import 'dotenv/config'
import { createDatabase } from '../server/db.ts'
import { readConfig } from '../server/config.ts'
import { requireOperatorDatabase } from '../server/auth/operator-target.ts'

const connection = readConfig().connectionString
requireOperatorDatabase(connection)
const db = createDatabase(connection)
try {
  const sessions = await db.$executeRaw`DELETE FROM "AuthSession" WHERE "expiresAt"<=clock_timestamp()`
  const counters = await db.$executeRaw`DELETE FROM "LoginThrottle" WHERE "expiresAt"<=clock_timestamp()`
  console.info(`Pruned ${sessions} expired sessions and ${counters} expired counters`)
} finally { await db.$disconnect() }
