import { createHash } from 'node:crypto'
import { Prisma } from '../../src/generated/prisma/client.ts'
import type { PrismaClient } from '../../src/generated/prisma/client.ts'
import type { ReviewCommand, ReviewItem, ReviewReceipt } from '../../src/features/line-manager/approvals-contracts.ts'
import { wellFormed } from '../../src/features/auth/contracts.ts'
import { AuthFailure } from '../auth/errors.ts'
import { withKnownRollbackRetry } from '../auth/owner-write.ts'
import type { Actor } from '../auth/owner-write.ts'
import { databaseClock } from '../db.ts'
import { EmployeeFailure, monday } from '../employee/calendar.ts'
import { snapshotContext } from '../employee/history-evidence.ts'
import { parseOperation, taskIdentity, TaskFailure } from '../employee/task-validation.ts'
import { recordApprovalOutcome, recordManagerComment } from '../notifications/events.ts'
import { exactReview, pendingAuthority, reviewerScope } from './review-scope.ts'
import type { ReviewSource } from './review-scope.ts'
import { effective, managerPrincipal } from './scope.ts'
import type { Tx } from './scope.ts'
import { ManagerFailure } from './writes.ts'

const invalid = () => new EmployeeFailure('INVALID_INPUT', 400)
const notFound = () => new EmployeeFailure('NOT_FOUND', 404)
const unavailable = () => new AuthFailure('SERVICE_UNAVAILABLE', 503)
const stale = () => new TaskFailure('STALE_TASK', 409)

function input(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length
    || keys.some((key) => !Object.hasOwn(value, key))) throw invalid()
  return value as Record<string, unknown>
}

function revision(value: unknown) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 2147483647) throw invalid()
  return value
}

export function approvalInput(action: 'approve' | 'decline' | 'comments' | 'batch', id: unknown, body: unknown): ReviewCommand {
  if (action === 'batch') {
    const { items } = input(body, ['items'])
    if (!Array.isArray(items) || !items.length || items.length > 25) throw invalid()
    const entries = items.map((value) => {
      const { requestId, expectedTaskRevision } = input(value, ['requestId', 'expectedTaskRevision'])
      return { requestId: taskIdentity(requestId), expectedTaskRevision: revision(expectedTaskRevision) }
    }).sort((a, b) => a.requestId.localeCompare(b.requestId))
    if (new Set(entries.map(({ requestId }) => requestId)).size !== entries.length) throw invalid()
    return { operation: 'LM_APPROVE_BATCH', items: entries }
  }
  const requestId = taskIdentity(id)
  if (action === 'comments') {
    const command = parseOperation('COMMENT', requestId, body, undefined)
    if (command.kind !== 'COMMENT') throw invalid()
    return { operation: 'LM_TASK_COMMENT', requestId, body: command.body }
  }
  const fields = input(body, action === 'approve' ? ['expectedTaskRevision'] : ['expectedTaskRevision', 'reason'])
  const expectedTaskRevision = revision(fields.expectedTaskRevision)
  if (action === 'approve') return { operation: 'LM_APPROVE', requestId, expectedTaskRevision }
  const reason = typeof fields.reason === 'string' ? fields.reason.trim() : ''
  if (reason.length < 10 || reason.length > 2000 || reason.includes('\0') || !wellFormed(reason)) {
    throw new TaskFailure('INVALID_INPUT', 400, { reason: 'Enter a reason of 10 to 2,000 characters.' })
  }
  return { operation: 'LM_DECLINE', requestId, expectedTaskRevision, reason }
}

function exactIds(command: ReviewCommand) {
  return command.operation === 'LM_APPROVE_BATCH' ? command.items.map(({ requestId }) => requestId) : [command.requestId]
}

