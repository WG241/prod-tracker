import 'dotenv/config'
import { readConfig } from '../server/config.ts'
import { requireOperatorDatabase } from '../server/auth/operator-target.ts'
import { createDatabase } from '../server/db.ts'
import { historyCursor, historyPass, historyScope } from '../server/employee/history-worker.ts'

async function main() {
  const { scope, apply } = historyScope(process.argv.slice(2))
  const target = readConfig().connectionString
  requireOperatorDatabase(target)
  const db = createDatabase(target)
  try {
    const report = await historyPass(db, historyCursor(), apply, scope)
    console.info(JSON.stringify({ mode: apply ? 'apply' : 'diagnostics', ...report }))
    const invalid = report.results.some((row) => ['NOT_FOUND', 'NOT_FROZEN', 'OUTSIDE_COVERAGE', 'SETTINGS_UNAVAILABLE'].includes(row.code))
    process.exitCode = report.infrastructureFailure || invalid ? 1 : report.remaining ? 2 : 0
  } finally { await db.$disconnect() }
}
main().catch(() => { console.error('History capture could not complete; check configuration and selectors'); process.exitCode = 1 })
