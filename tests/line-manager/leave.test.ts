import 'dotenv/config'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, test } from 'node:test'
import express from 'express'
import { authTestDatabase, readAuthConfig } from '../../server/auth/config.ts'
import { provision } from '../../server/auth/provision.ts'
import { createAuth } from '../../server/auth/provider.ts'
import { createAuthService } from '../../server/auth/service.ts'
import { day, isoDay, shiftDay } from '../../server/data-model/calendar.ts'
import { createDatabase } from '../../server/db.ts'
import { recipientRefusal, storedBasis } from '../../server/email/policy.ts'
import type { PrismaClient } from '../../src/generated/prisma/client.ts'
import { mutateManagerLeave } from '../../server/line-manager/leave-writes.ts'
import { registerLineManager } from '../../server/line-manager/router.ts'
import { markRead } from '../../server/notifications/writes.ts'
import type { CoverHistory, ManagerLeave, ManagerLeaveHistory, ManagerLeaveResult, ReliefCandidates } from '../../src/features/line-manager/leave-contracts.ts'
import { historicalFixtures } from '../helpers/historical-fixtures.ts'
import { managerFixtures } from '../helpers/manager-dashboard-fixtures.ts'

const db = createDatabase(authTestDatabase(process.env.TEST_DATABASE_URL, process.env.DATABASE_URL))
const config = readAuthConfig()
const service = createAuthService(db, createAuth(db, config))
const app = express()
const server = createServer(app)
const cookies: string[] = []
let base = ''

