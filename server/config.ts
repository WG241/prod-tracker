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
  }
}
