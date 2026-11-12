import { createHash } from 'node:crypto'
import type { Prisma, PrismaClient, WorkWeek } from '../../src/generated/prisma/client.ts'
import type { ManagerCommand, ManagerReceipt } from '../../src/features/line-manager/dashboard-view.ts'
import type { Actor } from '../auth/owner-write.ts'
import { withKnownRollbackRetry } from '../auth/owner-write.ts'
import { AuthFailure } from '../auth/errors.ts'
import { databaseClock } from '../db.ts'
import { isoDay, watCalendarDay } from '../data-model/calendar.ts'
import { EmployeeFailure, monday } from '../employee/calendar.ts'
import { currentLeave } from '../employee/leave-state.ts'
import { ensureWeek } from '../employee/write-context.ts'
import { recordManagerComment, recordWorkReminder } from '../notifications/events.ts'
import { managerWeek } from './query.ts'
import { managerPrincipal, reminderEligibility, reminderKey, teamEmployee } from './scope.ts'
import type { Tx } from './scope.ts'

const failures = {
  IDEMPOTENCY_CONFLICT: { status: 409, message: 'This request identity was already used for a different change.' },
  REMINDER_UNAVAILABLE: { status: 409, message: 'This employee can no longer be reminded for this workweek. Reload the dashboard.' },
  WORK_CLOSED: { status: 423, message: 'This action is unavailable while work is closed or paused for leave.' },
} as const

export class ManagerFailure extends Error {
  readonly code: keyof typeof failures
  readonly status: number
  constructor(code: keyof typeof failures) {
    super(failures[code].message)
    this.code = code
    this.status = failures[code].status
  }
}
class BoundaryChanged extends Error {}
const notFound = () => new EmployeeFailure('NOT_FOUND', 404)

async function lockActors(tx: Tx, actor: Actor, target: string | undefined) {
  const id = actor.context.user.id
  if (target) await tx.$queryRaw`SELECT id FROM "User" WHERE id=${target} FOR UPDATE`
  await tx.$queryRaw`SELECT id FROM "User" WHERE id=${id} FOR SHARE`
  await tx.$queryRaw`SELECT id FROM "AuthSession" WHERE id=${actor.sessionId} AND "userId"=${id} FOR SHARE`
  await tx.$queryRaw`SELECT id FROM "AuthUser" WHERE id=${id} FOR SHARE`
  await tx.$queryRaw`SELECT id FROM "EmploymentAssignment" WHERE "userId" IN (${id}, ${target ?? id}) ORDER BY id FOR SHARE`
  await tx.$queryRaw`SELECT id FROM "LeaveRecord" WHERE "userId" IN (${id}, ${target ?? id}) ORDER BY id FOR SHARE`
}

async function checkWorking(tx: Tx, id: string, at: Date) {
  const leave = await currentLeave(tx, id, at)
  if (leave.state === 'ON_LEAVE' || leave.state === 'REPAIR_REQUIRED') throw new ManagerFailure('WORK_CLOSED')
}

async function newAuthority(tx: Tx, actor: Actor, employeeId: string | undefined) {
  const principal = await managerPrincipal(tx, actor)
  const employee = employeeId ? await teamEmployee(tx, employeeId, principal.userId, principal.businessId, principal.at) : null
  if (!employee) throw notFound()
  await checkWorking(tx, principal.userId, principal.at)
  return { ...principal, employee }
}

function sameDay(first: Date, last: Date) {
  if (isoDay(watCalendarDay(first)) !== isoDay(watCalendarDay(last))) throw new BoundaryChanged()
}

async function validateReminder(tx: Tx, actor: Actor, employeeId: string, week: WorkWeek) {
  const authority = await newAuthority(tx, actor, employeeId)
  const { at, employee } = authority
  if (monday(at).getTime() !== week.startsOn.getTime() || at >= week.freezesAt) throw new ManagerFailure('WORK_CLOSED')
  await checkWorking(tx, employeeId, at)
  const task = await tx.weeklyTask.findFirst({ where: { ownerId: employeeId, deletedAt: null, tracker: { weekId: week.id } }, select: { id: true } })
  const eligibility = await reminderEligibility(tx, employee, week.startsOn, week, null, at, !!task)
  if (!eligibility.allowed) {
    if (task) throw new ManagerFailure('REMINDER_UNAVAILABLE')
    throw new ManagerFailure('WORK_CLOSED')
  }
  return { ...authority, transitions: eligibility.transitions }
}

