import { Prisma } from '../../src/generated/prisma/client.ts'
import { wellFormed } from '../../src/features/auth/contracts.ts'
import type { SubmittedWork } from '../../src/features/line-manager/approvals-contracts.ts'
import { isoDay, watCalendarDay, watMidnight } from '../data-model/calendar.ts'
import { parseDay } from '../employee/calendar.ts'
import { currentLeave } from '../employee/leave-state.ts'
import { snapshotContext } from '../employee/history-evidence.ts'
import { taskTextLimits, validTaskText } from '../employee/task-validation.ts'
import { effective } from './scope.ts'
import type { Tx } from './scope.ts'

export function reviewInclude(at: Date) {
  return {
    decision: { include: { actor: { select: { name: true } }, principal: { select: { name: true } } } },
    submitter: { select: { accountStatus: true, name: true, assignments: { where: effective(at), take: 2, include: { unit: true } } } },
    task: { include: { approvals: { orderBy: { attemptNumber: 'desc' }, take: 1, select: { id: true } },
      tracker: { include: { week: { include: { historySnapshot: { select: { id: true } } } } } } } },
  } satisfies Prisma.ApprovalRequestInclude
}
export type ReviewSource = Prisma.ApprovalRequestGetPayload<{ include: ReturnType<typeof reviewInclude> }>

export async function decisionReadiness(tx: Tx, rows: ReviewSource[], at: Date) {
  const archived = rows.filter(({ task: { tracker: { week } } }) => week.freezesAt <= at && week.historySnapshot)
  const archiveTasks = archived.length ? await tx.historyTaskSnapshot.findMany({ where: {
    id: { in: archived.map(({ task }) => task.id) },
  }, select: { id: true, ownerId: true, historyWeekId: true } }) : []
  const byTask = new Map(archiveTasks.map((row) => [row.id, row]))
  return new Set(rows.filter(({ task, submittedById }) => {
    const { tracker } = task
    const { week } = tracker
    if (at < week.freezesAt) return true
    const days = tracker.expectedWorkingDaysSnapshot
    if (!tracker.snapshotAt || tracker.snapshotAt < week.freezesAt || !snapshotContext(tracker.contextSnapshot, submittedById)
      || days === null || days < 0 || days > 5 || !Number.isInteger(days)) return false
    if (!week.historySnapshot) return true
    const saved = byTask.get(task.id)
    return saved?.ownerId === submittedById && saved.historyWeekId === week.historySnapshot.id
  }).map(({ id }) => id))
}
type Route = { managerId: string; businessId: string; managerName: string; reliefId: string | null }

export async function reviewerScope(tx: Tx, actorId: string, at: Date) {
  const today = watCalendarDay(at)
  const actor = await tx.user.findUnique({ where: { id: actorId }, select: { accountStatus: true, name: true,
    assignments: { where: effective(at), take: 2 } } })
  const assignment = actor?.assignments.length === 1 ? actor.assignments[0] : null
  const routes = new Map<string, Route>()
  const unavailableRoutes = new Map<string, string>()
  const transitions: Date[] = []
  if (actor?.accountStatus !== 'ACTIVE' || assignment?.role !== 'LINE_MANAGER' || !assignment.businessId) {
    return { at, actorId, assignment: null, routes, unavailableRoutes, transitions, paused: false }
  }
  routes.set(actorId, { managerId: actorId, businessId: assignment.businessId, managerName: actor.name?.trim() || 'Staff member', reliefId: null })
  if (assignment.effectiveTo) transitions.push(assignment.effectiveTo)
  const covers = await tx.reliefAssignment.findMany({
    where: { coveredManagerId: { not: actorId }, createdAt: { lte: at }, endsOn: { gt: today },
      OR: [{ endedAt: null }, { endedAt: { gt: at } }], manager: { accountStatus: 'ACTIVE' },
      leave: { OR: [{ cancelledAt: null }, { cancelledAt: { gt: at } }] },
      AND: [{ OR: [{ reliefManagerId: actorId }, { manager: { coveredLeaves: { some: { reliefManagerId: actorId, endsOn: { gt: today } } } } }] }],
    },
    include: { leave: true, manager: { select: { name: true, assignments: { where: effective(at), take: 2 } } } },
  })
  const active = new Map<string, typeof covers>()
  for (const cover of covers) {
    const leave = cover.leave
    const end = leave.actualReturnOn ?? leave.expectedReturnOn
    if (leave.userId !== cover.coveredManagerId || leave.createdAt > at) continue
    transitions.push(...[cover.startsOn, cover.endsOn, leave.startsOn, end].map(watMidnight))
    if (cover.endedAt) transitions.push(cover.endedAt)
    if (leave.cancelledAt) transitions.push(leave.cancelledAt)
    if (cover.startsOn > today || leave.startsOn > today || end <= today) continue
    const entries = active.get(cover.coveredManagerId) ?? []
    entries.push(cover)
    active.set(cover.coveredManagerId, entries)
  }
  for (const [managerId, rows] of active) {
    const cover = rows.find((row) => row.reliefManagerId === actorId)
    if (!cover) continue
    const covered = cover.manager.assignments.length === 1 ? cover.manager.assignments[0] : null
    if (covered?.role !== 'LINE_MANAGER' || !covered.businessId) continue
    if (covered.effectiveTo) transitions.push(covered.effectiveTo)
    if (rows.length !== 1) unavailableRoutes.set(managerId, covered.businessId)
    else routes.set(managerId, { managerId, businessId: covered.businessId, managerName: cover.manager.name?.trim() || 'Staff member', reliefId: cover.id })
  }
  const leave = await currentLeave(tx, actorId, at)
  transitions.push(new Date(leave.nextChangeAt))
  return { at, actorId, assignment, routes, unavailableRoutes, transitions, paused: leave.state === 'ON_LEAVE' || leave.state === 'REPAIR_REQUIRED' }
}
export type ReviewerScope = Awaited<ReturnType<typeof reviewerScope>>

