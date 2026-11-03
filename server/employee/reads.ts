import type { Prisma, PrismaClient } from '../../src/generated/prisma/client.ts'
import type { SessionContext } from '../../src/features/auth/contracts.ts'
import type { DetailResponse, HomeResponse, Page, TaskEntry } from '../../src/features/employee/contracts.ts'
import { day, isoDay } from '../data-model/calendar.ts'
import { EmployeeFailure, leaveSummary, monday, nextChange, weekProjection } from './calendar.ts'
import type { readQuery } from './calendar.ts'
import type { WeekState } from '../../src/features/employee/contracts.ts'
import { taskPermissions } from './permissions.ts'
import { snapshotContext } from './history-evidence.ts'
import { currentLeave } from './leave-state.ts'

type Tx = Prisma.TransactionClient
type Query = ReturnType<typeof readQuery>
const taskSelect = {
  id: true, revision: true, title: true, activity: true, startsOn: true, endsOn: true, status: true,
  carryRequested: true, carriedFromId: true, blockerReason: true,
  tracker: { select: { snapshotAt: true, week: { select: { startsOn: true } } } },
  approvals: { where: { decision: { decision: 'DECLINE' } }, orderBy: { attemptNumber: 'desc' }, take: 1,
    select: { decision: { select: { reason: true } } } },
} satisfies Prisma.WeeklyTaskSelect
type TaskRow = Prisma.WeeklyTaskGetPayload<{ select: typeof taskSelect }>
function entry(row: TaskRow, week: WeekState | null, asOf: Date): TaskEntry {
  return {
    id: row.id, revision: row.revision, permissions: taskPermissions(row.status, row.tracker.snapshotAt, week, asOf), title: row.title, activity: row.activity, startsOn: isoDay(row.startsOn), endsOn: isoDay(row.endsOn),
    status: row.status, carryRequested: row.carryRequested, carriedFrom: !!row.carriedFromId,
    week: isoDay(row.tracker.week.startsOn),
    reason: row.status === 'BLOCKED' ? row.blockerReason : row.status === 'DECLINED' ? row.approvals[0]?.decision?.reason ?? null : null,
  }
}
const orderBy = [{ tracker: { week: { startsOn: 'asc' } } }, { startsOn: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }] satisfies Prisma.WeeklyTaskOrderByWithRelationInput[]
export function pageOffset(page: number, total: number) {
  return page > Math.max(1, Math.ceil(total / 25)) ? null : (page - 1) * 25
}
async function taskPage(tx: Tx, where: Prisma.WeeklyTaskWhereInput, page: number, week: WeekState | null, asOf: Date): Promise<Page<TaskEntry>> {
  const total = await tx.weeklyTask.count({ where })
  const skip = pageOffset(page, total)
  const items = skip === null ? [] : (await tx.weeklyTask.findMany({ where, select: taskSelect, orderBy, skip, take: 25 })).map((row) => entry(row, week, asOf))
  return { items, page, pageSize: 25, total }
}

export async function employeePrincipal(tx: Tx, context: SessionContext, asOf: Date) {
  // Recheck current authority inside the same snapshot as the private projection.
  const person = await tx.user.findFirst({ where: { id: context.user.id, accountStatus: 'ACTIVE' }, select: {
    name: true, email: true, authIdentity: { select: { email: true, provisionedAt: true } },
    assignments: { where: { effectiveFrom: { lte: asOf }, effectiveTo: null }, take: 2,
      include: { business: true, unit: true, manager: { select: { name: true } } } },
  } })
  if (!person || !person.authIdentity?.provisionedAt || person.email.trim().toLowerCase() !== person.authIdentity.email || person.assignments.length !== 1) throw new EmployeeFailure('SESSION_REQUIRED', 401)
  const assignment = person.assignments[0]
  if (assignment.role !== 'EMPLOYEE') throw new EmployeeFailure('FORBIDDEN', 403)
  if (!assignment.businessId || !assignment.unitId) throw new EmployeeFailure('SESSION_REQUIRED', 401)
  return { person, assignment }
}
export async function employeeCalendar(tx: Tx, context: SessionContext, asOf: Date, start: Date | null, assignment: Awaited<ReturnType<typeof employeePrincipal>>['assignment']) {
  const leave = leaveSummary(await tx.leaveRecord.findMany({ where: { userId: context.user.id, OR: [{ cancelledAt: null }, { cancelledAt: { gt: asOf } }] } }), asOf)
  let week = null
  let transitions = leave.transitions
  if (start) {
    const stored = await tx.workWeek.findUnique({ where: { startsOn: start } })
    const settings = stored ? null : await tx.trackerSettings.findUnique({ where: { id: 'workforce-group' } })
    const unlocks = stored ? await tx.planningUnlock.findMany({ where: { weekId: stored.id, OR: [
      { scope: 'EVERYONE' }, { scope: 'PERSON', userId: context.user.id },
      { scope: 'UNIT', unitId: assignment.unitId }, { scope: 'BUSINESS', businessId: assignment.businessId },
    ] } }) : []
    const projection = weekProjection(start, stored, settings, unlocks, asOf, leave.paused)
    week = projection.state
    transitions = [...transitions, ...projection.transitions]
  }
  const ownedLeave = await currentLeave(tx, context.user.id, asOf)
  return { week, leave: { paused: leave.paused, returnsOn: leave.returnsOn, returnTarget: ownedLeave.current?.canReturn ? ownedLeave.current.id : null, repairRequired: ownedLeave.state === 'REPAIR_REQUIRED' }, nextChangeAt: nextChange(asOf, [...transitions, new Date(ownedLeave.nextChangeAt)]) }
}
function clock(asOf: Date) {
  return { asOf: asOf.toISOString(), timezone: 'Africa/Lagos' as const, currentWeekStart: isoDay(monday(asOf)) }
}

