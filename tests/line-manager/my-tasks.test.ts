import 'dotenv/config'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, test } from 'node:test'
import express from 'express'
import type { Prisma } from '../../src/generated/prisma/client.ts'
import type { DetailResponse, HomeResponse } from '../../src/features/employee/contracts.ts'
import type { MutationResult, TaskDraft } from '../../src/features/employee/mutations.ts'
import { authTestDatabase, readAuthConfig } from '../../server/auth/config.ts'
import { provision } from '../../server/auth/provision.ts'
import { createAuth } from '../../server/auth/provider.ts'
import { createAuthService } from '../../server/auth/service.ts'
import { day, isoDay, shiftDay, watMidnight } from '../../server/data-model/calendar.ts'
import { createDatabase, databaseClock } from '../../server/db.ts'
import { registerEmployee } from '../../server/employee/router.ts'
import { mutateTask } from '../../server/employee/writes.ts'
import { registerLineManager } from '../../server/line-manager/router.ts'
import { registerNotifications } from '../../server/notifications/router.ts'
import { managerFixtures } from '../helpers/manager-dashboard-fixtures.ts'
import { historicalFixtures } from '../helpers/historical-fixtures.ts'

const db = createDatabase(authTestDatabase(process.env.TEST_DATABASE_URL, process.env.DATABASE_URL))
const config = readAuthConfig(), service = createAuthService(db, createAuth(db, config))
const server = createServer()
const root = '/api/line-manager/my-tasks'
let fixture: Awaited<ReturnType<typeof managerFixtures>>
let cookie = '', employeeCookie = '', otherCookie = '', base = ''
const previousMailMode = process.env.EMAIL_MODE

async function login(email: string) {
  const result = await service.signIn(email, fixture.password, new Headers({ origin: config.origin }))
  return result.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ')
}

