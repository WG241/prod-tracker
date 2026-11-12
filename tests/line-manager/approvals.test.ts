import 'dotenv/config'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, test } from 'node:test'
import { setTimeout } from 'node:timers/promises'
import express from 'express'
import { authTestDatabase, readAuthConfig } from '../../server/auth/config.ts'
import { provision } from '../../server/auth/provision.ts'
import { createAuth } from '../../server/auth/provider.ts'
import { createAuthService } from '../../server/auth/service.ts'
import { day, isoDay, shiftDay } from '../../server/data-model/calendar.ts'
import { createDatabase, databaseClock } from '../../server/db.ts'
import { mutateTask } from '../../server/employee/writes.ts'
import { parseOperation } from '../../server/employee/task-validation.ts'
import { historyQuery, readHistory } from '../../server/employee/history-reads.ts'
import { readTaskDetail } from '../../server/employee/reads.ts'
import { recipientRefusal, storedBasis } from '../../server/email/policy.ts'
import { reroutePendingRequests } from '../../server/line-manager/approval-writes.ts'
import { registerLineManager } from '../../server/line-manager/router.ts'
import { markRead } from '../../server/notifications/writes.ts'
import type { ReviewDetail, ReviewList, ReviewPeople, ReviewPerson, ReviewReceipt, ReviewSummary } from '../../src/features/line-manager/approvals-contracts.ts'
import { managerFixtures } from '../helpers/manager-dashboard-fixtures.ts'
import { frozenTeamFixture } from '../helpers/team-history-fixtures.ts'

const db = createDatabase(authTestDatabase(process.env.TEST_DATABASE_URL, process.env.DATABASE_URL))
const config = readAuthConfig()
const service = createAuthService(db, createAuth(db, config))
const app = express()
const server = createServer(app)
const priorMode = process.env.EMAIL_MODE
const priorFrom = process.env.EMAIL_FROM
let fixture: Awaited<ReturnType<typeof managerFixtures>>
let base = '', manager = '', other = '', employee = '', officerCookie = ''
const root = '/approvals'
const exact = (id: string) => `${root}/requests/${id}`
const get = (path: string, cookie = manager) => fetch(base + path, { headers: { cookie } })
const post = (path: string, body: unknown, cookie = manager, key = randomUUID()) => fetch(base + path, {
  method: 'POST', headers: { cookie, origin: config.origin, 'content-type': 'application/json', 'idempotency-key': key }, body: JSON.stringify(body),
})

async function login(email: string) {
  const result = await service.signIn(email, fixture.password, new Headers({ origin: config.origin }))
  return result.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ')
}
async function actor(cookie: string) {
  const session = await service.current(new Headers({ cookie }))
  assert.ok(session.context && session.internalSessionId)
  return { context: session.context, sessionId: session.internalSessionId }
}
async function read<T>(path: string, cookie = manager) {
  const response = await get(path, cookie)
  assert.equal(response.status, 200, path)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  return await response.json() as T
}

