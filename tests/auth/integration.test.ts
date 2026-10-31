import 'dotenv/config'
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { randomUUID } from 'node:crypto'
import express from 'express'
import { createDatabase } from '../../server/db.ts'
import { authTestDatabase, readAuthConfig } from '../../server/auth/config.ts'
import { createAuth } from '../../server/auth/provider.ts'
import { createAuthService } from '../../server/auth/service.ts'
import { registerAuth, registerNavigation } from '../../server/auth/router.ts'
import { provision } from '../../server/auth/provision.ts'
import { staffContext, safeContext } from '../../server/auth/context.ts'
import { aggregateScope, canReadPerson, canReadTask, canReviewRelief } from '../../server/auth/policies.ts'
import { checkEmail, recordFailure, reserve, throttleKey } from '../../server/auth/throttle.ts'
import type { SessionContext } from '../../src/features/auth/contracts.ts'

const url = authTestDatabase(process.env.TEST_DATABASE_URL, process.env.DATABASE_URL)
const db = createDatabase(url)
const password = process.env.LOCAL_AUTH_TEST_PASSWORD
assert.ok(password, 'Explicit LOCAL_AUTH_TEST_PASSWORD is required')
const config = readAuthConfig()
const auth = createAuth(db, config)
const service = createAuthService(db, auth)
const server = createServer()
const roles = [
  ['person-ada-okafor', 'EMPLOYEE'], ['person-tunde-bakare', 'LINE_MANAGER'], ['person-amara-bello', 'BUSINESS_DIRECTOR'],
  ['person-david-cole', 'EXECUTIVE'], ['person-kemi-adebayo', 'HR_ADMIN'],
] as const
let base: string
const ids = new Set<string>()
const counterKeys = new Set<string>()
const testPeople = new Set<string>()

