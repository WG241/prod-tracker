import type { Notification, Prisma } from '../../src/generated/prisma/client.ts'
import type { SessionContext } from '../../src/features/auth/contracts.ts'
import type { NotificationTarget } from '../../src/features/notifications/contracts.ts'
import { isoDay } from '../data-model/calendar.ts'
import { EmployeeFailure } from '../employee/calendar.ts'
import { readTaskDetail } from '../employee/reads.ts'
import { notificationEvent, readableMessage } from './events.ts'
import { exactReview, pendingAuthority, reviewerScope } from '../line-manager/review-scope.ts'
import { teamTaskTarget } from '../line-manager/team-history.ts'
import { storedBasis } from '../email/policy.ts'

const unavailable = { kind: 'UNAVAILABLE', reason: 'TARGET_UNAVAILABLE' } as const

export async function resolveTarget(tx: Prisma.TransactionClient, context: SessionContext, row: Notification, at: Date): Promise<NotificationTarget> {
  if (row.recipientId !== context.user.id || !readableMessage(row.title, row.body)) return unavailable
  const target = notificationEvent(row.kind)?.target
  if (target === 'profile') return { kind: 'PROFILE' }
  if (context.role !== 'EMPLOYEE' && context.role !== 'LINE_MANAGER') return unavailable
  if (context.role === 'EMPLOYEE' && target === 'tracker' && row.workWeekId) {
    const week = await tx.workWeek.findUnique({ where: { id: row.workWeekId }, select: { startsOn: true } })
    return week ? { kind: 'OWN_TRACKER', week: isoDay(week.startsOn) } : unavailable
  }
  if (target === 'leave' && row.leaveId) {
    const owned = await tx.leaveRecord.findFirst({ where: { id: row.leaveId, userId: context.user.id }, select: { contextSnapshot: true } })
    if (owned) {
      if (context.role === 'LINE_MANAGER') return { kind: 'MANAGER_LEAVE' }
      const outbox = await tx.emailDelivery.findUnique({ where: { notificationId: row.id }, select: { recipientBasis: true } })
      return owned.contextSnapshot || row.reliefAssignmentId || storedBasis(outbox?.recipientBasis ?? null)?.relationship === 'MANAGER_LEAVE_OWNER'
        ? unavailable : { kind: 'EMPLOYEE_LEAVE' }
    }
    if (context.role === 'LINE_MANAGER' && row.reliefAssignmentId && await tx.reliefAssignment.findFirst({
      where: { id: row.reliefAssignmentId, leaveId: row.leaveId, reliefManagerId: context.user.id }, select: { id: true },
    })) return { kind: 'MANAGER_APPROVALS' }
    return unavailable
  }
  if ((target !== 'task' && target !== 'approval') || !row.weeklyTaskId) return unavailable
  const ownedTask = await tx.weeklyTask.findFirst({ where: {
    id: row.weeklyTaskId, ownerId: context.user.id, deletedAt: null, tracker: { userId: context.user.id },
  }, select: { tracker: { select: { week: { select: { startsOn: true } } } } } })
  if (!ownedTask) {
    if (context.role !== 'LINE_MANAGER' || !context.businessId) return unavailable
    if ((row.kind === 'APPROVAL_REQUESTED' || row.kind === 'TASK_COMMENTED') && row.approvalRequestId) {
      const request = await exactReview(tx, row.approvalRequestId, at)
      if (!request || request.task.id !== row.weeklyTaskId) return unavailable
      const scope = await reviewerScope(tx, context.user.id, at)
      const authority = pendingAuthority(scope, request, 'read')
      if (authority.state !== 'ALLOWED' || authority.route.reliefId !== row.reliefAssignmentId) return unavailable
      return { kind: 'REVIEW_REQUEST', requestId: request.id, taskId: request.task.id, week: authority.submitted.week }
    }
    if (row.kind === 'TASK_COMMENTED' && !row.approvalRequestId && !row.reliefAssignmentId) {
      return await teamTaskTarget(tx, { userId: context.user.id, businessId: context.businessId, name: context.user.name, at }, row.weeklyTaskId) ?? unavailable
    }
    return unavailable
  }
  if (target === 'approval') return unavailable
  if (row.kind !== 'TASK_COMMENTED') {
    if (!row.approvalRequestId) return unavailable
    const decision = await tx.approvalDecision.findFirst({ where: {
      requestId: row.approvalRequestId,
      request: { weeklyTaskId: row.weeklyTaskId, submittedById: context.user.id },
      decision: row.kind === 'APPROVAL_APPROVED' ? 'APPROVE' : 'DECLINE',
    }, select: { requestId: true } })
    if (!decision) return unavailable
  }
  // Use the same detail contract as the destination, inside the read transaction.
  try {
    const { task } = await readTaskDetail(tx, context, row.weeklyTaskId, { commentPage: 1 }, at, context.role)
    const week = isoDay(ownedTask.tracker.week.startsOn)
    if (task.week !== week) throw new EmployeeFailure('SERVICE_UNAVAILABLE', 503)
    return { kind: 'OWN_TASK', taskId: task.id, week }
  } catch (error) {
    if (error instanceof EmployeeFailure && error.status === 404) return unavailable
    throw error
  }
}