before(async () => {
  process.env.EMAIL_MODE = 'off'
  fixture = await managerFixtures(db, config)
  const week = await db.workWeek.findUniqueOrThrow({ where: { id: fixture.weekId } })
  await db.planningUnlock.create({ data: { weekId: fixture.weekId, scope: 'PERSON', userId: fixture.managerId, grantedById: 'person-kemi-adebayo',
    reason: 'Isolated own task verification', expiresAt: week.freezesAt } })
  const other = await db.user.findUniqueOrThrow({ where: { id: fixture.otherManagerId } })
  await provision(db, config, other.id, fixture.password)
  cookie = await login(fixture.email)
  employeeCookie = await login(fixture.ownerEmail)
  otherCookie = await login(other.email)
  const app = express(), router = express.Router()
  registerEmployee(router, db, service, config)
  registerLineManager(router, db, service, config)
  registerNotifications(router, db, service, config)
  app.use('/api', router)
  server.on('request', app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
after(async () => {
  if (base) await new Promise<void>((resolve) => server.close(() => resolve()))
  for (const session of [cookie, employeeCookie, otherCookie]) if (session) await service.signOut(new Headers({ cookie: session }))
  if (previousMailMode === undefined) delete process.env.EMAIL_MODE
  else process.env.EMAIL_MODE = previousMailMode
  await db.$disconnect()
})

const get = (path = root, session = cookie) => fetch(base + path, { headers: { cookie: session } })
function post(path: string, payload: unknown, { session = cookie, revision, key = randomUUID(), method = 'POST' }: { session?: string; revision?: number; key?: string; method?: string } = {}) {
  return fetch(base + path, { method, headers: { cookie: session, origin: config.origin, 'content-type': 'application/json',
    'idempotency-key': key, ...(revision === undefined ? {} : { 'if-match': `"${revision}"` }),
  }, body: JSON.stringify(payload) })
}
const draft = (title: string, carryRequested = false): TaskDraft => ({ title, activity: 'Prepare the approved manager work for this week.',
  startsOn: fixture.week, endsOn: isoDay(shiftDay(day(fixture.week), 4)), carryRequested })
async function create(title: string, carryRequested = false) {
  const response = await post(root, { week: fixture.week, ...draft(title, carryRequested) })
  assert.equal(response.status, 201)
  return response.json() as Promise<MutationResult>
}

test('manager own reads use private ownership and the manager routes accept only their documented methods', async () => {
  const response = await get()
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  const data = await response.json() as HomeResponse
  assert.deepEqual(data.tasks.items.map(({ title }) => title), ['Manager private work'])
  const task = data.tasks.items[0]
  assert.equal((await get(`${root}/${task.id}`, otherCookie)).status, 404)
  assert.equal((await get(`${root}/${fixture.blockerId}`)).status, 404)
  assert.equal((await get(root, employeeCookie)).status, 403)
  assert.equal((await get('/api/employee/home')).status, 403)
  assert.equal((await post(`${root}/${task.id}`, draft('Wrong method'), { method: 'PATCH', revision: task.revision })).status, 400)
  assert.equal((await post(`${root}/${task.id}/comments`, { body: 'Cannot post on another manager task.' }, { session: otherCookie })).status, 404)
  assert.equal((await get(root + '?page=1&page=2')).status, 400)
})

test('manager completion is atomic and safe to replay with exactly one automatic decision', async () => {
  const task = await create('Own automatic completion')
  const key = randomUUID()
  const complete = () => post(`${root}/${task.taskId}/status`, { status: 'COMPLETED' }, { revision: task.taskRevision, key })
  const responses = await Promise.all([complete(), complete()])
  assert.deepEqual(responses.map(({ status }) => status), [200, 200])
  const receipts = await Promise.all(responses.map((response) => response.json() as Promise<MutationResult>))
  const first = receipts.find((receipt) => !receipt.replayed)!
  assert.deepEqual(receipts.find((receipt) => receipt.replayed), { ...first, replayed: true })
  assert.equal(first.taskRevision, task.taskRevision + 1)
  const request = await db.approvalRequest.findUniqueOrThrow({ where: { id: first.approvalRequestId! }, include: { decision: true, task: true } })
  assert.equal(request.state, 'DECIDED')
  assert.equal(request.assignedManagerId, null)
  assert.equal(request.submittedById, fixture.managerId)
  assert.equal(request.attemptNumber, 1)
  assert.equal(request.task.status, 'APPROVED')
  assert.deepEqual(request.submissionSnapshot, { version: 1, title: 'Own automatic completion', activity: draft('').activity,
    startsOn: fixture.week, endsOn: draft('').endsOn, ownerId: fixture.managerId, ownerDisplayName: fixture.managerName,
    weekStartsOn: fixture.week, status: 'AWAITING_APPROVAL' })
  assert.deepEqual(request.decision && [request.decision.method, request.decision.decision, request.decision.actorId,
    request.decision.actingForManagerId, request.decision.reliefAssignmentId], ['AUTOMATIC', 'APPROVE', null, null, null])
  assert.equal(request.decision?.decidedAt.toISOString(), first.appliedAt)
  assert.equal(await db.auditEvent.count({ where: { targetId: task.taskId, actorId: fixture.managerId, action: 'LINE_MANAGER_TASK_STATUS' } }), 1)
  assert.equal(await db.notification.count({ where: { weeklyTaskId: task.taskId } }), 0)
  assert.equal((await post(`${root}/${task.taskId}/status`, { status: 'COMPLETED' }, { revision: first.taskRevision })).status, 423)
  assert.equal((await post(`${root}/${task.taskId}/comments`, { body: 'Keep the result for the next review.' })).status, 200)
  const detail = await (await get(`${root}/${task.taskId}`)).json() as DetailResponse
  assert.equal(detail.review?.decision?.reviewer, 'System')
  assert.equal(detail.comments.items[0].author, fixture.managerName)
  assert.equal(detail.task.revision, first.taskRevision)
  assert.equal(await db.notification.count({ where: { weeklyTaskId: task.taskId } }), 0)
})

test('edit, carry and delete retain the original revision and independent continuation rules', async () => {
  const task = await create('Manager source with carry', true)
  assert.ok(task.continuationId)
  const next = isoDay(shiftDay(day(fixture.week), 7))
  const report = await (await get(`${root}?week=${next}`)).json() as HomeResponse
  assert.equal(report.tasks.items[0].id, task.continuationId)
  assert.equal(report.canCreate, false)
  const edit = await post(`${root}/${task.taskId}/edit`, draft('New source title', true), { revision: task.taskRevision })
  assert.equal(edit.status, 200)
  const saved = await edit.json() as MutationResult
  assert.equal((await db.weeklyTask.findUniqueOrThrow({ where: { id: task.continuationId } })).title, 'Manager source with carry')
  assert.equal((await post(`${root}/${task.taskId}/carry`, { carryRequested: false }, { revision: task.taskRevision })).status, 409)
  const undo = await post(`${root}/${task.taskId}/carry`, { carryRequested: false }, { revision: saved.taskRevision })
  assert.equal(undo.status, 200)
  assert.equal((await get(`${root}/${task.continuationId}`)).status, 404)
  const undone = await undo.json() as MutationResult
  assert.equal((await post(`${root}/${task.taskId}/delete`, {}, { revision: undone.taskRevision })).status, 200)
  assert.equal((await get(`${root}/${task.taskId}`)).status, 404)
})

test('failure to persist the automatic decision rolls back approval, task and receipt', async () => {
  const task = await create('Atomic automatic decision failure')
  const session = await service.current(new Headers({ cookie }))
  assert.ok(session.context && session.internalSessionId)
  const injected = new Proxy(db, { get(target, property, receiver) {
    if (property !== '$transaction') return Reflect.get(target, property, receiver)
    return <T>(write: (tx: Prisma.TransactionClient) => Promise<T>, options: { isolationLevel: 'ReadCommitted'; maxWait: number; timeout: number }) =>
      target.$transaction((tx) => write(new Proxy(tx, { get(transaction, field, proxy) {
        if (field === 'approvalDecision') return { create: () => Promise.reject(new Error('Injected decision failure')) }
        return Reflect.get(transaction, field, proxy)
      } })), options)
  } })
  const key = randomUUID()
  await assert.rejects(mutateTask(injected, session.context, session.internalSessionId, key,
    { kind: 'STATUS', taskId: task.taskId, revision: task.taskRevision, status: 'COMPLETED' }, 'LINE_MANAGER'), /Injected decision failure/)
  assert.equal((await db.weeklyTask.findUniqueOrThrow({ where: { id: task.taskId } })).status, 'PENDING')
  assert.equal(await db.approvalRequest.count({ where: { weeklyTaskId: task.taskId } }), 0)
  assert.equal(await db.taskMutationReceipt.count({ where: { userId: fixture.managerId, requestId: key } }), 0)
})

test('legacy pending manager work returns a fixed conflict and preserves the pending attempt', async () => {
  const created = await create('Manager task with legacy review')
  const source = await db.employmentAssignment.findFirstOrThrow({ where: { userId: fixture.managerId, effectiveTo: null } })
  const request = await db.$transaction(async (tx) => {
    const task = await tx.weeklyTask.update({ where: { id: created.taskId }, data: { status: 'AWAITING_APPROVAL' } })
    return tx.approvalRequest.create({ data: { weeklyTaskId: task.id, submittedById: fixture.managerId, submissionAssignmentId: source.id,
      assignedManagerId: fixture.otherManagerId, attemptNumber: 1,
      submissionSnapshot: { version: 1, title: task.title, activity: task.activity, ownerId: fixture.managerId, ownerDisplayName: fixture.managerName,
        startsOn: fixture.week, endsOn: isoDay(task.endsOn), weekStartsOn: fixture.week, status: 'AWAITING_APPROVAL' } } })
  })
  const response = await post(`${root}/${created.taskId}/status`, { status: 'COMPLETED' }, { revision: created.taskRevision })
  assert.equal(response.status, 409)
  assert.equal((await response.json()).error.code, 'OWN_TASK_REVIEW_CONFLICT')
  assert.equal(await db.approvalDecision.count({ where: { requestId: request.id } }), 0)
  assert.equal((await db.approvalRequest.findUniqueOrThrow({ where: { id: request.id } })).state, 'PENDING')
})

test('frozen manager detail uses recorded ownership and rejects changes', async () => {
  const frozen = await historicalFixtures(async (tx) => {
    let start = shiftDay(day(fixture.week), -7)
    while (await tx.workWeek.findUnique({ where: { startsOn: start }, select: { id: true } })) start = shiftDay(start, -7)
    const at = await databaseClock(tx)
    const source = await tx.employmentAssignment.findFirstOrThrow({ where: { userId: fixture.managerId, effectiveTo: null }, include: { business: true, unit: true } })
    const original = await tx.employmentAssignment.create({ data: { userId: fixture.managerId, role: 'LINE_MANAGER', businessId: source.businessId,
      unitId: source.unitId, effectiveFrom: watMidnight(start), effectiveTo: source.effectiveFrom } })
    const week = await tx.workWeek.create({ data: { startsOn: start, planningLocksAt: watMidnight(shiftDay(start, 1)), freezesAt: watMidnight(shiftDay(start, 5)) } })
    const contextSnapshot = { version: 1, userId: fixture.managerId, displayName: 'Recorded manager name', role: 'LINE_MANAGER', accountStatus: 'ACTIVE',
      businessId: source.businessId, businessName: source.business!.name, unitId: source.unitId, unitName: source.unit!.name,
      managerId: null, managerName: null, departmentLabel: null }
    const tracker = await tx.weeklyTracker.create({ data: { userId: fixture.managerId, weekId: week.id, assignmentId: original.id,
      snapshotAt: at, expectedWorkingDaysSnapshot: 0, contextSnapshot } })
    const series = await tx.taskSeries.create({ data: { ownerId: fixture.managerId } })
    return tx.weeklyTask.create({ data: { trackerId: tracker.id, seriesId: series.id, ownerId: fixture.managerId,
      title: 'Frozen own work', activity: 'Completed during an earlier period.', startsOn: start, endsOn: shiftDay(start, 4) } })
  })
  const response = await get(`${root}/${frozen.id}`)
  assert.equal(response.status, 200)
  const detail = await response.json() as DetailResponse
  assert.equal(detail.frozen, true)
  assert.equal(detail.owner.name, 'Recorded manager name')
  assert.equal(detail.task.permissions.canComment, false)
  assert.equal((await get(`${root}/${frozen.id}`, otherCookie)).status, 404)
  assert.equal((await post(`${root}/${frozen.id}/comments`, { body: 'A frozen task cannot take a comment.' })).status, 423)
})

test('employee completion still queues a human review, and manager leave pauses writes without hiding tasks', async () => {
  const employee = await db.weeklyTask.findUniqueOrThrow({ where: { id: fixture.blockerId } })
  const submitted = await post(`/api/employee/tasks/${employee.id}/status`, { status: 'COMPLETED' }, { revision: employee.revision, session: employeeCookie })
  assert.equal(submitted.status, 200)
  const receipt = await submitted.json() as MutationResult
  const review = await db.approvalRequest.findUniqueOrThrow({ where: { id: receipt.approvalRequestId! }, include: { decision: true, task: true } })
  assert.deepEqual([review.state, review.assignedManagerId, review.decision, review.task.status], ['PENDING', fixture.managerId, null, 'AWAITING_APPROVAL'])
  const own = await create('Manager work before leave')
  const leave = await db.leaveRecord.create({ data: { userId: fixture.managerId, startsOn: fixture.today, expectedReturnOn: shiftDay(fixture.today, 1), createdAt: await databaseClock(db) } })
  await db.reliefAssignment.create({ data: { leaveId: leave.id, coveredManagerId: fixture.managerId, reliefManagerId: fixture.otherManagerId,
    startsOn: fixture.today, endsOn: shiftDay(fixture.today, 1) } })
  const home = await (await get()).json() as HomeResponse
  assert.equal(home.leave.paused, true)
  assert.equal(home.canCreate, false)
  assert.equal(home.leave.returnTarget, null)
  assert.ok(home.tasks.items.some(({ id }) => id === own.taskId))
  assert.equal((await get(`${root}/${own.taskId}`, otherCookie)).status, 404)
  assert.equal((await post(`${root}/${own.taskId}/status`, { status: 'COMPLETED' }, { revision: own.taskRevision })).status, 423)
})

test('a promoted Employee can open a retained task notification through their new own task route', async () => {
  const notice = await db.notification.create({ data: { recipientId: fixture.ownerId, weeklyTaskId: fixture.blockerId,
    kind: 'TASK_COMMENTED', title: 'Retained task update', body: 'A comment was recorded before the role changed.', deduplicationKey: randomUUID() } })
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${fixture.ownerId} FOR UPDATE`
    const at = await databaseClock(tx)
    const old = await tx.employmentAssignment.findFirstOrThrow({ where: { userId: fixture.ownerId, effectiveTo: null } })
    await tx.employmentAssignment.update({ where: { id: old.id }, data: { effectiveTo: at } })
    await tx.employmentAssignment.create({ data: { userId: fixture.ownerId, role: 'LINE_MANAGER',
      businessId: old.businessId, unitId: old.unitId, effectiveFrom: at } })
  })
  assert.equal((await post(`/api/notifications/${notice.id}/read`, {})).status, 404)
  const selected = await post(`/api/notifications/${notice.id}/read`, {}, { session: employeeCookie })
  assert.equal(selected.status, 200)
  assert.deepEqual((await selected.json()).target, { kind: 'OWN_TASK', taskId: fixture.blockerId, week: fixture.week })
  const detail = await get(`${root}/${fixture.blockerId}`, employeeCookie)
  assert.equal(detail.status, 200)
  assert.equal((await detail.json() as DetailResponse).task.id, fixture.blockerId)
  assert.equal((await get(`/api/employee/tasks/${fixture.blockerId}`, employeeCookie)).status, 403)
})
