export function accessibilityConfig(env: NodeJS.ProcessEnv = process.env) {
  const base = new URL(env.A11Y_BASE_URL ?? 'http://127.0.0.1:5173')
  if (!['http:', 'https:'].includes(base.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)
    || base.username || base.password || base.pathname !== '/' || base.search || base.hash) {
    throw new Error('A11Y_BASE_URL must be a loopback HTTP or HTTPS origin without credentials, path, query or fragment')
  }
  const target = env.A11Y_TARGET ?? 'development'
  if (!['development', 'production'].includes(target)) throw new Error('A11Y_TARGET must be development or production')
  return { base: base.origin, target: target as 'development' | 'production' }
}