function safeReceipt(value: Prisma.JsonValue, command: ReviewCommand, requestId: string): ReviewReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 1 || value.changed !== true
    || value.operation !== command.operation || value.requestId !== requestId || typeof value.appliedAt !== 'string') throw unavailable()
  const base = { version: 1 as const, changed: true as const, operation: command.operation, requestId, appliedAt: value.appliedAt }
  if (command.operation === 'LM_TASK_COMMENT') {
    if (value.approvalRequestId !== command.requestId || typeof value.taskId !== 'string' || typeof value.commentId !== 'string') throw unavailable()
    return { ...base, approvalRequestId: command.requestId, taskId: value.taskId, commentId: value.commentId }
  }
  const ids = exactIds(command)
  if (!Array.isArray(value.items) || value.items.length !== ids.length) throw unavailable()
  const items = value.items.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item) || item.approvalRequestId !== ids[index] || typeof item.decisionId !== 'string'
      || typeof item.taskId !== 'string' || typeof item.taskRevision !== 'number' || !Number.isSafeInteger(item.taskRevision)) throw unavailable()
    return { approvalRequestId: ids[index], decisionId: item.decisionId, taskId: item.taskId, taskRevision: item.taskRevision }
  })
  return { ...base, items }
}

async function lockReview(tx: Tx, actor: Actor, ids: string[]) {
  const userId = actor.context.user.id
  const subjects = await tx.approvalRequest.findMany({ where: { id: { in: ids } }, select: {
    submittedById: true, assignedManagerId: true, weeklyTaskId: true, task: { select: { tracker: { select: { weekId: true } } } },
  } })
  const owners = [...new Set(subjects.map(({ submittedById }) => submittedById))].sort()
  if (owners.length > 1) {
    const principal = await managerPrincipal(tx, actor)
    const scope = await reviewerScope(tx, userId, principal.at)
    for (const id of ids) {
      const row = await exactReview(tx, id, principal.at)
      if (!row || pendingAuthority(scope, row, 'read').state !== 'ALLOWED') throw notFound()
    }
    throw invalid()
  }
  const source = owners[0]
  if (source) await tx.$queryRaw`SELECT id FROM "User" WHERE id=${source} FOR UPDATE`
  const routed = await tx.approvalRequest.findMany({ where: { id: { in: ids } }, select: { assignedManagerId: true } })
  const covered = [...new Set(routed.flatMap(({ assignedManagerId }) => assignedManagerId && assignedManagerId !== userId ? [assignedManagerId] : []))].sort()
  if (covered.length) await tx.$queryRaw`SELECT id FROM "User" WHERE id IN (${Prisma.join(covered)}) ORDER BY id FOR SHARE`
  await tx.$queryRaw`SELECT id FROM "User" WHERE id=${userId} FOR SHARE`
  await tx.$queryRaw`SELECT id FROM "AuthSession" WHERE id=${actor.sessionId} AND "userId"=${userId} FOR SHARE`
  await tx.$queryRaw`SELECT id FROM "AuthUser" WHERE id=${userId} FOR SHARE`
  const people = [userId, ...(source ? [source] : []), ...covered]
  await tx.$queryRaw`SELECT id FROM "EmploymentAssignment" WHERE "userId" IN (${Prisma.join(people)}) ORDER BY id FOR SHARE`
  await tx.$queryRaw`SELECT id FROM "LeaveRecord" WHERE "userId" IN (${Prisma.join(people)}) ORDER BY id FOR SHARE`
  if (!subjects.length) return
  const weeks = [...new Set(subjects.map(({ task }) => task.tracker.weekId))]
  await tx.$queryRaw`SELECT id FROM "WorkWeek" WHERE id IN (${Prisma.join(weeks)}) ORDER BY id FOR SHARE`
  await tx.$queryRaw`SELECT id FROM "WeeklyTask" WHERE id IN (${Prisma.join(subjects.map(({ weeklyTaskId }) => weeklyTaskId))}) ORDER BY id FOR UPDATE`
  await tx.$queryRaw`SELECT id FROM "ApprovalRequest" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`
  if (covered.length) await tx.$queryRaw`SELECT id FROM "ReliefAssignment" WHERE "coveredManagerId" IN (${Prisma.join(covered)}) ORDER BY id FOR SHARE`
}

function allowed(state: ReturnType<typeof pendingAuthority>): asserts state is Extract<typeof state, { state: 'ALLOWED' }> {
  if (state.state === 'ALLOWED') return
  if (state.state === 'PAUSED') throw new ManagerFailure('WORK_CLOSED')
  if (state.state === 'STALE') throw stale()
  if (state.state === 'UNAVAILABLE') throw unavailable()
  throw notFound()
}

