import 'dotenv/config'
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import express from 'express'
import type { PrismaClient } from '../../src/generated/prisma/client.ts'
import type { SessionContext } from '../../src/features/auth/contracts.ts'
import type { LeaveOperation, LeaveResult } from '../../src/features/employee/leave-contracts.ts'
import { leaveDraftErrors } from '../../src/features/employee/leave-contracts.ts'
import { LeaveOperations } from '../../src/features/employee/leave-operations.ts'
import { createDatabase } from '../../server/db.ts'
import { authTestDatabase, readAuthConfig } from '../../server/auth/config.ts'
import { createAuth } from '../../server/auth/provider.ts'
import { createAuthService } from '../../server/auth/service.ts'
import { provision } from '../../server/auth/provision.ts'
import { registerEmployee } from '../../server/employee/router.ts'
import { mutateLeave } from '../../server/employee/leave-writes.ts'
import type { LeaveClock } from '../../server/employee/leave-writes.ts'
import { classifyLeave, currentLeave } from '../../server/employee/leave-state.ts'
import { parseLeaveOperation } from '../../server/employee/leave-validation.ts'
import { monday, readQuery } from '../../server/employee/calendar.ts'
import { isoDay, shiftDay, watCalendarDay } from '../../server/data-model/calendar.ts'
import { readHome } from '../../server/employee/reads.ts'
import { historicalFixtures } from '../helpers/historical-fixtures.ts'

