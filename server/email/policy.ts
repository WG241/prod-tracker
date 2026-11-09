import type { Notification, Prisma } from '../../src/generated/prisma/client.ts'
import { currentLeave } from '../employee/leave-state.ts'
import { monday } from '../employee/calendar.ts'
import { reminderEligibility, teamEmployee } from '../line-manager/scope.ts'
import { staffContext } from '../auth/context.ts'
import { canonicalMailbox } from './config.ts'
import { exactReview, pendingAuthority, reviewerScope } from '../line-manager/review-scope.ts'
import { effective } from '../line-manager/scope.ts'
import { watCalendarDay } from '../data-model/calendar.ts'

type Tx = Prisma.TransactionClient
export type RecipientBasis = { version: 1; sourceUserId: string } & (
  | { relationship: 'OWNER' }
  | { relationship: 'HR'; recipientAssignmentId: string }
  | { relationship: 'MANAGER' | 'ASSIGNED_REVIEWER'; sourceAssignmentId: string; recipientAssignmentId: string; businessId: string }
  | { relationship: 'REMINDER_RECIPIENT'; sourceAssignmentId: string; requestingManagerId: string; businessId: string; workWeekId: string }
  | { relationship: 'TASK_COMMENT_OWNER'; sourceAssignmentId: string; requestingManagerId: string; businessId: string }
  | { relationship: 'RELIEF_REVIEWER'; sourceAssignmentId: string; businessId: string; coveredManagerId: string; reliefAssignmentId: string }
  | { relationship: 'RELIEF_COMMENT_OWNER'; sourceAssignmentId: string; businessId: string; coveredManagerId: string; reliefAssignmentId: string; requestingManagerId: string }
  | { relationship: 'MANAGER_LEAVE_OWNER' }
  | { relationship: 'BUSINESS_DIRECTOR'; sourceAssignmentId: string; recipientAssignmentId: string; businessId: string }
  | { relationship: 'RELIEF_OFFICER'; reliefAssignmentId: string; recipientAssignmentId: string }
)
export type MailNotice = Pick<Notification, 'kind' | 'recipientId' | 'weeklyTaskId' | 'approvalRequestId' | 'leaveId' | 'workWeekId' | 'reliefAssignmentId'>

export function storedBasis(value: Prisma.JsonValue): RecipientBasis | null {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 1 || typeof value.sourceUserId !== 'string') return null
  const base = { version: 1 as const, sourceUserId: value.sourceUserId }
  const size = Object.keys(value).length
  if (value.relationship === 'OWNER' && size === 3) return { ...base, relationship: 'OWNER' }
  if (value.relationship === 'MANAGER_LEAVE_OWNER' && size === 3) return { ...base, relationship: value.relationship }
  if (typeof value.sourceAssignmentId === 'string' && typeof value.businessId === 'string'
    && typeof value.coveredManagerId === 'string' && typeof value.reliefAssignmentId === 'string') {
    const cover = { ...base, sourceAssignmentId: value.sourceAssignmentId, businessId: value.businessId,
      coveredManagerId: value.coveredManagerId, reliefAssignmentId: value.reliefAssignmentId }
    if (value.relationship === 'RELIEF_REVIEWER' && size === 7) return { ...cover, relationship: value.relationship }
    if (value.relationship === 'RELIEF_COMMENT_OWNER' && size === 8 && typeof value.requestingManagerId === 'string') {
      return { ...cover, relationship: value.relationship, requestingManagerId: value.requestingManagerId }
    }
  }
  if (typeof value.sourceAssignmentId === 'string' && typeof value.requestingManagerId === 'string' && typeof value.businessId === 'string') {
    const source = { ...base, sourceAssignmentId: value.sourceAssignmentId, requestingManagerId: value.requestingManagerId, businessId: value.businessId }
    if (value.relationship === 'REMINDER_RECIPIENT' && size === 7 && typeof value.workWeekId === 'string') return { ...source, relationship: value.relationship, workWeekId: value.workWeekId }
    if (value.relationship === 'TASK_COMMENT_OWNER' && size === 6) return { ...source, relationship: value.relationship }
  }
  if (typeof value.recipientAssignmentId !== 'string') return null
  const assigned = { ...base, recipientAssignmentId: value.recipientAssignmentId }
  if (value.relationship === 'HR' && size === 4) return { ...assigned, relationship: 'HR' }
  if (value.relationship === 'RELIEF_OFFICER' && size === 5 && typeof value.reliefAssignmentId === 'string') {
    return { ...assigned, relationship: value.relationship, reliefAssignmentId: value.reliefAssignmentId }
  }
  if ((value.relationship === 'MANAGER' || value.relationship === 'ASSIGNED_REVIEWER' || value.relationship === 'BUSINESS_DIRECTOR') && size === 6
    && typeof value.sourceAssignmentId === 'string' && typeof value.businessId === 'string') {
    return { ...assigned, relationship: value.relationship, sourceAssignmentId: value.sourceAssignmentId, businessId: value.businessId }
  }
  return null
}

