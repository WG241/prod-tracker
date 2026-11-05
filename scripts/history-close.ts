import 'dotenv/config'
import { readConfig } from '../server/config.ts'
import { requireOperatorDatabase } from '../server/auth/operator-target.ts'
import { createDatabase } from '../server/db.ts'
import { day } from '../server/data-model/calendar.ts'
import { historyScope } from '../server/employee/history-worker.ts'
import { closeHistoryWeek } from '../server/employee/history-snapshot.ts'
import { initializeHistory } from '../server/employee/history-capture.ts'

async function main() {
  const args = process.argv.slice(2)
  const week = args[0]
  if (!week || args.length !== 1) throw new Error('Usage: npm run history:close -- YYYY-MM-DD')
  const parsed = historyScope(['--week', week, '--apply'])
  const target = readConfig().connectionString
  requireOperatorDatabase(target)
  const db = createDatabase(target)
  try {
    const initialized = await initializeHistory(db)
    const record = db ? await db.workWeek.findUnique({ where: { startsOn: day(parsed.scope.week!) }, select: { id: true } }) : null
    const result = !['CAPTURED', 'ALREADY_CAPTURED'].includes(initialized.code)
      ? { code: initialized.code, changed: false, week }
      : record ? await closeHistoryWeek(db, record.id) : { code: 'NOT_FOUND', changed: false, week }
    console.info(JSON.stringify(result))
    process.exitCode = ['CAPTURED', 'ALREADY_CAPTURED'].includes(result.code) ? 0 : 2
  } finally {
    await db.$disconnect()
  }
}

main().catch(() => {
  console.error('History close could not complete; check the Monday week selector and database configuration')
  process.exitCode = 1
})