export async function readHome(db: PrismaClient, context: SessionContext, query: Query, asOf: Date): Promise<HomeResponse> {
  return db.$transaction(async (tx) => {
    const { assignment } = await employeePrincipal(tx, context, asOf)
    const { selection } = query
    const where: Prisma.WeeklyTaskWhereInput = {
      ownerId: context.user.id, deletedAt: null,
      tracker: { userId: context.user.id, ...(selection.kind === 'week' ? { week: { startsOn: day(selection.week) } } : {}) },
      ...(selection.kind === 'range' ? { startsOn: { lte: day(selection.to) }, endsOn: { gte: day(selection.from) } } : {}),
    }
    const state = await employeeCalendar(tx, context, asOf, selection.kind === 'week' ? day(selection.week) : null, assignment)
    const tasks = await taskPage(tx, where, query.page, state.week, asOf)
    const attention = await taskPage(tx, { ...where, status: { in: ['BLOCKED', 'DECLINED'] } }, query.attentionPage, state.week, asOf)
    const current = state.week?.startsOn === isoDay(monday(asOf)) && asOf < new Date(state.week.freezesAt)
    const canCreate = !!current && !!state.week?.planningOpen && !state.leave.paused
    return { ...clock(asOf), ...state, selection, tasks, attention, canCreate,
      createRestriction: canCreate ? null : !current ? 'This week is read only.' : state.leave.paused ? 'Your tracker is paused while on leave.' : 'Tracker is closed for new tasks.' }
  }, { isolationLevel: 'RepeatableRead', maxWait: 5000, timeout: 15000 })
}

function frozenOwner(value: Prisma.JsonValue, ownerId: string): DetailResponse['owner'] {
  const snapshot = snapshotContext(value, ownerId)
  if (!snapshot || !['EMPLOYEE', 'LINE_MANAGER'].includes(snapshot.role)) throw new EmployeeFailure('SERVICE_UNAVAILABLE', 503)
  return { name: snapshot.displayName, business: snapshot.businessName, unit: snapshot.unitName, manager: snapshot.managerName, department: snapshot.departmentLabel }
}

export async function readDetail(db: PrismaClient, context: SessionContext, taskId: string, query: Query, asOf: Date): Promise<DetailResponse> {
  return db.$transaction(async (tx) => {
    const { person, assignment } = await employeePrincipal(tx, context, asOf)
    const task = await tx.weeklyTask.findFirst({ where: { id: taskId, ownerId: context.user.id, deletedAt: null, tracker: { userId: context.user.id } }, select: {
      ...taskSelect,
      tracker: { select: { contextSnapshot: true, snapshotAt: true, expectedWorkingDaysSnapshot: true, week: true } },
    } })
    if (!task) throw new EmployeeFailure('NOT_FOUND', 404)
    const frozen = asOf >= task.tracker.week.freezesAt
    if (frozen && (!task.tracker.snapshotAt || task.tracker.snapshotAt < task.tracker.week.freezesAt || !Number.isInteger(task.tracker.expectedWorkingDaysSnapshot) || task.tracker.expectedWorkingDaysSnapshot! < 0 || task.tracker.expectedWorkingDaysSnapshot! > 5)) throw new EmployeeFailure('SERVICE_UNAVAILABLE', 503)
    const owner = frozen ? frozenOwner(task.tracker.contextSnapshot, context.user.id) : {
      name: person.name?.trim() || 'Staff member', business: assignment.business?.name ?? null, unit: assignment.unit?.name ?? null,
      manager: assignment.manager?.name ?? null, department: assignment.departmentLabel,
    }
    const state = await employeeCalendar(tx, context, asOf, task.tracker.week.startsOn, assignment)
    if (!state.week) throw new EmployeeFailure('SERVICE_UNAVAILABLE', 503)
    const latest = await tx.approvalRequest.findFirst({ where: { weeklyTaskId: taskId }, orderBy: { attemptNumber: 'desc' }, select: {
      attemptNumber: true, state: true, submittedAt: true,
      decision: { select: { decision: true, method: true, reason: true, decidedAt: true, actor: { select: { name: true } }, principal: { select: { name: true } } } },
    } })
    const total = await tx.taskComment.count({ where: { weeklyTaskId: taskId } })
    const skip = pageOffset(query.commentPage, total)
    const comments = skip === null ? [] : await tx.taskComment.findMany({ where: { weeklyTaskId: taskId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 25, skip,
      select: { id: true, body: true, createdAt: true, author: { select: { name: true } } } })
    const decision = latest?.decision
    return {
      ...clock(asOf), nextChangeAt: state.nextChangeAt, task: entry(task, state.week, asOf), owner, week: state.week, frozen,
      review: latest ? { attempt: latest.attemptNumber, state: latest.state, submittedAt: latest.submittedAt.toISOString(), decision: decision ? {
        kind: decision.decision, method: decision.method, reason: decision.reason, decidedAt: decision.decidedAt.toISOString(),
        reviewer: decision.method === 'AUTOMATIC' ? 'System' : decision.actor?.name?.trim() || 'Staff member', coveredManager: decision.principal?.name ?? null,
      } : null } : null,
      comments: { items: comments.map((c) => ({ id: c.id, body: c.body, author: c.author.name?.trim() || 'Staff member', createdAt: c.createdAt.toISOString() })), page: query.commentPage, pageSize: 25, total },
    }
  }, { isolationLevel: 'RepeatableRead', maxWait: 5000, timeout: 15000 })
}