export async function lockRecipientPolicy(tx: Tx, notice: MailNotice, basis: RecipientBasis) {
  const { recipientId } = notice
  const { sourceUserId } = basis
  const requester = 'requestingManagerId' in basis ? basis.requestingManagerId : sourceUserId
  const covered = 'coveredManagerId' in basis ? basis.coveredManagerId : requester
  await tx.$queryRaw`SELECT id FROM "User" WHERE id IN (${recipientId},${sourceUserId},${requester},${covered}) ORDER BY id FOR SHARE`
  await tx.$queryRaw`SELECT id FROM "AuthUser" WHERE id=${recipientId} FOR SHARE`
  await tx.$queryRaw`SELECT id FROM "EmploymentAssignment" WHERE "userId" IN (${recipientId},${sourceUserId},${requester},${covered}) ORDER BY id FOR SHARE`
  await tx.$queryRaw`SELECT id FROM "LeaveRecord" WHERE "userId" IN (${recipientId},${covered}) ORDER BY id FOR SHARE`
  await tx.$queryRaw`SELECT "userId" FROM "NotificationPreference" WHERE "userId"=${recipientId} FOR SHARE`
  if (notice.approvalRequestId) {
    await tx.$queryRaw`SELECT id FROM "WeeklyTask" WHERE id=${notice.weeklyTaskId} FOR SHARE`
    await tx.$queryRaw`SELECT id FROM "ApprovalRequest" WHERE id=${notice.approvalRequestId} FOR SHARE`
  }
  if (notice.kind === 'WORK_REMINDER') {
    await tx.$queryRaw`SELECT id FROM "WorkWeek" WHERE id=${notice.workWeekId} FOR SHARE`
    await tx.$queryRaw`SELECT id FROM "PlanningUnlock" WHERE "weekId"=${notice.workWeekId} ORDER BY id FOR SHARE`
  }
  if (notice.kind === 'TASK_COMMENTED') await tx.$queryRaw`SELECT id FROM "WeeklyTask" WHERE id=${notice.weeklyTaskId} FOR SHARE`
  if (notice.leaveId) await tx.$queryRaw`SELECT id FROM "LeaveRecord" WHERE id=${notice.leaveId} FOR SHARE`
  if ('coveredManagerId' in basis) await tx.$queryRaw`SELECT id FROM "ReliefAssignment" WHERE "coveredManagerId"=${basis.coveredManagerId} ORDER BY id FOR SHARE`
  else if (notice.reliefAssignmentId) await tx.$queryRaw`SELECT id FROM "ReliefAssignment" WHERE id=${notice.reliefAssignmentId} FOR SHARE`
}

