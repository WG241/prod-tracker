import 'dotenv/config'
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { randomUUID } from 'node:crypto'
import express from 'express'
import { betterAuth } from 'better-auth'
import { createDatabase } from '../../server/db.ts'
import { authTestDatabase, readAuthConfig } from '../../server/auth/config.ts'
import { createAuth } from '../../server/auth/provider.ts'
import { createAuthService } from '../../server/auth/service.ts'
import { registerAuth, registerNavigation } from '../../server/auth/router.ts'
import { registerAccountProfile } from '../../server/account/router.ts'
import { registerNotifications } from '../../server/notifications/router.ts'
import { recordPasswordChanged } from '../../server/notifications/events.ts'
import { provision } from '../../server/auth/provision.ts'
import { staffContext, safeContext } from '../../server/auth/context.ts'
import { aggregateScope, canReadPerson, canReadTask, canReviewRelief } from '../../server/auth/policies.ts'
import { checkEmail, recordFailure, reserve, throttleKey } from '../../server/auth/throttle.ts'
import type { SessionContext } from '../../src/features/auth/contracts.ts'
import type { ProfileResponse } from '../../src/features/profile/contracts.ts'
import type { PreferenceReceipt } from '../../src/features/profile/contracts.ts'
import type { BatchReadResult, SingleReadResult, UnreadPage, UnreadSummary } from '../../src/features/notifications/contracts.ts'
import type { EmploymentAssignment } from '../../src/generated/prisma/client.ts'
import { monday } from '../../server/employee/calendar.ts'
import { shiftDay } from '../../server/data-model/calendar.ts'

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

