import type { Prisma } from '../../src/generated/prisma/client.ts'
import { wellFormed } from '../../src/features/auth/contracts.ts'
import type { NotificationIcon } from '../../src/features/notifications/contracts.ts'
import { AuthFailure } from '../auth/errors.ts'
import { enqueueEmail } from '../email/enqueue.ts'
import type { RecipientBasis } from '../email/policy.ts'
import { effectiveReviewOfficer, exactReview, pendingAuthority, reviewerScope } from '../line-manager/review-scope.ts'

// Later producers use stable domain event ids and their locked recipient basis.
const events = {
  PASSWORD_CHANGED: { icon: 'security', target: 'profile', category: 'SECURITY' },
  APPROVAL_REQUESTED: { icon: 'check', target: 'approval', category: 'WORK' },
  APPROVAL_APPROVED: { icon: 'check', target: 'task', category: 'WORK' },
  APPROVAL_DECLINED: { icon: 'check', target: 'task', category: 'WORK' },
  TASK_COMMENTED: { icon: 'message', target: 'task', category: 'WORK' },
  LEAVE_RECORDED: { icon: 'calendar', target: 'leave', category: 'LEAVE' },
  LEAVE_CANCELLED: { icon: 'calendar', target: 'leave', category: 'LEAVE' },
  LEAVE_RETURNED: { icon: 'calendar', target: 'leave', category: 'LEAVE' },
  TRACKER_LOCKED: { icon: 'generic', target: 'future', category: 'WORK' },
  TRACKER_UNLOCKED: { icon: 'generic', target: 'future', category: 'WORK' },
  WORK_REMINDER: { icon: 'generic', target: 'tracker', category: 'WORK' },
  RELIEF_ASSIGNED: { icon: 'calendar', target: 'leave', category: 'LEAVE' },
  RELIEF_ENDED: { icon: 'calendar', target: 'leave', category: 'LEAVE' },
} as const satisfies Record<string, {
  icon: NotificationIcon
  target: 'profile' | 'approval' | 'task' | 'leave' | 'tracker' | 'future'
  category: 'SECURITY' | 'WORK' | 'LEAVE'
}>

export function notificationEvent(kind: string) {
  return Object.hasOwn(events, kind) ? events[kind as keyof typeof events] : undefined
}

export function readableMessage(title: string, body: string) {
  function readable(value: string, maximum: number) {
    return value.length <= maximum * 2 && !!value.trim() && !value.includes('\0') && wellFormed(value) && [...value].length <= maximum
  }
  return readable(title, 160) && readable(body, 4000)
}

type Tx = Prisma.TransactionClient
type LeaveEvent = 'RECORDED' | 'CANCELLED' | 'RETURNED'
export type LeaveRecipient = { id: string; basis: RecipientBasis & { relationship: 'OWNER' | 'MANAGER' | 'HR' } }
export type ManagerLeaveRecipient = { id: string; basis: RecipientBasis & { relationship: 'MANAGER_LEAVE_OWNER' | 'BUSINESS_DIRECTOR' | 'RELIEF_OFFICER' | 'HR' } }
type Delivery = { recipientId: string; title: string; body: string; deduplicationKey: string; createdAt: Date } & (
  | { kind: 'PASSWORD_CHANGED'; basis: RecipientBasis & { relationship: 'OWNER' } }
  | { kind: 'APPROVAL_REQUESTED'; basis: RecipientBasis & { relationship: 'ASSIGNED_REVIEWER' | 'RELIEF_REVIEWER' }; weeklyTaskId: string; approvalRequestId: string; reliefAssignmentId?: string }
  | { kind: 'APPROVAL_APPROVED' | 'APPROVAL_DECLINED'; basis: RecipientBasis & { relationship: 'OWNER' }; weeklyTaskId: string; approvalRequestId: string }
  | { kind: `LEAVE_${LeaveEvent}` | 'RELIEF_ASSIGNED' | 'RELIEF_ENDED'; basis: LeaveRecipient['basis'] | ManagerLeaveRecipient['basis']; leaveId: string; reliefAssignmentId?: string }
  | { kind: 'WORK_REMINDER'; basis: RecipientBasis & { relationship: 'REMINDER_RECIPIENT' }; workWeekId: string }
  | { kind: 'TASK_COMMENTED'; basis: RecipientBasis & { relationship: 'TASK_COMMENT_OWNER' | 'RELIEF_COMMENT_OWNER' | 'MANAGER' | 'RELIEF_REVIEWER' }; weeklyTaskId: string; approvalRequestId: string | null; reliefAssignmentId?: string }
)

