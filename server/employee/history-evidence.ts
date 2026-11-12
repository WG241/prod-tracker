import type { Prisma, Role, WorkWeek } from '../../src/generated/prisma/client.ts'
import type { HistoryAvailability } from '../../src/features/employee/history-contracts.ts'
import { activeAt, assignmentForWeek, expectedWorkingDays, isoDay, shiftDay, watMidnight } from '../data-model/calendar.ts'

export type HistoryTx = Prisma.TransactionClient
export type SnapshotContext = { version: 1; userId: string; displayName: string; role: Role; accountStatus: 'ACTIVE' | 'INACTIVE'; businessId: string | null; businessName: string | null; unitId: string | null; unitName: string | null; managerId: string | null; managerName: string | null; departmentLabel: string | null }
export const historyCodes = ['CAPTURE_PENDING', 'CAPTURED', 'ALREADY_CAPTURED', 'ROSTER_COMPLETE', 'HISTORICAL_FACTS_UNAVAILABLE', 'PROTECTION_UNAVAILABLE', 'MISSING_HISTORICAL_SCHEDULE', 'INVALID_SNAPSHOT', 'INVALID_ASSIGNMENT', 'INVALID_LEAVE', 'INVALID_SOURCE', 'SETTINGS_UNAVAILABLE', 'NOT_FROZEN', 'NOT_FOUND', 'OUTSIDE_COVERAGE', 'RETRY_LATER', 'SERVICE_UNAVAILABLE'] as const
export type HistoryCode = typeof historyCodes[number]
function object(value: Prisma.JsonValue | null): value is Prisma.JsonObject { return !!value && typeof value === 'object' && !Array.isArray(value) }
function label(value: unknown): value is string { return typeof value === 'string' && !!value.trim() && value.length <= 10000 }
export function snapshotContext(value: Prisma.JsonValue, ownerId: string): SnapshotContext | null {
  if (!object(value) || value.version !== 1 || value.userId !== ownerId || !label(value.displayName) || !['EMPLOYEE', 'LINE_MANAGER', 'BUSINESS_DIRECTOR', 'EXECUTIVE', 'HR_ADMIN'].includes(String(value.role)) || !['ACTIVE', 'INACTIVE'].includes(String(value.accountStatus))) return null
  for (const key of ['businessId', 'businessName', 'unitId', 'unitName', 'managerId', 'managerName', 'departmentLabel']) if (value[key] !== null && !label(value[key])) return null
  const required = value.role === 'EMPLOYEE' ? ['businessId', 'businessName', 'unitId', 'unitName', 'managerId', 'managerName'] : value.role === 'LINE_MANAGER' ? ['businessId', 'businessName', 'unitId', 'unitName'] : value.role === 'BUSINESS_DIRECTOR' ? ['businessId', 'businessName'] : []
  for (const key of required) if (!label(value[key])) return null
  for (const key of ['businessId', 'businessName', 'unitId', 'unitName', 'managerId', 'managerName']) if (!required.includes(key) && value[key] !== null) return null
  return { version: 1, userId: ownerId, displayName: value.displayName, role: value.role as Role, accountStatus: value.accountStatus as 'ACTIVE' | 'INACTIVE', businessId: value.businessId as string | null, businessName: value.businessName as string | null, unitId: value.unitId as string | null, unitName: value.unitName as string | null, managerId: value.managerId as string | null, managerName: value.managerName as string | null, departmentLabel: value.departmentLabel as string | null }
}
export async function databaseClock(tx: HistoryTx) {
  const [{ milliseconds }] = await tx.$queryRaw<{ milliseconds: bigint }[]>`SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS milliseconds`
  return new Date(Number(milliseconds))
}
export async function protection(tx: HistoryTx) {
  const settings = await tx.trackerSettings.findUnique({ where: { id: 'workforce-group' } })
  const audits = await tx.auditEvent.findMany({ where: { action: 'HISTORY_TRACKING_STARTED', targetType: 'TrackerSettings', targetId: 'workforce-group' }, take: 2 })
  const guards = await tx.$queryRaw<{ total: number }[]>`SELECT count(*)::integer AS total FROM pg_trigger WHERE NOT tgisinternal AND tgenabled IN ('O','A') AND tgname IN ('history_assignment_guard','history_leave_guard','history_week_guard','history_tracking_guard','frozen_roster_guard','audit_append_only')`
  const audit = audits.length === 1 ? audits[0] : null
  const valid = guards[0].total === 6 && !!settings?.trackingStartsOn && !!audit && object(audit.after) && audit.after.version === 1 && audit.after.historicalProtectionVersion === 1 && audit.after.trackingStartsOn === isoDay(settings.trackingStartsOn)
  return { settings, guards: guards[0].total === 6, valid, startedAt: valid ? audit!.createdAt : null }
}
export type Protection = Awaited<ReturnType<typeof protection>>
const sourceInclude = { assignments: { orderBy: { effectiveFrom: 'asc' as const }, include: { business: true, unit: true, manager: true } }, leaves: true } satisfies Prisma.UserInclude
export function historyPeople(tx: HistoryTx, userIds: string[]) {
  return tx.user.findMany({ where: { id: { in: userIds } }, include: sourceInclude })
}
export async function historySources(tx: HistoryTx, userId: string, weekId: string) {
  const person = await tx.user.findUnique({ where: { id: userId }, include: sourceInclude })
  const tracker = await tx.weeklyTracker.findUnique({ where: { userId_weekId: { userId, weekId } } })
  return { person, tracker }
}
export type HistorySources = Awaited<ReturnType<typeof historySources>>
export function overlapsWeek(assignment: { effectiveFrom: Date; effectiveTo: Date | null }, week: Pick<WorkWeek, 'startsOn' | 'freezesAt'>) { return assignment.effectiveFrom < week.freezesAt && (!assignment.effectiveTo || assignment.effectiveTo > watMidnight(week.startsOn)) }
export type Evidence = { state: HistoryAvailability; code: HistoryCode; context?: SnapshotContext; assignmentId?: string; days?: number }
export function historyEvidence(sources: HistorySources, week: Pick<WorkWeek, 'startsOn' | 'freezesAt'>, proof: Protection, at: Date): Evidence {
  const { person, tracker } = sources
  const repair = (code: HistoryCode): Evidence => ({ state: 'REPAIR_REQUIRED', code })
  if (tracker?.snapshotAt) {
    const context = snapshotContext(tracker.contextSnapshot, tracker.userId)
    return context && tracker.snapshotAt >= week.freezesAt && Number.isInteger(tracker.expectedWorkingDaysSnapshot) && tracker.expectedWorkingDaysSnapshot! >= 0 && tracker.expectedWorkingDaysSnapshot! <= 5
      ? { state: 'AVAILABLE', code: 'ALREADY_CAPTURED', context, assignmentId: tracker.assignmentId, days: tracker.expectedWorkingDaysSnapshot! } : repair('INVALID_SNAPSHOT')
  }
  if (!person) return repair('INVALID_SOURCE')
  if (week.freezesAt > at) return { state: 'PENDING', code: 'NOT_FROZEN' }
  if (!proof.valid || !proof.startedAt) return repair('PROTECTION_UNAVAILABLE')
  if (week.freezesAt < proof.startedAt) return repair('HISTORICAL_FACTS_UNAVAILABLE')
  const periods = person.assignments
  for (let i = 1; i < periods.length; i++) if (!periods[i - 1].effectiveTo || periods[i - 1].effectiveTo! > periods[i].effectiveFrom) return repair('INVALID_ASSIGNMENT')
  const assignment = assignmentForWeek(periods, week.startsOn, week.freezesAt, at)
  if (!assignment || !overlapsWeek(assignment, week)) return repair('INVALID_ASSIGNMENT')
  const labels = [person, assignment.business, assignment.unit, assignment.manager].filter((row) => row !== null)
  if (labels.some((row) => row.createdAt > week.freezesAt || row.updatedAt > week.freezesAt) || assignment.createdAt > week.freezesAt || (tracker && tracker.updatedAt > week.freezesAt)) return repair('HISTORICAL_FACTS_UNAVAILABLE')
  const reference = new Date(week.freezesAt.getTime() - 1)
  const relevantLeaves = person.leaves.filter((leave) => leave.startsOn <= shiftDay(week.startsOn, 4) && (leave.actualReturnOn ?? leave.expectedReturnOn) > week.startsOn && (!leave.cancelledAt || leave.cancelledAt > reference))
  if (relevantLeaves.some((leave) => leave.createdAt > week.freezesAt || (leave.actualReturnOn ?? leave.expectedReturnOn) <= leave.startsOn)) return repair('INVALID_LEAVE')
  const context = snapshotContext({ version: 1, userId: person.id, displayName: person.name, role: assignment.role, accountStatus: activeAt(person, reference) ? 'ACTIVE' : 'INACTIVE', businessId: assignment.businessId, businessName: assignment.business?.name ?? null, unitId: assignment.unitId, unitName: assignment.unit?.name ?? null, managerId: assignment.managerId, managerName: assignment.manager?.name ?? null, departmentLabel: assignment.departmentLabel }, person.id)
  if (!context) return repair('INVALID_SOURCE')
  return { state: 'PENDING', code: 'CAPTURE_PENDING', context, assignmentId: assignment.id, days: expectedWorkingDays(person, periods, person.leaves, week.startsOn, week.freezesAt, at) }
}
