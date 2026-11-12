import { createHash } from 'node:crypto'
import { databaseClock, databaseErrorCode } from '../db.ts'
import type { Prisma, PrismaClient, WeeklyTask } from '../../src/generated/prisma/client.ts'
import type { SessionContext } from '../../src/features/auth/contracts.ts'
import type { MutationResult, OwnTaskRole, TaskOperation } from '../../src/features/employee/mutations.ts'
import { operationRequest } from '../../src/features/employee/mutations.ts'
import { day, isoDay, shiftDay } from '../data-model/calendar.ts'
import { EmployeeFailure, monday } from './calendar.ts'
import { recordApprovalRequested, recordEmployeeReply } from '../notifications/events.ts'
import { requestEmailPass } from '../email/worker.ts'
import { lockEmployeeReviewRecipients } from '../line-manager/review-scope.ts'
import { employeeCalendar } from './reads.ts'
import { ensureWeek, lockPrincipal, principal, tracker } from './write-context.ts'
import type { Tx } from './write-context.ts'
import { TaskFailure, validateTaskDates } from './task-validation.ts'

function unavailable(): never { throw new EmployeeFailure('SERVICE_UNAVAILABLE', 503) }
function safe(task: WeeklyTask) {
  return { title: task.title, activity: task.activity, startsOn: isoDay(task.startsOn), endsOn: isoDay(task.endsOn), status: task.status, blockerReason: task.blockerReason, carryRequested: task.carryRequested, deletedAt: task.deletedAt?.toISOString() ?? null, revision: task.revision }
}
function receipt(value: Prisma.JsonValue, requestId: string, op: TaskOperation, taskId: string): MutationResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return unavailable()
  const v = value
  if (v.version !== 1 || v.requestId !== requestId || v.operation !== op.kind || v.taskId !== taskId || typeof v.taskRevision !== 'number' || !Number.isSafeInteger(v.taskRevision) || v.taskRevision < 0
    || typeof v.appliedAt !== 'string' || !Number.isFinite(Date.parse(v.appliedAt)) || typeof v.changed !== 'boolean'
    || ![v.continuationId, v.commentId, v.approvalRequestId].every((id) => id === null || typeof id === 'string')) return unavailable()
  return { version: 1, requestId, operation: op.kind, taskId, taskRevision: v.taskRevision, appliedAt: v.appliedAt, changed: v.changed,
    continuationId: v.continuationId as string | null, commentId: v.commentId as string | null, approvalRequestId: v.approvalRequestId as string | null, replayed: true }
}
async function pending(tx: Tx, task: WeeklyTask, role: OwnTaskRole) {
  const rows = await tx.approvalRequest.findMany({ where: { weeklyTaskId: task.id, state: 'PENDING' } })
  if (role === 'LINE_MANAGER' && (rows.length || task.status === 'AWAITING_APPROVAL')) throw new TaskFailure('OWN_TASK_REVIEW_CONFLICT', 409)
  if ((task.status === 'AWAITING_APPROVAL' && rows.length !== 1) || (task.status !== 'AWAITING_APPROVAL' && rows.length !== 0)) unavailable()
  return rows[0] ?? null
}
async function carry(tx: Tx, task: WeeklyTask, start: Date, fresh: Awaited<ReturnType<typeof principal>>, requested: boolean, at: Date) {
  const next = shiftDay(start, 7), friday = shiftDay(next, 4)
  if (isoDay(friday) > '9999-12-31') throw new TaskFailure('INVALID_INPUT', 400)
  const week = await ensureWeek(tx, next)
  const target = await tracker(tx, task.ownerId, week.id, fresh)
  let copy = await tx.weeklyTask.findUnique({ where: { seriesId_trackerId: { seriesId: task.seriesId, trackerId: target.id } } })
  if (copy) {
    await tx.$queryRaw`SELECT id FROM "WeeklyTask" WHERE id=${copy.id} FOR UPDATE`
    copy = await tx.weeklyTask.findUniqueOrThrow({ where: { id: copy.id } })
    if (copy.ownerId !== task.ownerId || copy.carriedFromId !== task.id) unavailable()
    if (!requested || copy.deletedAt) {
      const used = copy.revision !== 0 || copy.status !== 'PENDING' || copy.carryRequested
        || await tx.taskComment.count({ where: { weeklyTaskId: copy.id } })
        || await tx.approvalRequest.count({ where: { weeklyTaskId: copy.id } })
        || await tx.weeklyTask.count({ where: { carriedFromId: copy.id } })
      if (used) throw new TaskFailure('CARRY_IN_USE', 409)
      await tx.weeklyTask.update({ where: { id: copy.id }, data: { deletedAt: requested ? null : at } })
    }
  } else if (requested) {
    copy = await tx.weeklyTask.create({ data: { ownerId: task.ownerId, seriesId: task.seriesId, trackerId: target.id, carriedFromId: task.id,
      title: task.title, activity: task.activity, startsOn: next, endsOn: task.endsOn > friday ? task.endsOn : friday, createdAt: at } })
  } else unavailable()
  return copy?.id ?? null
}
async function submit(tx: Tx, task: WeeklyTask, start: Date, fresh: Awaited<ReturnType<typeof principal>>, at: Date, role: OwnTaskRole) {
  const automatic = role === 'LINE_MANAGER'
  const managerId = automatic ? null : fresh.assignment.managerId
  let reviewer: { id: string; businessId: string } | null = null
  if (!automatic) {
    if (!managerId) throw new TaskFailure('MANAGER_UNAVAILABLE', 409)
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${managerId} FOR SHARE`
    await tx.$queryRaw`SELECT id FROM "EmploymentAssignment" WHERE "userId"=${managerId} AND "effectiveTo" IS NULL ORDER BY id FOR SHARE`
    const manager = await tx.user.findFirst({ where: { id: managerId, accountStatus: 'ACTIVE' }, include: { assignments: { where: { effectiveFrom: { lte: at }, effectiveTo: null } } } })
    const assignment = manager?.assignments.length === 1 ? manager.assignments[0] : null
    if (assignment?.role !== 'LINE_MANAGER' || !assignment.businessId || assignment.businessId !== fresh.assignment.businessId) throw new TaskFailure('MANAGER_UNAVAILABLE', 409)
    reviewer = { id: assignment.id, businessId: assignment.businessId }
  }
  const latest = await tx.approvalRequest.aggregate({ where: { weeklyTaskId: task.id }, _max: { attemptNumber: true } })
  const request = await tx.approvalRequest.create({ data: { weeklyTaskId: task.id, attemptNumber: (latest._max.attemptNumber ?? 0) + 1,
    submittedById: task.ownerId, submissionAssignmentId: fresh.assignment.id, assignedManagerId: managerId, submittedAt: at, state: automatic ? 'DECIDED' : 'PENDING',
    submissionSnapshot: { version: 1, title: task.title, activity: task.activity, startsOn: isoDay(task.startsOn), endsOn: isoDay(task.endsOn), ownerId: task.ownerId,
      ownerDisplayName: fresh.person.name?.trim() || 'Staff member', weekStartsOn: isoDay(start), status: 'AWAITING_APPROVAL' } } })
  if (automatic) await tx.approvalDecision.create({ data: { requestId: request.id, decision: 'APPROVE', method: 'AUTOMATIC', decidedAt: at } })
  else if (reviewer) await recordApprovalRequested(tx, request, reviewer, fresh.person.name?.trim() || 'Staff member', task.title)
  return request.id
}

export async function mutateTask(db: PrismaClient, context: SessionContext, sessionId: string, requestId: string, op: TaskOperation, role: OwnTaskRole = 'EMPLOYEE') {
  const request = operationRequest(op, role)
  const hash = createHash('sha256').update(JSON.stringify({ kind: op.kind, path: request.path, body: request.body, revision: request.revision ?? null })).digest('hex')
  for (let attempt = 0; ; attempt++) {
    try {
      const result = await db.$transaction(async (tx) => {
        await lockPrincipal(tx, context, sessionId)
        let fresh = await principal(tx, context, sessionId, await databaseClock(tx), role)
        const oldReceipt = await tx.taskMutationReceipt.findUnique({ where: { userId_requestId: { userId: context.user.id, requestId } } })
        if (oldReceipt) {
          if (oldReceipt.requestHash !== hash || oldReceipt.operation !== op.kind) throw new TaskFailure('IDEMPOTENCY_CONFLICT', 409)
          return receipt(oldReceipt.result, requestId, op, oldReceipt.taskId)
        }
        const userId = context.user.id
        let old: WeeklyTask | null = null
        let start: Date
        if (op.kind === 'CREATE') start = day(op.week)
        else {
          const found = await tx.weeklyTask.findFirst({ where: { id: op.taskId, ownerId: userId, deletedAt: null, tracker: { userId } }, include: { tracker: { include: { week: true } } } })
          if (!found) throw new EmployeeFailure('NOT_FOUND', 404)
          start = found.tracker.week.startsOn
        }
        const managerId = role === 'EMPLOYEE' ? fresh.assignment.managerId : null
        if (managerId && (op.kind === 'COMMENT' || (op.kind === 'STATUS' && op.status === 'COMPLETED')
          || (op.kind === 'EDIT' && op.draft.status === 'COMPLETED'))) {
          await lockEmployeeReviewRecipients(tx, managerId, await databaseClock(tx))
        }
        const week = await ensureWeek(tx, start)
        if (op.kind !== 'CREATE') {
          await tx.$queryRaw`SELECT id FROM "WeeklyTask" WHERE id=${op.taskId} AND "ownerId"=${userId} FOR UPDATE`
          old = await tx.weeklyTask.findFirst({ where: { id: op.taskId, ownerId: userId, deletedAt: null, tracker: { userId } } })
          if (!old) throw new EmployeeFailure('NOT_FOUND', 404)
        }
        const changingCarry = op.kind === 'CREATE' ? op.draft.carryRequested : op.kind === 'EDIT' ? op.draft.carryRequested !== old?.carryRequested : op.kind === 'CARRY' && op.carryRequested !== old?.carryRequested
        if (changingCarry) {
          const next = shiftDay(start, 7)
          if (isoDay(shiftDay(next, 4)) > '9999-12-31') throw new TaskFailure('INVALID_INPUT', 400)
          const nextWeek = await ensureWeek(tx, next)
          if (old) await tx.$queryRaw`SELECT t.id FROM "WeeklyTask" t JOIN "WeeklyTracker" r ON r.id=t."trackerId" WHERE t."seriesId"=${old.seriesId} AND r."weekId"=${nextWeek.id} ORDER BY t.id FOR UPDATE OF t`
        }
        const at = await databaseClock(tx)
        fresh = await principal(tx, context, sessionId, at, role)
        const state = await employeeCalendar(tx, context, at, start, fresh.assignment)
        if (op.kind === 'CREATE' && isoDay(start) !== isoDay(monday(at))) throw new TaskFailure('WEEK_CHANGED', 409)
        if (isoDay(start) !== isoDay(monday(at)) || at >= week.freezesAt) throw new TaskFailure('TASK_LOCKED', 423)
        if (state.leave.paused) throw new TaskFailure('ON_LEAVE', 423)
        const captured = await tx.weeklyTracker.findUnique({ where: { userId_weekId: { userId, weekId: week.id } }, select: { snapshotAt: true } })
        if (captured?.snapshotAt) throw new TaskFailure('TASK_LOCKED', 423)
        if (old && op.kind !== 'CREATE' && op.kind !== 'COMMENT' && old.revision !== op.revision) throw new TaskFailure('STALE_TASK', 409)
        if (old?.status === 'APPROVED' && op.kind !== 'COMMENT') throw new TaskFailure('TASK_LOCKED', 423)
        const review = old ? await pending(tx, old, role) : null
        let requiresPlanning = op.kind === 'CREATE'
        let task: WeeklyTask, changed = false, continuationId: string | null = null, commentId: string | null = null, approvalRequestId: string | null = null
        if (op.kind === 'CREATE') {
          if (!state.week?.planningOpen) throw new TaskFailure('TASK_LOCKED', 423)
          validateTaskDates(op.draft, start)
          const target = await tracker(tx, userId, week.id, fresh)
          const series = await tx.taskSeries.create({ data: { ownerId: userId, createdAt: at } })
          task = await tx.weeklyTask.create({ data: { seriesId: series.id, trackerId: target.id, ownerId: userId, ...op.draft, startsOn: day(op.draft.startsOn), endsOn: day(op.draft.endsOn), status: 'PENDING', createdAt: at } })
          changed = true
          if (task.carryRequested) continuationId = await carry(tx, task, start, fresh, true, at)
        } else {
          if (!old) return unavailable()
          task = old
          const patch: Prisma.WeeklyTaskUncheckedUpdateInput = {}
          if (op.kind === 'COMMENT') {
            const comment = await tx.taskComment.create({ data: { weeklyTaskId: task.id, authorId: userId, body: op.body, createdAt: at } })
              if (role === 'EMPLOYEE') await recordEmployeeReply(tx, task, comment, fresh.assignment, fresh.person.name?.trim() || 'Staff member')
            commentId = comment.id
            changed = true
          } else {
            let desired = op.kind === 'EDIT' ? op.draft.status : op.kind === 'STATUS' ? op.status : undefined
            const reason = op.kind === 'EDIT' ? op.draft.blockerReason : op.kind === 'STATUS' ? op.blockerReason : undefined
            let planningChange = op.kind === 'DELETE'
            if (op.kind === 'EDIT') {
              validateTaskDates(op.draft, start, old)
              planningChange = op.draft.title !== old.title || op.draft.startsOn !== isoDay(old.startsOn) || op.draft.endsOn !== isoDay(old.endsOn) || op.draft.carryRequested !== old.carryRequested
              if (op.draft.title !== old.title) patch.title = op.draft.title
              if (op.draft.activity !== old.activity) patch.activity = op.draft.activity
              if (op.draft.startsOn !== isoDay(old.startsOn)) patch.startsOn = day(op.draft.startsOn)
              if (op.draft.endsOn !== isoDay(old.endsOn)) patch.endsOn = day(op.draft.endsOn)
              if (op.draft.carryRequested !== old.carryRequested) patch.carryRequested = op.draft.carryRequested
            }
            if (op.kind === 'CARRY' && op.carryRequested !== old.carryRequested) {
              validateTaskDates({ title: old.title, activity: old.activity, startsOn: isoDay(old.startsOn), endsOn: isoDay(old.endsOn), carryRequested: op.carryRequested }, start, old)
              patch.carryRequested = op.carryRequested
              planningChange = true
            }
            if (planningChange && !state.week?.planningOpen) throw new TaskFailure('TASK_LOCKED', 423)
            requiresPlanning = planningChange
            if (op.kind === 'DELETE') patch.deletedAt = at
            const contentChanged = Object.keys(patch).length > 0
            if (old.status === 'AWAITING_APPROVAL' && desired === 'COMPLETED' && contentChanged) throw new TaskFailure('SAVE_BEFORE_RESUBMIT', 409)
            if (old.status === 'AWAITING_APPROVAL' && contentChanged && (!desired || desired === 'COMPLETED')) desired = 'PENDING'
            if (desired === 'BLOCKED') {
              if (!reason) throw new TaskFailure('INVALID_INPUT', 400, { blockerReason: 'Enter a blocker reason.' })
              if (old.blockerReason !== reason) patch.blockerReason = reason
            } else if (desired && old.blockerReason !== null) patch.blockerReason = null
            if (desired && !(desired === 'COMPLETED' && old.status === 'AWAITING_APPROVAL')) {
              const status = desired === 'COMPLETED' ? (role === 'LINE_MANAGER' ? 'APPROVED' : 'AWAITING_APPROVAL') : desired
              if (status !== old.status) patch.status = status
            }
            changed = Object.keys(patch).length > 0
            if (changed) {
              if (review) await tx.approvalRequest.update({ where: { id: review.id }, data: { state: 'WITHDRAWN' } })
              task = await tx.weeklyTask.update({ where: { id: old.id }, data: { ...patch, revision: { increment: 1 } } })
              if (patch.carryRequested !== undefined) continuationId = await carry(tx, task, start, fresh, task.carryRequested, at)
              if (desired === 'COMPLETED') approvalRequestId = await submit(tx, task, start, fresh, at, role)
            }
          }
          if (changed) await tracker(tx, userId, week.id, fresh)
        }
        const result: MutationResult = { version: 1, requestId, operation: op.kind, taskId: task.id, taskRevision: task.revision, continuationId, commentId, approvalRequestId, appliedAt: at.toISOString(), changed, replayed: false }
        if (changed) await tx.auditEvent.create({ data: { actorId: userId, action: `${role}_TASK_${op.kind}`, targetType: 'WeeklyTask', targetId: task.id,
          ...(old ? { before: safe(old) } : {}), after: { ...safe(task), requestId, continuationId, commentId, approvalRequestId }, createdAt: at } })
        const { replayed: _replayed, ...stored } = result
        await tx.taskMutationReceipt.create({ data: { userId, requestId, operation: op.kind, requestHash: hash, taskId: task.id, result: stored, createdAt: at } })
        if (role === 'LINE_MANAGER') {
          const latest = await databaseClock(tx)
          const current = await principal(tx, context, sessionId, latest, role)
          const calendar = await employeeCalendar(tx, context, latest, start, current.assignment)
          if (isoDay(start) !== isoDay(monday(latest)) || latest >= week.freezesAt || (requiresPlanning && !calendar.week?.planningOpen)) throw new TaskFailure('TASK_LOCKED', 423)
          if (calendar.leave.paused) throw new TaskFailure('ON_LEAVE', 423)
        }
        return result
      }, { isolationLevel: 'ReadCommitted', maxWait: 5000, timeout: 15000 })
      if (role === 'EMPLOYEE' && (result.approvalRequestId || result.commentId) && !result.replayed) requestEmailPass()
      return result
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : null
      const sqlCode = databaseErrorCode(error)
      if (attempt < 2 && (['P2034', 'P2002'].includes(String(code)) || sqlCode === '40P01' || sqlCode === '40001')) continue
      throw error
    }
  }
}
