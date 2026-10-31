export interface AuthConfig {
  secret: string
  origin: string
  secure: boolean
}

export function isLoopback(host: string) {
  return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(host.toLowerCase())
}

/** 127/8 and common loopback names share one identity for test-vs-ordinary DB checks. */
export function isLoopbackDatabaseHost(host: string) {
  const value = host.toLowerCase()
  if (isLoopback(value)) return true
  return /^127(?:\.\d+){0,3}$/.test(value)
}

export function checkedDatabaseTarget(value: string) {
  const url = new URL(value)
  if (!['postgresql:', 'postgres:'].includes(url.protocol)
    || [...url.searchParams.keys()].some((key) => /^(host|hostaddr|service)$/i.test(key))) {
    throw new Error('DATABASE_URL must use an explicit PostgreSQL target')
  }
  return url
}

function databaseName(url: URL) {
  return decodeURIComponent(url.pathname.replace(/^\//, ''))
}

/** Host + port + database name, with loopback aliases collapsed. */
export function databaseTargetIdentity(url: URL) {
  const name = databaseName(url)
  const host = url.hostname.toLowerCase()
  const port = url.port || '5432'
  const hostKey = isLoopbackDatabaseHost(host) ? 'loopback' : host
  return `${hostKey}:${port}:${name}`
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
  if (!databaseName(test)) {
    throw new Error('TEST_DATABASE_URL must include an explicit database name')
  }
  // Compare host (loopback aliases collapsed), port, and database name so Neon
  // branches or a different database name are allowed, while the ordinary
  // development database stays protected from host/port alias confusion.
  if (databaseTargetIdentity(test) === databaseTargetIdentity(ordinary)) {
    throw new Error('Tests require a separate TEST_DATABASE_URL that differs from the ordinary DATABASE_URL by host or database name')
  }
  return testValue
}