async function assertFrozenEvidence(tx: Tx, row: ReviewSource, at: Date) {
  const tracker = row.task.tracker, week = tracker.week
  if (at < week.freezesAt) return
  const days = tracker.expectedWorkingDaysSnapshot
  if (!tracker.snapshotAt || tracker.snapshotAt < week.freezesAt || !snapshotContext(tracker.contextSnapshot, row.submittedById)
    || days === null || days < 0 || days > 5 || !Number.isInteger(days)) throw unavailable()
  if (week.historySnapshot && !await tx.historyTaskSnapshot.findFirst({ where: {
    id: row.task.id, historyWeekId: week.historySnapshot.id, ownerId: row.submittedById,
  }, select: { id: true } })) throw unavailable()
}

function assertConversation(row: ReviewSource, at: Date) {
  const { week } = row.task.tracker
  if (week.startsOn.getTime() !== monday(at).getTime() || at >= week.freezesAt || row.task.tracker.snapshotAt) throw new ManagerFailure('WORK_CLOSED')
}

export async function mutateApproval(db: PrismaClient, actor: Actor, requestId: string, command: ReviewCommand) {
  const ids = exactIds(command)
  const hash = createHash('sha256').update(JSON.stringify(['approval', command])).digest('hex')
  return withKnownRollbackRetry(db, async (tx) => {
    await lockReview(tx, actor, ids)
    const principal = await managerPrincipal(tx, actor)
    const { userId, at } = principal
    const previous = await tx.sharedMutationReceipt.findUnique({ where: { userId_requestId: { userId, requestId } } })
    if (previous) {
      if (previous.operation !== command.operation || previous.requestHash !== hash) throw new ManagerFailure('IDEMPOTENCY_CONFLICT')
      return { result: safeReceipt(previous.result, command, requestId), replayed: true }
    }
    const scope = await reviewerScope(tx, userId, at)
    const rows = []
    const revisions: ReviewItem[] = command.operation === 'LM_APPROVE_BATCH' ? command.items : command.operation === 'LM_TASK_COMMENT' ? [] : [command]
    for (const [index, id] of ids.entries()) {
      const row = await exactReview(tx, id, at)
      if (!row) throw notFound()
      const authority = pendingAuthority(scope, row, 'write')
      allowed(authority)
      if (command.operation === 'LM_TASK_COMMENT') assertConversation(row, at)
      else {
        if (row.task.revision !== revisions[index]?.expectedTaskRevision) throw stale()
        await assertFrozenEvidence(tx, row, at)
      }
      rows.push({ row, authority })
    }
    const base = { version: 1 as const, operation: command.operation, requestId, appliedAt: at.toISOString(), changed: true as const }
    let result: ReviewReceipt
    if (command.operation === 'LM_TASK_COMMENT') {
      const { row, authority } = rows[0]
      const comment = await tx.taskComment.create({ data: { weeklyTaskId: row.task.id, authorId: userId, body: command.body, createdAt: at } })
      const basis = authority.route.reliefId
        ? { version: 1 as const, relationship: 'RELIEF_COMMENT_OWNER' as const, sourceUserId: row.submittedById, sourceAssignmentId: authority.employee.id,
          businessId: authority.route.businessId, coveredManagerId: authority.route.managerId, reliefAssignmentId: authority.route.reliefId, requestingManagerId: userId }
        : { version: 1 as const, relationship: 'TASK_COMMENT_OWNER' as const, sourceUserId: row.submittedById, sourceAssignmentId: authority.employee.id,
          requestingManagerId: userId, businessId: authority.route.businessId }
      await recordManagerComment(tx, basis, comment, row.task, principal.staff.person.name?.trim() || 'Your reviewer', row.id)
      await tx.auditEvent.create({ data: { actorId: userId, action: 'MANAGER_TASK_COMMENTED', targetType: 'TaskComment', targetId: comment.id,
        createdAt: at, after: { taskId: row.task.id, approvalRequestId: row.id } } })
      result = { ...base, approvalRequestId: row.id, taskId: row.task.id, commentId: comment.id }
    } else {
      const items: Extract<ReviewReceipt, { items: unknown }>['items'] = []
      const kind = command.operation === 'LM_DECLINE' ? 'DECLINE' : 'APPROVE'
      const reason = command.operation === 'LM_DECLINE' ? command.reason : null
      for (const { row, authority } of rows) {
        const { route, submitted } = authority
        const decision = await tx.approvalDecision.create({ data: { requestId: row.id, actorId: userId, method: 'HUMAN', decision: kind, reason,
          actingForManagerId: route.reliefId ? route.managerId : null, reliefAssignmentId: route.reliefId, decidedAt: at } })
        await tx.approvalRequest.update({ where: { id: row.id }, data: { state: 'DECIDED' } })
        const task = await tx.weeklyTask.update({ where: { id: row.task.id }, data: {
          status: kind === 'APPROVE' ? 'APPROVED' : 'DECLINED', revision: { increment: 1 }, updatedAt: at,
        }, select: { revision: true } })
        await tx.auditEvent.create({ data: { actorId: userId, action: 'MANAGER_APPROVAL_DECIDED', targetType: 'ApprovalDecision', targetId: decision.id,
          createdAt: at, after: { approvalRequestId: row.id, taskId: row.task.id, decision: kind, reliefAssignmentId: route.reliefId } } })
        await recordApprovalOutcome(tx, row, decision, submitted.title)
        items.push({ approvalRequestId: row.id, decisionId: decision.id, taskId: row.task.id, taskRevision: task.revision })
      }
      result = { ...base, items }
    }
    await tx.sharedMutationReceipt.create({ data: { userId, requestId, requestHash: hash, operation: command.operation, result, createdAt: at } })
    const final = await managerPrincipal(tx, actor)
    const finalScope = await reviewerScope(tx, userId, final.at)
    const latest = await databaseClock(tx)
    if (latest >= new Date(actor.context.session.expiresAt)) throw new AuthFailure('SESSION_REQUIRED', 401)
    if (finalScope.paused) throw new ManagerFailure('WORK_CLOSED')
    if (finalScope.transitions.some((boundary) => boundary > final.at && boundary <= latest)) throw new ManagerFailure('WORK_CLOSED')
    for (const { row, authority } of rows) {
      const route = finalScope.routes.get(authority.route.managerId)
      if (route?.reliefId !== authority.route.reliefId || route.businessId !== authority.route.businessId) throw notFound()
      const assignment = await tx.employmentAssignment.findFirst({ where: { id: authority.employee.id, ...effective(latest) }, select: { id: true } })
      if (!assignment) throw notFound()
      if (command.operation === 'LM_TASK_COMMENT') assertConversation(row, latest)
      else if (at < row.task.tracker.week.freezesAt && latest >= row.task.tracker.week.freezesAt) throw unavailable()
    }
    return { result, replayed: false }
  })
}