async function remind(tx: Tx, actor: Actor, command: Extract<ManagerCommand, { operation: 'LM_REMIND' }>, requestId: string) {
  const start = managerWeek(command.week)
  const preliminary = await newAuthority(tx, actor, command.employeeId)
  if (start.getTime() !== monday(preliminary.at).getTime()) throw new ManagerFailure('REMINDER_UNAVAILABLE')
  await tx.$queryRaw`SELECT id FROM "TrackerSettings" WHERE id='workforce-group' FOR SHARE`
  const week = await ensureWeek(tx, start)
  const { at, employee, userId, businessId } = await validateReminder(tx, actor, command.employeeId, week)
  const deduplicationKey = reminderKey(employee.person.id, start, at)
  const existing = await tx.notification.findUnique({ where: { recipientId_deduplicationKey: { recipientId: employee.person.id, deduplicationKey } },
    select: { id: true, kind: true, workWeekId: true } })
  if (existing && (existing.kind !== 'WORK_REMINDER' || existing.workWeekId !== week.id)) throw new AuthFailure('SERVICE_UNAVAILABLE', 503)
  const notificationId = existing?.id ?? await recordWorkReminder(tx, { version: 1, relationship: 'REMINDER_RECIPIENT',
    sourceUserId: employee.person.id, sourceAssignmentId: employee.assignment.id, requestingManagerId: userId, businessId, workWeekId: week.id }, command.week, deduplicationKey, at)
  if (!existing) await tx.auditEvent.create({ data: { actorId: userId, action: 'MANAGER_WORK_REMINDER_SENT', targetType: 'Notification', targetId: notificationId,
    after: { employeeId: employee.person.id, weekId: week.id }, createdAt: at } })
  const delivery = await tx.emailDelivery.findUnique({ where: { notificationId }, select: { state: true } })
  const receipt: ManagerReceipt = { version: 1, operation: command.operation, requestId, appliedAt: at.toISOString(),
    changed: !existing, alreadyReminded: !!existing, notificationId, emailSuppressed: delivery?.state === 'SUPPRESSED' }
  return { receipt, check: async () => {
    sameDay(at, await databaseClock(tx))
    const final = await validateReminder(tx, actor, command.employeeId, week)
    const latest = await databaseClock(tx)
    sameDay(at, latest)
    if (latest >= new Date(actor.context.session.expiresAt)) throw new AuthFailure('SESSION_REQUIRED', 401)
    if (final.transitions.some((boundary) => boundary > final.at && boundary <= latest)) throw new BoundaryChanged()
  } }
}

async function comment(tx: Tx, actor: Actor, command: Extract<ManagerCommand, { operation: 'LM_TASK_COMMENT' }>, requestId: string, employeeId: string | undefined) {
  const source = employeeId ? await tx.weeklyTask.findUnique({ where: { id: command.taskId }, select: { tracker: { select: { weekId: true } } } }) : null
  if (!source) throw notFound()
  await tx.$queryRaw`SELECT id FROM "WorkWeek" WHERE id=${source.tracker.weekId} FOR SHARE`
  await tx.$queryRaw`SELECT id FROM "WeeklyTask" WHERE id=${command.taskId} FOR UPDATE`
  await tx.$queryRaw`SELECT id FROM "ApprovalRequest" WHERE "weeklyTaskId"=${command.taskId} ORDER BY id FOR SHARE`
  const task = await tx.weeklyTask.findFirst({ where: { id: command.taskId, ownerId: employeeId, deletedAt: null, tracker: { weekId: source.tracker.weekId } },
    include: { tracker: { include: { week: true } }, approvals: { take: 1, orderBy: { attemptNumber: 'desc' }, include: { decision: true } } } })
  if (!task) throw notFound()
  const { week } = task.tracker
  const validate = async () => {
    const authority = await newAuthority(tx, actor, employeeId)
    if (week.startsOn.getTime() !== monday(authority.at).getTime() || authority.at >= week.freezesAt || task.tracker.snapshotAt) throw new ManagerFailure('WORK_CLOSED')
    return authority
  }
  const { at, employee, userId, businessId, staff } = await validate()
  const row = await tx.taskComment.create({ data: { authorId: userId, weeklyTaskId: task.id, body: command.body, createdAt: at } })
  const request = task.approvals[0]
  const approvalId = task.status === 'AWAITING_APPROVAL' && request?.state === 'PENDING' && !request.decision ? request.id : null
  await recordManagerComment(tx, { version: 1, relationship: 'TASK_COMMENT_OWNER', sourceUserId: employee.person.id,
    sourceAssignmentId: employee.assignment.id, requestingManagerId: userId, businessId }, row, task, staff.person.name?.trim() || 'Your line manager', approvalId)
  await tx.auditEvent.create({ data: { actorId: userId, action: 'MANAGER_TASK_COMMENTED', targetType: 'TaskComment', targetId: row.id,
    after: { taskId: task.id, employeeId: employee.person.id }, createdAt: at } })
  const receipt: ManagerReceipt = { version: 1, operation: command.operation, requestId, appliedAt: at.toISOString(), changed: true, taskId: task.id, commentId: row.id }
  return { receipt, check: async () => {
    const final = await validate()
    const latest = await databaseClock(tx)
    sameDay(final.at, latest)
    if (latest >= new Date(actor.context.session.expiresAt)) throw new AuthFailure('SESSION_REQUIRED', 401)
    if (latest >= week.freezesAt) throw new ManagerFailure('WORK_CLOSED')
  } }
}

