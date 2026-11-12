import { Prisma } from '../../src/generated/prisma/client.ts'
import type { ApprovalGroup } from '../../src/features/line-manager/dashboard-view.ts'
import { day, isoDay, shiftDay } from '../data-model/calendar.ts'
import { pendingAuthority, reviewInclude, reviewerScope } from './review-scope.ts'
import type { ReviewerScope } from './review-scope.ts'
import { teamWhere } from './scope.ts'
import { validSubmission } from './approval-history.ts'
import type { Tx } from './scope.ts'

export async function pendingReviews(tx: Tx, scope: ReviewerScope, { personId, weeks }: { personId?: string; weeks?: Set<string> | null } = {}) {
  const routes = new Map([...scope.unavailableRoutes, ...[...scope.routes].map(([id, route]) => [id, route.businessId] as const)])
  if (!routes.size || weeks?.size === 0) return []
  const rows = await tx.approvalRequest.findMany({ where: { state: 'PENDING', decision: null, submittedAt: { lte: scope.at },
    submittedById: personId,
    task: { status: 'AWAITING_APPROVAL', deletedAt: null, ...(weeks ? { tracker: { week: { startsOn: { in: [...weeks].map(day) } } } } : {}) },
    submitter: { OR: [...routes].map(([id, business]) => teamWhere(id, business, scope.at)) },
  }, include: reviewInclude(scope.at), orderBy: [{ submittedAt: 'asc' }, { id: 'asc' }] })
  return rows.flatMap((row) => {
    const authority = pendingAuthority(scope, row, 'read')
    if (authority.state !== 'ALLOWED' && authority.state !== 'UNAVAILABLE') return []
    return [{ row, authority, week: isoDay(row.task.tracker.week.startsOn) }]
  })
}
export type PendingReview = Awaited<ReturnType<typeof pendingReviews>>[number]

export async function pendingCounts(tx: Tx, scope: ReviewerScope) {
  const routes = [
    ...[...scope.routes.values()].map(({ managerId, businessId, reliefId }) => ({ managerId, businessId, available: true, permanent: !reliefId })),
    ...[...scope.unavailableRoutes].map(([managerId, businessId]) => ({ managerId, businessId, available: false, permanent: false })),
  ]
  const [counts] = await tx.$queryRaw<{ people: bigint; requests: bigint; unavailable: bigint }[]>`
    WITH scoped AS (
      SELECT r."submittedById", CASE
        WHEN NOT route.available THEN 'UNAVAILABLE'
        WHEN r."assignedManagerId" IS DISTINCT FROM a."managerId" THEN CASE WHEN route.permanent THEN 'UNAVAILABLE' END
        WHEN EXISTS (SELECT 1 FROM "ApprovalRequest" newer WHERE newer."weeklyTaskId" = t.id AND newer."attemptNumber" > r."attemptNumber") THEN NULL
        WHEN (${validSubmission(Prisma.sql`r."submissionSnapshot"`, Prisma.sql`r."submittedById"`, Prisma.sql`w."startsOn"`)}) IS TRUE THEN 'ALLOWED'
        ELSE 'UNAVAILABLE' END AS state
      FROM jsonb_to_recordset(${JSON.stringify(routes)}::jsonb) AS route("managerId" text, "businessId" text, available boolean, permanent boolean)
      JOIN "EmploymentAssignment" a ON a."managerId" = route."managerId" AND a."businessId" = route."businessId"
      JOIN "User" u ON u.id = a."userId" AND u."accountStatus" = 'ACTIVE'
      JOIN "ApprovalRequest" r ON r."submittedById" = u.id
      JOIN "WeeklyTask" t ON t.id = r."weeklyTaskId" AND t."ownerId" = u.id
      JOIN "WeeklyTracker" tracker ON tracker.id = t."trackerId" AND tracker."userId" = u.id
      JOIN "WorkWeek" w ON w.id = tracker."weekId"
      WHERE a.role = 'EMPLOYEE' AND a."unitId" IS NOT NULL AND a."effectiveFrom" <= ${scope.at}
        AND (a."effectiveTo" IS NULL OR a."effectiveTo" > ${scope.at})
        AND NOT EXISTS (
          SELECT 1 FROM "EmploymentAssignment" other WHERE other."userId" = u.id AND other.id <> a.id
            AND other."effectiveFrom" <= ${scope.at} AND (other."effectiveTo" IS NULL OR other."effectiveTo" > ${scope.at})
        )
        AND r.state = 'PENDING' AND r."submittedAt" <= ${scope.at} AND t.status = 'AWAITING_APPROVAL' AND t."deletedAt" IS NULL
        AND NOT EXISTS (SELECT 1 FROM "ApprovalDecision" d WHERE d."requestId" = r.id)
    )
    SELECT count(DISTINCT "submittedById") FILTER (WHERE state = 'ALLOWED') AS people,
      count(*) FILTER (WHERE state = 'ALLOWED') AS requests,
      count(*) FILTER (WHERE state = 'UNAVAILABLE') AS unavailable FROM scoped
  `
  return { employeeCount: Number(counts.people), requestCount: Number(counts.requests), routingUnavailableCount: Number(counts.unavailable) }
}

export function groupPending(requests: PendingReview[], at: Date, overdueDays: number) {
  const groups = new Map<string, { group: ApprovalGroup; oldest: number }>()
  let routingUnavailableCount = 0
  for (const { row, week, authority } of requests) {
    if (authority.state !== 'ALLOWED') { routingUnavailableCount++; continue }
    const existing = groups.get(row.submittedById)
    if (existing) { existing.group.taskCount++; continue }
    const oldest = row.submittedAt.getTime()
    const oldestDays = Math.floor((at.getTime() - oldest) / 86400000)
    groups.set(row.submittedById, { oldest, group: {
      employeeId: row.submittedById, employeeName: row.submitter.name?.trim() || 'Staff member',
      unitName: authority.employee.unit?.name ?? '', taskCount: 1, oldestDays, overdue: oldestDays >= overdueDays, requestId: row.id, week,
    } })
  }
  return { routingUnavailableCount, groups: [...groups.values()].sort((a, b) => a.oldest - b.oldest || a.group.employeeId.localeCompare(b.group.employeeId)).map(({ group }) => group) }
}

export async function pendingReviewGroups(tx: Tx, actorId: string, _businessId: string, at: Date, overdueDays: number) {
  const scope = await reviewerScope(tx, actorId, at)
  const requests = await pendingReviews(tx, scope)
  const transitions = [...scope.transitions]
  for (const { row, authority } of requests) {
    if (authority.state === 'ALLOWED') transitions.push(shiftDay(row.submittedAt, Math.floor((at.getTime() - row.submittedAt.getTime()) / 86400000) + 1))
  }
  return {
    badge: groupPending(requests, at, overdueDays).groups.length, transitions,
    select: (weeks: Set<string>) => groupPending(requests.filter(({ week }) => weeks.has(week)), at, overdueDays),
  }
}
