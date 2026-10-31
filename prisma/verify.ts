import 'dotenv/config'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import pg from 'pg'
import { createDatabase } from '../server/db.ts'
import { readConfig } from '../server/config.ts'
import { expectedWorkingDays } from '../server/data-model/calendar.ts'

const connectionString = readConfig().connectionString
assert.ok(['127.0.0.1','localhost','[::1]'].includes(new URL(connectionString).hostname), 'Verification requires local PostgreSQL')
const prisma = createDatabase(connectionString)
const client = new pg.Client({ connectionString, connectionTimeoutMillis: 3000, query_timeout: 5000 })
const run = promisify(execFile)

async function fingerprint() {
  const rows = await Promise.all([
    prisma.user.findMany({ orderBy: { id: 'asc' } }),
    prisma.employmentAssignment.findMany({ orderBy: { id: 'asc' } }),
    prisma.weeklyTracker.findMany({ orderBy: { id: 'asc' } }),
    prisma.weeklyTask.findMany({ orderBy: { id: 'asc' } }),
    prisma.approvalRequest.findMany({ orderBy: { id: 'asc' } }),
    prisma.approvalDecision.findMany({ orderBy: { id: 'asc' } }),
    prisma.auditEvent.findMany({ orderBy: { id: 'asc' } }),
    prisma.notification.findMany({ orderBy: { id: 'asc' } }),
    prisma.emailDelivery.findMany({ orderBy: { id: 'asc' } }),
  ])
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex')
}

type Metrics = { expected: number; submitted: number; tasks: number; approved: number; eligible: number }
async function metrics(scope: string, target: string, week = 'week-2026-10-19'): Promise<Metrics> {
  const result = await client.query<Metrics>(`
    WITH roster AS (
      SELECT wt.id FROM "WeeklyTracker" wt WHERE wt."weekId" = $1
        AND wt."contextSnapshot"->>'role' = 'EMPLOYEE' AND wt."expectedWorkingDaysSnapshot" > 0
        AND (${scope})
    ), work AS (
      SELECT t.* FROM "WeeklyTask" t JOIN roster r ON r.id = t."trackerId" WHERE t."deletedAt" IS NULL
    ) SELECT
      (SELECT count(*)::int FROM roster) AS expected,
      (SELECT count(*)::int FROM roster r WHERE EXISTS (SELECT 1 FROM work t WHERE t."trackerId" = r.id)) AS submitted,
      (SELECT count(*)::int FROM work) AS tasks,
      (SELECT count(*)::int FROM work WHERE status = 'APPROVED') AS approved,
      (SELECT count(*)::int FROM work WHERE status NOT IN ('AWAITING_APPROVAL','CANCELLED')) AS eligible
  `, [week, target])
  return result.rows[0]
}

