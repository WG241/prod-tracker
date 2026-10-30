export function readTrustProxy(value: string | undefined = process.env.TRUST_PROXY) {
  const raw = value?.trim()
  if (!raw || raw === '0' || /^false$/i.test(raw)) return false as const
  if (/^true$/i.test(raw)) return 1
  if (/^-?\d+$/.test(raw)) {
    const hops = Number(raw)
    if (!Number.isInteger(hops) || hops < 1) throw new Error('TRUST_PROXY must be a positive hop count, false, or an Express trust proxy value')
    return hops
  }
  // Express also accepts named ranges such as "loopback" after an explicit deploy decision.
  return raw
}

export function readConfig() {
  const connectionString = process.env.DATABASE_URL
  try {
    const url = new URL(connectionString ?? '')
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || url.pathname.length < 2) {
      throw new Error('invalid database URL')
    }
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL connection URL')
  }

  const development = process.argv.includes('--dev')
  const portText = process.env.PORT ?? (development ? '5173' : '3000')
  const port = Number(portText)
  if (!/^\d+$/.test(portText) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer from 1 to 65535')
  }

  return {
    connectionString: connectionString!,
    development,
    port,
    host: process.env.HOST ?? (development ? '127.0.0.1' : '0.0.0.0'),
    trustProxy: readTrustProxy(),
  }
}