export async function recipientRefusal(tx: Tx, notice: MailNotice, basis: RecipientBasis, address: string, at: Date) {
  const { recipientId } = notice
  const current = { effectiveFrom: { lte: at }, effectiveTo: null }
  const recipient = await tx.user.findUnique({ where: { id: recipientId }, include: {
    authIdentity: { select: { email: true, provisionedAt: true } }, notificationPreference: true,
    assignments: { where: current, take: 2 },
  } })
  if (!recipient || recipient.accountStatus !== 'ACTIVE' || canonicalMailbox(recipient.email) !== address
    || (recipient.authIdentity?.provisionedAt && canonicalMailbox(recipient.authIdentity.email) !== address)) return 'RECIPIENT_UNAVAILABLE'
  if (notice.kind === 'PASSWORD_CHANGED') return basis.relationship === 'OWNER' && basis.sourceUserId === recipientId ? null : 'EVENT_INELIGIBLE'
  if (!(recipient.notificationPreference?.emailRemindersEnabled ?? recipient.emailRemindersEnabled)) return 'PREFERENCE_DISABLED'
  const assignment = recipient.assignments.length === 1 ? recipient.assignments[0] : null
  if (['MANAGER_LEAVE_OWNER', 'BUSINESS_DIRECTOR', 'RELIEF_OFFICER'].includes(basis.relationship)
    || (basis.relationship === 'HR' && !!notice.reliefAssignmentId && !!notice.leaveId)) {
    if (!notice.leaveId || !['LEAVE_RECORDED', 'LEAVE_CANCELLED', 'LEAVE_RETURNED', 'RELIEF_ASSIGNED', 'RELIEF_ENDED'].includes(notice.kind)) return 'EVENT_INELIGIBLE'
    const leave = await tx.leaveRecord.findFirst({ where: { id: notice.leaveId, userId: basis.sourceUserId } })
    if (!leave) return 'EVENT_INELIGIBLE'
    const cover = notice.reliefAssignmentId ? await tx.reliefAssignment.findFirst({
      where: { id: notice.reliefAssignmentId, leaveId: leave.id, coveredManagerId: leave.userId },
    }) : null
    if ((notice.reliefAssignmentId && !cover) || (notice.kind.startsWith('RELIEF_') && !cover)
      || (notice.kind === 'RELIEF_ENDED' && (!cover?.endedAt || cover.endedAt > at))
      || (notice.kind === 'LEAVE_CANCELLED' && (!leave.cancelledAt || leave.cancelledAt > at))
      || (notice.kind === 'LEAVE_RETURNED' && !leave.actualReturnOn)) return 'EVENT_INELIGIBLE'
    if (basis.relationship === 'MANAGER_LEAVE_OWNER') return recipientId === leave.userId ? null : 'RELATIONSHIP_CHANGED'
    if (basis.relationship === 'HR') return assignment?.role === 'HR_ADMIN' && assignment.id === basis.recipientAssignmentId ? null : 'RELATIONSHIP_CHANGED'
    if (basis.relationship === 'BUSINESS_DIRECTOR') {
      const source = await tx.employmentAssignment.findMany({ where: { userId: leave.userId, ...effective(at) }, take: 2 })
      return assignment?.role === 'BUSINESS_DIRECTOR' && assignment.id === basis.recipientAssignmentId && assignment.businessId === basis.businessId
        && source.length === 1 && source[0].id === basis.sourceAssignmentId && source[0].businessId === basis.businessId ? null : 'RELATIONSHIP_CHANGED'
    }
    if (basis.relationship !== 'RELIEF_OFFICER' || cover?.id !== basis.reliefAssignmentId || cover.reliefManagerId !== recipientId
      || assignment?.role !== 'LINE_MANAGER' || assignment.id !== basis.recipientAssignmentId) return 'RELATIONSHIP_CHANGED'
    if (notice.kind === 'RELIEF_ASSIGNED' || notice.kind === 'LEAVE_RECORDED') {
      const today = watCalendarDay(at)
      if ((cover.endedAt && cover.endedAt <= at) || (leave.cancelledAt && leave.cancelledAt <= at)
        || cover.endsOn <= today || (leave.actualReturnOn ?? leave.expectedReturnOn) <= today) return 'RELATIONSHIP_CHANGED'
    }
    return null
  }
  if (notice.kind === 'APPROVAL_APPROVED' || notice.kind === 'APPROVAL_DECLINED') {
    if (basis.relationship !== 'OWNER' || basis.sourceUserId !== recipientId || !notice.approvalRequestId || !notice.weeklyTaskId) return 'EVENT_INELIGIBLE'
    const outcome = await tx.approvalDecision.findFirst({ where: { requestId: notice.approvalRequestId,
      decision: notice.kind === 'APPROVAL_APPROVED' ? 'APPROVE' : 'DECLINE',
      request: { weeklyTaskId: notice.weeklyTaskId, submittedById: recipientId, task: { ownerId: recipientId, deletedAt: null, tracker: { userId: recipientId } } },
    }, select: { id: true } })
    if (!outcome) return 'EVENT_INELIGIBLE'
    const leave = await currentLeave(tx, recipientId, at)
    return leave.state === 'ON_LEAVE' || leave.state === 'REPAIR_REQUIRED' ? 'ON_LEAVE' : null
  }
  if (basis.relationship === 'RELIEF_REVIEWER' || basis.relationship === 'RELIEF_COMMENT_OWNER'
    || (notice.kind === 'APPROVAL_REQUESTED' && basis.relationship === 'ASSIGNED_REVIEWER')) {
    const commenter = basis.relationship === 'RELIEF_COMMENT_OWNER'
    if ((notice.kind !== 'APPROVAL_REQUESTED' && notice.kind !== 'TASK_COMMENTED') || (commenter && notice.kind !== 'TASK_COMMENTED')
      || !notice.approvalRequestId || !notice.weeklyTaskId) return 'EVENT_INELIGIBLE'
    const reviewer = commenter ? basis.requestingManagerId : recipientId
    const row = await exactReview(tx, notice.approvalRequestId, at)
    if (!row || row.submittedById !== basis.sourceUserId || row.task.id !== notice.weeklyTaskId) return 'EVENT_INELIGIBLE'
    const scope = await reviewerScope(tx, reviewer, at)
    const authority = pendingAuthority(scope, row, 'mail')
    if (authority.state === 'PAUSED') return 'ON_LEAVE'
    if (authority.state !== 'ALLOWED') return authority.state === 'STALE' ? 'EVENT_INELIGIBLE' : 'RELATIONSHIP_CHANGED'
    if (authority.employee.id !== basis.sourceAssignmentId || authority.route.businessId !== basis.businessId) return 'RELATIONSHIP_CHANGED'
    if (basis.relationship === 'ASSIGNED_REVIEWER') {
      return authority.route.reliefId === null && scope.assignment?.id === basis.recipientAssignmentId ? null : 'RELATIONSHIP_CHANGED'
    }
    if (!('reliefAssignmentId' in basis) || authority.route.reliefId !== basis.reliefAssignmentId || authority.route.managerId !== basis.coveredManagerId
      || (!commenter && notice.reliefAssignmentId !== basis.reliefAssignmentId)) return 'RELATIONSHIP_CHANGED'
    if (!commenter) return null
    if (recipientId !== basis.sourceUserId) return 'EVENT_INELIGIBLE'
    const leave = await currentLeave(tx, recipientId, at)
    return leave.state === 'ON_LEAVE' || leave.state === 'REPAIR_REQUIRED' ? 'ON_LEAVE' : null
  }
  if (notice.kind === 'WORK_REMINDER' || (notice.kind === 'TASK_COMMENTED' && basis.relationship === 'TASK_COMMENT_OWNER')) {
    if ((notice.kind === 'WORK_REMINDER' && basis.relationship !== 'REMINDER_RECIPIENT')
      || (notice.kind === 'TASK_COMMENTED' && basis.relationship !== 'TASK_COMMENT_OWNER')
      || !('requestingManagerId' in basis) || basis.sourceUserId !== recipientId) return 'EVENT_INELIGIBLE'
    const manager = await staffContext(tx, basis.requestingManagerId, false, at)
    const employee = await teamEmployee(tx, recipientId, basis.requestingManagerId, basis.businessId, at)
    if (manager?.assignment.role !== 'LINE_MANAGER' || manager.assignment.businessId !== basis.businessId || employee?.assignment.id !== basis.sourceAssignmentId) return 'RELATIONSHIP_CHANGED'
    const leave = await currentLeave(tx, recipientId, at)
    if (leave.state === 'ON_LEAVE' || leave.state === 'REPAIR_REQUIRED') return 'ON_LEAVE'
    if (basis.relationship === 'REMINDER_RECIPIENT') {
      if (notice.workWeekId !== basis.workWeekId) return 'EVENT_INELIGIBLE'
      const week = await tx.workWeek.findUnique({ where: { id: basis.workWeekId } })
      if (!week || week.startsOn.getTime() !== monday(at).getTime()) return 'EVENT_INELIGIBLE'
      const task = await tx.weeklyTask.findFirst({ where: { ownerId: recipientId, tracker: { weekId: week.id }, deletedAt: null }, select: { id: true } })
      return (await reminderEligibility(tx, employee, week.startsOn, week, null, at, !!task)).allowed ? null : 'EVENT_INELIGIBLE'
    }
    if (!notice.weeklyTaskId) return 'EVENT_INELIGIBLE'
    return await tx.weeklyTask.findFirst({ where: { id: notice.weeklyTaskId, ownerId: recipientId, deletedAt: null }, select: { id: true } }) ? null : 'EVENT_INELIGIBLE'
  }
  if (basis.relationship === 'MANAGER' || basis.relationship === 'ASSIGNED_REVIEWER') {
    if (assignment?.role !== 'LINE_MANAGER' || assignment.businessId !== basis.businessId) return 'RELATIONSHIP_CHANGED'
    const source = await tx.user.findUnique({ where: { id: basis.sourceUserId }, include: { assignments: { where: current, take: 2 } } })
    const employee = source?.assignments.length === 1 ? source.assignments[0] : null
    if (source?.accountStatus !== 'ACTIVE' || employee?.role !== 'EMPLOYEE' || employee.businessId !== basis.businessId || employee.managerId !== recipientId) return 'RELATIONSHIP_CHANGED'
  }
  if (notice.kind === 'TASK_COMMENTED' && basis.relationship === 'MANAGER' && notice.weeklyTaskId) {
    if (assignment?.id !== basis.recipientAssignmentId || !await tx.weeklyTask.findFirst({ where: {
      id: notice.weeklyTaskId, ownerId: basis.sourceUserId, deletedAt: null,
      tracker: { userId: basis.sourceUserId, user: { assignments: { some: { ...current, id: basis.sourceAssignmentId } } } },
    }, select: { id: true } })) return 'RELATIONSHIP_CHANGED'
    const leave = await currentLeave(tx, recipientId, at)
    return leave.state === 'ON_LEAVE' || leave.state === 'REPAIR_REQUIRED' ? 'ON_LEAVE' : null
  }
  if (!['LEAVE_RECORDED', 'LEAVE_CANCELLED', 'LEAVE_RETURNED'].includes(notice.kind) || !notice.leaveId
    || basis.relationship === 'ASSIGNED_REVIEWER') return 'EVENT_INELIGIBLE'
  if ((basis.relationship === 'OWNER' && basis.sourceUserId !== recipientId)
    || (basis.relationship === 'HR' && assignment?.role !== 'HR_ADMIN')) return 'RELATIONSHIP_CHANGED'
  const leave = await tx.leaveRecord.findFirst({ where: { id: notice.leaveId, userId: basis.sourceUserId }, select: { id: true } })
  return leave ? null : 'EVENT_INELIGIBLE'
}
