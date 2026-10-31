// Trusted operator CLI helpers only. Never import from an HTTP handler.
import { checkedDatabaseTarget, isLoopback } from './config.ts'

/** Five fictional fixture people used by auth:seed (existing person-* ids). */
export const AUTH_FIXTURE_PERSON_IDS = [
  'person-ada-okafor',
  'person-tunde-bakare',
  'person-amara-bello',
  'person-david-cole',
  'person-kemi-adebayo',
] as const

/**
 * Classify DATABASE_URL after rejecting host/hostaddr/service query overrides.
 * Neon and other non-loopback targets are allowed for operator CLIs.
 */
export function requireOperatorDatabase(connectionString: string) {
  return checkedDatabaseTarget(connectionString)
}

/**
 * Fixture credential seeding (auth:seed): nonproduction, loopback app origin,
 * and a validated database target (Neon included).
 */
export function requireAuthFixtureTarget(input: {
  connectionString: string
  origin: string
  nodeEnv?: string | undefined
}) {
  if (input.nodeEnv === 'production') {
    throw new Error('Auth fixtures require a nonproduction environment')
  }
  let originHost: string
  try { originHost = new URL(input.origin).hostname }
  catch { throw new Error('Auth fixtures require a loopback BETTER_AUTH_URL origin') }
  if (!isLoopback(originHost)) {
    throw new Error('Auth fixtures require a loopback BETTER_AUTH_URL origin')
  }
  return requireOperatorDatabase(input.connectionString)
}
