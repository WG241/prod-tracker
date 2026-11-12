import 'dotenv/config'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, test } from 'node:test'
import express from 'express'
import type { DashboardResponse, ManagerReceipt, TeamTaskDetail } from '../../src/features/line-manager/dashboard-view.ts'
import { authTestDatabase, readAuthConfig } from '../../server/auth/config.ts'
import { createAuth } from '../../server/auth/provider.ts'
import { createAuthService } from '../../server/auth/service.ts'
import { day, isoDay, shiftDay, watMidnight } from '../../server/data-model/calendar.ts'
import { createDatabase, databaseClock } from '../../server/db.ts'
import { recipientRefusal, storedBasis } from '../../server/email/policy.ts'
import { dashboardQuery } from '../../server/line-manager/query.ts'
import { registerLineManager } from '../../server/line-manager/router.ts'
import { mutateDashboard } from '../../server/line-manager/writes.ts'
import { managerFixtures } from '../helpers/manager-dashboard-fixtures.ts'
import { historicalFixtures } from '../helpers/historical-fixtures.ts'

const db = createDatabase(authTestDatabase(process.env.TEST_DATABASE_URL, process.env.DATABASE_URL))
const config = readAuthConfig()
const service = createAuthService(db, createAuth(db, config))
const server = createServer()
let fixture: Awaited<ReturnType<typeof managerFixtures>>
let base = '', cookie = '', employeeCookie = ''
const priorMode = process.env.EMAIL_MODE

async function login(email: string) {
  const result = await service.signIn(email, fixture.password, new Headers({ origin: config.origin }))
  return result.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ')
}

