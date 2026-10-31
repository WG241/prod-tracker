import 'dotenv/config'
import { createDatabase } from '../server/db.ts'
import { readConfig } from '../server/config.ts'
import { requireOperatorDatabase } from '../server/auth/operator-target.ts'

const connection = readConfig().connectionString
requireOperatorDatabase(connection)
const db = createDatabase(connection)
try {
  const { sessions, counters } = await db.$transaction(async (tx) => {
    const sessions = await tx.$executeRaw`DELETE FROM "AuthSession" WHERE "expiresAt"<=clock_timestamp()`
    const counters = await tx.$executeRaw`DELETE FROM "LoginThrottle" WHERE "expiresAt"<=clock_timestamp()`
    return { sessions, counters }
  })
  console.info(`Pruned ${sessions} expired sessions and ${counters} expired counters`)
} finally { await db.$disconnect() }
