/**
 * After safe idempotency hardening of already-applied migration.sql files,
 * update `_prisma_migrations.checksum` to match the current file SHA-256
 * (AGENTS.md additive schema / checksum-repair rule).
 *
 * Uses the ordinary app DATABASE_URL. Does not change schema objects.
 */
import 'dotenv/config'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createDatabase } from '../server/db.ts'
import { readConfig } from '../server/config.ts'
import { requireOperatorDatabase } from '../server/auth/operator-target.ts'

const connection = readConfig().connectionString
requireOperatorDatabase(connection)

const migrationsDir = join(process.cwd(), 'prisma/migrations')
const dirs = readdirSync(migrationsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && /^\d{14}_/.test(entry.name))
  .map((entry) => entry.name)
  .sort()

const checksums = dirs.map((name) => ({
  name,
  checksum: createHash('sha256').update(readFileSync(join(migrationsDir, name, 'migration.sql'))).digest('hex'),
}))

const db = createDatabase(connection)
try {
  const updated = await db.$transaction(async (tx) => {
    let count = 0
    for (const { name, checksum } of checksums) {
      count += await tx.$executeRaw`
        UPDATE "_prisma_migrations"
        SET checksum = ${checksum}
        WHERE migration_name = ${name} AND checksum IS DISTINCT FROM ${checksum}`
    }
    return count
  })
  console.info(`Updated ${updated} migration checksum(s) for ${checksums.length} local migration file(s)`)
} finally {
  await db.$disconnect()
}