// The assignment writer owns the employee mutex and the assignment transaction.
export async function reroutePendingRequests(tx: Tx, employeeId: string, assignmentId: string, actorId: string) {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id=${employeeId} FOR UPDATE`
  const at = await databaseClock(tx)
  const assignments = await tx.employmentAssignment.findMany({ where: { userId: employeeId, ...effective(at), user: { accountStatus: 'ACTIVE' } }, take: 2 })
  const assignment = assignments.length === 1 ? assignments[0] : null
  if (assignment?.id !== assignmentId || assignment.role !== 'EMPLOYEE' || !assignment.managerId || !assignment.businessId) throw notFound()
  const scope = await reviewerScope(tx, assignment.managerId, at)
  if (scope.assignment?.businessId !== assignment.businessId) throw notFound()
  const pending = await tx.approvalRequest.findMany({ where: { submittedById: employeeId, state: 'PENDING', decision: null,
    task: { ownerId: employeeId, deletedAt: null, status: 'AWAITING_APPROVAL' } }, orderBy: { id: 'asc' } })
  for (const request of pending) {
    if (request.assignedManagerId === assignment.managerId) continue
    await tx.approvalRequest.update({ where: { id: request.id }, data: { assignedManagerId: assignment.managerId } })
    await tx.auditEvent.create({ data: { actorId, action: 'APPROVAL_REQUEST_REROUTED', targetType: 'ApprovalRequest', targetId: request.id,
      createdAt: at, before: { assignedManagerId: request.assignedManagerId }, after: { assignedManagerId: assignment.managerId, assignmentId } } })
  }
}