before(async () => {
  process.env.EMAIL_MODE = 'off'
  const router = express.Router()
  registerLineManager(router, db, service, config)
  app.use('/api', router)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/line-manager`
})
after(async () => {
  if (base) await new Promise<void>((resolve) => server.close(() => resolve()))
  for (const cookie of cookies) await service.signOut(new Headers({ cookie }))
  await db.$disconnect()
})

async function login(email: string, password: string) {
  const result = await service.signIn(email, password, new Headers({ origin: config.origin }))
  const cookie = result.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ')
  cookies.push(cookie)
  return cookie
}
async function setup() {
  const fixture = await managerFixtures(db, config)
  const other = await db.user.findUniqueOrThrow({ where: { id: fixture.otherManagerId } })
  await provision(db, config, other.id, fixture.password)
  return { ...fixture, today: isoDay(fixture.today), other,
    ownerCookie: await login(fixture.email, fixture.password), otherCookie: await login(other.email, fixture.password) }
}
const get = (path: string, cookie: string) => fetch(base + path, { headers: { cookie } })
const post = (path: string, body: unknown, cookie: string, key = randomUUID()) => fetch(base + path, {
  method: 'POST', headers: { cookie, origin: config.origin, 'content-type': 'application/json', 'idempotency-key': key }, body: JSON.stringify(body),
})
async function result<T>(response: Response): Promise<T> {
  assert.equal(response.headers.get('cache-control'), 'no-store')
  const value = await response.json()
  assert.equal(response.status, 200, JSON.stringify(value))
  return value as T
}
async function error(response: Response, status: number, code: string) {
  assert.equal(response.status, status)
  assert.equal((await response.json()).error.code, code)
}
const add = (start: string, days: number) => isoDay(shiftDay(day(start), days))
const period = (startsOn: string, expectedReturnOn: string, reliefManagerId: string) => ({ startsOn, expectedReturnOn, reliefManagerId })

test('current cover grants only live approvals and end revokes them immediately (AC-2, 3, 5, 6, 7, 8)', async () => {
  const f = await setup()
  const { ownerCookie, otherCookie, today } = f
  const exact = `/approvals/requests/${f.requestId}`
  assert.equal((await get(exact, otherCookie)).status, 404)
  const body = period(today, add(today, 5), f.other.id)
  const key = randomUUID()
  const receipt = await result<ManagerLeaveResult>(await post('/leave', body, ownerCookie, key))
  assert.ok(receipt.coverId)
  assert.deepEqual(await result(await post('/leave', body, ownerCookie, key)), { ...receipt, replayed: true })
  await error(await post('/leave', { ...body, expectedReturnOn: add(today, 6) }, ownerCookie, key), 409, 'IDEMPOTENCY_CONFLICT')
  const path = `/leave/${receipt.leaveId}`
  const current = await result<ManagerLeave>(await get('/leave', ownerCookie))
  assert.equal(current.current?.canReturn, true)
  assert.equal(current.coverState, 'Active')
  assert.equal(current.coverGap, false)
  const detail = await result<{ mode: string; canDecide: boolean }>(await get(exact, otherCookie))
  assert.deepEqual([detail.mode, detail.canDecide], ['RELIEF', true])
  const notice = await db.notification.findFirstOrThrow({ where: { recipientId: f.other.id, leaveId: receipt.leaveId, reliefAssignmentId: receipt.coverId }, include: { email: true } })
  assert.equal(notice.email?.failureCode, 'MAIL_DISABLED')
  const initialNotices = await db.notification.findMany({ where: { leaveId: receipt.leaveId }, include: { email: true } })
  assert.equal(new Set(initialNotices.map(({ recipientId }) => recipientId)).size, initialNotices.length)
  assert.deepEqual(new Set(initialNotices.map(({ email }) => storedBasis(email?.recipientBasis ?? null)?.relationship)),
    new Set(['MANAGER_LEAVE_OWNER', 'RELIEF_OFFICER', 'BUSINESS_DIRECTOR', 'HR']))
  const basis = storedBasis(notice.email?.recipientBasis ?? null)
  assert.ok(basis)
  assert.equal(await recipientRefusal(db, notice, basis, f.other.email, new Date(receipt.appliedAt)), null)
  const session = await service.current(new Headers({ cookie: otherCookie }))
  assert.ok(session.context && session.internalSessionId)
  const actor = { context: session.context, sessionId: session.internalSessionId }
  const opened = await markRead(db, actor, randomUUID(), { operation: 'NOTIFICATION_READ', notificationId: notice.id })
  assert.ok('target' in opened)
  assert.deepEqual(opened.target, { kind: 'MANAGER_APPROVALS' })
  assert.equal((await get(`${path}/cover-history`, otherCookie)).status, 404)
  await error(await post(`${path}/cover/end`, { expectedReliefId: randomUUID() }, ownerCookie), 409, 'RELIEF_CHANGED')
  const ended = await result<ManagerLeaveResult>(await post(`${path}/cover/end`, { expectedReliefId: receipt.coverId }, ownerCookie))
  assert.deepEqual(ended.endedCoverIds, [receipt.coverId])
  assert.ok(ended.notificationWarnings.includes('COVER_GAP'))
  assert.equal((await get(exact, otherCookie)).status, 404)
  assert.equal(await recipientRefusal(db, notice, basis, f.other.email, new Date(ended.appliedAt)), 'RELATIONSHIP_CHANGED')
  const endNotice = await db.notification.findFirstOrThrow({ where: { recipientId: f.other.id, reliefAssignmentId: receipt.coverId, kind: 'RELIEF_ENDED' } })
  assert.equal(await recipientRefusal(db, endNotice, basis, f.other.email, new Date(ended.appliedAt)), null)
  const stale = await markRead(db, actor, randomUUID(), { operation: 'NOTIFICATION_READ', notificationId: notice.id })
  assert.ok('target' in stale)
  assert.deepEqual(stale.target, { kind: 'MANAGER_APPROVALS' })
  const returned = await result<ManagerLeaveResult>(await post(`${path}/return`, {}, ownerCookie))
  assert.equal(returned.actualReturnOn, today)
  await db.user.update({ where: { id: f.other.id }, data: { name: 'Changed after cover' } })
  const history = await result<ManagerLeaveHistory>(await get('/leave/history', ownerCookie))
  const row = history.periods.items.find(({ id }) => id === receipt.leaveId)
  assert.deepEqual([row?.state, row?.days, row?.lastCover?.officerName], ['Returned early', 0, f.other.name])
  const covers = await result<CoverHistory>(await get(`${path}/cover-history`, ownerCookie))
  assert.deepEqual(covers.arrangements.items.map(({ startsOn, endsOn, endedById, state }) => [startsOn, endsOn, endedById, state]),
    [[today, body.expectedReturnOn, f.managerId, 'Ended']])
  assert.equal(await db.auditEvent.count({ where: { targetId: receipt.leaveId, actorId: f.managerId } }), 3)
})

test('scheduled leave supports cross business candidates, replacement, gaps, and cancellation (AC-2, 3, 4, 5, 6, 7, 8)', async () => {
  const f = await setup()
  const startsOn = add(f.today, 3), endsOn = add(f.today, 9)
  const first = await db.employmentAssignment.findFirstOrThrow({ where: { userId: f.managerId, effectiveTo: null } })
  const different = await db.employmentAssignment.findFirstOrThrow({ where: { role: 'LINE_MANAGER', businessId: { not: first.businessId! }, effectiveTo: null } })
  assert.ok(different.businessId && different.unitId)
  const replacementId = `f20-unprovisioned-${f.tag}`
  await historicalFixtures((tx) => tx.user.create({ data: { id: replacementId, name: `Cross Business ${f.prefix}`, email: `${replacementId}@example.invalid`, accountStatus: 'ACTIVE',
    assignments: { create: { role: 'LINE_MANAGER', businessId: different.businessId, unitId: different.unitId, effectiveFrom: day(f.today) } },
  } }))
  const query = new URLSearchParams({ startsOn, endsOn, search: f.prefix })
  const candidates = (await result<ReliefCandidates>(await get(`/leave/relief-candidates?${query}`, f.ownerCookie))).candidates.items
  assert.deepEqual(new Set(candidates.map(({ id }) => id)), new Set([f.other.id, replacementId]))
  for (const item of candidates) assert.deepEqual(Object.keys(item).sort(), ['business', 'id', 'name'])
  await error(await post('/leave', period(startsOn, endsOn, f.managerId), f.ownerCookie), 409, 'RELIEF_UNAVAILABLE')
  const booked = await result<ManagerLeaveResult>(await post('/leave', period(startsOn, endsOn, f.other.id), f.ownerCookie))
  const path = `/leave/${booked.leaveId}`
  assert.equal((await result<ManagerLeave>(await get('/leave', f.ownerCookie))).current?.canCancel, true)
  await error(await post('/leave', period(startsOn, endsOn, replacementId), f.otherCookie), 409, 'INCOMING_COVER')
  const body = { expectedReliefId: booked.coverId, reliefManagerId: replacementId, startsOn: add(startsOn, 1), endsOn }
  const changed = await result<ManagerLeaveResult>(await post(`${path}/cover`, body, f.ownerCookie))
  assert.ok(changed.coverId && changed.coverId !== booked.coverId)
  assert.ok(changed.notificationWarnings.includes('COVER_GAP'))
  assert.ok(changed.notificationWarnings.includes('OFFICER_NOT_PROVISIONED'))
  await error(await post(`${path}/cover`, body, f.ownerCookie), 409, 'RELIEF_CHANGED')
  const cancelled = await result<ManagerLeaveResult>(await post(`${path}/cancel`, {}, f.ownerCookie))
  assert.deepEqual(cancelled.endedCoverIds, [changed.coverId])
  const history = await result<ManagerLeaveHistory>(await get('/leave/history?page=1', f.ownerCookie))
  assert.deepEqual(history.periods.items.map(({ state, days, coverCount }) => [state, days, coverCount]), [['Cancelled', 0, 2]])
  assert.equal((await get('/leave', await login(f.ownerEmail, f.password))).status, 403)
})

test('simultaneous reciprocal bookings leave exactly one coherent period and grant (AC-4, 9)', async () => {
  const f = await setup()
  const start = add(f.today, 2), end = add(f.today, 4)
  const replies = await Promise.all([
    post('/leave', period(start, end, f.other.id), f.ownerCookie),
    post('/leave', period(start, end, f.managerId), f.otherCookie),
  ])
  assert.deepEqual(replies.map(({ status }) => status).sort(), [200, 409])
  assert.equal(await db.leaveRecord.count({ where: { userId: { in: [f.managerId, f.other.id] } } }), 1)
  assert.equal(await db.reliefAssignment.count({ where: { coveredManagerId: { in: [f.managerId, f.other.id] } } }), 1)
})

test('a persistence failure rolls back leave, cover, audit, notices and receipt (AC-7)', async () => {
  const f = await setup()
  const session = await service.current(new Headers({ cookie: f.ownerCookie }))
  assert.ok(session.context && session.internalSessionId)
  const actor = { context: session.context, sessionId: session.internalSessionId }
  const draft = period(add(f.today, 3), add(f.today, 5), f.other.id)
  for (const model of ['ReliefAssignment', 'Notification', 'EmailDelivery', 'AuditEvent', 'LeaveMutationReceipt']) {
    const requestId = randomUUID()
    const failing = db.$extends({ query: { $allModels: { async $allOperations({ model: name, operation, args, query }) {
      if (name === model && operation === 'create') throw new Error('Injected persistence outage')
      return query(args)
    } } } }) as unknown as PrismaClient
    await assert.rejects(mutateManagerLeave(failing, actor, requestId, { kind: 'MANAGER_CREATE', draft }), /Injected persistence outage/)
    assert.equal(await db.leaveRecord.count({ where: { userId: f.managerId } }), 0, model)
    assert.equal(await db.reliefAssignment.count({ where: { coveredManagerId: f.managerId } }), 0, model)
    assert.equal(await db.auditEvent.count({ where: { actorId: f.managerId, targetType: 'LeaveRecord' } }), 0, model)
    assert.equal(await db.notification.count({ where: { recipientId: f.managerId, leaveId: { not: null } } }), 0, model)
    assert.equal(await db.leaveMutationReceipt.count({ where: { userId: f.managerId, requestId } }), 0, model)
  }
})

test('ambiguous legacy cover preserves evidence and withholds all transitions (AC-8, 9)', async () => {
  const f = await setup()
  const startsOn = day(add(f.today, 3)), endsOn = day(add(f.today, 5))
  const leave = await db.leaveRecord.create({ data: { userId: f.managerId, startsOn, expectedReturnOn: endsOn } })
  await db.reliefAssignment.createMany({ data: [f.other.id, 'person-nneka-obi'].map((reliefManagerId) => ({
    leaveId: leave.id, coveredManagerId: f.managerId, reliefManagerId, startsOn, endsOn,
  })) })
  const current = await result<ManagerLeave>(await get('/leave', f.ownerCookie))
  assert.deepEqual([current.state, current.cover, current.canEditCover, current.current?.canCancel], ['REPAIR_REQUIRED', null, false, false])
  await error(await post(`/leave/${leave.id}/cancel`, {}, f.ownerCookie), 409, 'LEAVE_REPAIR_REQUIRED')
  const history = await result<CoverHistory>(await get(`/leave/${leave.id}/cover-history`, f.ownerCookie))
  assert.deepEqual(history.arrangements.items.map(({ officerName, endedAt }) => [officerName, endedAt]), [[null, null], [null, null]])
})
