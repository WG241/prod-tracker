import 'dotenv/config'
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import express from 'express'
import type { PrismaClient } from '../../src/generated/prisma/client.ts'
import type { SessionContext } from '../../src/features/auth/contracts.ts'
import type { MutationResult, TaskOperation, TaskDraft } from '../../src/features/employee/mutations.ts'
import { createDatabase } from '../../server/db.ts'
import { authTestDatabase, readAuthConfig } from '../../server/auth/config.ts'
import { createAuth } from '../../server/auth/provider.ts'
import { createAuthService } from '../../server/auth/service.ts'
import { provision } from '../../server/auth/provision.ts'
import { registerEmployee } from '../../server/employee/router.ts'
import { mutateTask } from '../../server/employee/writes.ts'
import { parseOperation, validateTaskDates } from '../../server/employee/task-validation.ts'
import { monday } from '../../server/employee/calendar.ts'
import { isoDay, shiftDay } from '../../server/data-model/calendar.ts'
import { historicalFixtures } from '../helpers/historical-fixtures.ts'

const db = createDatabase(authTestDatabase(process.env.TEST_DATABASE_URL, process.env.DATABASE_URL))
const config = readAuthConfig(), service = createAuthService(db, createAuth(db, config))
const id = `f10-${randomUUID()}`, start = monday(new Date()), week = isoDay(start)
const server = createServer()
let context: SessionContext, sessionId: string, cookie: string, base: string
const draft = (extra: Partial<TaskDraft> = {}): TaskDraft => ({ title: 'Persisted lifecycle outcome', activity: 'Work recorded on the real separate database', startsOn: week, endsOn: isoDay(shiftDay(start, 4)), carryRequested: false, ...extra })
const command = (op: TaskOperation, key: string = randomUUID(), client = db) => mutateTask(client, context, sessionId, key, op)
async function create(extra: Partial<TaskDraft> = {}) { return command({ kind: 'CREATE', week, draft: draft(extra) }) }
async function row(id: string) { return db.weeklyTask.findUniqueOrThrow({ where: { id } }) }
const rejection = (code: string) => (error: unknown) => !!error && typeof error === 'object' && 'code' in error && error.code === code
before(async () => {
  const source = await db.employmentAssignment.findFirstOrThrow({ where: { userId: 'person-ada-okafor', effectiveTo: null } })
  await historicalFixtures(async (tx) => {
    await tx.user.create({ data: { id, name: 'Lifecycle Employee', email: `${id}@example.invalid`, accountStatus: 'ACTIVE' } })
    await tx.employmentAssignment.create({ data: { userId: id, role: 'EMPLOYEE', businessId: source.businessId, unitId: source.unitId, managerId: source.managerId, effectiveFrom: new Date('2020-01-01') } })
    const existing = await tx.workWeek.findUnique({ where: { startsOn: start } })
    if (existing) await tx.planningUnlock.create({ data: { weekId: existing.id, scope: 'PERSON', userId: id, grantedById: 'person-kemi-adebayo', reason: 'Isolated lifecycle verification', expiresAt: existing.freezesAt } })
  })
  assert.ok(process.env.LOCAL_AUTH_TEST_PASSWORD)
  await provision(db, config, id, process.env.LOCAL_AUTH_TEST_PASSWORD)
  const login = await service.signIn(`${id}@example.invalid`, process.env.LOCAL_AUTH_TEST_PASSWORD, new Headers({ origin: config.origin }))
  cookie = login.headers.getSetCookie().map((v) => v.split(';')[0]).join('; ')
  const current = await service.current(new Headers({ cookie }))
  assert.ok(current.context && current.internalSessionId)
  context = current.context; sessionId = current.internalSessionId
  const app = express(), api = express.Router()
  registerEmployee(api, db, service, config)
  app.use('/api', api); server.on('request', app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
  if (cookie) await service.signOut(new Headers({ cookie }))
  await db.$disconnect()
})

test('AC2,3 date and exact payload validation, inclusive 366 day bound and inherited carry exception', () => {
  validateTaskDates(draft({ endsOn: isoDay(shiftDay(start, 365)), carryRequested: true }), start)
  assert.throws(() => validateTaskDates(draft({ endsOn: isoDay(shiftDay(start, 366)), carryRequested: true }), start), rejection('INVALID_INPUT'))
  assert.throws(() => validateTaskDates(draft({ startsOn: isoDay(shiftDay(start, 5)) }), start), rejection('INVALID_INPUT'))
  assert.throws(() => validateTaskDates(draft({ endsOn: isoDay(shiftDay(start, 7)) }), start), rejection('INVALID_INPUT'))
  validateTaskDates(draft({ endsOn: isoDay(shiftDay(start, 14)) }), start, { startsOn: start, endsOn: shiftDay(start, 14), carryRequested: false })
  for (const bad of [{ ...draft(), ownerId: id }, { ...draft(), title: ' ' }, { ...draft(), activity: 'x'.repeat(6001) }, { ...draft(), startsOn: '2026-02-30' }]) assert.throws(() => parseOperation('CREATE', undefined, { week, ...bad }, undefined), rejection('INVALID_INPUT'))
})
test('AC2,8 create replay, concurrent UUID and no change receipt survive later state changes', async () => {
  const key = randomUUID(), op: TaskOperation = { kind: 'CREATE', week, draft: draft() }
  const results = await Promise.all([command(op, key), command(op, key)])
  assert.equal(results[0].taskId, results[1].taskId)
  assert.equal(results.filter((r) => r.replayed).length, 1)
  const result = results[0]
  assert.equal((await row(result.taskId)).revision, 0)
  const noopKey = randomUUID(), noop: TaskOperation = { kind: 'STATUS', taskId: result.taskId, revision: 0, status: 'PENDING' }
  assert.equal((await command(noop, noopKey)).changed, false)
  await command({ kind: 'STATUS', taskId: result.taskId, revision: 0, status: 'IN_PROGRESS' })
  assert.equal((await command(noop, noopKey)).changed, false)
  assert.equal((await command(noop, noopKey)).replayed, true)
  await assert.rejects(command({ ...noop, revision: 1 }, noopKey), rejection('IDEMPOTENCY_CONFLICT'))
  const raced = await Promise.allSettled(['PENDING', 'BLOCKED'].map((status) => command({ kind: 'STATUS', taskId: result.taskId, revision: 1, status: status as 'PENDING' | 'BLOCKED', blockerReason: 'Dependency' })))
  assert.equal(raced.filter((r) => r.status === 'fulfilled').length, 1)
  assert.ok(raced.some((r) => r.status === 'rejected' && rejection('STALE_TASK')(r.reason)))
  await command({ kind: 'DELETE', taskId: result.taskId, revision: 2 })
  assert.equal((await command(noop, noopKey)).replayed, true, 'A no change receipt still replays after the target is hidden')
})
test('AC4,5 completion, immutable withdrawal and explicit resubmission', async () => {
  const task = await create(), key = randomUUID()
  const op: TaskOperation = { kind: 'STATUS', taskId: task.taskId, revision: 0, status: 'COMPLETED' }
  const complete = await command(op, key)
  await command(op, key)
  assert.equal((await row(task.taskId)).status, 'AWAITING_APPROVAL')
  const request = await db.approvalRequest.findUniqueOrThrow({ where: { id: complete.approvalRequestId! } })
  assert.equal(await db.notification.count({ where: { deduplicationKey: `approval-requested:${request.id}` } }), 1)
  assert.equal((await command({ ...op, revision: 1 })).changed, false)
  await assert.rejects(command({ kind: 'EDIT', taskId: task.taskId, revision: 1, draft: draft({ activity: 'Revised', status: 'COMPLETED' }) }), rejection('SAVE_BEFORE_RESUBMIT'))
  await command({ kind: 'EDIT', taskId: task.taskId, revision: 1, draft: draft({ activity: 'Revised', status: 'PENDING' }) })
  const withdrawn = await db.approvalRequest.findUniqueOrThrow({ where: { id: request.id } })
  assert.equal(withdrawn.state, 'WITHDRAWN'); assert.deepEqual(withdrawn.submissionSnapshot, request.submissionSnapshot)
  await command({ ...op, revision: 2 })
  assert.deepEqual((await db.approvalRequest.findMany({ where: { weeklyTaskId: task.taskId }, orderBy: { attemptNumber: 'asc' } })).map((r) => r.attemptNumber), [1, 2])
})
test('AC6,7 independent immediate carry, undo restore same identity and deletion preserving future', async () => {
  const source = await create({ carryRequested: true })
  assert.ok(source.continuationId)
  const copy = await row(source.continuationId)
  assert.equal(copy.startsOn.toISOString().slice(0, 10), isoDay(shiftDay(start, 7)))
  assert.equal(copy.endsOn.toISOString().slice(0, 10), isoDay(shiftDay(start, 11)))
  assert.equal(copy.carryRequested, false)
  await command({ kind: 'EDIT', taskId: source.taskId, revision: 0, draft: draft({ title: 'Changed source', carryRequested: true }) })
  assert.equal((await row(copy.id)).title, copy.title)
  await command({ kind: 'CARRY', taskId: source.taskId, revision: 1, carryRequested: false })
  assert.ok((await row(copy.id)).deletedAt)
  const restored = await command({ kind: 'CARRY', taskId: source.taskId, revision: 2, carryRequested: true })
  assert.equal(restored.continuationId, copy.id)
  assert.equal((await row(copy.id)).createdAt.getTime(), copy.createdAt.getTime())
  const deleted = await command({ kind: 'DELETE', taskId: source.taskId, revision: 3 })
  assert.equal(deleted.changed, true)
  assert.equal((await row(copy.id)).deletedAt, null)
  const replay = await command({ kind: 'CREATE', week, draft: draft({ carryRequested: true }) }, source.requestId)
  assert.equal(replay.taskId, source.taskId)
  assert.equal(replay.replayed, true)
  const used = await create({ carryRequested: true })
  await db.taskComment.create({ data: { weeklyTaskId: used.continuationId!, authorId: id, body: 'Protected evidence' } })
  await assert.rejects(command({ kind: 'CARRY', taskId: used.taskId, revision: 0, carryRequested: false }), rejection('CARRY_IN_USE'))
  assert.equal((await row(used.taskId)).carryRequested, true)
})
test('AC7,8 same comment key appends once without revising content or withdrawing review', async () => {
  const task = await create()
  await command({ kind: 'STATUS', taskId: task.taskId, revision: 0, status: 'COMPLETED' })
  const key = randomUUID(), op: TaskOperation = { kind: 'COMMENT', taskId: task.taskId, body: '<script>render as text</script>' }
  const result = await command(op, key)
  assert.equal((await command(op, key)).commentId, result.commentId)
  assert.equal(await db.taskComment.count({ where: { weeklyTaskId: task.taskId } }), 1)
  assert.equal((await row(task.taskId)).revision, 1)
  assert.equal(await db.approvalRequest.count({ where: { weeklyTaskId: task.taskId, state: 'PENDING' } }), 1)
})
test('AC8 injected create, audit, receipt and notification failures roll back all domain rows', async () => {
  async function counts() { return Promise.all([db.weeklyTask.count({ where: { ownerId: id } }), db.taskSeries.count({ where: { ownerId: id } }), db.approvalRequest.count({ where: { submittedById: id } }), db.notification.count({ where: { task: { ownerId: id } } }), db.auditEvent.count({ where: { actorId: id } }), db.taskMutationReceipt.count({ where: { userId: id } })]) }
  for (const model of ['WeeklyTask', 'AuditEvent', 'TaskMutationReceipt', 'ApprovalRequest', 'Notification']) {
    const task = await create(), before = await counts()
    const failing = db.$extends({ query: { $allModels: { async $allOperations({ model: current, operation, args, query }) {
      const value = await query(args)
      if (current === model && (operation === 'create' || operation === 'update')) throw new Error('Isolated injected persistence failure')
      return value
    } } } }) as unknown as PrismaClient
    await assert.rejects(command(model === 'WeeklyTask' ? { kind: 'CREATE', week, draft: draft({ carryRequested: true }) } : { kind: 'STATUS', taskId: task.taskId, revision: 0, status: 'COMPLETED' }, randomUUID(), failing))
    assert.deepEqual(await counts(), before, model)
    assert.equal((await row(task.taskId)).revision, 0)
  }
})
test('AC3,9 lock, leave, ownership and current persisted session are authoritative', async () => {
  const task = await create()
  await assert.rejects(command({ kind: 'COMMENT', taskId: 'missing-task', body: 'No access' }), rejection('NOT_FOUND'))
  const leave = await db.leaveRecord.create({ data: { userId: id, startsOn: start, expectedReturnOn: shiftDay(start, 7) } })
  await assert.rejects(command({ kind: 'COMMENT', taskId: task.taskId, body: 'Paused' }), rejection('ON_LEAVE'))
  await db.leaveRecord.update({ where: { id: leave.id }, data: { cancelledAt: new Date(), cancelledById: id } })
  await assert.rejects(mutateTask(db, context, 'revoked-session', randomUUID(), { kind: 'COMMENT', taskId: task.taskId, body: 'Invalid session' }), rejection('SESSION_REQUIRED'))
  const future = await create({ carryRequested: true })
  await assert.rejects(command({ kind: 'COMMENT', taskId: future.continuationId!, body: 'Future' }), rejection('TASK_LOCKED'))
})
test('AC9 actual endpoints enforce JSON, origin, identity, revisions and private result shape', async () => {
  async function post(headers: Record<string, string>, body: unknown = { week, ...draft() }) { return fetch(`${base}/api/employee/tasks`, { method: 'POST', headers, body: JSON.stringify(body) }) }
  const headers = { cookie, origin: config.origin, 'content-type': 'application/json', 'idempotency-key': randomUUID() }
  assert.equal((await post({ ...headers, cookie: '' })).status, 401)
  assert.equal((await post({ ...headers, origin: 'https://wrong.invalid' })).status, 403)
  assert.equal((await post({ ...headers, 'content-type': 'text/plain' })).status, 415)
  assert.equal((await post(headers, { week, ...draft(), ownerId: id })).status, 400)
  const response = await post(headers)
  assert.equal(response.status, 201); assert.equal(response.headers.get('cache-control'), 'no-store')
  const result = await response.json() as MutationResult
  assert.equal(result.version, 1)
  const stale = await fetch(`${base}/api/employee/tasks/${result.taskId}/status`, { method: 'POST', headers: { ...headers, 'idempotency-key': randomUUID(), 'if-match': '"99"' }, body: JSON.stringify({ status: 'IN_PROGRESS' }) })
  assert.equal(stale.status, 409)
  assert.equal((await stale.json()).error.code, 'STALE_TASK')
})
test('AC3,8 a permission change committed during the person lock wait is observed', async () => {
  const task = await create()
  let locked: () => void = () => {}, release: () => void = () => {}
  const ready = new Promise<void>((resolve) => { locked = resolve })
  const gate = new Promise<void>((resolve) => { release = resolve })
  let leaveId = ''
  const blocker = db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${id} FOR UPDATE`
    const leave = await tx.leaveRecord.create({ data: { userId: id, startsOn: start, expectedReturnOn: shiftDay(start, 7) } })
    leaveId = leave.id; locked(); await gate
  })
  await ready
  const waiting = command({ kind: 'COMMENT', taskId: task.taskId, body: 'Must see the committed leave' })
  // Allow the command to reach the held lock, then commit the permission change.
  await new Promise((resolve) => setTimeout(resolve, 100))
  release(); await blocker
  await assert.rejects(waiting, rejection('ON_LEAVE'))
  await db.leaveRecord.update({ where: { id: leaveId }, data: { cancelledAt: new Date(), cancelledById: id } })
  assert.equal(await db.taskComment.count({ where: { weeklyTaskId: task.taskId } }), 0)
})
test('AC3 closed planning still permits activity and comments, blocks title, carry and deletion', async () => {
  const calendar = await db.workWeek.findUniqueOrThrow({ where: { startsOn: start } })
  await db.workWeek.update({ where: { id: calendar.id }, data: { manuallyLockedAt: new Date(), lockReason: 'Isolated closed planning verification' } })
  const task = await create()
  const unlock = await db.planningUnlock.findFirstOrThrow({ where: { userId: id, scope: 'PERSON', revokedAt: null } })
  await db.planningUnlock.update({ where: { id: unlock.id }, data: { revokedAt: new Date(), revokedById: id } })
  try {
    await command({ kind: 'EDIT', taskId: task.taskId, revision: 0, draft: draft({ activity: 'Allowed after planning closes' }) })
    await command({ kind: 'COMMENT', taskId: task.taskId, body: 'Allowed conversation' })
    await assert.rejects(command({ kind: 'EDIT', taskId: task.taskId, revision: 1, draft: draft({ title: 'Disallowed title' }) }), rejection('TASK_LOCKED'))
    await assert.rejects(command({ kind: 'CARRY', taskId: task.taskId, revision: 1, carryRequested: true }), rejection('TASK_LOCKED'))
    await assert.rejects(command({ kind: 'DELETE', taskId: task.taskId, revision: 1 }), rejection('TASK_LOCKED'))
  } finally {
    await db.planningUnlock.update({ where: { id: unlock.id }, data: { revokedAt: null, revokedById: null } })
    await db.workWeek.update({ where: { id: calendar.id }, data: { manuallyLockedAt: calendar.manuallyLockedAt, lockReason: calendar.lockReason } })
  }
})
test('AC3,4,6 carry withdraws pending review, Approved conversations remain open and receipts are immutable', async () => {
  const task = await create()
  const complete = await command({ kind: 'STATUS', taskId: task.taskId, revision: 0, status: 'COMPLETED' })
  await command({ kind: 'CARRY', taskId: task.taskId, revision: 1, carryRequested: true })
  assert.equal((await row(task.taskId)).status, 'PENDING')
  assert.equal((await db.approvalRequest.findUniqueOrThrow({ where: { id: complete.approvalRequestId! } })).state, 'WITHDRAWN')
  const again = await command({ kind: 'STATUS', taskId: task.taskId, revision: 2, status: 'COMPLETED' })
  await db.$transaction(async (tx) => {
    const request = await tx.approvalRequest.findUniqueOrThrow({ where: { id: again.approvalRequestId! } })
    await tx.approvalDecision.create({ data: { requestId: request.id, decision: 'APPROVE', method: 'HUMAN', actorId: request.assignedManagerId } })
    await tx.approvalRequest.update({ where: { id: request.id }, data: { state: 'DECIDED' } })
    await tx.weeklyTask.update({ where: { id: task.taskId }, data: { status: 'APPROVED', revision: { increment: 1 } } })
  })
  await command({ kind: 'COMMENT', taskId: task.taskId, body: 'Conversation after approval' })
  await assert.rejects(command({ kind: 'STATUS', taskId: task.taskId, revision: 4, status: 'PENDING' }), rejection('TASK_LOCKED'))
  await assert.rejects(db.taskMutationReceipt.update({ where: { userId_requestId: { userId: id, requestId: complete.requestId } }, data: { requestHash: '0'.repeat(64) } }))
})
test('AC5 invalid current permanent manager causes no partial completion or receipt', async () => {
  const task = await create(), inactiveId = `inactive-${randomUUID()}`
  const old = await db.employmentAssignment.findFirstOrThrow({ where: { userId: id, effectiveTo: null } })
  async function assign(managerId: string) {
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${id} FOR UPDATE`
      const at = new Date()
      await tx.employmentAssignment.updateMany({ where: { userId: id, effectiveTo: null }, data: { effectiveTo: at } })
      await tx.employmentAssignment.create({ data: { userId: id, role: 'EMPLOYEE', businessId: old.businessId, unitId: old.unitId, managerId, effectiveFrom: at } })
    })
  }
  await db.user.create({ data: { id: inactiveId, email: `${inactiveId}@example.invalid`, name: 'Inactive manager fixture' } })
  await assign(inactiveId)
  const key = randomUUID()
  try {
    await assert.rejects(command({ kind: 'STATUS', taskId: task.taskId, revision: 0, status: 'COMPLETED' }, key), rejection('MANAGER_UNAVAILABLE'))
    assert.equal((await row(task.taskId)).status, 'PENDING')
    assert.equal(await db.approvalRequest.count({ where: { weeklyTaskId: task.taskId } }), 0)
    assert.equal(await db.taskMutationReceipt.count({ where: { userId: id, requestId: key } }), 0)
  } finally { await assign(old.managerId!) }
})