function safeReceipt(value: Prisma.JsonValue, command: ManagerCommand, requestId: string): ManagerReceipt {
  if (value && typeof value === 'object' && !Array.isArray(value) && value.version === 1 && value.requestId === requestId && value.operation === command.operation
    && typeof value.appliedAt === 'string' && typeof value.changed === 'boolean') {
    const base = { version: 1 as const, requestId, appliedAt: value.appliedAt, changed: value.changed }
    if (command.operation === 'LM_REMIND' && typeof value.notificationId === 'string' && typeof value.alreadyReminded === 'boolean' && typeof value.emailSuppressed === 'boolean') {
      return { ...base, operation: command.operation, notificationId: value.notificationId, alreadyReminded: value.alreadyReminded, emailSuppressed: value.emailSuppressed }
    }
    if (command.operation === 'LM_TASK_COMMENT' && value.taskId === command.taskId && typeof value.commentId === 'string') {
      return { ...base, operation: command.operation, taskId: command.taskId, commentId: value.commentId }
    }
  }
  throw new AuthFailure('SERVICE_UNAVAILABLE', 503)
}

export async function mutateDashboard(db: PrismaClient, actor: Actor, requestId: string, command: ManagerCommand) {
  const fields = command.operation === 'LM_REMIND' ? [command.employeeId, command.week] : [command.taskId, command.body]
  const requestHash = createHash('sha256').update(JSON.stringify([command.operation, ...fields])).digest('hex')
  try {
    return await withKnownRollbackRetry(db, async (tx) => {
      const employeeId = command.operation === 'LM_REMIND' ? command.employeeId
        : (await tx.weeklyTask.findUnique({ where: { id: command.taskId }, select: { ownerId: true } }))?.ownerId
      await lockActors(tx, actor, employeeId)
      const { userId } = await managerPrincipal(tx, actor)
      const previous = await tx.sharedMutationReceipt.findUnique({ where: { userId_requestId: { userId, requestId } } })
      if (previous) {
        if (previous.operation !== command.operation || previous.requestHash !== requestHash) throw new ManagerFailure('IDEMPOTENCY_CONFLICT')
        return { result: safeReceipt(previous.result, command, requestId), replayed: true }
      }
      const { receipt, check } = command.operation === 'LM_REMIND' ? await remind(tx, actor, command, requestId) : await comment(tx, actor, command, requestId, employeeId)
      await tx.sharedMutationReceipt.create({ data: { userId, requestId, requestHash, operation: command.operation, result: receipt, createdAt: receipt.appliedAt } })
      await check()
      return { result: receipt, replayed: false }
    }, (error) => error instanceof BoundaryChanged)
  } catch (error) {
    if (error instanceof BoundaryChanged) throw new AuthFailure('SERVICE_UNAVAILABLE', 503)
    throw error
  }
}