const db = createDatabase(authTestDatabase(process.env.TEST_DATABASE_URL, process.env.DATABASE_URL))
const config = readAuthConfig(), service = createAuthService(db, createAuth(db, config))
const server = createServer()
const today = watCalendarDay(new Date()), date = (offset: number) => isoDay(shiftDay(today, offset))
type Actor = { id: string; context: SessionContext; sessionId: string; cookie: string }
let base: string, actor: Actor
const rejects = (code: string) => (e: unknown) => !!e && typeof e === 'object' && 'code' in e && e.code === code
async function fixture(managerId?: string) {
  const id = `f12-${randomUUID()}`
  const source = await db.employmentAssignment.findFirstOrThrow({ where: { userId: 'person-ada-okafor', effectiveTo: null } })
  await historicalFixtures(async (tx) => {
    await tx.user.create({ data: { id, name: 'Leave Employee', email: `${id}@example.invalid`, accountStatus: 'ACTIVE' } })
    await tx.employmentAssignment.create({ data: { userId: id, role: 'EMPLOYEE', businessId: source.businessId, unitId: source.unitId, managerId: managerId ?? source.managerId, effectiveFrom: new Date('2020-01-01') } })
  })
  assert.ok(process.env.LOCAL_AUTH_TEST_PASSWORD)
  await provision(db, config, id, process.env.LOCAL_AUTH_TEST_PASSWORD)
  const login = await service.signIn(`${id}@example.invalid`, process.env.LOCAL_AUTH_TEST_PASSWORD, new Headers({ origin: config.origin }))
  const cookie = login.headers.getSetCookie().map((v) => v.split(';')[0]).join('; ')
  const auth = await service.current(new Headers({ cookie }))
  assert.ok(auth.context && auth.internalSessionId)
  return { id, context: auth.context, sessionId: auth.internalSessionId, cookie }
}
const create = (start = 1, end = 8): LeaveOperation => ({ kind: 'CREATE', draft: { startsOn: date(start), expectedReturnOn: date(end) } })
const send = (op: LeaveOperation, key = randomUUID(), client = db, who = actor, clock?: LeaveClock) => mutateLeave(client, who.context, who.sessionId, key, op, clock)
const read = (who = actor, at = new Date()) => db.$transaction((tx) => currentLeave(tx, who.id, at))
async function counts(who = actor) {
  return { leaves: await db.leaveRecord.count({ where: { userId: who.id } }), receipts: await db.leaveMutationReceipt.count({ where: { userId: who.id } }), notifications: await db.notification.count({ where: { leave: { userId: who.id } } }), audits: await db.auditEvent.count({ where: { actorId: who.id, targetType: 'LeaveRecord' } }) }
}
before(async () => {
  actor = await fixture()
  const app = express(), api = express.Router()
  registerEmployee(api, db, service, config); app.use('/api', api); server.on('request', app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
after(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); await db.$disconnect() })

test('AC2 validates real date boundaries, exclusive duration and exact inputs', () => {
  const draft = { startsOn: date(365), expectedReturnOn: date(731) }
  assert.deepEqual(leaveDraftErrors(draft, date(0), date(365)), {})
  assert.ok(leaveDraftErrors({ ...draft, startsOn: date(366) }, date(0), date(365)).startsOn)
  assert.ok(leaveDraftErrors({ startsOn: date(0), expectedReturnOn: date(367) }).expectedReturnOn)
  assert.ok(leaveDraftErrors({ startsOn: date(0), expectedReturnOn: date(0) }).expectedReturnOn)
  for (const startsOn of ['2026-02-30', '0000-01-01', '10000-01-01', '2026-1-01', 'x']) assert.ok(leaveDraftErrors({ startsOn, expectedReturnOn: date(8) }).startsOn)
  assert.throws(() => parseLeaveOperation('RETURN', 'id', { actualReturnOn: date(0) }), rejects('INVALID_INPUT'))
  assert.throws(() => parseLeaveOperation('CREATE', undefined, { ...draft, userId: actor.id }), rejects('INVALID_INPUT'))
  const last = classifyLeave([], new Date('9999-12-31T12:00:00Z'))
  assert.equal(last.canCreate, false); assert.equal(last.defaults.expectedReturnOn, '9999-12-31')
})

test('AC2,9 classification changes at WAT midnight and preserves coherent legacy periods', () => {
  const row = { id: 'one', startsOn: new Date('2026-11-04'), expectedReturnOn: new Date('2028-01-01'), actualReturnOn: null, cancelledAt: null }
  assert.equal(classifyLeave([row], new Date('2026-11-03T22:59:59Z')).state, 'SCHEDULED')
  assert.equal(classifyLeave([row], new Date('2026-11-03T23:00:00Z')).state, 'ON_LEAVE')
  assert.equal(classifyLeave([row], new Date('2027-12-31T23:00:00Z')).state, 'NONE')
  assert.equal(classifyLeave([row, { ...row, id: 'two' }], new Date('2026-11-04')).state, 'REPAIR_REQUIRED')
  assert.equal(classifyLeave([{ ...row, actualReturnOn: new Date('2026-11-06') }], new Date('2026-11-04')).state, 'REPAIR_REQUIRED')
  assert.equal(classifyLeave([{ ...row, cancelledAt: new Date('2026-11-04T12:00:00Z') }], new Date('2026-11-04')).nextChangeAt, '2026-11-04T12:00:00.000Z')
  assert.equal(classifyLeave([{ ...row, expectedReturnOn: new Date('+010000-01-01T00:00:00Z') }], new Date('2026-11-04')).state, 'REPAIR_REQUIRED')
})

test('AC5,6 concurrent identical requests commit once, new keys conflict, and cancelled requests replay', async () => {
  const key = randomUUID(), op = create()
  const results = await Promise.all([send(op, key), send(op, key)])
  assert.equal(results[0].leaveId, results[1].leaveId)
  assert.equal(results.filter((r) => r.replayed).length, 1)
  await assert.rejects(send(create(2, 9), key), rejects('IDEMPOTENCY_CONFLICT'))
  await assert.rejects(send(create(2, 9)), rejects('LEAVE_CONFLICT'))
  const leaveId = results[0].leaveId
  assert.equal((await read()).state, 'SCHEDULED')
  const cancel = await send({ kind: 'CANCEL', leaveId })
  const duplicate = await send({ kind: 'CANCEL', leaveId })
  assert.equal(cancel.changed, true); assert.equal(duplicate.changed, false)
  assert.equal((await send(op, key)).replayed, true)
  assert.equal((await read()).state, 'NONE')
  assert.equal(await db.auditEvent.count({ where: { targetId: leaveId, action: 'LEAVE_CANCELLED' } }), 1)
  const notifications = await db.notification.findMany({ where: { leaveId, kind: 'LEAVE_RECORDED' } })
  assert.ok(notifications.some((n) => n.recipientId === actor.id))
  const assignment = await db.employmentAssignment.findFirstOrThrow({ where: { userId: actor.id, effectiveTo: null } })
  assert.ok(notifications.some((n) => n.recipientId === assignment.managerId))
  assert.ok(notifications.some((n) => n.recipientId === 'person-kemi-adebayo'))
  assert.equal(new Set(notifications.map((n) => n.recipientId)).size, notifications.length)
  assert.deepEqual(results[0].notificationWarnings, [])
  await assert.rejects(db.leaveMutationReceipt.update({ where: { userId_requestId: { userId: actor.id, requestId: key } }, data: { requestHash: '0'.repeat(64) } }))
  await assert.rejects(db.leaveMutationReceipt.delete({ where: { userId_requestId: { userId: actor.id, requestId: key } } }))
})

test('AC3,4 same day return has zero days, refreshes Home and never changes tracker locks', async () => {
  const before = await db.workWeek.findUniqueOrThrow({ where: { startsOn: monday(new Date()) } })
  const result = await send(create(0, 7)), leaveId = result.leaveId
  assert.equal((await read()).state, 'ON_LEAVE')
  const paused = await readHome(db, actor.context, readQuery('/', false, new Date()), new Date())
  assert.equal(paused.leave.paused, true); assert.equal(paused.leave.returnTarget, leaveId)
  await assert.rejects(send({ kind: 'CANCEL', leaveId }), rejects('LEAVE_CHANGED'))
  await send({ kind: 'RETURN', leaveId })
  const row = await db.leaveRecord.findUniqueOrThrow({ where: { id: leaveId } })
  assert.equal(isoDay(row.actualReturnOn!), isoDay(row.startsOn))
  assert.equal((await read()).state, 'NONE')
  assert.equal((await send({ kind: 'RETURN', leaveId })).changed, false)
  assert.equal(await db.auditEvent.count({ where: { targetId: leaveId, action: 'LEAVE_RETURNED' } }), 1)
  const unpaused = await readHome(db, actor.context, readQuery('/', false, new Date()), new Date())
  assert.equal(unpaused.leave.paused, false)
  assert.deepEqual(await db.workWeek.findUniqueOrThrow({ where: { id: before.id } }), before)
  const next = await send(create())
  await send({ kind: 'RETURN', leaveId })
  assert.equal((await read()).current?.id, next.leaveId)
  await send({ kind: 'CANCEL', leaveId: next.leaveId })
})

test('AC5,6 different create identities racing have only one winner', async () => {
  const raced = await Promise.allSettled([send(create()), send(create(2, 9))])
  assert.equal(raced.filter((r) => r.status === 'fulfilled').length, 1)
  assert.ok(raced.some((r) => r.status === 'rejected' && rejects('LEAVE_CONFLICT')(r.reason)))
  const result = raced.find((r) => r.status === 'fulfilled') as PromiseFulfilledResult<LeaveResult>
  await send({ kind: 'CANCEL', leaveId: result.value.leaveId })
})

test('AC5 missing recipients warn while available notification rows and leave commit', async () => {
  const invalidManager = `f12-manager-${randomUUID()}`
  await db.user.create({ data: { id: invalidManager, email: `${invalidManager}@example.invalid`, name: 'Unassigned manager' } })
  const who = await fixture(invalidManager)
  const result = await send(create(), randomUUID(), db, who)
  assert.deepEqual(result.notificationWarnings, ['MANAGER_UNAVAILABLE'])
  assert.equal(await db.notification.count({ where: { leaveId: result.leaveId, recipientId: invalidManager } }), 0)
  assert.ok(await db.notification.count({ where: { leaveId: result.leaveId, recipientId: who.id } }))
  const noHr = db.$extends({ query: { user: { async findMany({ args, query }) {
    // Dependency boundary: an unavailable configured recipient set is not a DB outage.
    const rows = await query(args)
    return rows.filter((row) => row.id === invalidManager)
  } } } }) as unknown as PrismaClient
  await send({ kind: 'CANCEL', leaveId: result.leaveId }, randomUUID(), db, who)
  const gap = await send(create(), randomUUID(), noHr, who)
  assert.deepEqual(gap.notificationWarnings, ['MANAGER_UNAVAILABLE', 'HR_UNAVAILABLE'])
  assert.equal(await db.notification.count({ where: { leaveId: gap.leaveId } }), 1)
  await send({ kind: 'CANCEL', leaveId: gap.leaveId }, randomUUID(), db, who)
})

test('AC5,7 failures in each persistence step roll back the entire operation', async () => {
  for (const model of ['LeaveRecord', 'Notification', 'AuditEvent', 'LeaveMutationReceipt']) {
    const before = await counts(), key = randomUUID()
    const failing = db.$extends({ query: { $allModels: { async $allOperations({ model: current, operation, args, query }) {
      if (current === model && operation === 'create') throw new Error('Injected persistence outage')
      return query(args)
    } } } }) as unknown as PrismaClient
    await assert.rejects(send(create(), key, failing))
    assert.deepEqual(await counts(), before, model)
  }
})

test('AC9 ambiguous legacy periods withhold actions and Home has no arbitrary return target', async () => {
  const who = await fixture()
  await db.leaveRecord.createMany({ data: [0, 1].map((n) => ({ userId: who.id, startsOn: shiftDay(today, n), expectedReturnOn: shiftDay(today, 8) })) })
  const projection = await read(who)
  assert.equal(projection.state, 'REPAIR_REQUIRED'); assert.equal(projection.current, null)
  const data = await readHome(db, who.context, readQuery('/', false, new Date()), new Date())
  assert.equal(data.leave.paused, true); assert.equal(data.leave.returnTarget, null); assert.equal(data.leave.repairRequired, true)
  await assert.rejects(send(create(), randomUUID(), db, who), rejects('LEAVE_REPAIR_REQUIRED'))
})

test('AC7 source guards refuse a frozen coverage change without partial evidence', async () => {
  const who = await fixture()
  const old = await historicalFixtures((tx) => tx.leaveRecord.create({ data: { userId: who.id, startsOn: new Date('2026-10-19'), expectedReturnOn: shiftDay(today, 9) } }))
  const before = await counts(who), frozen = await db.weeklyTracker.findMany({ where: { userId: who.id } })
  await assert.rejects(send({ kind: 'RETURN', leaveId: old.id }, randomUUID(), db, who, async () => new Date('2026-10-20T12:00:00Z')), rejects('HISTORY_PROTECTED'))
  assert.deepEqual(await counts(who), before)
  assert.equal((await db.leaveRecord.findUniqueOrThrow({ where: { id: old.id } })).actualReturnOn, null)
  assert.deepEqual(await db.weeklyTracker.findMany({ where: { userId: who.id } }), frozen)
})

test('AC3,7 post guard midnight crossing rolls back and retries with the new return date', async () => {
  const who = await fixture(), result = await send(create(0, 8), randomUUID(), db, who)
  let crossed = false, updates = 0
  const crossing = db.$extends({ query: { leaveRecord: { async update({ args, query }) {
    const result = await query(args); updates++; crossed = true; return result
  } } } }) as unknown as PrismaClient
  const clock = async () => new Date(`${date(crossed ? 1 : 0)}T12:00:00Z`)
  const returned = await send({ kind: 'RETURN', leaveId: result.leaveId }, randomUUID(), crossing, who, clock)
  assert.equal(updates, 2)
  assert.equal((await db.leaveRecord.findUniqueOrThrow({ where: { id: result.leaveId } })).actualReturnOn?.toISOString().slice(0, 10), date(1))
  assert.equal(returned.appliedAt, `${date(1)}T12:00:00.000Z`)
  assert.equal(await db.auditEvent.count({ where: { targetId: result.leaveId, action: 'LEAVE_RETURNED' } }), 1)
  assert.equal(await db.leaveMutationReceipt.count({ where: { leaveId: result.leaveId, operation: 'RETURN' } }), 1)
})

test('AC3,7 a held source week crossing midnight uses the date after the wait', async () => {
  const who = await fixture(), result = await send(create(), randomUUID(), db, who)
  const calendar = await db.workWeek.findUniqueOrThrow({ where: { startsOn: monday(new Date()) } })
  let release: () => void = () => {}, locked: () => void = () => {}, sourceReached: () => void = () => {}, crossed = false
  const ready = new Promise<void>((resolve) => { locked = resolve }), gate = new Promise<void>((resolve) => { release = resolve }), reached = new Promise<void>((resolve) => { sourceReached = resolve })
  const holding = db.$transaction(async (tx) => { await tx.$queryRaw`SELECT id FROM "WorkWeek" WHERE id=${calendar.id} FOR UPDATE`; locked(); await gate })
  await ready
  const watched = db.$extends({ query: { async $queryRaw({ args, query }) {
    if (JSON.stringify(args).includes('WorkWeek')) sourceReached()
    return query(args)
  } } }) as unknown as PrismaClient
  const pending = send({ kind: 'CANCEL', leaveId: result.leaveId }, randomUUID(), watched, who, async () => new Date(`${date(crossed ? 1 : 0)}T12:00:00Z`))
  await reached
  crossed = true; release(); await holding
  await assert.rejects(pending, rejects('LEAVE_CHANGED'))
  assert.equal((await db.leaveRecord.findUniqueOrThrow({ where: { id: result.leaveId } })).cancelledAt, null)
})

test('AC8 HTTP guards reject selectors, forged owners, dates, origins, bodies and old sessions', async () => {
  const headers = { cookie: actor.cookie, origin: config.origin, 'content-type': 'application/json', 'idempotency-key': randomUUID() }
  const post = (body: unknown, changes: Record<string, string> = {}, path = '') => fetch(`${base}/api/employee/leave${path}`, { method: 'POST', headers: { ...headers, ...changes }, body: JSON.stringify(body) })
  assert.equal((await post((create() as Extract<LeaveOperation, { kind: 'CREATE' }>).draft, { cookie: '' })).status, 401)
  assert.equal((await post({}, { origin: 'https://wrong.invalid' })).status, 403)
  assert.equal((await post({}, { 'content-type': 'text/plain' })).status, 415)
  assert.equal((await post({}, { 'idempotency-key': 'invalid' })).status, 400)
  assert.equal((await post({ userId: actor.id })).status, 400)
  assert.equal((await post({ x: 'x'.repeat(33000) })).status, 413)
  assert.equal((await post({ actualReturnOn: date(0) }, {}, '/missing/return')).status, 400)
  assert.equal((await post({}, {}, '/missing/return')).status, 404)
  assert.equal((await fetch(`${base}/api/employee/leave?ownerId=${actor.id}`, { headers })).status, 400)
  const response = await fetch(`${base}/api/employee/leave`, { headers })
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store')
  const who = await fixture(), result = await send(create(), randomUUID(), db, who)
  assert.equal((await post({}, {}, `/${result.leaveId}/return`)).status, 404)
  await assert.rejects(mutateLeave(db, actor.context, 'revoked', randomUUID(), create()), rejects('SESSION_REQUIRED'))
  await send({ kind: 'CANCEL', leaveId: result.leaveId }, randomUUID(), db, who)
  const raw = await response.text()
  assert.ok(!raw.includes(actor.cookie)); assert.ok(!raw.includes('requestHash'))
})

test('AC8 persisted deactivation during the owner lock wait denies the mutation', async () => {
  const who = await fixture(), before = await counts(who)
  let release: () => void = () => {}, locked: () => void = () => {}
  const ready = new Promise<void>((resolve) => { locked = resolve }), gate = new Promise<void>((resolve) => { release = resolve })
  const holding = db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${who.id} FOR UPDATE`
    await tx.user.update({ where: { id: who.id }, data: { accountStatus: 'INACTIVE' } })
    locked(); await gate
  })
  await ready
  const pending = send(create(), randomUUID(), db, who)
  release(); await holding
  await assert.rejects(pending, rejects('SESSION_REQUIRED'))
  assert.deepEqual(await counts(who), before)
})

test('AC5 a recipient deactivated after discovery is excluded after its row lock wait', async () => {
  const who = await fixture(), hrId = `f12-hr-${randomUUID()}`
  await db.$transaction(async (tx) => {
    await tx.user.create({ data: { id: hrId, name: 'Leave HR fixture', email: `${hrId}@example.invalid`, accountStatus: 'ACTIVE' } })
    await tx.employmentAssignment.create({ data: { userId: hrId, role: 'HR_ADMIN', effectiveFrom: new Date() } })
  })
  let release: () => void = () => {}, locked: () => void = () => {}, found: () => void = () => {}
  const ready = new Promise<void>((resolve) => { locked = resolve }), gate = new Promise<void>((resolve) => { release = resolve }), discovered = new Promise<void>((resolve) => { found = resolve })
  const holding = db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${hrId} FOR UPDATE`
    await tx.user.update({ where: { id: hrId }, data: { accountStatus: 'INACTIVE' } }); locked(); await gate
  })
  await ready
  const scoped = db.$extends({ query: { user: { async findMany({ args, query }) {
    const rows = await query(args); found(); return rows.filter((row) => row.id === hrId)
  } } } }) as unknown as PrismaClient
  const pending = send(create(), randomUUID(), scoped, who)
  await discovered; release(); await holding
  const result = await pending
  assert.deepEqual(result.notificationWarnings, ['MANAGER_UNAVAILABLE', 'HR_UNAVAILABLE'])
  assert.equal(await db.notification.count({ where: { leaveId: result.leaveId } }), 1)
  assert.equal(await db.notification.count({ where: { leaveId: result.leaveId, recipientId: hrId } }), 0)
})