async function changeAssignment(userId: string, data: Pick<EmploymentAssignment, 'role' | 'businessId' | 'unitId' | 'managerId' | 'departmentLabel'>) {
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${userId} FOR UPDATE`
    const current = await tx.employmentAssignment.findFirstOrThrow({ where: { userId, effectiveTo: null } })
    const at = new Date()
    await tx.employmentAssignment.update({ where: { id: current.id }, data: { effectiveTo: at } })
    const { role, businessId, unitId, managerId, departmentLabel } = data
    await tx.employmentAssignment.create({ data: { userId, role, businessId, unitId, managerId, departmentLabel, effectiveFrom: at } })
  })
}

async function resetLimits() {
  for (const namespace of ['ip', 'auth-ip', 'account-preference-ip', 'account-password-ip', 'notification-write-ip'] as const) counterKeys.add(throttleKey(config.secret, namespace, '127.0.0.1'))
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
async function accountFixture() {
  const id = `profile-test-${randomUUID()}`
  const email = `${id}@example.invalid`
  const secret = `A1${randomUUID()}`
  testPeople.add(id)
  for (const namespace of ['account-preference-user', 'account-password-user', 'notification-write-user'] as const) counterKeys.add(throttleKey(config.secret, namespace, id))
  counterKeys.add(throttleKey(config.secret, 'email', email))
  await db.$transaction(async (tx) => {
    await tx.user.create({ data: { id, email, name: 'Profile Test', accountStatus: 'ACTIVE', emailRemindersEnabled: false } })
    await tx.employmentAssignment.create({ data: { userId: id, role: 'HR_ADMIN', effectiveFrom: new Date() } })
  })
  await provision(db, config, id, secret)
  return { id, email, secret }
}

function accountPost(path: 'email-preference' | 'password', cookie: string, key: string, body: object) {
  return request(`/api/account/${path}`, {
    method: 'POST', headers: { Origin: config.origin, 'Content-Type': 'application/json', Cookie: cookie, 'Idempotency-Key': key },
    body: JSON.stringify(body),
  })
}
function notificationPost(path: string, cookie: string, key: string = randomUUID(), body = '{}', headers = {}) {
  return request(`/api/notifications/${path}`, { method: 'POST', body, headers: {
    Origin: config.origin, 'Content-Type': 'application/json', Cookie: cookie, 'Idempotency-Key': key, ...headers,
  } })
}
before(async () => {
  for (const [id] of roles) await provision(db, config, id, password!)
  await resetLimits()
  const app = express()
  const api = express.Router()
  registerAuth(api, db, service, config)
  registerAccountProfile(api, db, service, config)
  registerNotifications(api, db, service, config)
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
    const notifications = await request('/api/notifications', { headers: { Cookie: result.cookie } })
    assert.equal(notifications.status, 200)
    assert.equal(notifications.headers.get('cache-control'), 'no-store')
  }
})
test('signed-in Profile projects only the current owner for all five roles (Feature 13 AC-1,2,8)', async () => {
  const reportingLabels = {
    EMPLOYEE: ['Workforce Resourcing', 'Recruitment', 'Tunde Bakare'],
    LINE_MANAGER: ['Workforce Resourcing', 'Recruitment', null],
    BUSINESS_DIRECTOR: ['Workforce Resourcing', null, null],
    EXECUTIVE: ['Workforce Group', 'Workforce Group', null],
    HR_ADMIN: ['Workforce Group', 'People & Culture', null],
  } as const
  assert.equal((await request('/api/account/profile')).status, 401)
  for (const [id, role] of roles) {
    const signedIn = await login(id)
    const profile = await request('/api/account/profile', { headers: { Cookie: signedIn.cookie } })
    assert.equal(profile.status, 200)
    assert.equal(profile.headers.get('cache-control'), 'no-store')
    const body = await profile.json() as ProfileResponse
    const [business, unit, manager] = reportingLabels[role]
    assert.deepEqual(body.person, {
      name: signedIn.body.user.name, email: signedIn.body.user.email, role,
      roleLabel: { EMPLOYEE: 'Employee', LINE_MANAGER: 'Line Manager', BUSINESS_DIRECTOR: 'Business Director', EXECUTIVE: 'Executive', HR_ADMIN: 'HR / Admin' }[role],
      business, unit, manager, status: 'Active',
    })
    assert.equal(body.timezone, 'Africa/Lagos')
    assert.equal(body.canChangePassword, true)
    assert.equal(typeof body.preference.emailRemindersEnabled, 'boolean')
  }
  const { cookie } = await login()
  assert.equal((await request('/api/account/profile?userId=person-kemi-adebayo', { headers: { Cookie: cookie } })).status, 400)
  assert.equal((await request('/api/account/profile', { headers: { Cookie: cookie, 'If-Match': '"0"' } })).status, 400)
  assert.equal((await request('/api/account/profile', { headers: { Cookie: cookie, 'Sec-Fetch-Site': 'cross-site' } })).status, 403)
  assert.equal((await request('/api/account/profile', { method: 'POST', headers: { Cookie: cookie } })).status, 400)
  const signedOut = await request('/api/auth/sign-out', { method: 'POST', headers: { Origin: config.origin, 'Content-Type': 'application/json', Cookie: cookie }, body: '{}' })
  assert.equal(signedOut.status, 204)
  assert.equal((await request('/api/account/profile', { headers: { Cookie: cookie } })).status, 401)
})
test('email preference uses legacy fallback, serializes revisions and replays exact receipts (Feature 13 AC-3,4,8)', async () => {
  const { id, secret } = await accountFixture()
  await db.notificationPreference.delete({ where: { userId: id } })
  const before = await db.user.findUniqueOrThrow({ where: { id } })
  const { cookie } = await login(id, secret)
  const initial = await request('/api/account/profile', { headers: { Cookie: cookie } })
  assert.deepEqual((await initial.json() as ProfileResponse).preference, { emailRemindersEnabled: false, revision: 0 })
  assert.equal(await db.notificationPreference.count({ where: { userId: id } }), 0)

  const keys = [randomUUID(), randomUUID()]
  const intent = { emailRemindersEnabled: true, expectedRevision: 0 }
  const [first, second] = await Promise.all(keys.map((key) => accountPost('email-preference', cookie, key, intent)))
  assert.deepEqual([first.status, second.status].sort(), [200, 409])
  const saved = await (first.ok ? first : second).json() as PreferenceReceipt
  const stale = await (first.ok ? second : first).json()
  assert.equal(stale.error.code, 'STALE_PREFERENCE')
  assert.deepEqual(saved.preference, { emailRemindersEnabled: true, revision: 1 })
  const retry = await accountPost('email-preference', cookie, saved.requestId, intent)
  assert.deepEqual(await retry.json(), { ...saved, replayed: true })
  const reuse = await accountPost('email-preference', cookie, saved.requestId, { ...intent, emailRemindersEnabled: false })
  assert.equal((await reuse.json()).error.code, 'KEY_CONFLICT')

  const noChangeKey = randomUUID()
  const noChange = await accountPost('email-preference', cookie, noChangeKey, { ...intent, expectedRevision: 1 })
  const noChangeBody = await noChange.json()
  assert.equal(noChangeBody.changed, false)
  const noChangeRetry = await accountPost('email-preference', cookie, noChangeKey, { ...intent, expectedRevision: 1 })
  assert.deepEqual(await noChangeRetry.json(), { ...noChangeBody, replayed: true })
  assert.equal(await db.sharedMutationReceipt.count({ where: { userId: id } }), 2)
  assert.equal(await db.auditEvent.count({ where: { actorId: id, action: 'account.email_preference.changed' } }), 1)
  const after = await db.user.findUniqueOrThrow({ where: { id } })
  assert.equal(after.emailRemindersEnabled, before.emailRemindersEnabled)
  assert.equal(after.updatedAt.toISOString(), before.updatedAt.toISOString())
})

test('password change rolls back with failed evidence and ends all sessions only after commit (Feature 13 AC-5,6,7,8)', async () => {
  const { id, email, secret } = await accountFixture()
  const next = `A1${randomUUID()}`
  const [first, second] = [await login(id, secret), await login(id, secret)]
  const recovery = await request('/sign-in?notice=password-outcome-unknown', { headers: { Cookie: first.cookie, Accept: 'text/html' } })
  assert.equal(recovery.status, 200)
  assert.equal(recovery.headers.get('cache-control'), 'no-store')
  const intent = { currentPassword: secret, newPassword: next, confirmPassword: next }
  const mismatched = await accountPost('password', first.cookie, randomUUID(), { ...intent, confirmPassword: secret })
  assert.equal((await mismatched.json()).error.code, 'INVALID_PASSWORD_FIELDS')
  const wrong = await accountPost('password', first.cookie, randomUUID(), { ...intent, currentPassword: 'Incorrect1' })
  assert.equal((await wrong.json()).error.code, 'INVALID_CURRENT_PASSWORD')
  const reused = await accountPost('password', first.cookie, randomUUID(), { ...intent, newPassword: secret, confirmPassword: secret })
  assert.equal((await reused.json()).error.code, 'PASSWORD_REUSED')

  await db.$executeRawUnsafe("CREATE FUNCTION auth_test_profile_receipt_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.operation='PASSWORD_CHANGE' THEN RAISE EXCEPTION 'injected profile receipt failure'; END IF; RETURN NEW; END $$")
  await db.$executeRawUnsafe('CREATE TRIGGER auth_test_profile_receipt_failure BEFORE INSERT ON "SharedMutationReceipt" FOR EACH ROW EXECUTE FUNCTION auth_test_profile_receipt_failure()')
  const key = randomUUID()
  try {
    const failure = await accountPost('password', first.cookie, key, intent)
    assert.equal(failure.status, 503)
    assert.equal(await db.authSession.count({ where: { userId: id } }), 2)
    assert.equal(await db.notification.count({ where: { recipientId: id, kind: 'PASSWORD_CHANGED' } }), 0)
    assert.equal(await db.auditEvent.count({ where: { actorId: id, action: 'account.password.changed' } }), 0)
    assert.equal(await db.sharedMutationReceipt.count({ where: { userId: id } }), 0)
  } finally {
    await db.$executeRawUnsafe('DROP TRIGGER auth_test_profile_receipt_failure ON "SharedMutationReceipt"')
    await db.$executeRawUnsafe('DROP FUNCTION auth_test_profile_receipt_failure()')
  }
  // A new browser command after a confirmed test rollback, with both old sessions still active.
  const committed = await accountPost('password', first.cookie, key, intent)
  assert.equal(committed.status, 200)
  const body = await committed.json()
  assert.equal(body.reauthRequired, true)
  assert.equal(body.requestId, key)
  assert.ok(committed.headers.getSetCookie().some((value) => /Max-Age=0/.test(value)))
  assert.equal(await db.authSession.count({ where: { userId: id } }), 0)
  for (const session of [first, second]) assert.equal((await request('/api/account/profile', { headers: { Cookie: session.cookie } })).status, 401)
  const receipt = await db.sharedMutationReceipt.findUniqueOrThrow({ where: { userId_requestId: { userId: id, requestId: key } } })
  assert.equal(receipt.requestHash, null)
  assert.deepEqual(receipt.result, body)
  assert.equal(await db.notification.count({ where: { recipientId: id, kind: 'PASSWORD_CHANGED' } }), 1)
  const audit = await db.auditEvent.findFirstOrThrow({ where: { actorId: id, action: 'account.password.changed' } })
  assert.deepEqual(audit.after, { requestId: key, appliedAt: body.appliedAt, operation: 'PASSWORD_CHANGE', sessionCount: 2 })
  const old = await request('/api/auth/sign-in', { method: 'POST', headers: { Origin: config.origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: secret }) })
  assert.equal(old.status, 401)
  const current = await login(id, next)
  const consumed = await accountPost('password', current.cookie, key, { currentPassword: next, newPassword: secret, confirmPassword: secret })
  assert.equal((await consumed.json()).error.code, 'CONSUMED_COMMAND')
  assert.equal(await db.authSession.count({ where: { userId: id } }), 1)
})

test('a sign-in that verified the old password cannot issue a session after a password change (Feature 13 AC-6)', { timeout: 15000 }, async () => {
  const { id, email, secret } = await accountFixture()
  const first = await login(id, secret)
  let beforeInsert = () => {}
  let resume = () => {}
  const inserting = new Promise<void>((resolve) => { beforeInsert = resolve })
  const released = new Promise<void>((resolve) => { resume = resolve })
  const delayed = betterAuth({
    ...auth.options,
    databaseHooks: {
      ...auth.options.databaseHooks,
      session: { create: { before: async (session) => {
        await auth.options.databaseHooks.session.create.before(session)
        if (session.userId === id) { beforeInsert(); await released }
      } } },
    },
  })
  const unfinished = createAuthService(db, delayed).signIn(email, secret, new Headers())
  const rejection = assert.rejects(unfinished, { code: 'CREDENTIALS_CHANGED' })
  try {
    // The provider has verified the old password, but has not inserted its session.
    await Promise.race([inserting, unfinished])
    const next = `A1${randomUUID()}`
    const changed = await accountPost('password', first.cookie, randomUUID(), { currentPassword: secret, newPassword: next, confirmPassword: next })
    assert.equal(changed.status, 200)
    assert.equal(await db.authSession.count({ where: { userId: id } }), 0)
  } finally {
    resume()
    await rejection
  }
  assert.equal(await db.authSession.count({ where: { userId: id } }), 0)
  assert.equal(await db.auditEvent.count({ where: { actorId: id, action: 'auth.signin.completed' } }), 1)
})

test('unread notifications page only current recipient messages with stable ties (Feature 14 AC-2,8)', async () => {
  const owner = await accountFixture()
  const other = await accountFixture()
  const { cookie } = await login(owner.id, owner.secret)
  const earlier = new Date(Date.now() - 60000)
  const ids = Array.from({ length: 26 }, (_, index) => `${owner.id}-notice-${String(index).padStart(2, '0')}`)
  const message = { kind: 'PASSWORD_CHANGED', title: 'Password changed', body: 'Your test account password changed.', createdAt: earlier }
  await db.notification.createMany({ data: [
    ...ids.map((id) => ({ ...message, id, recipientId: owner.id, deduplicationKey: id })),
    { ...message, recipientId: owner.id, deduplicationKey: 'fixture-read', readAt: earlier },
    { ...message, recipientId: owner.id, deduplicationKey: 'fixture-future', createdAt: new Date(Date.now() + 600000) },
    { ...message, recipientId: other.id, deduplicationKey: 'fixture-other' },
  ] })

  const headers = { Cookie: cookie }
  const summary = await request('/api/notifications/summary', { headers })
  assert.equal(summary.headers.get('cache-control'), 'no-store')
  assert.equal((await summary.json() as UnreadSummary).unreadCount, 26)
  const first = await request('/api/notifications', { headers })
  const page = await first.json() as UnreadPage
  assert.equal(page.pageSize, 25)
  assert.equal(page.total, 26)
  assert.equal(page.totalPages, 2)
  assert.deepEqual(page.items.map((item) => item.id), ids.slice(1).reverse())
  const second = await request('/api/notifications?page=2', { headers })
  assert.deepEqual((await second.json() as UnreadPage).items.map((item) => item.id), ids.slice(0, 1))
  const huge = await request('/api/notifications?page=9007199254740991', { headers })
  assert.deepEqual((await huge.json() as UnreadPage).items, [])
  for (const suffix of ['?page=1&page=2', '?page=0', '?recipientId=someone-else']) {
    assert.equal((await request('/api/notifications' + suffix, { headers })).status, 400)
  }
  assert.equal((await request('/api/notifications/summary?page=1', { headers })).status, 400)
  assert.equal((await request('/api/notifications/summary', { headers: { ...headers, 'Sec-Fetch-Site': 'cross-site' } })).status, 403)
  assert.equal((await request('/api/notifications')).status, 401)
})

test('read all includes every available page and replay leaves later arrivals unread (Feature 14 AC-4,8)', async () => {
  const { id, secret } = await accountFixture()
  const { cookie } = await login(id, secret)
  const createdAt = new Date(Date.now() - 1000)
  const message = { recipientId: id, kind: 'UNKNOWN_LEGACY', title: 'Test notice', body: 'Test content', createdAt }
  await db.notification.createMany({ data: Array.from({ length: 25 }, (_, i) => ({ ...message, deduplicationKey: `initial-${i}` })) })
  const future = await db.notification.create({ data: { ...message, deduplicationKey: 'future', createdAt: new Date(Date.now() + 600000) } })
  let signalProducerReady: (pid: number) => void = () => {}
  let releaseProducer: () => void = () => {}
  const producerReady = new Promise<number>((resolve) => { signalProducerReady = resolve })
  const released = new Promise<void>((resolve) => { releaseProducer = resolve })
  const producer = db.$transaction(async (tx) => {
    await recordPasswordChanged(tx, id, randomUUID(), createdAt)
    const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`
    signalProducerReady(pid)
    await released
  }, { timeout: 10000 })
  const producerPid = await Promise.race([producerReady, producer.then(() => assert.fail('Producer exited before releasing its lock'))])
  const key = randomUUID()
  const requestInFlight = notificationPost('read-all', cookie, key)
  let blocked = false
  try {
    const deadline = Date.now() + 3500
    while (!blocked && Date.now() < deadline) {
      const [wait] = await db.$queryRaw<{ blocked: boolean }[]>`
        SELECT EXISTS (SELECT FROM pg_stat_activity WHERE ${producerPid}::int = ANY(pg_blocking_pids(pid))) AS blocked
      `
      blocked = wait.blocked
      if (!blocked) await new Promise((resolve) => setTimeout(resolve, 35))
    }
  } finally {
    releaseProducer()
    await producer
  }
  const response = await requestInFlight
  assert.equal(blocked, true, 'Read all must wait for the producer’s recipient lock')
  assert.equal(response.status, 200)
  const first = await response.json() as BatchReadResult
  assert.equal(first.unreadCount, 0)
  assert.equal(first.result.changedCount, 26)
  assert.equal(first.result.replayed, false)
  const arrival = await db.notification.create({ data: { ...message, deduplicationKey: 'later', createdAt: new Date() } })
  const replay = await notificationPost('read-all', cookie, key)
  assert.deepEqual(await replay.json(), { result: { ...first.result, replayed: true }, unreadCount: 1 })
  const conflict = await notificationPost(`${arrival.id}/read`, cookie, key)
  assert.equal(conflict.status, 409)
  const rows = await db.notification.findMany({ where: { recipientId: id }, select: { id: true, readAt: true } })
  for (const row of rows) assert.equal(row.readAt?.toISOString() ?? null, [arrival.id, future.id].includes(row.id) ? null : first.result.appliedAt)
  const futureRead = await notificationPost(`${future.id}/read`, cookie)
  assert.equal(futureRead.status, 404)
})