async function record(tx: Tx, { basis, ...event }: Delivery) {
  if (!readableMessage(event.title, event.body)) throw new AuthFailure('SERVICE_UNAVAILABLE', 503)
  const { recipientId, deduplicationKey } = event
  await tx.$queryRaw`SELECT id FROM "User" WHERE id=${recipientId} FOR SHARE`
  const previous = await tx.notification.findUnique({ where: { recipientId_deduplicationKey: { recipientId, deduplicationKey } } })
  if (!previous) {
    const notice = await tx.notification.create({ data: event })
    await enqueueEmail(tx, notice, basis)
    return notice.id
  }
  if (previous.kind !== event.kind || previous.title !== event.title || previous.body !== event.body
    || previous.createdAt.getTime() !== event.createdAt.getTime() || previous.reliefAssignmentId !== ('reliefAssignmentId' in event ? event.reliefAssignmentId ?? null : null)
    || previous.weeklyTaskId !== ('weeklyTaskId' in event ? event.weeklyTaskId : null)
    || previous.approvalRequestId !== ('approvalRequestId' in event ? event.approvalRequestId : null)
    || previous.leaveId !== ('leaveId' in event ? event.leaveId : null)
    || previous.workWeekId !== ('workWeekId' in event ? event.workWeekId : null)) throw new AuthFailure('SERVICE_UNAVAILABLE', 503)
  return previous.id
}

export function recordWorkReminder(tx: Tx, basis: RecipientBasis & { relationship: 'REMINDER_RECIPIENT' }, week: string, key: string, createdAt: Date) {
  return record(tx, { recipientId: basis.sourceUserId, basis, kind: 'WORK_REMINDER', workWeekId: basis.workWeekId,
    title: 'Weekly tasks reminder', body: `Please add your tasks for the workweek starting ${week}.`, deduplicationKey: key, createdAt })
}

export function recordManagerComment(tx: Tx, basis: RecipientBasis & { relationship: 'TASK_COMMENT_OWNER' | 'RELIEF_COMMENT_OWNER' }, comment: { id: string; createdAt: Date },
  task: { id: string; title: string }, managerName: string, approvalRequestId: string | null) {
  return record(tx, { recipientId: basis.sourceUserId, basis, kind: 'TASK_COMMENTED', title: 'Manager commented on your task',
    body: `${managerName} commented on ${task.title}.`, weeklyTaskId: task.id, approvalRequestId,
    deduplicationKey: `task-commented:${comment.id}`, createdAt: comment.createdAt })
}

const securityTime = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lagos', dateStyle: 'long', timeStyle: 'short' })
export function recordPasswordChanged(tx: Tx, recipientId: string, requestId: string, createdAt: Date) {
  return record(tx, { recipientId, basis: { version: 1, relationship: 'OWNER', sourceUserId: recipientId }, kind: 'PASSWORD_CHANGED', title: 'Password changed',
    body: `Your password changed on ${securityTime.format(createdAt)} WAT. All sessions ended. Contact HR if you did not make this change.`,
    deduplicationKey: `password-changed:${recipientId}:${requestId}`, createdAt })
}

