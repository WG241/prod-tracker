export interface AuthConfig {
  secret: string
  origin: string
  secure: boolean
}

export function isLoopback(host: string) {
  return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(host.toLowerCase())
}

export function checkedDatabaseTarget(value: string) {
  const url = new URL(value)
  if (!['postgresql:', 'postgres:'].includes(url.protocol)
    || [...url.searchParams.keys()].some((key) => /^(host|hostaddr|service)$/i.test(key))) {
    throw new Error('DATABASE_URL must use an explicit PostgreSQL target')
  }
  return url
}

export function readAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const secret = env.BETTER_AUTH_SECRET ?? ''
  if (secret.length < 32 || /placeholder|change.?me|your.?secret|development.?secret/i.test(secret)
    || new Set(secret).size < 12) throw new Error('BETTER_AUTH_SECRET must contain a generated secret of at least 32 characters')
  let url: URL
  try { url = new URL(env.BETTER_AUTH_URL ?? '') }
  catch { throw new Error('BETTER_AUTH_URL must be a fixed HTTPS origin or loopback HTTP origin') }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash
    || !(url.protocol === 'https:' || (url.protocol === 'http:' && isLoopback(url.hostname)))) {
    throw new Error('BETTER_AUTH_URL must be a fixed HTTPS origin or loopback HTTP origin')
  }
  return { secret, origin: url.origin, secure: url.protocol === 'https:' }
}

export function authTestDatabase(testValue: string | undefined, ordinaryValue: string | undefined) {
  if (!testValue || !ordinaryValue) throw new Error('TEST_DATABASE_URL and DATABASE_URL must be explicitly configured')
  const test = checkedDatabaseTarget(testValue)
  const ordinary = checkedDatabaseTarget(ordinaryValue)
  // Reserving a distinct database name also prevents host/port aliases from
  // making the ordinary database appear to be a separate test target.
  if (!isLoopback(test.hostname) || test.pathname !== '/prod_tracker_auth_test'
    || decodeURIComponent(ordinary.pathname) === '/prod_tracker_auth_test') {
    throw new Error('Tests require a separate local prod_tracker_auth_test database and a different ordinary database name')
  }
  return testValue
}
