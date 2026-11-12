import type { PlanningUnlock, Prisma, WorkWeek, TrackerSettings } from '../../src/generated/prisma/client.ts'
import type { Actor } from '../auth/owner-write.ts'
import { owner } from '../auth/owner-write.ts'
import { AuthFailure } from '../auth/errors.ts'
import { expectedWorkingDays, isoDay, shiftDay, watCalendarDay } from '../data-model/calendar.ts'
import { leaveSummary, monday, weekProjection } from '../employee/calendar.ts'
import { classifyLeave } from '../employee/leave-state.ts'

export type Tx = Prisma.TransactionClient

export async function managerPrincipal(tx: Tx, actor: Actor) {
  const current = await owner(tx, actor)
  if (current.staff.assignment.role !== 'LINE_MANAGER' || !current.staff.assignment.businessId) throw new AuthFailure('FORBIDDEN', 403)
  return { ...current, businessId: current.staff.assignment.businessId }
}

export const effective = (at: Date): Prisma.EmploymentAssignmentWhereInput => ({
  effectiveFrom: { lte: at }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
})

export function teamWhere(managerId: string, businessId: string, at: Date): Prisma.UserWhereInput {
  return { accountStatus: 'ACTIVE', assignments: { some: { ...effective(at), role: 'EMPLOYEE', managerId, businessId } } }
}

export const employeeSelect = (at: Date, start: Date) => ({
  id: true, name: true, createdAt: true, deactivatedAt: true, accountStatus: true,
  assignments: { where: { OR: [effective(at), { role: 'EMPLOYEE', effectiveFrom: { lt: new Date(shiftDay(start, 5).getTime() - 3600000) },
    OR: [{ effectiveTo: null }, { effectiveTo: { gt: new Date(start.getTime() - 3600000) } }] }] },
    include: { unit: { select: { name: true } }, business: { select: { name: true } } } },
  leaves: { where: { startsOn: { lt: shiftDay(start, 5) }, OR: [{ actualReturnOn: { gt: start } }, { actualReturnOn: null, expectedReturnOn: { gt: start } }] } },
} satisfies Prisma.UserSelect)

export type TeamEmployee = Prisma.UserGetPayload<{ select: ReturnType<typeof employeeSelect> }>

export function employeeAssignment(person: TeamEmployee, managerId: string, businessId: string, at: Date) {
  const rows = person.assignments.filter((row) => row.effectiveFrom <= at && (!row.effectiveTo || row.effectiveTo > at))
  const assignment = rows.length === 1 ? rows[0] : null
  return assignment?.role === 'EMPLOYEE' && assignment.managerId === managerId && assignment.businessId === businessId && assignment.unitId ? assignment : null
}

export async function teamEmployee(tx: Tx, id: string, managerId: string, businessId: string, at: Date) {
  const person = await tx.user.findFirst({ where: { id, ...teamWhere(managerId, businessId, at) }, select: employeeSelect(at, monday(at)) })
  const assignment = person ? employeeAssignment(person, managerId, businessId, at) : null
  return person && assignment ? { person, assignment } : null
}

export function leavePaused(rows: TeamEmployee['leaves'], at: Date) {
  const state = classifyLeave(rows, at).state
  return state === 'ON_LEAVE' || state === 'REPAIR_REQUIRED'
}

export async function reminderEligibility(
  tx: Tx, employee: NonNullable<Awaited<ReturnType<typeof teamEmployee>>>, start: Date, stored: WorkWeek | null,
  settings: TrackerSettings | null, at: Date, hasTask: boolean, weekUnlocks?: PlanningUnlock[],
) {
  const { person, assignment } = employee
  const leave = leaveSummary(person.leaves, at)
  const unlocks = !stored ? [] : (weekUnlocks ?? await tx.planningUnlock.findMany({ where: { weekId: stored.id } }))
    .filter((unlock) => unlock.scope === 'EVERYONE' || unlock.scope === 'PERSON' && unlock.userId === person.id
      || unlock.scope === 'UNIT' && unlock.unitId === assignment.unitId || unlock.scope === 'BUSINESS' && unlock.businessId === assignment.businessId)
  const { state, transitions } = weekProjection(start, stored, settings, unlocks, at, leave.paused)
  const days = expectedWorkingDays(person, person.assignments, person.leaves, start, new Date(state.freezesAt), at)
  return { days, allowed: days > 0 && !hasTask && state.planningOpen && !leavePaused(person.leaves, at),
    transitions: [...transitions, ...leave.transitions] }
}

export function reminderKey(employeeId: string, week: Date, at: Date) {
  return `work-reminder:${employeeId}:${isoDay(week)}:${isoDay(watCalendarDay(at))}`
}
