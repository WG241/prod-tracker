import 'dotenv/config'
import { readConfig } from '../server/config.ts'
import { createDatabase } from '../server/db.ts'
import { requireOperatorDatabase } from '../server/auth/operator-target.ts'
import { createSeedPlan } from './fixtures/plan.ts'
import { validateSeedPlan } from './fixtures/validate.ts'

const connectionString = readConfig().connectionString
requireOperatorDatabase(connectionString)
const prisma = createDatabase(connectionString)

function stableRows<T extends { id?: string }>(rows: T[]) {
  return rows.map((row) => {
    if (!row.id) throw new Error('Protected fixtures require stable ids')
    return { ...row, id: row.id }
  })
}
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
    await tx.$executeRaw`
      INSERT INTO "NotificationPreference" ("userId", "emailRemindersEnabled", "updatedAt")
      SELECT id, "emailRemindersEnabled", clock_timestamp() FROM "User"
      ON CONFLICT ("userId") DO NOTHING
    `
    await tx.business.createMany({ data: plan.businesses, skipDuplicates: true })
    await tx.unit.createMany({ data: plan.units, skipDuplicates: true })
    const assignmentIds = new Set((await tx.employmentAssignment.findMany({ where: { id: { in: plan.assignments.map((row) => row.id) } }, select: { id: true } })).map((row) => row.id))
    await tx.employmentAssignment.createMany({ data: plan.assignments.filter((row) => !assignmentIds.has(row.id)), skipDuplicates: true })
    const stableLeaves = stableRows(plan.leaves)
    const leaveIds = new Set((await tx.leaveRecord.findMany({ where: { id: { in: stableLeaves.map((row) => row.id) } }, select: { id: true } })).map((row) => row.id))
    await tx.leaveRecord.createMany({ data: stableLeaves.filter((row) => !leaveIds.has(row.id)), skipDuplicates: true })
    await tx.workWeek.createMany({ data: plan.weeks, skipDuplicates: true })
    await tx.weeklyTracker.createMany({ data: plan.trackers, skipDuplicates: true })
    await tx.taskSeries.createMany({ data: plan.series, skipDuplicates: true })
    // Parents precede continuations, avoiding an immediate self FK dependency.
    // The synchronous close installs BEFORE INSERT guards on these records.
    // Exclude existing rows before INSERT so the guards never see replayed fixtures.
    const tasks = stableRows(plan.tasks)
    const taskIds = new Set((await tx.weeklyTask.findMany({ where: { id: { in: tasks.map(({ id }) => id) } }, select: { id: true } })).map(({ id }) => id))
    const missingTasks = tasks.filter(({ id }) => !taskIds.has(id))
    await tx.weeklyTask.createMany({ data: missingTasks.filter((row) => !row.carriedFromId), skipDuplicates: true })
    await tx.weeklyTask.createMany({ data: missingTasks.filter((row) => row.carriedFromId), skipDuplicates: true })
    const comments = stableRows(plan.comments)
    const commentIds = new Set((await tx.taskComment.findMany({ where: { id: { in: comments.map(({ id }) => id) } }, select: { id: true } })).map(({ id }) => id))
    await tx.taskComment.createMany({ data: comments.filter(({ id }) => !commentIds.has(id)), skipDuplicates: true })
    await tx.reliefAssignment.createMany({ data: plan.relief, skipDuplicates: true })
    const requests = stableRows(plan.requests)
    const requestIds = new Set((await tx.approvalRequest.findMany({ where: { id: { in: requests.map(({ id }) => id) } }, select: { id: true } })).map(({ id }) => id))
    await tx.approvalRequest.createMany({ data: requests.filter(({ id }) => !requestIds.has(id)), skipDuplicates: true })
    const decisions = stableRows(plan.decisions)
    const decisionIds = new Set((await tx.approvalDecision.findMany({ where: { id: { in: decisions.map(({ id }) => id) } }, select: { id: true } })).map(({ id }) => id))
    await tx.approvalDecision.createMany({ data: decisions.filter(({ id }) => !decisionIds.has(id)), skipDuplicates: true })
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
