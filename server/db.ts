import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'
import { PrismaClient } from '../src/generated/prisma/client.ts'
import type { Prisma } from '../src/generated/prisma/client.ts'

export async function databaseClock(tx: Prisma.TransactionClient) {
  const [{ milliseconds }] = await tx.$queryRaw<{ milliseconds: bigint }[]>`
    SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS milliseconds
  `
  return new Date(Number(milliseconds))
}

export function databaseErrorCode(error: unknown, depth = 0): string | null {
  if (!error || typeof error !== 'object' || depth > 4) return null
  const record = error as Record<string, unknown>
  for (const key of ['meta', 'driverAdapterError', 'cause'] as const) {
    if (key in record) {
      const code = databaseErrorCode(record[key], depth + 1)
      if (code) return code
    }
  }
  return 'code' in error && typeof error.code === 'string' ? error.code : null
}

export function createDatabase(connectionString: string) {
  // PrismaPg normalizes timestamptz values assuming a UTC database session.
  // URL options override Pool options, so append this setting to the URL itself.
  const target = new URL(connectionString)
  target.searchParams.set('options', `${target.searchParams.get('options') ?? ''} -c timezone=UTC`.trim())
  const pool = new pg.Pool({
    connectionString: target.href,
    max: 5,
    connectionTimeoutMillis: 3000,
    query_timeout: 5000,
    statement_timeout: 5000,
    idleTimeoutMillis: 10000,
  })
  const adapter = new PrismaPg(pool, {
    disposeExternalPool: true,
    onPoolError: (error) => console.error('Database pool error', error),
  })
  return new PrismaClient({ adapter, errorFormat: 'minimal' })
}
