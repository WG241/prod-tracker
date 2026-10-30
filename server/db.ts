import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'
import { PrismaClient } from '../src/generated/prisma/client.ts'

export function createDatabase(connectionString: string) {
  const pool = new pg.Pool({
    connectionString,
    max: 5,
    connectionTimeoutMillis: 3000,
    query_timeout: 5000,
    statement_timeout: 5000,
    idleTimeoutMillis: 10000,
  })
  const adapter = new PrismaPg(pool, {
    disposeExternalPool: true,
    onPoolError: () => console.error('database_pool_unavailable'),
  })
  return new PrismaClient({ adapter, errorFormat: 'minimal' })
}