test('owned selection rechecks the destination after a role change and preserves the first read (Feature 14 AC-4,5,8)', async () => {
  const { id, secret } = await accountFixture()
  const other = await accountFixture()
  const { cookie } = await login(id, secret)
  const employee = await db.employmentAssignment.findFirstOrThrow({ where: { userId: roles[0][0], effectiveTo: null } })
  await changeAssignment(id, employee)
  const day = new Date(`${new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)}T00:00:00.000Z`)
  const leave = await db.leaveRecord.create({ data: { userId: id, startsOn: day, expectedReturnOn: shiftDay(day, 1) } })
  const message = { kind: 'LEAVE_RECORDED', title: 'Leave recorded', body: 'Test leave message.', leaveId: leave.id, deduplicationKey: 'leave-fixture' }
  const own = await db.notification.create({ data: { ...message, recipientId: id } })
  const foreign = await db.notification.create({ data: { ...message, recipientId: other.id } })
  const notOwned = await notificationPost(`${foreign.id}/read`, cookie)
  const missing = await notificationPost('missing-notification/read', cookie)
  assert.equal(notOwned.status, 404)
  assert.equal(missing.status, 404)
  assert.deepEqual(await missing.json(), await notOwned.json())
  const key = randomUUID()
  const response = await notificationPost(`${own.id}/read`, cookie, key)
  assert.equal(response.status, 200)
  const first = await response.json() as SingleReadResult
  assert.deepEqual(first.target, { kind: 'EMPLOYEE_LEAVE' })
  assert.equal(first.result.changed, true)
  assert.equal(first.result.readAt, first.result.appliedAt)
  await changeAssignment(id, { role: 'HR_ADMIN', businessId: null, unitId: null, managerId: null, departmentLabel: null })
  const replay = await notificationPost(`${own.id}/read`, cookie, key)
  assert.equal(replay.status, 200)
  assert.deepEqual(await replay.json(), { result: { ...first.result, replayed: true }, unreadCount: 0, target: { kind: 'UNAVAILABLE', reason: 'TARGET_UNAVAILABLE' } })
  const second = await notificationPost(`${own.id}/read`, cookie)
  const again = await second.json() as SingleReadResult
  assert.equal(again.result.changed, false)
  assert.equal(again.result.readAt, first.result.readAt)
  assert.equal((await db.notification.findUniqueOrThrow({ where: { id: foreign.id } })).readAt, null)
  assert.equal((await db.sharedMutationReceipt.findUniqueOrThrow({ where: { userId_requestId: { userId: id, requestId: key } } })).targetNotificationId, own.id)
  await assert.rejects(db.sharedMutationReceipt.create({ data: { userId: id, requestId: randomUUID(), operation: 'NOTIFICATION_READ',
    requestHash: '0'.repeat(64), result: {}, targetNotificationId: foreign.id } }))
  await assert.rejects(db.notification.update({ where: { id: own.id }, data: { title: 'Rewritten' } }))
  await assert.rejects(db.notification.update({ where: { id: own.id }, data: { readAt: null } }))
  await assert.rejects(db.notification.delete({ where: { id: own.id } }))
})