async function resetLimits() {
  for (const namespace of ['ip', 'auth-ip'] as const) counterKeys.add(throttleKey(config.secret, namespace, '127.0.0.1'))
  for (const [id] of roles) {
    const person = await db.user.findUniqueOrThrow({ where: { id } })
    counterKeys.add(throttleKey(config.secret, 'email', person.email))
  }
  await db.loginThrottle.deleteMany({ where: { key: { in: [...counterKeys] } } })
}
async function request(path: string, options: RequestInit = {}) {
  return fetch(base + path, { redirect: 'manual', ...options })
}
async function login(id: string = roles[0][0], suppliedPassword = password!) {
  const person = await db.user.findUniqueOrThrow({ where: { id } })
  const response = await request('/api/auth/sign-in', { method: 'POST', headers: { Origin: config.origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: person.email, password: suppliedPassword }) })
  const cookies = response.headers.getSetCookie()
  const cookie = cookies.map((value) => value.split(';')[0]).join('; ')
  const body = await response.json() as SessionContext
  assert.equal(response.status, 200, JSON.stringify(body))
  const sessions = await db.authSession.findMany({ where: { userId: id }, select: { id: true } })
  for (const session of sessions) ids.add(session.id)
  return { cookie, body, cookies }
}
async function context(id: string) {
  const staff = await staffContext(db, id)
  assert.ok(staff)
  return safeContext(staff, new Date(Date.now() + 60000))
}
before(async () => {
  for (const [id] of roles) await provision(db, config, id, password!)
  await resetLimits()
  const app = express()
  const api = express.Router()
  registerAuth(api, db, service, config)
  api.use((_request, response) => response.status(404).json({ error: 'Not found' }))
  app.use('/api', api)
  registerNavigation(app, service, true)
  app.get('/{*path}', (_request, response) => response.setHeader('Cache-Control', 'no-cache').type('html').send('<main>Application document</main>'))
  server.on('request', app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await db.authSession.deleteMany({ where: { id: { in: [...ids] } } })
  await db.loginThrottle.deleteMany({ where: { key: { in: [...counterKeys] } } })
  await db.user.updateMany({ where: { id: { in: [...testPeople] } }, data: { accountStatus: 'INACTIVE', deactivatedAt: new Date() } })
  await db.$disconnect()
})

test('five roles sign in with safe context and secure host only cookies (AC-2,3,5)', async () => {
  for (const [id, role] of roles) {
    const result = await login(id)
    assert.equal(result.body.user.id, id)
    assert.equal(result.body.role, role)
    assert.equal(JSON.stringify(result.body).includes('token'), false)
    assert.equal(JSON.stringify(result.body).includes('password'), false)
    assert.ok(result.cookies.some((cookie) => cookie.includes('workforce.session_token=') && /HttpOnly/i.test(cookie) && /SameSite=Lax/i.test(cookie) && /Path=\//i.test(cookie) && !/Domain=/i.test(cookie)))
    const session = await request('/api/session', { headers: { Cookie: result.cookie } })
    assert.equal(session.status, 200)
    assert.equal(session.headers.get('cache-control'), 'no-store')
  }
})
test('sessions are independent and revocation survives cookie replay (AC-3)', async () => {
  const first = await login()
  const second = await login()
  const signedOut = await request('/api/auth/sign-out', { method: 'POST', headers: { Origin: config.origin, 'Content-Type': 'application/json', Cookie: first.cookie }, body: '{}' })
  assert.equal(signedOut.status, 204)
  assert.ok(signedOut.headers.getSetCookie().some((value) => /Max-Age=0/.test(value)))
  assert.equal((await request('/api/session', { headers: { Cookie: first.cookie } })).status, 401)
  assert.equal((await request('/api/session', { headers: { Cookie: second.cookie } })).status, 200)
  assert.equal((await request('/api/auth/sign-out', { method: 'POST', headers: { Origin: config.origin, 'Content-Type': 'application/json' }, body: '{}' })).status, 204)
})
test('sign out does not claim success or clear cookies when provider deletion fails (AC-3)', async () => {
  await resetLimits()
  const signedIn = await login()
  await db.$executeRawUnsafe(`CREATE FUNCTION auth_test_session_delete_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD."userId" = 'person-ada-okafor' THEN RAISE EXCEPTION 'injected deletion failure'; END IF; RETURN OLD; END $$`)
  await db.$executeRawUnsafe(`CREATE TRIGGER auth_test_session_delete_failure BEFORE DELETE ON "AuthSession" FOR EACH ROW EXECUTE FUNCTION auth_test_session_delete_failure()`)
  try {
    const failed = await request('/api/auth/sign-out', { method: 'POST', headers: { Origin: config.origin, 'Content-Type': 'application/json', Cookie: signedIn.cookie }, body: '{}' })
    assert.equal(failed.status, 503)
    assert.equal(failed.headers.getSetCookie().length, 0)
    assert.equal((await request('/api/session', { headers: { Cookie: signedIn.cookie } })).status, 200)
  } finally {
    await db.$executeRawUnsafe('DROP TRIGGER auth_test_session_delete_failure ON "AuthSession"')
    await db.$executeRawUnsafe('DROP FUNCTION auth_test_session_delete_failure()')
  }
})
test('daily activity refreshes expiry and forwards renewal cookies while expired sessions fail (AC-3)', async () => {
  const signedIn = await login()
  const session = await db.authSession.findFirstOrThrow({ where: { userId: roles[0][0] }, orderBy: { createdAt: 'desc' } })
  await db.authSession.update({ where: { id: session.id }, data: { updatedAt: new Date(Date.now() - 90000000), expiresAt: new Date(Date.now() + 500000000) } })
  const renewed = await request('/api/session', { headers: { Cookie: signedIn.cookie } })
  assert.equal(renewed.status, 200)
  assert.ok(renewed.headers.getSetCookie().length)
  const refreshed = await db.authSession.findUniqueOrThrow({ where: { id: session.id } })
  assert.ok(refreshed.expiresAt.getTime() > Date.now() + 604000000)
  await db.authSession.update({ where: { id: session.id }, data: { expiresAt: new Date(Date.now() - 1000) } })
  assert.equal((await request('/api/session', { headers: { Cookie: signedIn.cookie } })).status, 401)
})
test('current role changes take effect immediately and deactivation revokes all devices (AC-4)', async () => {
  const first = await login()
  const second = await login()
  const assignment = await db.employmentAssignment.findFirstOrThrow({ where: { userId: roles[0][0], effectiveTo: null } })
  try {
    await db.employmentAssignment.update({ where: { id: assignment.id }, data: { role: 'LINE_MANAGER', managerId: null } })
    const changed = await request('/api/session', { headers: { Cookie: first.cookie } })
    assert.equal((await changed.json() as SessionContext).role, 'LINE_MANAGER')
    const redirect = await request('/employee/home', { headers: { Cookie: first.cookie, Accept: 'text/html' } })
    assert.equal(redirect.headers.get('location'), '/line-manager/dashboard?notice=access-denied')
    await db.user.update({ where: { id: roles[0][0] }, data: { accountStatus: 'INACTIVE', deactivatedAt: new Date() } })
    assert.equal((await request('/api/session', { headers: { Cookie: first.cookie } })).status, 401)
    assert.equal((await request('/api/session', { headers: { Cookie: second.cookie } })).status, 401)
    assert.equal(await db.authSession.count({ where: { userId: roles[0][0] } }), 0)
  } finally {
    await db.employmentAssignment.update({ where: { id: assignment.id }, data: { role: assignment.role, managerId: assignment.managerId } })
    await db.user.update({ where: { id: roles[0][0] }, data: { accountStatus: 'ACTIVE', deactivatedAt: null } })
  }
})
test('identity inconsistencies deny sessions and account details require correct password (AC-4,7)', async () => {
  const signedIn = await login()
  const identity = await db.authUser.findUniqueOrThrow({ where: { id: roles[0][0] } })
  try {
    await db.authUser.update({ where: { id: identity.id }, data: { provisionedAt: null } })
    assert.equal((await request('/api/session', { headers: { Cookie: signedIn.cookie } })).status, 401)
    const attempt = async (pass: string) => request('/api/auth/sign-in', { method: 'POST', headers: { Origin: config.origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: identity.email, password: pass }) })
    assert.equal((await attempt('WrongPass1')).status, 401)
    assert.equal((await attempt(password!)).status, 403)
    await db.authUser.update({ where: { id: identity.id }, data: { provisionedAt: identity.provisionedAt } })
    const fresh = await login()
    const freshSession = await db.authSession.findFirstOrThrow({ where: { userId: identity.id }, orderBy: { createdAt: 'desc' } })
    await db.authUser.update({ where: { id: identity.id }, data: { email: 'mismatch@example.com' } })
    assert.equal((await request('/api/session', { headers: { Cookie: fresh.cookie } })).status, 401)
    assert.equal(await db.authSession.findUnique({ where: { id: freshSession.id } }), null)
  } finally { await db.authUser.update({ where: { id: identity.id }, data: { provisionedAt: identity.provisionedAt, email: identity.email } }) }
  await resetLimits()
})
test('unknown routes, methods, selectors and cross origin writes cannot bypass guards (AC-5,7,8)', async () => {
  for (const path of ['/api/auth/sign-up/email', '/api/auth/reset-password', '/api/auth/update-user', '/api/employee/tasks']) assert.equal((await request(path)).status, 404)
  const body = JSON.stringify({ email: 'unknown@example.com', password })
  for (const origin of [undefined, 'null', 'https://foreign.example']) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (origin) headers.Origin = origin
    assert.equal((await request('/api/auth/sign-in', { method: 'POST', headers, body })).status, 403)
  }
  assert.equal((await request('/api/auth/sign-in', { method: 'POST', headers: { Origin: config.origin, 'Content-Type': 'text/plain' }, body })).status, 415)
  assert.equal((await request('/api/auth/sign-in', { method: 'POST', headers: { Origin: config.origin, 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'cross-site' }, body })).status, 403)
  for (const path of ['/api/session?role=HR_ADMIN', '/api/session?x=1&x=2', '/api/auth/sign-in']) assert.equal((await request(path)).status, 400)
  const anonymous = await request('/hr/employees', { headers: { Accept: 'text/html' } })
  assert.equal(anonymous.headers.get('location'), '/sign-in')
  assert.equal((await request('/__ui', { headers: { Accept: 'text/html' } })).status, 200)
  assert.equal((await request('/sign-in', { headers: { Accept: 'text/html', 'Sec-Fetch-Site': 'cross-site' } })).status, 200)
  assert.equal((await request('/sign-in', { headers: { Accept: 'text/html' } })).headers.get('cache-control'), 'no-store')
  assert.equal((await request('/@vite/client', { headers: { Accept: '*/*' } })).status, 200)
  const signedIn = await login()
  assert.equal((await request('/employee', { headers: { Cookie: signedIn.cookie, Accept: 'text/html' } })).headers.get('location'), '/employee/home')
  assert.equal((await request('/employee/unknown', { headers: { Cookie: signedIn.cookie, Accept: 'text/html' } })).headers.get('location'), '/employee/home?notice=page-unavailable')
  assert.equal((await request('/api/session', { headers: { Cookie: signedIn.cookie + 'tampered' } })).status, 401)
  for (const extra of [{ role: 'HR_ADMIN' }, { userId: roles[1][0] }, { businessId: 'other' }]) {
    assert.equal((await request('/api/auth/sign-in', { method: 'POST', headers: { Origin: config.origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'unknown@example.com', password, ...extra }) })).status, 400)
  }
  for (const invalid of ['[]', '{', JSON.stringify({ email: 'x'.repeat(8200), password })]) {
    assert.ok([400, 413].includes((await request('/api/auth/sign-in', { method: 'POST', headers: { Origin: config.origin, 'Content-Type': 'application/json' }, body: invalid })).status))
  }
})
test('email failures, atomic concurrent counters and independent IP limits persist (AC-8)', async () => {
  const email = `unknown-${randomUUID()}@example.com`
  const key = throttleKey(config.secret, 'email', email)
  counterKeys.add(key)
  const attempt = () => request('/api/auth/sign-in', { method: 'POST', headers: { Origin: config.origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })
  for (let index = 0; index < 5; index++) assert.equal((await attempt()).status, 401)
  const blocked = await attempt()
  assert.equal(blocked.status, 429)
  assert.ok(Number(blocked.headers.get('retry-after')) > 0)
  const concurrentKey = throttleKey(config.secret, 'email', randomUUID())
  counterKeys.add(concurrentKey)
  await Promise.all(Array.from({ length: 8 }, () => recordFailure(db, concurrentKey)))
  assert.equal((await db.loginThrottle.findUniqueOrThrow({ where: { key: concurrentKey } })).count, 5)
  await assert.rejects(checkEmail(db, concurrentKey), /Too many attempts/)
  const ipKey = throttleKey(config.secret, 'ip', '127.0.0.1')
  await db.loginThrottle.update({ where: { key: ipKey }, data: { count: 100 } })
  assert.equal((await attempt()).status, 429)
  const sharedKey = throttleKey(config.secret, 'auth-ip', '127.0.0.1')
  await reserve(db, sharedKey, 100, 10)
  await db.loginThrottle.update({ where: { key: sharedKey }, data: { count: 100 } })
  assert.equal((await request('/api/session')).status, 429)
  await resetLimits()
})
test('policies enforce own, current, historical, business, Executive, HR and narrow relief scopes (AC-6)', async () => {
  const employee = await context(roles[0][0])
  const manager = await context(roles[1][0])
  const director = await context(roles[2][0])
  const executive = await context(roles[3][0])
  const hr = await context(roles[4][0])
  const own = await db.weeklyTask.findFirstOrThrow({ where: { ownerId: employee.user.id, deletedAt: null, tracker: { snapshotAt: { not: null } } } })
  const current = await db.weeklyTask.findFirstOrThrow({ where: { ownerId: employee.user.id, deletedAt: null, tracker: { snapshotAt: null } } })
  const foreign = await db.weeklyTask.findFirstOrThrow({ where: { ownerId: { not: employee.user.id }, deletedAt: null } })
  assert.equal(await canReadTask(db, employee, own.id, 'own'), true)
  assert.equal(await canReadTask(db, employee, foreign.id, 'own'), false)
  assert.equal(await canReadTask(db, employee, foreign.id, 'current'), false)
  assert.equal(await canReadPerson(db, manager, employee.user.id), true)
  assert.equal(await canReadTask(db, manager, current.id, 'current'), true)
  assert.equal(await canReadTask(db, director, current.id, 'current'), true)
  assert.equal(await canReadTask(db, manager, own.id, 'historical'), true)
  assert.equal(await canReadTask(db, manager, own.id, 'current'), false, 'Frozen tasks cannot be reinterpreted using current reporting scope')
  assert.equal(await canReadTask(db, director, own.id, 'historical'), true)
  assert.equal(await canReadTask(db, { ...director, businessId: 'different-business' }, own.id, 'current'), false)
  assert.equal(await canReadTask(db, executive, own.id, 'current'), false)
  assert.equal(await canReadPerson(db, executive, employee.user.id), false)
  assert.equal(await canReadPerson(db, executive, executive.user.id), true)
  assert.equal(await canReadTask(db, hr, foreign.id, 'historical'), true)
  assert.equal(aggregateScope(executive), true)
  assert.equal(aggregateScope(employee), false)
  const assignment = await db.employmentAssignment.findFirstOrThrow({ where: { userId: employee.user.id, effectiveTo: null } })
  try {
    await db.employmentAssignment.update({ where: { id: assignment.id }, data: { managerId: 'person-nneka-obi' } })
    assert.equal(await canReadTask(db, manager, current.id, 'current'), false)
    assert.equal(await canReadTask(db, manager, own.id, 'historical'), true)
  } finally { await db.employmentAssignment.update({ where: { id: assignment.id }, data: { managerId: assignment.managerId } }) }
  const relief = await db.reliefAssignment.findUniqueOrThrow({ where: { id: 'relief-nneka' }, include: { leave: true } })
  const pending = await db.approvalRequest.findFirstOrThrow({ where: { assignedManagerId: manager.user.id, state: 'PENDING' } })
  const during = new Date(relief.startsOn.getTime() + 3600000)
  try {
    await db.approvalRequest.update({ where: { id: pending.id }, data: { assignedManagerId: relief.coveredManagerId } })
    assert.equal(await canReviewRelief(db, manager, pending.id, during), true)
    assert.equal(await canReviewRelief(db, manager, pending.id, new Date(relief.endsOn.getTime())), false)
    assert.equal(await canReviewRelief(db, manager, pending.id, new Date(relief.startsOn.getTime() - 3600001)), false)
    assert.equal(await canReviewRelief(db, employee, pending.id, during), false)
    await db.reliefAssignment.update({ where: { id: relief.id }, data: { endedAt: during } })
    assert.equal(await canReviewRelief(db, manager, pending.id, during), false)
    await db.reliefAssignment.update({ where: { id: relief.id }, data: { endedAt: relief.endedAt } })
    await db.leaveRecord.update({ where: { id: relief.leaveId }, data: { cancelledAt: during } })
    assert.equal(await canReviewRelief(db, manager, pending.id, during), false)
  } finally {
    await db.approvalRequest.update({ where: { id: pending.id }, data: { assignedManagerId: pending.assignedManagerId } })
    await db.reliefAssignment.update({ where: { id: relief.id }, data: { endedAt: relief.endedAt } })
    await db.leaveRecord.update({ where: { id: relief.leaveId }, data: { cancelledAt: relief.leave.cancelledAt } })
  }
  assert.equal(await canReviewRelief(db, manager, 'missing-request'), false)
})
test('reprovisioning preserves ready credentials, activation time and sessions (AC-1,7)', async () => {
  await login()
  const identity = await db.authUser.findUniqueOrThrow({ where: { id: roles[0][0] }, include: { accounts: true, sessions: true } })
  assert.equal(await provision(db, config, identity.id, 'DifferentPass1'), 'already provisioned')
  assert.deepEqual(await db.authUser.findUniqueOrThrow({ where: { id: identity.id }, include: { accounts: true, sessions: true } }), identity)
})

async function createTestPerson() {
  const id = `auth-test-${randomUUID()}`
  testPeople.add(id)
  const assignment = await db.employmentAssignment.findFirstOrThrow({ where: { userId: roles[0][0], effectiveTo: null } })
  await db.user.create({ data: { id, name: 'Authentication test fixture', email: `${id}@example.com`, accountStatus: 'ACTIVE', assignments: { create: {
    role: 'EMPLOYEE', businessId: assignment.businessId, unitId: assignment.unitId, managerId: assignment.managerId, effectiveFrom: new Date(Date.now() - 60000),
  } } } })
  return id
}

test('the real provider accepts composed passwords at length boundaries (AC-8)', async () => {
  for (const exact of ['Abcd12', 'A1' + 'x'.repeat(126)]) {
    const id = await createTestPerson()
    assert.equal(await provision(db, config, id, exact), 'provisioned')
    assert.equal((await login(id, exact)).body.user.id, id)
  }
  await assert.rejects(provision(db, config, await createTestPerson(), 'abcdef'), /uppercase letter and a number/)
  await assert.rejects(provision(db, config, await createTestPerson(), 'Abcd1'), /uppercase letter and a number/)
})

test('failed activation stays pending and requires password verified resume (AC-7)', async () => {
  const id = await createTestPerson()
  let transactions = 0
  const failing = new Proxy(db, { get(target, property) {
    if (property === '$transaction') return (...args: unknown[]) => {
      if (++transactions === 2) throw new Error('Injected activation outage')
      return Reflect.apply(target.$transaction, target, args)
    }
    const value: unknown = Reflect.get(target, property)
    return typeof value === 'function' ? value.bind(target) : value
  } })
  await assert.rejects(provision(failing, config, id, password!), /activation outage/)
  assert.equal((await db.authUser.findUniqueOrThrow({ where: { id } })).provisionedAt, null)
  assert.equal(await db.authAccount.count({ where: { userId: id } }), 1)
  assert.equal(await staffContext(db, id), null)
  await assert.rejects(provision(db, config, id, 'WrongOriginal1', { resume: true }), /verification failed/)
  assert.equal(await provision(db, config, id, password!, { resume: true }), 'provisioned')
  assert.ok((await db.authUser.findUniqueOrThrow({ where: { id } })).provisionedAt)
  assert.equal(await db.auditEvent.count({ where: { targetId: id, action: 'auth.credential.provisioned' } }), 1)
  await assert.rejects(provision(db, config, id, password!, { repair: true }), /ready identity/)
})
test('private pair creation rolls back an account failure and guarded repair refuses unsafe identities (AC-1,7)', async () => {
  const rollbackId = await createTestPerson()
  // A database constraint failure after identity insertion must roll back the pair.
  await db.$executeRawUnsafe(`CREATE FUNCTION auth_test_account_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."userId" LIKE 'auth-test-%' THEN RAISE EXCEPTION 'injected account failure'; END IF; RETURN NEW; END $$`)
  await db.$executeRawUnsafe(`CREATE TRIGGER auth_test_account_failure BEFORE INSERT ON "AuthAccount" FOR EACH ROW EXECUTE FUNCTION auth_test_account_failure()`)
  try { await assert.rejects(provision(db, config, rollbackId, password!)) }
  finally {
    await db.$executeRawUnsafe('DROP TRIGGER auth_test_account_failure ON "AuthAccount"')
    await db.$executeRawUnsafe('DROP FUNCTION auth_test_account_failure()')
  }
  assert.equal(await db.authUser.count({ where: { id: rollbackId } }), 0)
  const id = await createTestPerson()
  const person = await db.user.findUniqueOrThrow({ where: { id } })
  await db.authUser.create({ data: { id, name: person.name!, email: person.email } })
  const sessionId = `test-session-${randomUUID()}`
  ids.add(sessionId)
  await db.authSession.create({ data: { id: sessionId, userId: id, token: randomUUID(), expiresAt: new Date(Date.now() + 60000) } })
  await assert.rejects(provision(db, config, id, password!, { repair: true }), /Repair refused/)
  await db.authSession.delete({ where: { id: sessionId } })
  assert.equal(await provision(db, config, id, password!, { repair: true }), 'provisioned')
  assert.equal(await db.auditEvent.count({ where: { targetId: id, action: 'auth.credential.repair.requested' } }), 1)
  await db.authUser.update({ where: { id }, data: { provisionedAt: null } })
  await db.authAccount.deleteMany({ where: { userId: id } })
  await assert.rejects(provision(db, config, id, password!, { repair: true }), /Repair refused/)
})
test('audit failures withhold sign in cookies and preserve sign out requested evidence (AC-2,3,7)', async () => {
  await resetLimits()
  await db.$executeRawUnsafe(`CREATE FUNCTION auth_test_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'auth.signin.completed' THEN RAISE EXCEPTION 'injected audit failure'; END IF; RETURN NEW; END $$`)
  await db.$executeRawUnsafe(`CREATE TRIGGER auth_test_audit_failure BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION auth_test_audit_failure()`)
  const person = await db.user.findUniqueOrThrow({ where: { id: roles[0][0] } })
  try {
    const failed = await request('/api/auth/sign-in', { method: 'POST', headers: { Origin: config.origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: person.email, password }) })
    assert.equal(failed.status, 503)
    assert.equal(failed.headers.getSetCookie().length, 0)
  } finally {
    await db.$executeRawUnsafe('DROP TRIGGER auth_test_audit_failure ON "AuditEvent"')
    await db.$executeRawUnsafe('DROP FUNCTION auth_test_audit_failure()')
  }
  const signedIn = await login()
  const session = await db.authSession.findFirstOrThrow({ where: { userId: person.id }, orderBy: { createdAt: 'desc' } })
  await db.$executeRawUnsafe(`CREATE FUNCTION auth_test_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'auth.signout.requested' THEN RAISE EXCEPTION 'injected audit failure'; END IF; RETURN NEW; END $$`)
  await db.$executeRawUnsafe(`CREATE TRIGGER auth_test_audit_failure BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION auth_test_audit_failure()`)
  const signOut = () => request('/api/auth/sign-out', { method: 'POST', headers: { Origin: config.origin, 'Content-Type': 'application/json', Cookie: signedIn.cookie }, body: '{}' })
  try {
    assert.equal((await signOut()).status, 503)
    assert.ok(await db.authSession.findUnique({ where: { id: session.id } }))
  } finally {
    await db.$executeRawUnsafe('DROP TRIGGER auth_test_audit_failure ON "AuditEvent"')
    await db.$executeRawUnsafe('DROP FUNCTION auth_test_audit_failure()')
  }
  await db.$executeRawUnsafe(`CREATE FUNCTION auth_test_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'auth.signout.completed' THEN RAISE EXCEPTION 'injected audit failure'; END IF; RETURN NEW; END $$`)
  await db.$executeRawUnsafe(`CREATE TRIGGER auth_test_audit_failure BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION auth_test_audit_failure()`)
  try {
    assert.equal((await signOut()).status, 204)
    assert.equal(await db.authSession.findUnique({ where: { id: session.id } }), null)
    assert.equal(await db.auditEvent.count({ where: { targetId: session.id, action: 'auth.signout.requested' } }), 1)
    assert.equal(await db.auditEvent.count({ where: { targetId: session.id, action: 'auth.signout.completed' } }), 0)
  } finally {
    await db.$executeRawUnsafe('DROP TRIGGER auth_test_audit_failure ON "AuditEvent"')
    await db.$executeRawUnsafe('DROP FUNCTION auth_test_audit_failure()')
  }
})
test('email counter cleanup failure cannot record a completed unissued sign in (AC-2,3,8)', async () => {
  await resetLimits()
  const person = await db.user.findUniqueOrThrow({ where: { id: roles[0][0] } })
  const key = throttleKey(config.secret, 'email', person.email)
  await recordFailure(db, key)
  const beforeAudit = await db.auditEvent.count({ where: { actorId: person.id, action: 'auth.signin.completed' } })
  const beforeSessions = await db.authSession.findMany({ where: { userId: person.id }, select: { id: true } })
  await db.$executeRawUnsafe(`CREATE FUNCTION auth_test_throttle_delete_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.key LIKE 'email:%' THEN RAISE EXCEPTION 'injected counter cleanup failure'; END IF; RETURN OLD; END $$`)
  await db.$executeRawUnsafe(`CREATE TRIGGER auth_test_throttle_delete_failure BEFORE DELETE ON "LoginThrottle" FOR EACH ROW EXECUTE FUNCTION auth_test_throttle_delete_failure()`)
  try {
    const failed = await request('/api/auth/sign-in', { method: 'POST', headers: { Origin: config.origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: person.email, password }) })
    assert.equal(failed.status, 503)
    assert.equal(failed.headers.getSetCookie().length, 0)
    assert.equal(await db.auditEvent.count({ where: { actorId: person.id, action: 'auth.signin.completed' } }), beforeAudit)
    assert.deepEqual((await db.authSession.findMany({ where: { userId: person.id }, select: { id: true } })).map((row) => row.id).sort(), beforeSessions.map((row) => row.id).sort())
  } finally {
    await db.$executeRawUnsafe('DROP TRIGGER auth_test_throttle_delete_failure ON "LoginThrottle"')
    await db.$executeRawUnsafe('DROP FUNCTION auth_test_throttle_delete_failure()')
    for (const session of await db.authSession.findMany({ where: { userId: person.id }, select: { id: true } })) ids.add(session.id)
  }
})
test('database failures fail closed during session resolution and persistent limiting (AC-4,8)', async () => {
  const brokenUrl = new URL(url!)
  brokenUrl.port = '1'
  const broken = createDatabase(brokenUrl.href)
  const valid = await login()
  const brokenService = createAuthService(broken, createAuth(broken, config))
  const app = express()
  const api = express.Router()
  registerAuth(api, broken, brokenService, config)
  app.use('/api', api)
  registerNavigation(app, brokenService, true)
  app.get('/{*path}', (_request, response) => response.status(200).setHeader('Cache-Control', 'no-cache').type('html').send('<main>Neutral retry document</main>'))
  const failedServer = app.listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => failedServer.once('listening', resolve))
  const failedBase = `http://127.0.0.1:${(failedServer.address() as AddressInfo).port}`
  try {
    await assert.rejects(brokenService.current(new Headers({ Cookie: valid.cookie })))
    const failedNavigation = await fetch(failedBase + '/profile', { headers: { Accept: 'text/html', Cookie: valid.cookie } })
    assert.equal(failedNavigation.status, 503)
    assert.equal(failedNavigation.headers.get('cache-control'), 'no-store')
    const failedSession = await fetch(failedBase + '/api/session')
    assert.equal(failedSession.status, 503)
    const failedSignIn = await fetch(failedBase + '/api/auth/sign-in', { method: 'POST', headers: { Origin: config.origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'unknown@example.com', password }) })
    assert.equal(failedSignIn.status, 503)
    assert.equal(JSON.stringify(await failedSignIn.json()).includes('postgres'), false)
  } finally { await new Promise<void>((resolve) => failedServer.close(() => resolve())); await broken.$disconnect() }
})
