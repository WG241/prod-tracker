import 'dotenv/config'
import { readConfig } from '../server/config.ts'
import { createDatabase } from '../server/db.ts'
import { requireOperatorDatabase } from '../server/auth/operator-target.ts'
import { createSeedPlan } from './fixtures/plan.ts'
import { validateSeedPlan } from './fixtures/validate.ts'

const connectionString = readConfig().connectionString
requireOperatorDatabase(connectionString)
const prisma = createDatabase(connectionString)
try {
  const plan = createSeedPlan()
  validateSeedPlan(plan)
  await prisma.$transaction(async (tx) => {
    // Serialize source fixture construction and prefilter existing ids. A BEFORE
    // history guard runs even for INSERT ON CONFLICT DO NOTHING.
    await tx.$executeRaw`LOCK TABLE "EmploymentAssignment", "LeaveRecord" IN SHARE ROW EXCLUSIVE MODE`
    // Skip existing identities and immutable evidence. A repeated seed is not a reset.
    await tx.user.createMany({ data: [{ id: 'foundation-health', email: 'foundation-health@example.invalid',
      name: 'Local foundation check' }], skipDuplicates: true })
    await tx.user.createMany({ data: plan.users, skipDuplicates: true })
    await tx.business.createMany({ data: plan.businesses, skipDuplicates: true })
    await tx.unit.createMany({ data: plan.units, skipDuplicates: true })
    const assignmentIds = new Set((await tx.employmentAssignment.findMany({ where: { id: { in: plan.assignments.map((row) => row.id) } }, select: { id: true } })).map((row) => row.id))
    await tx.employmentAssignment.createMany({ data: plan.assignments.filter((row) => !assignmentIds.has(row.id)), skipDuplicates: true })
    const stableLeaves = plan.leaves.map((row) => { if (!row.id) throw new Error('Leave fixtures require stable ids'); return { ...row, id: row.id } })
    const leaveIds = new Set((await tx.leaveRecord.findMany({ where: { id: { in: stableLeaves.map((row) => row.id) } }, select: { id: true } })).map((row) => row.id))
    await tx.leaveRecord.createMany({ data: stableLeaves.filter((row) => !leaveIds.has(row.id)), skipDuplicates: true })
    await tx.workWeek.createMany({ data: plan.weeks, skipDuplicates: true })
    await tx.weeklyTracker.createMany({ data: plan.trackers, skipDuplicates: true })
    await tx.taskSeries.createMany({ data: plan.series, skipDuplicates: true })
    // Parents precede continuations, avoiding an immediate self FK dependency.
    await tx.weeklyTask.createMany({ data: plan.tasks.filter((row) => !row.carriedFromId), skipDuplicates: true })
    await tx.weeklyTask.createMany({ data: plan.tasks.filter((row) => row.carriedFromId), skipDuplicates: true })
    await tx.taskComment.createMany({ data: plan.comments, skipDuplicates: true })
    await tx.reliefAssignment.createMany({ data: plan.relief, skipDuplicates: true })
    await tx.approvalRequest.createMany({ data: plan.requests, skipDuplicates: true })
    await tx.approvalDecision.createMany({ data: plan.decisions, skipDuplicates: true })
    await tx.trackerSettings.upsert({ where: { id: plan.settings.id }, create: plan.settings, update: {} })
    await tx.planningUnlock.createMany({ data: plan.unlocks, skipDuplicates: true })
    await tx.auditEvent.createMany({ data: plan.audit, skipDuplicates: true })
    await tx.notification.createMany({ data: plan.notifications, skipDuplicates: true })
    await tx.emailDelivery.createMany({ data: plan.deliveries, skipDuplicates: true })
  }, { timeout: 30000, maxWait: 5000 })
  console.info(`Workforce fixtures ready: ${plan.users.length} staff identities, ${plan.tasks.length} weekly tasks; email delivery suppressed`)
} catch {
  console.error('Workforce fixture seed failed; no partial fixture transaction was committed')
  process.exitCode = 1
} finally {
  await prisma.$disconnect()
}