export const submittedOwnerNameLimit = 160

export function submittedWork(row: ReviewSource): SubmittedWork | null {
  const value = row.submissionSnapshot
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 1 || value.ownerId !== row.submittedById
    || row.task.ownerId !== row.submittedById || row.task.tracker.userId !== row.submittedById
    || value.status !== 'AWAITING_APPROVAL' || !validTaskText(value.title, taskTextLimits.title) || !validTaskText(value.activity, taskTextLimits.activity)
    || typeof value.ownerDisplayName !== 'string' || value.ownerDisplayName.length > submittedOwnerNameLimit * 2 || !value.ownerDisplayName.trim()
    || value.ownerDisplayName.includes('\0') || !wellFormed(value.ownerDisplayName) || [...value.ownerDisplayName].length > submittedOwnerNameLimit
    || typeof value.startsOn !== 'string' || typeof value.endsOn !== 'string' || value.startsOn > value.endsOn
    || value.weekStartsOn !== isoDay(row.task.tracker.week.startsOn)) return null
  try { parseDay(value.startsOn); parseDay(value.endsOn) } catch { return null }
  return { title: value.title, activity: value.activity, startsOn: value.startsOn, endsOn: value.endsOn,
    ownerId: row.submittedById, ownerName: value.ownerDisplayName, week: value.weekStartsOn }
}

export function pendingAuthority(scope: ReviewerScope, row: ReviewSource, purpose: 'read' | 'write' | 'mail') {
  const employee = row.submitter.assignments.length === 1 ? row.submitter.assignments[0] : null
  if (row.submitter.accountStatus !== 'ACTIVE' || employee?.role !== 'EMPLOYEE' || !employee.managerId
    || !employee.businessId || !employee.unitId || row.task.ownerId !== row.submittedById
    || row.task.tracker.userId !== row.submittedById) return { state: 'OUTSIDE' } as const
  const route = scope.routes.get(employee.managerId)
  if (!route || route.businessId !== employee.businessId) {
    return { state: scope.unavailableRoutes.get(employee.managerId) === employee.businessId ? 'UNAVAILABLE' : 'OUTSIDE' } as const
  }
  if (row.assignedManagerId !== employee.managerId) return { state: route.reliefId ? 'OUTSIDE' : 'UNAVAILABLE' } as const
  if (row.state !== 'PENDING' || row.decision || row.task.deletedAt || row.task.status !== 'AWAITING_APPROVAL'
    || row.task.approvals[0]?.id !== row.id || row.submittedAt > scope.at) return { state: 'STALE' } as const
  const submitted = submittedWork(row)
  if (!submitted) return { state: 'UNAVAILABLE' } as const
  if (purpose !== 'read' && scope.paused) return { state: 'PAUSED' } as const
  return { state: 'ALLOWED', route, employee, submitted } as const
}

export async function exactReview(tx: Tx, requestId: string, at: Date) {
  return tx.approvalRequest.findUnique({ where: { id: requestId }, include: reviewInclude(at) })
}

export async function lockEmployeeReviewRecipients(tx: Tx, managerId: string, at: Date) {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id=${managerId} FOR UPDATE`
  const covers = await tx.reliefAssignment.findMany({ where: { coveredManagerId: managerId, endsOn: { gte: watCalendarDay(at) } },
    select: { reliefManagerId: true } })
  const officers = [...new Set(covers.map(({ reliefManagerId }) => reliefManagerId))].filter((id) => id !== managerId)
  if (officers.length) await tx.$queryRaw`SELECT id FROM "User" WHERE id IN (${Prisma.join(officers)}) ORDER BY id FOR SHARE`
  const people = Prisma.join([managerId, ...officers])
  await tx.$queryRaw`SELECT id FROM "EmploymentAssignment" WHERE "userId" IN (${people}) ORDER BY id FOR SHARE`
  await tx.$queryRaw`SELECT id FROM "LeaveRecord" WHERE "userId" IN (${people}) ORDER BY id FOR SHARE`
  await tx.$queryRaw`SELECT id FROM "ReliefAssignment" WHERE "coveredManagerId"=${managerId} ORDER BY id FOR SHARE`
}

export async function effectiveReviewOfficer(tx: Tx, row: ReviewSource, at: Date) {
  if (!row.assignedManagerId) return null
  const today = watCalendarDay(at)
  const candidates = await tx.reliefAssignment.findMany({ where: { coveredManagerId: row.assignedManagerId,
    startsOn: { lte: today }, endsOn: { gt: today }, createdAt: { lte: at }, OR: [{ endedAt: null }, { endedAt: { gt: at } }],
  }, orderBy: { id: 'asc' }, select: { id: true, reliefManagerId: true } })
  for (const candidate of candidates) {
    const scope = await reviewerScope(tx, candidate.reliefManagerId, at)
    const authority = pendingAuthority(scope, row, 'read')
    if (authority.state === 'ALLOWED' && authority.route.reliefId === candidate.id) return { ...candidate, authority }
  }
  return null
}