before(async () => {
  process.env.EMAIL_MODE = 'off'
  fixture = await managerFixtures(db, config)
  await provision(db, config, fixture.otherManagerId, fixture.password)
  manager = await login(fixture.email)
  other = await login((await db.user.findUniqueOrThrow({ where: { id: fixture.otherManagerId } })).email)
  employee = await login(fixture.ownerEmail)
  const router = express.Router()
  registerLineManager(router, db, service, config)
  app.use('/api', router)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/line-manager`
})
after(async () => {
  if (base) await new Promise<void>((resolve) => server.close(() => resolve()))
  for (const cookie of [manager, other, employee, officerCookie]) if (cookie) await service.signOut(new Headers({ cookie }))
  if (priorMode === undefined) delete process.env.EMAIL_MODE
  else process.env.EMAIL_MODE = priorMode
  if (priorFrom === undefined) delete process.env.EMAIL_FROM
  else process.env.EMAIL_FROM = priorFrom
  await db.$disconnect()
})

async function pending(title: string) {
  return db.$transaction(async (tx) => {
    const tracker = await tx.weeklyTracker.findUniqueOrThrow({ where: { userId_weekId: { userId: fixture.ownerId, weekId: fixture.weekId } } })
    const series = await tx.taskSeries.create({ data: { ownerId: fixture.ownerId } })
    const start = day(fixture.week)
    const task = await tx.weeklyTask.create({ data: { ownerId: fixture.ownerId, trackerId: tracker.id, seriesId: series.id,
      title, activity: 'Submitted test activity.', startsOn: start, endsOn: shiftDay(start, 4), status: 'AWAITING_APPROVAL' } })
    const request = await tx.approvalRequest.create({ data: { weeklyTaskId: task.id, submittedById: fixture.ownerId, submissionAssignmentId: fixture.ownerAssignmentId,
      assignedManagerId: fixture.managerId, attemptNumber: 1, submissionSnapshot: { version: 1, title, activity: task.activity,
        startsOn: fixture.week, endsOn: isoDay(task.endsOn), ownerId: fixture.ownerId, ownerDisplayName: fixture.ownerName,
        weekStartsOn: fixture.week, status: 'AWAITING_APPROVAL' } } })
    return { task, request }
  })
}

test('reads scoped groups, exact submitted detail, blockers and immutable decided attempts', async () => {
  const list = await read<ReviewList>(root)
  assert.equal(list.selection, null)
  assert.equal(list.groups.total, 1)
  assert.equal(list.groups.items[0]?.employeeId, fixture.ownerId)
  assert.equal(list.counts.APPROVED, 1)
  assert.equal(list.counts.BLOCKERS, 1)
  assert.deepEqual(list.decisions.items, [])
  const awaitingPeople = await read<ReviewPeople>(`${root}/people`)
  assert.deepEqual(awaitingPeople.people.items.map(({ id }) => id), [fixture.ownerId])
  const summary = await read<ReviewSummary>(root + '/summary')
  assert.deepEqual([summary.employeeCount, summary.requestCount], [1, 1])
  const selected = await read<ReviewPerson>(`${root}/people/${fixture.ownerId}/pending?week=${fixture.week}`)
  assert.equal(selected.requests.items[0]?.requestId, fixture.requestId)
  const detail = await read<ReviewDetail>(exact(fixture.requestId))
  assert.equal(detail.canDecide, true)
  assert.equal(detail.mode, 'PERMANENT')
  assert.equal(detail.attempt.note, null)
  assert.equal((await get(exact(fixture.requestId), other)).status, 404)
  assert.equal((await get(root, employee)).status, 403)
  for (const query of ['tab=INVALID', 'page=1&page=2', 'actorId=other', `week=${fixture.week}&from=${fixture.week}&to=${fixture.week}`]) {
    assert.equal((await get(`${root}?${query}`)).status, 400)
  }
})

test('excludes malformed decision evidence from totals, pages and Employee options', async () => {
  const task = await db.weeklyTask.findFirstOrThrow({ where: { ownerId: fixture.ownerId, title: 'Approved dashboard task' } })
  const invalid = [
    { activity: '😀'.repeat(3001), startsOn: isoDay(task.startsOn) },
    { activity: task.activity, startsOn: '2001-02-29' },
  ]
  await db.$transaction(async (tx) => {
    for (const [index, fields] of invalid.entries()) {
      const request = await tx.approvalRequest.create({ data: { weeklyTaskId: task.id, submittedById: fixture.ownerId,
        submissionAssignmentId: fixture.ownerAssignmentId, assignedManagerId: fixture.managerId, attemptNumber: index + 2, state: 'DECIDED',
        submissionSnapshot: { version: 1, ownerId: fixture.ownerId, title: task.title, ownerDisplayName: 'Malformed Employee',
          ...fields, endsOn: isoDay(task.endsOn), weekStartsOn: fixture.week, status: 'AWAITING_APPROVAL' } } })
      await tx.approvalDecision.create({ data: { requestId: request.id, actorId: fixture.managerId, decision: 'APPROVE', method: 'HUMAN' } })
    }
  })
  const list = await read<ReviewList>(`${root}?tab=APPROVED`)
  assert.equal(list.decisions.total, 1)
  assert.deepEqual(list.decisions.items.map(({ ownerName }) => ownerName), [fixture.ownerName])
  const options = await read<ReviewPeople>(`${root}/people?tab=APPROVED&search=Malformed`)
  assert.equal(options.people.total, 0)
})

test('concurrent decisions commit exactly once and replay the original actor receipt', async () => {
  const url = exact(fixture.requestId) + '/approve'
  const requestKey = randomUUID()
  const body = { expectedTaskRevision: 0 }
  const concurrent = await Promise.all([post(url, body, manager, requestKey), post(url, body, manager, requestKey)])
  assert.deepEqual(concurrent.map(({ status }) => status), [200, 200])
  const results = await Promise.all(concurrent.map((response) => response.json() as Promise<{ result: ReviewReceipt; replayed: boolean; summary: ReviewSummary }>))
  assert.deepEqual(results[0].result, results[1].result)
  assert.equal(results.filter(({ replayed }) => replayed).length, 1)
  assert.equal(results[0].summary.employeeCount, 0)
  assert.equal((await post(url, body)).status, 409)
  assert.equal((await post(url, { expectedTaskRevision: 1 }, manager, requestKey)).status, 409)
  const outcome = await db.approvalDecision.findUniqueOrThrow({ where: { requestId: fixture.requestId }, include: { request: { include: { task: true } } } })
  assert.deepEqual([outcome.actorId, outcome.method, outcome.request.state, outcome.request.task.status, outcome.request.task.revision],
    [fixture.managerId, 'HUMAN', 'DECIDED', 'APPROVED', 1])
  const notice = await db.notification.findUniqueOrThrow({ where: { recipientId_deduplicationKey: {
    recipientId: fixture.ownerId, deduplicationKey: `approval-decision:${outcome.id}`,
  } }, include: { email: true } })
  assert.equal(notice.approvalRequestId, fixture.requestId)
  assert.equal(notice.email?.failureCode, 'MAIL_DISABLED')
  const opened = await markRead(db, await actor(employee), randomUUID(), { operation: 'NOTIFICATION_READ', notificationId: notice.id })
  assert.ok('target' in opened)
  assert.deepEqual(opened.target, { kind: 'OWN_TASK', taskId: outcome.request.task.id, week: fixture.week })
})

test('reviews and decides Employee submissions up to the activity limit', async () => {
  const user = await actor(employee)
  const task = await db.weeklyTask.findFirstOrThrow({ where: { ownerId: fixture.ownerId, status: 'IN_PROGRESS' } })
  for (const [length, outcome] of [[4001, 'decline'], [6000, 'approve']] as const) {
    const current = await db.weeklyTask.findUniqueOrThrow({ where: { id: task.id } })
    const activity = length === 6000 ? '😀'.repeat(3000) : 'a'.repeat(length)
    const edit = parseOperation('EDIT', current.id, { title: current.title, activity, startsOn: isoDay(current.startsOn),
      endsOn: isoDay(current.endsOn), carryRequested: current.carryRequested }, `"${current.revision}"`)
    const edited = await mutateTask(db, user.context, user.sessionId, randomUUID(), edit)
    const submitted = await mutateTask(db, user.context, user.sessionId, randomUUID(),
      { kind: 'STATUS', taskId: task.id, revision: edited.taskRevision, status: 'COMPLETED' })
    assert.ok(submitted.approvalRequestId)
    const url = exact(submitted.approvalRequestId)
    const group = await read<ReviewPerson>(`${root}/people/${fixture.ownerId}/pending`)
    assert.ok(group.requests.items.find(({ requestId }) => requestId === submitted.approvalRequestId)?.activity === activity)
    assert.ok((await read<ReviewDetail>(url)).attempt.activity === activity)
    const response = await post(`${url}/${outcome}`, { expectedTaskRevision: submitted.taskRevision,
      ...(outcome === 'decline' ? { reason: 'Please add supporting evidence.' } : {}) })
    assert.equal(response.status, 200, await response.text())
    const history = await read<ReviewList>(`${root}?tab=${outcome === 'approve' ? 'APPROVED' : 'DECLINED'}`)
    assert.ok(history.decisions.items.find(({ requestId }) => requestId === submitted.approvalRequestId)?.activity === activity)
  }
})

test('rejects a stale batch atomically and approves only the supplied displayed attempts', async () => {
  const one = await pending('Batch first'), two = await pending('Batch second'), later = await pending('Arrived later')
  const path = root + '/approve-batch'
  const items = [one, two].map(({ request, task }) => ({ requestId: request.id, expectedTaskRevision: task.revision }))
  assert.equal((await post(path, { items: [items[0], items[0]] })).status, 400)
  assert.equal((await post(path, { items: Array.from({ length: 26 }, () => items[0]) })).status, 400)
  assert.equal((await post(path, { items: [items[0], { ...items[1], expectedTaskRevision: 1 }] })).status, 409)
  assert.equal(await db.approvalDecision.count({ where: { requestId: { in: items.map(({ requestId }) => requestId) } } }), 0)
  const key = randomUUID()
  const applied = await post(path, { items }, manager, key)
  assert.equal(applied.status, 200)
  const result = (await applied.json() as { result: ReviewReceipt }).result
  assert.ok('items' in result)
  assert.equal(result.items.length, 2)
  const replay = await post(path, { items: items.toReversed() }, manager, key)
  assert.equal(replay.status, 200)
  assert.equal((await replay.json() as { replayed: boolean }).replayed, true)
  assert.equal(await db.approvalDecision.count({ where: { requestId: later.request.id } }), 0)
})

test('a failed owner alert rolls back every decision, task revision, audit and receipt in the batch', async () => {
  const first = await pending('First rollback item'), second = await pending('Second rollback item')
  const key = randomUUID()
  const items = [first, second].map(({ request }) => ({ requestId: request.id, expectedTaskRevision: 0 }))
  const taskIds = [first.task.id, second.task.id]
  const blocked = second.task.id
  assert.match(blocked, /^[a-z0-9]+$/i)
  await db.$executeRawUnsafe(`ALTER TABLE "Notification" ADD CONSTRAINT "test_approvals_alert_${blocked}"
    CHECK ("weeklyTaskId" IS DISTINCT FROM '${blocked}' OR kind <> 'APPROVAL_APPROVED') NOT VALID`)
  try {
    assert.equal((await post(root + '/approve-batch', { items }, manager, key)).status, 503)
    assert.equal(await db.approvalDecision.count({ where: { requestId: { in: items.map(({ requestId }) => requestId) } } }), 0)
    assert.equal(await db.weeklyTask.count({ where: { id: { in: taskIds }, status: 'AWAITING_APPROVAL', revision: 0 } }), 2)
    assert.equal(await db.notification.count({ where: { weeklyTaskId: { in: taskIds }, kind: 'APPROVAL_APPROVED' } }), 0)
    assert.equal(await db.sharedMutationReceipt.count({ where: { userId: fixture.managerId, requestId: key } }), 0)
    assert.equal(await db.auditEvent.count({ where: { actorId: fixture.managerId, action: 'MANAGER_APPROVAL_DECIDED',
      OR: items.map(({ requestId }) => ({ after: { path: ['approvalRequestId'], equals: requestId } })) } }), 0)
  } finally {
    await db.$executeRawUnsafe(`ALTER TABLE "Notification" DROP CONSTRAINT "test_approvals_alert_${blocked}"`)
  }
})

test('a full Review page approves 25 exact attempts and leaves the next page pending', async () => {
  for (let index = 0; index < 26; index++) await pending(`Paged approval item ${index + 1}`)
  const path = `${root}/people/${fixture.ownerId}/pending?week=${fixture.week}`
  const first = await read<ReviewPerson>(path)
  const second = await read<ReviewPerson>(path + '&page=2')
  assert.equal(first.requests.items.length, 25)
  assert.ok(second.requests.items.length > 0)
  const items = first.requests.items.map(({ requestId, revision }) => ({ requestId, expectedTaskRevision: revision }))
  const response = await post(root + '/approve-batch', { items })
  assert.equal(response.status, 200)
  const result = (await response.json() as { result: ReviewReceipt }).result
  assert.ok('items' in result)
  assert.equal(result.items.length, 25)
  assert.equal(await db.approvalRequest.count({ where: { id: { in: second.requests.items.map(({ requestId }) => requestId) }, state: 'PENDING' } }), second.requests.items.length)
  const times = await db.approvalDecision.findMany({ where: { id: { in: result.items.map(({ decisionId }) => decisionId) } }, select: { decidedAt: true } })
  assert.equal(new Set(times.map(({ decidedAt }) => decidedAt.toISOString())).size, 1)

  const filter = `${root}?tab=APPROVED&week=${fixture.week}&personId=${fixture.ownerId}`
  const pageOne = await read<ReviewList>(filter)
  const pageTwo = await read<ReviewList>(filter + '&page=2')
  assert.deepEqual(pageOne.decisions.items.map(({ requestId }) => requestId), result.items
    .toSorted((a, b) => b.decisionId.localeCompare(a.decisionId)).map(({ approvalRequestId }) => approvalRequestId))
  assert.equal(pageOne.counts.APPROVED, pageOne.decisions.total)
  assert.equal(pageTwo.decisions.total, pageOne.decisions.total)
  assert.equal(pageTwo.decisions.items.length, pageOne.decisions.total - 25)
  assert.deepEqual((await read<ReviewList>(filter + '&page=9007199254740991')).decisions.items, [])
  const options = await read<ReviewPeople>(`${root}/people?tab=APPROVED&week=${fixture.week}&search=${fixture.prefix}`)
  assert.deepEqual(options.people.items.map(({ id }) => id), [fixture.ownerId])
})

test('reroutes a frozen pending attempt and records a late decline without changing the archive', async () => {
  const frozen = await frozenTeamFixture(db, fixture, true, true)
  const assignment = await db.employmentAssignment.findFirstOrThrow({ where: { userId: frozen.transfer.id, effectiveTo: null } })
  assert.equal((await get(exact(frozen.requestId), other)).status, 503)
  await db.$transaction((tx) => reroutePendingRequests(tx, frozen.transfer.id, assignment.id, fixture.otherManagerId))
  assert.equal((await get(exact(frozen.requestId))).status, 404)
  const detail = await read<ReviewDetail>(exact(frozen.requestId), other)
  assert.equal(detail.frozen, true)
  assert.equal(detail.canDecide, true)
  assert.equal(detail.canComment, false)
  assert.equal((await post(exact(frozen.requestId) + '/comments', { body: 'Frozen reply' }, other)).status, 423)
  const old = await db.historyTaskSnapshot.findUniqueOrThrow({ where: { id: frozen.taskId } })
  assert.equal((await post(exact(frozen.requestId) + '/decline', { expectedTaskRevision: 0, reason: 'Too short' }, other)).status, 400)
  const reason = 'Please attach the signed evidence for this submission.'
  const response = await post(exact(frozen.requestId) + '/decline', { expectedTaskRevision: 0, reason: `  ${reason}  ` }, other)
  assert.equal(response.status, 200, await response.text())
  const later = await db.approvalDecision.findUniqueOrThrow({ where: { requestId: frozen.requestId } })
  assert.equal(later.reason, reason)
  assert.ok(later.decidedAt > old.createdAt)
  assert.deepEqual(await db.historyTaskSnapshot.findUnique({ where: { id: frozen.taskId } }), old)
  assert.equal((await db.weeklyTask.findUniqueOrThrow({ where: { id: frozen.taskId } })).status, 'DECLINED')
  assert.equal((await read<ReviewList>(`${root}?tab=DECLINED&week=${frozen.week}`)).decisions.items[0]?.requestId, frozen.requestId)
  assert.equal((await read<ReviewList>(`${root}?tab=DECLINED&week=${frozen.week}`, other)).decisions.total, 0)
  const options = await read<ReviewPeople>(`${root}/people?tab=DECLINED&week=${frozen.week}`)
  assert.deepEqual(options.people.items.map(({ id }) => id), [frozen.transfer.id])
  assert.equal((await get(exact(frozen.requestId), other)).status, 404)
  await assert.rejects(db.weeklyTask.update({ where: { id: frozen.taskId }, data: { title: 'Change frozen text' } }))
  await provision(db, config, frozen.transfer.id, fixture.password)
  const owner = await login((await db.user.findUniqueOrThrow({ where: { id: frozen.transfer.id } })).email)
  try {
    const { context } = await actor(owner)
    const at = await databaseClock(db)
    const projected = await db.$transaction((tx) => readTaskDetail(tx, context, frozen.taskId, { commentPage: 1 }, at))
    assert.equal(projected.task.status, 'DECLINED')
    assert.equal(projected.task.title, frozen.title)
    assert.equal(projected.review?.decision?.decidedAt, later.decidedAt.toISOString())
    const history = await readHistory(db, context, historyQuery(`/history?week=${frozen.week}&status=DECLINED`), at)
    assert.deepEqual(history.records.items.map(({ id, status }) => [id, status]), [[frozen.taskId, 'DECLINED']])
  } finally { await service.signOut(new Headers({ cookie: owner })) }
})

test('effective relief gets exact notifications and reply access that ends immediately on revocation', async () => {
  process.env.EMAIL_MODE = 'preview'
  process.env.EMAIL_FROM = 'notifications@example.invalid'
  const officer = await db.$transaction(async (tx) => {
    const business = await tx.business.create({ data: { name: `Approval cover business ${fixture.prefix}` } })
    const unit = await tx.unit.create({ data: { name: 'Review cover', businessId: business.id } })
    const person = await tx.user.create({ data: { email: `f19-officer-${fixture.tag}@example.invalid`, name: 'Cross business officer', accountStatus: 'ACTIVE' } })
    await tx.employmentAssignment.create({ data: { userId: person.id, role: 'LINE_MANAGER', businessId: business.id, unitId: unit.id,
      effectiveFrom: await databaseClock(tx) } })
    return person
  })
  await provision(db, config, officer.id, fixture.password)
  officerCookie = await login(officer.email)
  const leave = await db.leaveRecord.create({ data: { userId: fixture.managerId, startsOn: fixture.today, expectedReturnOn: shiftDay(fixture.today, 1) } })
  const relief = await db.reliefAssignment.create({ data: { coveredManagerId: fixture.managerId, reliefManagerId: officer.id,
    startsOn: fixture.today, endsOn: shiftDay(fixture.today, 1), leaveId: leave.id } })
  const user = await actor(employee)
  const task = await db.weeklyTask.findUniqueOrThrow({ where: { id: fixture.blockerId } })
  const submitted = await mutateTask(db, user.context, user.sessionId, randomUUID(),
    { kind: 'STATUS', taskId: task.id, revision: task.revision, status: 'COMPLETED' })
  assert.ok(submitted.approvalRequestId)
  const url = exact(submitted.approvalRequestId)
  assert.equal((await read<ReviewDetail>(url)).workPaused, true)
  assert.equal((await post(url + '/approve', { expectedTaskRevision: submitted.taskRevision })).status, 423)
  assert.equal((await read<ReviewDetail>(url, officerCookie)).mode, 'RELIEF')
  assert.equal((await get(`/team-tasks/${task.id}`, officerCookie)).status, 404)
  const note = await db.notification.findUniqueOrThrow({ where: { recipientId_deduplicationKey: {
    recipientId: officer.id, deduplicationKey: `approval-requested:${submitted.approvalRequestId}`,
  } }, include: { email: true } })
  assert.equal(note.email?.state, 'QUEUED')
  assert.equal(note.email?.transportMode, 'preview')
  const permanent = await db.notification.findUniqueOrThrow({ where: { recipientId_deduplicationKey: {
    recipientId: fixture.managerId, deduplicationKey: note.deduplicationKey,
  } }, include: { email: true } })
  assert.equal(permanent.email?.failureCode, 'ON_LEAVE')
  const basis = storedBasis(note.email?.recipientBasis ?? null)
  assert.equal(basis?.relationship, 'RELIEF_REVIEWER')
  const reviewer = await actor(officerCookie), notificationKey = randomUUID()
  const opened = await markRead(db, reviewer, notificationKey, { operation: 'NOTIFICATION_READ', notificationId: note.id })
  assert.ok('target' in opened)
  assert.equal(opened.target.kind, 'REVIEW_REQUEST')
  const commentKey = randomUUID(), comment = { body: 'Please confirm the supporting evidence.' }
  const reply = await post(url + '/comments', comment, officerCookie, commentKey)
  assert.equal(reply.status, 200)
  const ownerReply = await mutateTask(db, user.context, user.sessionId, randomUUID(),
    { kind: 'COMMENT', taskId: task.id, body: 'I have added the supporting evidence.' })
  const routedReplies = await db.notification.findMany({ where: { deduplicationKey: `task-commented:${ownerReply.commentId}` } })
  assert.deepEqual(routedReplies.map(({ recipientId }) => recipientId).sort(), [fixture.managerId, officer.id].sort())
  assert.ok(routedReplies.every(({ approvalRequestId }) => approvalRequestId === submitted.approvalRequestId))
  const approved = await db.approvalRequest.findUniqueOrThrow({ where: { id: fixture.requestId } })
  const nonpending = await mutateTask(db, user.context, user.sessionId, randomUUID(),
    { kind: 'COMMENT', taskId: approved.weeklyTaskId, body: 'Here is the final file location.' })
  const managerNote = await db.notification.findUniqueOrThrow({ where: { recipientId_deduplicationKey: {
    recipientId: fixture.managerId, deduplicationKey: `task-commented:${nonpending.commentId}`,
  } } })
  const team = await markRead(db, await actor(manager), randomUUID(), { operation: 'NOTIFICATION_READ', notificationId: managerNote.id })
  assert.ok('target' in team)
  assert.deepEqual(team.target, { kind: 'TEAM_TASK', taskId: approved.weeklyTaskId, week: fixture.week })
  const another = await pending('Decision by a cross business reviewer')
  assert.equal((await post(exact(another.request.id) + '/approve', { expectedTaskRevision: 0 }, officerCookie)).status, 200)
  const coveredDecision = await db.approvalDecision.findUniqueOrThrow({ where: { requestId: another.request.id } })
  assert.deepEqual([coveredDecision.actorId, coveredDecision.actingForManagerId, coveredDecision.reliefAssignmentId], [officer.id, fixture.managerId, relief.id])
  assert.equal((await get(exact(another.request.id), officerCookie)).status, 404)
  let locked!: () => void, release!: () => void
  const held = new Promise<void>((resolve) => { locked = resolve })
  const released = new Promise<void>((resolve) => { release = resolve })
  const ownerLock = db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${fixture.ownerId} FOR UPDATE`
    locked()
    await released
  })
  await held
  const attempted = post(url + '/approve', { expectedTaskRevision: submitted.taskRevision }, officerCookie)
  try {
    await setTimeout(250)
    await db.reliefAssignment.update({ where: { id: relief.id }, data: { endedAt: await databaseClock(db), endedById: fixture.managerId } })
  } finally {
    release()
    await ownerLock
  }
  assert.equal((await attempted).status, 404)
  assert.equal((await get(url, officerCookie)).status, 404)
  assert.equal((await post(url + '/comments', comment, officerCookie)).status, 404)
  assert.equal((await post(url + '/comments', comment, officerCookie, commentKey)).status, 200)
  const replay = await markRead(db, reviewer, notificationKey, { operation: 'NOTIFICATION_READ', notificationId: note.id })
  assert.ok('target' in replay)
  assert.equal(replay.target.kind, 'UNAVAILABLE')
  assert.ok(basis)
  assert.equal(await db.$transaction(async (tx) => recipientRefusal(tx, note, basis, officer.email, await databaseClock(tx))), 'RELATIONSHIP_CHANGED')
})
