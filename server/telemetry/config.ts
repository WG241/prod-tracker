import type { Environment } from './records.ts'
import { environments } from './records.ts'

export function telemetryConfig(env: NodeJS.ProcessEnv = process.env, development = process.argv.includes('--dev')) {
  const mode = env.TELEMETRY_MODE ?? 'local'
  const environment = env.TELEMETRY_ENV ?? (development ? 'development' : 'production')
  const valid = ['local', 'off'].includes(mode) && environments.includes(environment as Environment)
  return { enabled: valid && mode === 'local', valid, environment: valid ? environment as Environment : null }
}

export function browserOrigin(host: string, port: number, env: NodeJS.ProcessEnv = process.env) {
  function origin(value: string) {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Invalid origin')
    return url.origin
  }
  try {
    const explicit = env.TELEMETRY_ORIGIN ? origin(env.TELEMETRY_ORIGIN) : null
    const auth = env.BETTER_AUTH_URL ? origin(env.BETTER_AUTH_URL) : null
    if (explicit && auth && explicit !== auth) return null
    return explicit ?? auth ?? (['127.0.0.1', 'localhost', '::1'].includes(host) ? origin(`http://${host === '::1' ? '[::1]' : host}:${port}`) : null)
  } catch { return null }
}