export async function recordApprovalRequested(tx: Tx, request: { id: string; weeklyTaskId: string; assignedManagerId: string | null; submittedAt: Date; submittedById: string; submissionAssignmentId: string }, reviewer: { id: string; businessId: string }, ownerName: string, taskTitle: string) {
  if (!request.assignedManagerId) throw new AuthFailure('SERVICE_UNAVAILABLE', 503)
  const event = { kind: 'APPROVAL_REQUESTED' as const, title: 'Completion awaiting approval',
    body: `${ownerName} has submitted ${taskTitle}.`, weeklyTaskId: request.weeklyTaskId, approvalRequestId: request.id,
    deduplicationKey: `approval-requested:${request.id}`, createdAt: request.submittedAt }
  await record(tx, { ...event, recipientId: request.assignedManagerId,
    basis: { version: 1, relationship: 'ASSIGNED_REVIEWER', sourceUserId: request.submittedById, sourceAssignmentId: request.submissionAssignmentId, recipientAssignmentId: reviewer.id, businessId: reviewer.businessId },
  })
  const row = await exactReview(tx, request.id, request.submittedAt)
  const cover = row ? await effectiveReviewOfficer(tx, row, request.submittedAt) : null
  if (cover && cover.reliefManagerId !== request.submittedById) {
    await record(tx, { ...event, recipientId: cover.reliefManagerId, reliefAssignmentId: cover.id,
      basis: { version: 1, relationship: 'RELIEF_REVIEWER', sourceUserId: request.submittedById, sourceAssignmentId: cover.authority.employee.id,
        businessId: cover.authority.route.businessId, coveredManagerId: request.assignedManagerId, reliefAssignmentId: cover.id } })
  }
}

export function recordApprovalOutcome(tx: Tx, row: { id: string; submittedById: string; weeklyTaskId: string },
  decision: { id: string; decision: 'APPROVE' | 'DECLINE'; decidedAt: Date; reason: string | null }, title: string) {
  const approved = decision.decision === 'APPROVE'
  return record(tx, { recipientId: row.submittedById, kind: approved ? 'APPROVAL_APPROVED' : 'APPROVAL_DECLINED',
    basis: { version: 1, relationship: 'OWNER', sourceUserId: row.submittedById }, title: approved ? 'Completion approved' : 'Completion declined',
    body: `${title} was ${approved ? 'approved.' : `declined. ${decision.reason ?? ''}`}`,
    weeklyTaskId: row.weeklyTaskId, approvalRequestId: row.id, deduplicationKey: `approval-decision:${decision.id}`, createdAt: decision.decidedAt })
}

export async function recordEmployeeReply(tx: Tx, task: { id: string; title: string; ownerId: string }, comment: { id: string; createdAt: Date },
  source: { id: string; managerId: string | null; businessId: string | null }, ownerName: string) {
  const { createdAt } = comment
  if (!source.managerId || source.managerId === task.ownerId || !source.businessId) return
  await tx.$queryRaw`SELECT id FROM "User" WHERE id=${source.managerId} FOR SHARE`
  await tx.$queryRaw`SELECT id FROM "EmploymentAssignment" WHERE "userId"=${source.managerId} ORDER BY id FOR SHARE`
  const manager = await reviewerScope(tx, source.managerId, createdAt)
  if (manager.assignment?.businessId !== source.businessId) return
  const request = await tx.approvalRequest.findFirst({ where: { weeklyTaskId: task.id, state: 'PENDING' }, select: { id: true } })
  const row = request ? await exactReview(tx, request.id, createdAt) : null
  const pending = row && pendingAuthority(manager, row, 'read').state === 'ALLOWED' ? row : null
  const event = { kind: 'TASK_COMMENTED' as const, weeklyTaskId: task.id, approvalRequestId: pending?.id ?? null,
    title: 'Employee commented on a task', body: `${ownerName} commented on ${task.title}.`, deduplicationKey: `task-commented:${comment.id}`, createdAt }
  await record(tx, { ...event, recipientId: source.managerId,
    basis: { version: 1, relationship: 'MANAGER', sourceUserId: task.ownerId, sourceAssignmentId: source.id, recipientAssignmentId: manager.assignment.id, businessId: source.businessId } })
  const cover = pending ? await effectiveReviewOfficer(tx, pending, createdAt) : null
  if (cover && cover.reliefManagerId !== task.ownerId && cover.reliefManagerId !== source.managerId) {
    await record(tx, { ...event, recipientId: cover.reliefManagerId, reliefAssignmentId: cover.id,
      basis: { version: 1, relationship: 'RELIEF_REVIEWER', sourceUserId: task.ownerId, sourceAssignmentId: source.id,
        businessId: source.businessId, coveredManagerId: source.managerId, reliefAssignmentId: cover.id } })
  }
}