before(async () => {
  process.env.EMAIL_MODE = 'off'
  fixture = await managerFixtures(db, config)
  cookie = await login(fixture.email)
  employeeCookie = await login(fixture.ownerEmail)
  const app = express(), router = express.Router()
  registerLineManager(router, db, service, config)
  app.use('/api', router)
  server.on('request', app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/line-manager`
})
after(async () => {
  if (base) await new Promise<void>((resolve) => server.close(() => resolve()))
  for (const session of [cookie, employeeCookie]) if (session) await service.signOut(new Headers({ cookie: session }))
  if (priorMode === undefined) delete process.env.EMAIL_MODE
  else process.env.EMAIL_MODE = priorMode
  await db.$disconnect()
})

const get = (path: string, session = cookie) => fetch(base + path, { headers: { cookie: session } })
const post = (path: string, body: unknown, id = randomUUID()) => fetch(base + path, { method: 'POST', headers: {
  cookie, origin: config.origin, 'content-type': 'application/json', 'idempotency-key': id,
}, body: JSON.stringify(body) })

test('selectors accept only named pages, real Mondays and whole overlapping workweeks', () => {
  const at = new Date('2026-11-09T12:00:00Z')
  assert.deepEqual(dashboardQuery('/dashboard?from=2026-11-07&to=2026-11-08', at).included, [])
  assert.deepEqual(dashboardQuery('/dashboard?from=2026-11-05&to=2026-11-09', at).included.map(isoDay), ['2026-11-02', '2026-11-09'])
  assert.equal(dashboardQuery('/dashboard?week=0001-01-01', at).trend.length, 1)
  for (const query of ['week=2026-11-10', 'from=2026-01-01&to=2027-01-02', 'activityPage=0', 'missingPage=1&missingPage=2', 'ownerId=other']) {
    assert.throws(() => dashboardQuery('/dashboard?' + query, at))
  }
})

test('live report uses current direct Employees, independent pages and canonical task outcomes', async () => {
  const response = await get('/dashboard')
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  const data = await response.json() as DashboardResponse
  assert.deepEqual(data.metrics, { members: 3, completion: 25, awaiting: 1, inProgress: 1 })
  assert.deepEqual(data.trend.at(-1), { week: fixture.week, submission: 50, completion: 25 })
  assert.equal(data.approvals.items[0].requestId, fixture.requestId)
  assert.equal(data.approvalBadge, 1)
  assert.deepEqual(data.missing.items.map(({ employeeId }) => employeeId), [fixture.missingId])
  assert.equal(data.missing.items[0].canRemind, true)
  assert.deepEqual(data.blocked.items.map(({ id }) => id), [fixture.blockerId])
  assert.ok(data.activity.items.some(({ summary }) => summary.includes('Approved dashboard task')))
  const out = await (await get('/dashboard?approvalPage=9007199254740991&blockedPage=9007199254740991')).json() as DashboardResponse
  assert.deepEqual([out.approvals.total, out.blocked.total, out.approvals.items.length, out.blocked.items.length], [1, 1, 0, 0])
  assert.equal(out.missing.items.length, 1)
  const future = await (await get(`/dashboard?week=${isoDay(shiftDay(day(fixture.week), 7))}`)).json() as DashboardResponse
  assert.equal(future.metrics.members, null)
  assert.equal(future.missing.total, 0)
  assert.equal(future.trend.at(-1)?.week, fixture.week)
  assert.equal((await get('/dashboard', '')).status, 401)
  assert.equal((await get('/dashboard', employeeCookie)).status, 403)
  assert.equal((await get(`/team-tasks/${fixture.outsideTaskId}`)).status, 404)
})

test('an incomplete frozen roster keeps valid recorded blockers and withholds totals across reassignment', async () => {
  const saved = await historicalFixtures(async (tx) => {
    let start = shiftDay(day(fixture.week), -7)
    while (await tx.workWeek.findUnique({ where: { startsOn: start }, select: { id: true } })) start = shiftDay(start, -7)
    const at = await databaseClock(tx)
    const freezesAt = watMidnight(shiftDay(start, 5))
    const original = await tx.employmentAssignment.findUniqueOrThrow({ where: { id: fixture.ownerAssignmentId }, include: { unit: true, business: true } })
    const recordedOwner = `f16-recorded-${fixture.tag}`, name = 'Recorded employee for the old team'
    await tx.user.create({ data: { id: recordedOwner, name: 'Employee after transfer', email: `${recordedOwner}@example.invalid`,
      accountStatus: 'ACTIVE', createdAt: watMidnight(start) } })
    const old = await tx.employmentAssignment.create({ data: { userId: recordedOwner, role: 'EMPLOYEE', unitId: original.unitId, businessId: original.businessId,
      managerId: fixture.managerId, effectiveFrom: watMidnight(start), effectiveTo: at } })
    await tx.employmentAssignment.create({ data: { userId: recordedOwner, role: 'EMPLOYEE', unitId: original.unitId, businessId: original.businessId,
      managerId: fixture.otherManagerId, effectiveFrom: at } })
    const week = await tx.workWeek.create({ data: { startsOn: start, freezesAt, planningLocksAt: watMidnight(shiftDay(start, 1)) } })
    const tracker = await tx.weeklyTracker.create({ data: { userId: recordedOwner, weekId: week.id, assignmentId: old.id, snapshotAt: at, expectedWorkingDaysSnapshot: 4,
      contextSnapshot: { version: 1, userId: recordedOwner, displayName: name, role: 'EMPLOYEE', accountStatus: 'ACTIVE',
        unitId: original.unitId, unitName: original.unit!.name, businessId: original.businessId, businessName: original.business!.name,
        managerId: fixture.managerId, managerName: fixture.managerName, departmentLabel: null } } })
    const series = await tx.taskSeries.create({ data: { ownerId: recordedOwner } })
    const task = await tx.weeklyTask.create({ data: { seriesId: series.id, trackerId: tracker.id, ownerId: recordedOwner,
      title: 'Recorded blocker', activity: 'Captured before the employee moved teams.', startsOn: start, endsOn: shiftDay(start, 3),
      status: 'BLOCKED', blockerReason: 'Waiting on a recorded dependency.' } })
    return { week: isoDay(start), weekId: week.id, taskId: task.id, name }
  })
  const response = await get(`/dashboard?week=${saved.week}`)
  assert.equal(response.status, 200)
  const data = await response.json() as DashboardResponse
  assert.deepEqual(data.availability.unavailableWeeks, [saved.week])
  assert.equal(data.metrics.members, null)
  assert.equal(data.trend.at(-1)?.submission, null)
  assert.deepEqual(data.blocked.items.map(({ id, ownerName, current }) => ({ id, ownerName, current })), [{ id: saved.taskId, ownerName: saved.name, current: false }])
  assert.equal((await post(`/team-tasks/${saved.taskId}/comments`, { body: 'Historical work cannot be changed' })).status, 404)
  await db.workWeek.update({ where: { id: saved.weekId }, data: { rosterCapturedAt: await databaseClock(db) } })
  const complete = await (await get(`/dashboard?week=${saved.week}`)).json() as DashboardResponse
  assert.deepEqual(complete.availability.unavailableWeeks, [])
  assert.equal(complete.metrics.members, 1)
  assert.equal(complete.trend.at(-1)?.submission, 100)
})

test('active relief adds exact pending attempts to the queue without adding the covered team to reports', async () => {
  const coverage = await db.$transaction(async (tx) => {
    const at = await databaseClock(tx)
    const task = await tx.weeklyTask.update({ where: { id: fixture.outsideTaskId }, data: { status: 'AWAITING_APPROVAL', blockerReason: null } })
    const assignment = await tx.employmentAssignment.findFirstOrThrow({ where: { userId: task.ownerId, effectiveTo: null } })
    const request = await tx.approvalRequest.create({ data: { weeklyTaskId: task.id, submittedById: task.ownerId, submissionAssignmentId: assignment.id,
      assignedManagerId: fixture.otherManagerId, submittedAt: at, attemptNumber: 1,
      submissionSnapshot: { version: 1, ownerId: task.ownerId, title: task.title, ownerDisplayName: 'Employee with temporary cover',
        activity: task.activity, startsOn: fixture.week, endsOn: isoDay(task.endsOn), weekStartsOn: fixture.week, status: 'AWAITING_APPROVAL' } } })
    const leave = await tx.leaveRecord.create({ data: { userId: fixture.otherManagerId, startsOn: fixture.today, expectedReturnOn: shiftDay(fixture.today, 1), createdAt: at } })
    const relief = await tx.reliefAssignment.create({ data: { leaveId: leave.id, coveredManagerId: fixture.otherManagerId, reliefManagerId: fixture.managerId,
      startsOn: fixture.today, endsOn: shiftDay(fixture.today, 1), createdAt: at } })
    return { request, relief }
  })
  const active = await (await get('/dashboard')).json() as DashboardResponse
  assert.equal(active.metrics.members, 3)
  assert.equal(active.metrics.awaiting, 2)
  assert.ok(active.approvals.items.some(({ requestId }) => requestId === coverage.request.id))
  assert.equal((await get(`/team-tasks/${fixture.outsideTaskId}`)).status, 404)
  await db.reliefAssignment.update({ where: { id: coverage.relief.id }, data: { endedAt: await databaseClock(db), endedById: fixture.otherManagerId } })
  const ended = await (await get('/dashboard')).json() as DashboardResponse
  assert.equal(ended.metrics.awaiting, 1)
})

test('concurrent reminders share one daily notice, receipt replays and outbox evidence', async () => {
  const key = randomUUID(), input = { employeeId: fixture.missingId, week: fixture.week }
  const responses = await Promise.all([post('/reminders', input, key), post('/reminders', input)])
  assert.deepEqual(responses.map(({ status }) => status), [200, 200])
  const results = await Promise.all(responses.map((response) => response.json() as Promise<{ result: ManagerReceipt }>))
  assert.equal(results.filter(({ result }) => result.changed).length, 1)
  assert.ok(results.every(({ result }) => result.operation === 'LM_REMIND'))
  const first = results[0].result
  assert.ok(first.operation === 'LM_REMIND')
  const retry = await (await post('/reminders', input, key)).json()
  assert.deepEqual(retry, { result: first, replayed: true })
  assert.equal((await post('/reminders', { ...input, employeeId: fixture.ownerId }, key)).status, 409)
  assert.equal((await post('/reminders', { ...input, employeeId: fixture.ownerId })).status, 409)
  assert.equal((await post('/reminders', { ...input, employeeId: fixture.leaveId })).status, 423)
  assert.equal((await post('/reminders', { ...input, employeeId: fixture.outsideId })).status, 404)
  const notice = await db.notification.findUniqueOrThrow({ where: { id: first.notificationId }, include: { email: true } })
  assert.equal(notice.workWeekId, fixture.weekId)
  assert.equal(notice.email?.failureCode, 'MAIL_DISABLED')
  assert.equal(await db.auditEvent.count({ where: { action: 'MANAGER_WORK_REMINDER_SENT', targetId: notice.id } }), 1)
})

test('comments record a single real author and owner alert without changing Employee task content', async () => {
  const path = `/team-tasks/${fixture.blockerId}`, body = { body: '  Please confirm the next step with the client.  ' }, key = randomUUID()
  const beforeTask = await db.weeklyTask.findUniqueOrThrow({ where: { id: fixture.blockerId } })
  const first = await post(path + '/comments', body, key)
  assert.equal(first.status, 200)
  const receipt = (await first.json() as { result: ManagerReceipt }).result
  assert.ok(receipt.operation === 'LM_TASK_COMMENT')
  assert.deepEqual(await (await post(path + '/comments', body, key)).json(), { result: receipt, replayed: true })
  assert.equal((await post(path + '/comments', { body: 'Different' }, key)).status, 409)
  assert.equal((await post(`/team-tasks/${fixture.outsideTaskId}/comments`, body)).status, 404)
  assert.deepEqual(await db.weeklyTask.findUniqueOrThrow({ where: { id: fixture.blockerId } }), beforeTask)
  const detail = await (await get(path)).json() as TeamTaskDetail
  assert.equal(detail.comments.total, 1)
  assert.equal(detail.comments.items[0].authorName, fixture.managerName)
  assert.equal(detail.comments.items[0].body, body.body.trim())
  const notice = await db.notification.findFirstOrThrow({ where: { kind: 'TASK_COMMENTED', weeklyTaskId: fixture.blockerId }, include: { email: true } })
  assert.equal(notice.recipientId, fixture.ownerId)
  assert.ok(!notice.body.includes(body.body.trim()))
  assert.equal(notice.email?.failureCode, 'MAIL_DISABLED')
})

test('eligible comment email uses Preview, and a later preference change prevents delivery', async () => {
  const oldFrom = process.env.EMAIL_FROM
  process.env.EMAIL_MODE = 'preview'
  process.env.EMAIL_FROM = 'notifications@example.invalid'
  try {
    const response = await post(`/team-tasks/${fixture.blockerId}/comments`, { body: 'Private text belongs in the conversation.' })
    assert.equal(response.status, 200)
    const receipt = (await response.json() as { result: ManagerReceipt }).result
    assert.ok(receipt.operation === 'LM_TASK_COMMENT')
    const notice = await db.notification.findUniqueOrThrow({ where: { recipientId_deduplicationKey: { recipientId: fixture.ownerId,
      deduplicationKey: `task-commented:${receipt.commentId}` } }, include: { email: true } })
    assert.equal(notice.email?.state, 'QUEUED')
    assert.ok(notice.email && !JSON.stringify(notice.email.messageSnapshot).includes('Private text belongs'))
    const basis = storedBasis(notice.email.recipientBasis)
    assert.ok(basis)
    const refusal = await db.$transaction(async (tx) => {
      const saved = await tx.notificationPreference.upsert({ where: { userId: fixture.ownerId }, create: { userId: fixture.ownerId, emailRemindersEnabled: false },
        update: { emailRemindersEnabled: false } })
      assert.equal(saved.emailRemindersEnabled, false)
      const reason = await recipientRefusal(tx, notice, basis, notice.email!.recipientEmail, await databaseClock(tx))
      if (reason) await tx.emailDelivery.update({ where: { id: notice.email!.id }, data: { state: 'SUPPRESSED', failureCode: reason } })
      return reason
    })
    assert.equal(refusal, 'PREFERENCE_DISABLED')
  } finally {
    process.env.EMAIL_MODE = 'off'
    if (oldFrom === undefined) delete process.env.EMAIL_FROM
    else process.env.EMAIL_FROM = oldFrom
  }
})

test('manager leave keeps reports readable and pauses new work while permitting a settled receipt', async () => {
  const session = await service.current(new Headers({ cookie }))
  assert.ok(session.context && session.internalSessionId)
  const actor = { context: session.context, sessionId: session.internalSessionId }
  const command = { operation: 'LM_TASK_COMMENT' as const, taskId: fixture.blockerId, body: 'This comment is saved before leave.' }
  const key = randomUUID()
  const saved = await mutateDashboard(db, actor, key, command)
  const at = await databaseClock(db)
  await db.leaveRecord.create({ data: { userId: fixture.managerId, startsOn: fixture.today, expectedReturnOn: shiftDay(fixture.today, 1), createdAt: at } })
  const read = await get('/dashboard')
  assert.equal(read.status, 200)
  const detail = await (await get(`/team-tasks/${fixture.blockerId}`)).json() as TeamTaskDetail
  assert.equal(detail.canComment, false)
  assert.equal((await post(`/team-tasks/${fixture.blockerId}/comments`, { body: 'Comment while away' })).status, 423)
  assert.deepEqual(await mutateDashboard(db, actor, key, command), { ...saved, replayed: true })
})

test('an event failure rolls back a comment, its receipt and its audit record', async () => {
  const current = await service.current(new Headers({ cookie }))
  assert.ok(current.context && current.internalSessionId)
  const actor = { context: current.context, sessionId: current.internalSessionId }
  const command = { operation: 'LM_TASK_COMMENT' as const, taskId: fixture.blockerId, body: 'Evidence that should not be persisted.' }
  const key = randomUUID()
  const beforeCount = await db.taskComment.count({ where: { weeklyTaskId: fixture.blockerId } })
  // A distinct actor is needed because the preceding scenario put the primary
  // manager on leave. Reject the outbox write in a real transaction via its
  // message shape instead of committing any fixture side effects.
  const active = await managerFixtures(db, config)
  const secondCookie = await login(active.email)
  try {
    const session = await service.current(new Headers({ cookie: secondCookie }))
    assert.ok(session.context && session.internalSessionId)
    await db.user.update({ where: { id: active.managerId }, data: { name: 'x'.repeat(4100) } })
    await assert.rejects(mutateDashboard(db, { context: session.context, sessionId: session.internalSessionId }, key, { ...command, taskId: active.blockerId }), { code: 'SERVICE_UNAVAILABLE' })
    assert.equal(await db.taskComment.count({ where: { weeklyTaskId: active.blockerId } }), 0)
    assert.equal(await db.sharedMutationReceipt.count({ where: { userId: active.managerId, requestId: key } }), 0)
    assert.equal(await db.notification.count({ where: { weeklyTaskId: active.blockerId, kind: 'TASK_COMMENTED' } }), 0)
    assert.equal(await db.auditEvent.count({ where: { actorId: active.managerId, action: 'MANAGER_TASK_COMMENTED' } }), 0)
  } finally {
    await db.user.update({ where: { id: active.managerId }, data: { name: active.managerName } })
    await service.signOut(new Headers({ cookie: secondCookie }))
  }
  assert.equal(await db.taskComment.count({ where: { weeklyTaskId: fixture.blockerId, authorId: actor.context.user.id } }), beforeCount)
})