test('AC6,10 uncertain client retries preserve their operation and stale actor replies are ignored', async () => {
  const originalFetch = globalThis.fetch, originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { setTimeout, clearTimeout } })
  const store = new LeaveOperations(), calls: { id: string; path: string; body: string }[] = []
  let lose = true, invalid = 0
  globalThis.fetch = async (input, init) => {
    const id = new Headers(init?.headers).get('Idempotency-Key')!
    calls.push({ id, path: String(input), body: String(init?.body) })
    if (lose) { lose = false; throw new Error('Lost response') }
    return Response.json({ version: 1, requestId: id, operation: 'CREATE', leaveId: 'saved', appliedAt: new Date().toISOString(), changed: true, replayed: true, notificationWarnings: [] })
  }
  try {
    store.bind('first:EMPLOYEE')
    await store.send(create(), () => { invalid++ })
    assert.equal(store.record?.state, 'uncertain')
    await store.send({ kind: 'RETURN', leaveId: 'different-intent' }, () => { invalid++ })
    assert.deepEqual(calls[0], calls[1]); assert.equal(store.commits, 1)
    let reply: (response: Response) => void = () => {}, pendingId = ''
    globalThis.fetch = async (_input, init) => { pendingId = new Headers(init?.headers).get('Idempotency-Key')!; return new Promise<Response>((resolve) => { reply = resolve }) }
    const pending = store.send(create(2, 9), () => { invalid++ })
    store.bind('another:EMPLOYEE')
    reply(Response.json({ version: 1, requestId: pendingId, operation: 'CREATE', leaveId: 'old-private-leave', changed: true, notificationWarnings: [] }))
    await pending
    assert.equal(store.record, null); assert.equal(store.commits, 1); assert.equal(invalid, 0)
    let bodyReply: (value: LeaveResult) => void = () => {}, reading: () => void = () => {}
    const bodyReady = new Promise<void>((resolve) => { reading = resolve })
    globalThis.fetch = async (_input, init) => {
      pendingId = new Headers(init?.headers).get('Idempotency-Key')!
      const response = new Response('')
      response.json = () => { reading(); return new Promise<LeaveResult>((resolve) => { bodyReply = resolve }) }
      return response
    }
    const decoding = store.send(create(3, 10), () => { invalid++ })
    await bodyReady; store.bind('third:EMPLOYEE')
    bodyReply({ version: 1, requestId: pendingId, operation: 'CREATE', leaveId: 'old-decoded-leave', appliedAt: new Date().toISOString(), changed: true, replayed: false, notificationWarnings: [] })
    await decoding
    assert.equal(store.record, null); assert.equal(store.commits, 1, 'An old response body cannot clear another actor draft through a commit event')
  } finally {
    store.clear(); globalThis.fetch = originalFetch
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow); else Reflect.deleteProperty(globalThis, 'window')
  }
})