test('notification writes reject forged selectors, unsafe methods and malformed input (Feature 14 AC-8)', async () => {
  const { id, secret } = await accountFixture()
  const { cookie } = await login(id, secret)
  assert.equal((await notificationPost('read-all', cookie, 'invalid-key')).status, 400)
  assert.equal((await notificationPost('read-all', cookie, randomUUID(), '')).status, 400)
  assert.equal((await notificationPost('read-all', cookie, randomUUID(), '{')).status, 400)
  assert.equal((await notificationPost('read-all', cookie, randomUUID(), '[]')).status, 400)
  assert.equal((await notificationPost('read-all', cookie, randomUUID(), '{"recipientId":"another-user"}')).status, 400)
  assert.equal((await notificationPost('read-all', cookie, randomUUID(), `{${' '.repeat(8300)}}`)).status, 413)
  assert.equal((await notificationPost('read-all?role=HR_ADMIN', cookie)).status, 400)
  assert.equal((await notificationPost('read-all', cookie, randomUUID(), '{}', { 'Content-Type': 'text/plain' })).status, 415)
  assert.equal((await notificationPost('read-all', cookie, randomUUID(), '{}', { 'If-Match': '1' })).status, 400)
  assert.equal((await notificationPost('read-all', cookie, randomUUID(), '{}', { Origin: 'https://other.example' })).status, 403)
  assert.equal((await notificationPost('read-all', cookie, randomUUID(), '{}', { 'Sec-Fetch-Site': 'cross-site' })).status, 403)
  assert.equal((await request('/api/notifications/read-all', { headers: { Cookie: cookie, Origin: config.origin } })).status, 400)
  assert.equal((await notificationPost('read-all', '')).status, 401)
  assert.equal(await db.sharedMutationReceipt.count({ where: { userId: id } }), 0)
})