let probeCount = 0
async function rejects(label: string, sql: string, values: unknown[], code: string, constraint?: string, setup?: () => Promise<unknown>) {
  const savepoint = `probe_${probeCount++}`
  await client.query(`SAVEPOINT ${savepoint}`)
  let observed: unknown
  try {
    await setup?.()
    await client.query(sql, values)
  } catch (error) { observed = error }
  finally {
    await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`)
    await client.query(`RELEASE SAVEPOINT ${savepoint}`)
  }
  assert.ok(observed instanceof Error && 'code' in observed, `${label} did not produce a PostgreSQL constraint failure`)
  assert.equal(observed.code, code, `${label}: wrong SQL state`)
  if (constraint) assert.equal((observed as pg.DatabaseError).constraint, constraint, `${label}: wrong constraint`)
  console.info(`PASS ${label} (${code})`)
}

try {
  await client.connect()
  const tables = await client.query<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'")
  assert.deepEqual(tables.rows.map((row) => row.tablename).sort(), [
    'User','Business','Unit','EmploymentAssignment','WorkWeek','WeeklyTracker','TaskSeries','WeeklyTask','TaskComment',
    'ApprovalRequest','ApprovalDecision','LeaveRecord','ReliefAssignment','TrackerSettings','PlanningUnlock','AuditEvent','Notification','EmailDelivery',
    'AuthUser','AuthAccount','AuthSession','AuthVerification','LoginThrottle',
  ].sort())
  const triggers = await client.query<{ tgname: string }>('SELECT tgname FROM pg_trigger WHERE NOT tgisinternal')
  for (const name of ['audit_append_only','decision_append_only','submission_evidence_guard','frozen_roster_guard']) {
    assert.ok(triggers.rows.some((row) => row.tgname === name), `Missing live history guard: ${name}`)
  }
  console.info('PASS live PostgreSQL schema: 23 model tables and four history guards')
  const staff = await prisma.user.count({ where: { assignments: { some: {} } } })
  assert.equal(staff, 28)
  assert.equal(await prisma.weeklyTask.count(), 35)
  assert.equal(await prisma.weeklyTracker.count(), 110)
  const retained = await prisma.user.findUnique({ where: { email: 'foundation-health@example.invalid' } })
  assert.ok(retained && retained.accountStatus === 'INACTIVE')

  const before = await fingerprint()
  const countsBefore = await Promise.all([
    prisma.user.count(), prisma.business.count(), prisma.unit.count(), prisma.workWeek.count(),
    prisma.leaveRecord.count(), prisma.reliefAssignment.count(), prisma.taskComment.count(), prisma.planningUnlock.count(),
  ])
  await run(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'prisma/seed.ts'], { windowsHide: true, timeout: 60000 })
  assert.equal(await fingerprint(), before, 'Repeated seed changed identities, content or event times')
  assert.deepEqual(await Promise.all([
    prisma.user.count(), prisma.business.count(), prisma.unit.count(), prisma.workWeek.count(),
    prisma.leaveRecord.count(), prisma.reliefAssignment.count(), prisma.taskComment.count(), prisma.planningUnlock.count(),
  ]), countsBefore)
  console.info('PASS seed repeatability and retained foundation identity')

  const roster = await prisma.weeklyTracker.findMany({ where: { weekId: 'week-2026-10-19' }, include: { user: true } })
  const snapshot = (name: string) => roster.find((row) => row.user.name === name)!
  assert.equal(roster.length, 28)
  assert.equal(snapshot('Femi Lawson').expectedWorkingDaysSnapshot, 0)
  assert.equal(snapshot('Ada Okafor').expectedWorkingDaysSnapshot, 4)
  assert.equal(snapshot('Tosin Ajayi').expectedWorkingDaysSnapshot, 3)
  assert.equal(snapshot('Grace Ekanem').expectedWorkingDaysSnapshot, 5)
  assert.equal(snapshot('Grace Ekanem').user.accountStatus, 'INACTIVE')
  assert.equal(await prisma.weeklyTask.count({ where: { trackerId: snapshot('Grace Ekanem').id } }), 0)
  const original = await prisma.weeklyTracker.findUniqueOrThrow({ where: {
    userId_weekId: { userId: 'person-damilola-james', weekId: 'week-2026-10-05' },
  } })
  assert.equal((original.contextSnapshot as { managerId: string }).managerId, 'person-nneka-obi')
  const finalAssignment = await prisma.weeklyTracker.findUniqueOrThrow({ where: {
    userId_weekId: { userId: 'person-damilola-james', weekId: 'week-2026-10-12' },
  } })
  assert.equal((finalAssignment.contextSnapshot as { managerId: string }).managerId, 'person-tunde-bakare')
  console.info('PASS full frozen roster, partial leave, partial day joining and midweek attribution')

  const projections = [
    { name: 'Employee', scope: 'wt."userId" = $2', target: 'person-ada-okafor', expected: [1,1,9,3,7] },
    { name: 'Line Manager', scope: 'wt."contextSnapshot"->>\'managerId\' = $2', target: 'person-tunde-bakare', expected: [15,5,24,7,18] },
    { name: 'Business Director', scope: 'wt."contextSnapshot"->>\'businessId\' = $2', target: 'business-workforce-resourcing', expected: [15,5,24,7,18] },
    { name: 'Executive', scope: '$2::text IS NOT NULL', target: 'person-david-cole', expected: [20,5,24,7,18] },
    { name: 'HR / Admin', scope: '$2::text IS NOT NULL', target: 'person-kemi-adebayo', expected: [20,5,24,7,18] },
    { name: 'Outsourcing Director', scope: 'wt."contextSnapshot"->>\'businessId\' = $2', target: 'business-outsourcing', expected: [5,0,0,0,0] },
  ]
  for (const projection of projections) {
    const row = await metrics(projection.scope, projection.target)
    assert.deepEqual([row.expected,row.submitted,row.tasks,row.approved,row.eligible], projection.expected, `${projection.name} scope mismatch`)
    console.info(JSON.stringify({ scope: projection.name, ...row,
      submissionRate: row.expected ? Math.round(row.submitted / row.expected * 100) : 0,
      completionRate: row.eligible ? Math.round(row.approved / row.eligible * 100) : 0 }))
  }

  const nextWeek = await prisma.workWeek.findUniqueOrThrow({ where: { id: 'week-2026-10-26' } })
  const nextRoster = await prisma.weeklyTracker.findMany({ where: { weekId: nextWeek.id }, include: { user: { include: { assignments: true, leaves: true } }, tasks: true } })
  const expectedNext = nextRoster.filter((row) => expectedWorkingDays(row.user, row.user.assignments, row.user.leaves,
    nextWeek.startsOn, nextWeek.freezesAt, new Date('2026-10-26T12:00:00+01:00')) > 0)
  assert.equal(expectedNext.length, 20)
  assert.equal(expectedNext.filter((row) => row.tasks.some((task) => !task.deletedAt)).length, 3)
  const carries = await prisma.weeklyTask.findMany({ where: { carriedFromId: { not: null } }, include: { carriedFrom: true } })
  assert.equal(carries.length, 3)
  assert.ok(carries.every((row) => row.carriedFrom?.seriesId === row.seriesId && row.status === 'PENDING'))
  const routed = await prisma.approvalRequest.findFirstOrThrow({ where: { submissionAssignmentId: 'assignment-damilola-before-transfer', state: 'PENDING' }, include: { assignment: true } })
  assert.equal(routed.assignment.managerId, 'person-nneka-obi')
  assert.equal(routed.assignedManagerId, 'person-tunde-bakare')
  const late = await prisma.approvalDecision.findFirstOrThrow({ where: { decidedAt: { gt: new Date('2026-10-17T00:00:00+01:00') }, request: { task: { tracker: { weekId: 'week-2026-10-12' } } } } })
  assert.ok(late)
  assert.equal(await prisma.approvalDecision.count({ where: { method: 'AUTOMATIC' } }), 1)
  assert.equal(await prisma.approvalDecision.count({ where: { reliefAssignmentId: { not: null } } }), 1)
  const onboarding = await prisma.approvalRequest.findMany({ where: { task: { title: 'Finalise the onboarding pack', tracker: { weekId: 'week-2026-10-19' } } }, orderBy: { attemptNumber: 'asc' } })
  assert.equal(onboarding.length, 2)
  assert.equal(onboarding[0].state, 'DECIDED')
  assert.equal(onboarding[1].state, 'PENDING')
  assert.notEqual((onboarding[0].submissionSnapshot as { activity: string }).activity, (onboarding[1].submissionSnapshot as { activity: string }).activity)
  assert.equal(await prisma.emailDelivery.count({ where: { state: { not: 'SUPPRESSED' } } }), 0)
  assert.equal(await prisma.notification.count({ where: { readAt: null } }), 3)
  assert.equal(await prisma.notification.count({ where: { readAt: { not: null } } }), 1)
  console.info('PASS automatic carry submission, request routing, late approval, review snapshots, auto/relief decisions and recipient delivery state')

  const pending = onboarding[1]
  const decision = await prisma.approvalDecision.findFirstOrThrow()
  const editable = carries.find((row) => row.ownerId === 'person-ada-okafor')!
  const openTracker = nextRoster.find((row) => row.userId === 'person-ada-okafor')!
  await client.query('BEGIN')
  try {
    await rejects('uppercase account email', 'INSERT INTO "User" (id,email,"updatedAt") VALUES ($1,$2,now())', ['verification-email','UPPER@example.invalid'], '23514', 'user_canonical_email')
    await rejects('active account without a name', 'INSERT INTO "User" (id,email,"accountStatus","updatedAt") VALUES ($1,$2,\'ACTIVE\',now())', ['verification-name','name@example.invalid'], '23514', 'active_user_name')
    await rejects('duplicate current assignment', `INSERT INTO "EmploymentAssignment" (id,"userId",role,"businessId","unitId","managerId","effectiveFrom") SELECT $1,"userId",role,"businessId","unitId","managerId","effectiveFrom" FROM "EmploymentAssignment" WHERE id=$2`, ['verification-assignment','assignment-ada-okafor-current'], '23505', 'one_current_assignment')
    await rejects('mismatched unit and business', 'UPDATE "EmploymentAssignment" SET "unitId"=$1 WHERE id=$2', ['unit-outsourcing-payroll','assignment-ada-okafor-current'], '23503')
    await rejects('self reporting', 'UPDATE "EmploymentAssignment" SET "managerId"="userId" WHERE id=$1', ['assignment-ada-okafor-current'], '23514', 'assignment_not_self_managed')
    await rejects('duplicate pending attempt', `INSERT INTO "ApprovalRequest" (id,"weeklyTaskId","attemptNumber","submittedById","submissionAssignmentId","submissionSnapshot","assignedManagerId","submittedAt",state) SELECT $1,"weeklyTaskId",999,"submittedById","submissionAssignmentId","submissionSnapshot","assignedManagerId","submittedAt",state FROM "ApprovalRequest" WHERE id=$2`, ['verification-pending',pending.id], '23505', 'one_pending_approval')
    await rejects('duplicate decision', `INSERT INTO "ApprovalDecision" (id,"requestId",decision,method,"actorId","actingForManagerId","reliefAssignmentId",reason,"decidedAt") SELECT $1,"requestId",decision,method,"actorId","actingForManagerId","reliefAssignmentId",reason,"decidedAt" FROM "ApprovalDecision" WHERE id=$2`, ['verification-decision',decision.id], '23505', 'ApprovalDecision_requestId_key')
    await rejects('backwards task dates', 'UPDATE "WeeklyTask" SET "endsOn"="startsOn"-1 WHERE id=$1', [editable.id], '23514', 'task_dates')
    await rejects('blank task content', 'UPDATE "WeeklyTask" SET title=\'   \' WHERE id=$1', [editable.id], '23514', 'task_content')
    await rejects('invalid unlock target', `INSERT INTO "PlanningUnlock" (id,"weekId",scope,"userId","grantedById",reason,"grantedAt","expiresAt") VALUES ($1,$2,'EVERYONE',$3,$4,'Verification',now(),now()+interval '1 hour')`, ['verification-unlock','week-2026-10-26','person-ada-okafor','person-kemi-adebayo'], '23514', 'unlock_target_shape')
    await rejects('invalid leave interval', 'UPDATE "LeaveRecord" SET "expectedReturnOn"="startsOn" WHERE id=$1', ['leave-femi'], '23514', 'leave_dates')
    await rejects('audit rewrite', 'UPDATE "AuditEvent" SET action=\'REWRITTEN\' WHERE id=$1', ['audit-seed-workforce'], '23514')
    await rejects('decision deletion', 'DELETE FROM "ApprovalDecision" WHERE id=$1', [decision.id], '23514')
    await rejects('submission content rewrite', 'UPDATE "ApprovalRequest" SET "submissionSnapshot"=jsonb_set("submissionSnapshot",\'{title}\',\'"rewritten"\') WHERE id=$1', [pending.id], '23514')
    await rejects('mismatched tracker assignment owner', 'UPDATE "WeeklyTracker" SET "assignmentId"=$1 WHERE id=$2', ['assignment-chidi-eze-current',openTracker.id], '23503')
    await rejects('mismatched task owner', 'UPDATE "WeeklyTask" SET "ownerId"=$1 WHERE id=$2', ['person-chidi-eze',editable.id], '23503')
    await rejects('invalid schedule time', 'UPDATE "TrackerSettings" SET "lockTime"=\'24:00\' WHERE id=\'workforce-group\'', [], '23514', 'settings_times')
    await rejects('self relief', 'UPDATE "ReliefAssignment" SET "reliefManagerId"="coveredManagerId" WHERE id=$1', ['relief-nneka'], '23514', 'relief_not_self')
    await rejects('sent email without sent time', 'UPDATE "EmailDelivery" SET state=\'SENT\' WHERE id=$1', ['email-notification-ada-approved'], '23514', 'sent_delivery_timestamp')
    await rejects('delete referenced identity', 'DELETE FROM "User" WHERE id=$1', ['person-ada-okafor'], '23001')
    await rejects('delete frozen missing submitter', 'DELETE FROM "WeeklyTracker" WHERE id=$1', [snapshot('Grace Ekanem').id], '23514')
    await rejects('rewrite frozen eligibility', 'UPDATE "WeeklyTracker" SET "expectedWorkingDaysSnapshot"=0 WHERE id=$1', [snapshot('Grace Ekanem').id], '23514')
    await rejects('second business director', `INSERT INTO "EmploymentAssignment" (id,"userId",role,"businessId","effectiveFrom") VALUES ($1,$2,'BUSINESS_DIRECTOR','business-workforce-resourcing',now())`, ['verification-director-assignment','verification-director'], '23505', 'one_current_business_director',
      () => client.query('INSERT INTO "User" (id,email,"updatedAt") VALUES ($1,$2,now())', ['verification-director','director@example.invalid']))

    const historicalBefore = await metrics('$2::text IS NOT NULL', 'person-kemi-adebayo')
    await client.query('UPDATE "User" SET "accountStatus"=\'INACTIVE\',"deactivatedAt"=now() WHERE id=$1', ['person-damilola-james'])
    assert.deepEqual(await metrics('$2::text IS NOT NULL', 'person-kemi-adebayo'), historicalBefore)
    console.info('PASS later account deactivation leaves the frozen denominator unchanged')
    const utc = await client.query<{ reversible: boolean }>(`SELECT bool_and(((v AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')=v) AS reversible
      FROM (VALUES (timestamp '2026-10-26 12:34:56.789'),(timestamp '2025-01-01 00:00:00'),(timestamp '2026-10-19 23:59:59.999')) AS timestamps(v)`)
    assert.equal(utc.rows[0].reversible, true)
    console.info('PASS explicit legacy timestamp conversion round trip (not a before/after row comparison)')
  } finally { await client.query('ROLLBACK') }
  assert.equal(await fingerprint(), before, 'Verification changed persistent fixture records')
  console.info(`Data model verification passed: ${probeCount} rejected writes; all probe mutations rolled back`)
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Data model verification failed')
  process.exitCode = 1
} finally {
  await client.end()
  await prisma.$disconnect()
}
