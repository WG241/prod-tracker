import assert from 'node:assert/strict'
import { test } from 'node:test'
import { randomBytes } from 'node:crypto'
import type { Response } from 'express'
import { authTestDatabase, checkedDatabaseTarget, readAuthConfig } from '../../server/auth/config.ts'
import { forwardCookies } from '../../server/auth/router.ts'
import { day, watCalendarDay } from '../../server/data-model/calendar.ts'
import { roleRoutes, routeContext, validPassword } from '../../src/features/auth/contracts.ts'
import { readTrustProxy } from '../../server/config.ts'
import {
  AUTH_FIXTURE_PERSON_IDS,
  requireAuthFixtureTarget,
  requireOperatorDatabase,
} from '../../server/auth/operator-target.ts'
import { EMAIL_FAILURE_LIMIT, throttleKey } from '../../server/auth/throttle.ts'

// AC-5, AC-8: boundary values, fixed routes and secure configuration.
test('password policy counts Unicode characters and preserves spaces', () => {
  for (const value of ['x'.repeat(15), 'x'.repeat(128), '😀'.repeat(15), '😀'.repeat(128), ' '.repeat(15)]) assert.equal(validPassword(value), true)
  for (const value of ['x'.repeat(14), 'x'.repeat(129), '😀'.repeat(129), 'a'.repeat(15) + '\0', 'a'.repeat(15) + '\uD800', null, []]) assert.equal(validPassword(value), false)
})
test('auth configuration permits only fixed origins and rejects placeholders', () => {
  const secret = randomBytes(48).toString('base64url')
  for (const origin of ['http://127.0.0.1:5173', 'http://localhost:3000', 'https://workforce.example']) assert.equal(readAuthConfig({ BETTER_AUTH_SECRET: secret, BETTER_AUTH_URL: origin }).origin, origin)
  for (const origin of ['http://workforce.example', 'https://user:password@workforce.example', 'https://workforce.example/path', 'https://workforce.example?query=x', 'https://workforce.example#hash', '']) assert.throws(() => readAuthConfig({ BETTER_AUTH_SECRET: secret, BETTER_AUTH_URL: origin }), /BETTER_AUTH_URL/)
  for (const value of ['', 'a'.repeat(40), 'your-secret-placeholder-that-is-long-enough']) assert.throws(() => readAuthConfig({ BETTER_AUTH_SECRET: value, BETTER_AUTH_URL: 'http://127.0.0.1' }), /BETTER_AUTH_SECRET/)
})
test('database target checks reject query host overrides regardless of case', () => {
  for (const key of ['host', 'HOST', 'hostaddr', 'service']) assert.throws(() => checkedDatabaseTarget(`postgresql://user@localhost/test?${key}=remote`))
  assert.equal(checkedDatabaseTarget('postgresql://user@localhost/test?sslmode=require').hostname, 'localhost')
})
test('test database validation cannot mistake host or port aliases for separate databases', () => {
  const testUrl = 'postgresql://user@127.0.0.1:5432/prod_tracker_auth_test'
  assert.equal(authTestDatabase(testUrl, 'postgresql://user@localhost/prod_tracker'), testUrl)
  for (const ordinary of ['postgresql://user@localhost/prod_tracker_auth_test', 'postgresql://user@[::1]:5432/prod_tracker_auth_test', 'postgresql://user@127.1:5432/prod%5Ftracker_auth_test']) assert.throws(() => authTestDatabase(testUrl, ordinary), /separate local/)
  assert.throws(() => authTestDatabase('postgresql://user@remote/prod_tracker_auth_test', 'postgresql://user@localhost/prod_tracker'))
})
test('every role has only the approved landing and navigation paths', () => {
  const counts = [3, 5, 4, 3, 7]
  Object.keys(roleRoutes).forEach((role, index) => {
    const routes = routeContext(role as keyof typeof roleRoutes)
    assert.equal(routes.navigation.length, counts[index])
    assert.equal(routes.landingPath, routes.navigation[0].path)
    assert.equal(routes.navigation.some((item) => item.path.includes('profile')), false)
  })
})
test('throttle keys are opaque and separated by namespace and secret', () => {
  const key = throttleKey('first-secret', 'email', 'person@example.com')
  assert.match(key, /^email:[a-f0-9]{64}$/)
  assert.equal(key.includes('person'), false)
  assert.notEqual(key, throttleKey('second-secret', 'email', 'person@example.com'))
  assert.notEqual(key, throttleKey('first-secret', 'ip', 'person@example.com'))
})
test('forwardCookies appends each Set-Cookie value individually (AC-3)', () => {
  const appended: Array<[string, string]> = []
  const response = {
    append(name: string, value: string) {
      appended.push([name, value])
      return this
    },
  } as unknown as Response
  const headers = new Headers()
  headers.append('Set-Cookie', 'workforce.session_token=one; Path=/; HttpOnly')
  headers.append('Set-Cookie', 'workforce.session_data=two; Path=/; HttpOnly')
  forwardCookies(response, headers)
  assert.deepEqual(appended, [
    ['Set-Cookie', 'workforce.session_token=one; Path=/; HttpOnly'],
    ['Set-Cookie', 'workforce.session_data=two; Path=/; HttpOnly'],
  ])
})
test('watCalendarDay uses Africa/Lagos date boundaries for date-only fields', () => {
  assert.equal(watCalendarDay(new Date('2026-10-26T22:30:00.000Z')).getTime(), day('2026-10-26').getTime())
  assert.equal(watCalendarDay(new Date('2026-10-26T23:30:00.000Z')).getTime(), day('2026-10-27').getTime())
})
test('TRUST_PROXY stays off by default and accepts explicit hop or named values', () => {
  assert.equal(readTrustProxy(undefined), false)
  assert.equal(readTrustProxy(''), false)
  assert.equal(readTrustProxy('false'), false)
  assert.equal(readTrustProxy('0'), false)
  assert.equal(readTrustProxy('true'), 1)
  assert.equal(readTrustProxy('1'), 1)
  assert.equal(readTrustProxy('loopback'), 'loopback')
  assert.throws(() => readTrustProxy('-1'), /TRUST_PROXY/)
})
test('email failure limit is a small fixed ceiling', () => {
  assert.equal(EMAIL_FAILURE_LIMIT, 5)
})
test('operator database target allows Neon and loopback after host override checks', () => {
  assert.equal(requireOperatorDatabase('postgresql://user@127.0.0.1/prod_tracker').hostname, '127.0.0.1')
  assert.equal(requireOperatorDatabase('postgresql://user@ep.neon.tech/neondb').hostname, 'ep.neon.tech')
})
test('auth fixtures allow Neon but keep loopback origin and nonproduction', () => {
  assert.equal(AUTH_FIXTURE_PERSON_IDS.length, 5)
  const neon = 'postgresql://user@ep.neon.tech/neondb?sslmode=require'
  assert.equal(requireAuthFixtureTarget({
    connectionString: neon, origin: 'http://127.0.0.1:5173',
  }).hostname, 'ep.neon.tech')
  assert.throws(() => requireAuthFixtureTarget({
    connectionString: neon, origin: 'https://app.example',
  }), /loopback BETTER_AUTH_URL/)
  assert.throws(() => requireAuthFixtureTarget({
    connectionString: neon, origin: 'http://127.0.0.1:5173', nodeEnv: 'production',
  }), /nonproduction/)
})
