import type { ApprovalGroup } from '../../src/features/line-manager/dashboard-view.ts'
import { isoDay, shiftDay } from '../data-model/calendar.ts'
import { pendingAuthority, reviewInclude, reviewerScope } from './review-scope.ts'
import type { ReviewerScope } from './review-scope.ts'
import { teamWhere } from './scope.ts'
import type { Tx } from './scope.ts'

export async function pendingReviews(tx: Tx, scope: ReviewerScope) {
  const routes = new Map([...scope.unavailableRoutes, ...[...scope.routes].map(([id, route]) => [id, route.businessId] as const)])
  if (!routes.size) return []
  const rows = await tx.approvalRequest.findMany({ where: { state: 'PENDING', decision: null, submittedAt: { lte: scope.at },
    task: { status: 'AWAITING_APPROVAL', deletedAt: null },
    submitter: { OR: [...routes].map(([id, business]) => teamWhere(id, business, scope.at)) },
  }, include: reviewInclude(scope.at), orderBy: [{ submittedAt: 'asc' }, { id: 'asc' }] })
  return rows.flatMap((row) => {
    const authority = pendingAuthority(scope, row, 'read')
    if (authority.state !== 'ALLOWED' && authority.state !== 'UNAVAILABLE') return []
    return [{ row, authority, week: isoDay(row.task.tracker.week.startsOn) }]
  })
}
export type PendingReview = Awaited<ReturnType<typeof pendingReviews>>[number]

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