test('notification factory reuses an identical event and aborts the domain transaction on mismatch (Feature 14 AC-6,7)', async () => {
  const { id } = await accountFixture()
  const at = new Date(), key = randomUUID()
  const event = await db.$transaction(async (tx) => {
    const first = await recordPasswordChanged(tx, id, key, at)
    assert.equal(await recordPasswordChanged(tx, id, key, at), first)
    return first
  })
  await assert.rejects(db.$transaction(async (tx) => {
    await tx.user.update({ where: { id }, data: { name: 'Changed in failing transaction' } })
    await recordPasswordChanged(tx, id, key, new Date(at.getTime() + 1000))
  }))
  const owner = await db.user.findUniqueOrThrow({ where: { id }, include: { notifications: true } })
  assert.equal(owner.name, 'Profile Test')
  assert.deepEqual(owner.notifications.map((item) => item.id), [event])
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
    await changeAssignment(assignment.userId, { ...assignment, role: 'LINE_MANAGER', managerId: null })
    const changed = await request('/api/session', { headers: { Cookie: first.cookie } })
    assert.equal((await changed.json() as SessionContext).role, 'LINE_MANAGER')
    const redirect = await request('/employee/home', { headers: { Cookie: first.cookie, Accept: 'text/html' } })
    assert.equal(redirect.headers.get('location'), '/line-manager/dashboard?notice=access-denied')
    await db.user.update({ where: { id: roles[0][0] }, data: { accountStatus: 'INACTIVE', deactivatedAt: new Date() } })
    assert.equal((await request('/api/session', { headers: { Cookie: first.cookie } })).status, 401)
    assert.equal((await request('/api/session', { headers: { Cookie: second.cookie } })).status, 401)
    assert.equal(await db.authSession.count({ where: { userId: roles[0][0] } }), 0)
  } finally {
    await changeAssignment(assignment.userId, assignment)
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
    await changeAssignment(assignment.userId, { ...assignment, managerId: 'person-nneka-obi' })
    assert.equal(await canReadTask(db, manager, current.id, 'current'), false)
    assert.equal(await canReadTask(db, manager, own.id, 'historical'), true)
  } finally { await changeAssignment(assignment.userId, assignment) }
  const original = await db.reliefAssignment.findUniqueOrThrow({ where: { id: 'relief-nneka' } })
  const startsOn = shiftDay(monday(new Date()), 7), endsOn = shiftDay(startsOn, 7)
  const relief = await db.$transaction(async (tx) => {
    const leave = await tx.leaveRecord.create({ data: { userId: original.coveredManagerId, startsOn, expectedReturnOn: endsOn } })
    return tx.reliefAssignment.create({ data: { leaveId: leave.id, coveredManagerId: original.coveredManagerId, reliefManagerId: manager.user.id, startsOn, endsOn } })
  })
  const pending = await db.approvalRequest.findFirstOrThrow({ where: { assignedManagerId: manager.user.id, state: 'PENDING' } })
  const during = new Date(relief.startsOn.getTime() + 3600000)
  try {
    await db.approvalRequest.update({ where: { id: pending.id }, data: { assignedManagerId: relief.coveredManagerId } })
    assert.equal(await canReviewRelief(db, manager, pending.id, during), true)
    assert.equal(await canReviewRelief(db, manager, pending.id, new Date(relief.endsOn.getTime())), false)
    assert.equal(await canReviewRelief(db, manager, pending.id, new Date(relief.startsOn.getTime() - 3600001)), false)
    assert.equal(await canReviewRelief(db, employee, pending.id, during), false)
    await db.reliefAssignment.update({ where: { id: relief.id }, data: { endedAt: during, endedById: relief.coveredManagerId } })
    assert.equal(await canReviewRelief(db, manager, pending.id, during), false)
    await db.reliefAssignment.create({ data: { leaveId: relief.leaveId, coveredManagerId: relief.coveredManagerId, reliefManagerId: relief.reliefManagerId, startsOn, endsOn } })
    assert.equal(await canReviewRelief(db, manager, pending.id, during), true)
    await db.leaveRecord.update({ where: { id: relief.leaveId }, data: { cancelledAt: during, cancelledById: manager.user.id } })
    assert.equal(await canReviewRelief(db, manager, pending.id, during), false)
  } finally {
    await db.approvalRequest.update({ where: { id: pending.id }, data: { assignedManagerId: pending.assignedManagerId } })
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
    role: 'EMPLOYEE', businessId: assignment.businessId, unitId: assignment.unitId, managerId: assignment.managerId, effectiveFrom: new Date(),
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