const leaveTitles = { RECORDED: 'Leave recorded', CANCELLED: 'Leave cancelled', RETURNED: 'Return recorded' } satisfies Record<LeaveEvent, string>
const leaveDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
export function recordLeaveEvent(tx: Tx, recipient: LeaveRecipient, event: LeaveEvent, row: { id: string; startsOn: Date; expectedReturnOn: Date; actualReturnOn: Date | null }, ownerName: string, createdAt: Date) {
  if (event === 'RETURNED' && !row.actualReturnOn) throw new AuthFailure('SERVICE_UNAVAILABLE', 503)
  const title = leaveTitles[event]
  const body = event === 'RETURNED' ? `${ownerName} returned on ${leaveDate.format(row.actualReturnOn!)}.`
    : `${ownerName}: ${title.toLowerCase()} from ${leaveDate.format(row.startsOn)} until the first day back, ${leaveDate.format(row.expectedReturnOn)}.`
  return record(tx, { recipientId: recipient.id, basis: recipient.basis, kind: `LEAVE_${event}`, title, body, leaveId: row.id,
    deduplicationKey: `leave:${row.id}:${event.toLowerCase()}`, createdAt })
}

export function recordManagerLeaveEvent(tx: Tx, recipient: ManagerLeaveRecipient,
  kind: `LEAVE_${LeaveEvent}` | 'RELIEF_ASSIGNED' | 'RELIEF_ENDED',
  leave: { id: string; startsOn: Date; expectedReturnOn: Date; actualReturnOn: Date | null },
  cover: { id: string; startsOn: Date; endsOn: Date; name: string } | null, owner: string, createdAt: Date) {
  const coverage = cover ? ` ${cover.name} was assigned from ${leaveDate.format(cover.startsOn)} until ${leaveDate.format(cover.endsOn)} (exclusive).` : ''
  const details = {
    LEAVE_RECORDED: ['Leave recorded', `${owner} recorded leave from ${leaveDate.format(leave.startsOn)} until the first day back, ${leaveDate.format(leave.expectedReturnOn)}.${coverage}`],
    LEAVE_CANCELLED: ['Leave cancelled', `${owner} cancelled the leave starting ${leaveDate.format(leave.startsOn)}.${coverage}`],
    LEAVE_RETURNED: ['Return recorded', `${owner} returned on ${leaveDate.format(leave.actualReturnOn ?? leave.expectedReturnOn)}.${coverage}`],
    RELIEF_ASSIGNED: ['Relief cover assigned', `Relief cover was arranged for ${owner}.${coverage}`],
    RELIEF_ENDED: ['Relief cover ended', `Relief cover for ${owner} ended.${coverage}`],
  } as const
  const [title, body] = details[kind]
  const key = kind.startsWith('RELIEF_') ? `relief:${cover?.id}:${kind.slice(7).toLowerCase()}` : `leave:${leave.id}:${kind.slice(6).toLowerCase()}`
  if (kind.startsWith('RELIEF_') && !cover) throw new AuthFailure('SERVICE_UNAVAILABLE', 503)
  return record(tx, { recipientId: recipient.id, basis: recipient.basis, kind, title, body, deduplicationKey: key,
    leaveId: leave.id, ...(cover ? { reliefAssignmentId: cover.id } : {}), createdAt })
}
