import { Buffer } from 'node:buffer'
import type { LeaveRecord, Prisma, ReliefAssignment } from '../../src/generated/prisma/client.ts'
import type { CoverEvidence } from '../../src/features/line-manager/leave-contracts.ts'
import { wellFormed } from '../../src/features/auth/contracts.ts'
import { isoDay, watMidnight } from '../data-model/calendar.ts'
import { effective } from './scope.ts'
import type { Tx } from './scope.ts'

export function displayLabel(value: string | null | undefined) {
  const safe = value?.replaceAll('\0', '').replace(/[\uD800-\uDFFF]/gu, '\uFFFD').trim() || 'Staff member'
  return [...safe].slice(0, 240).join('')
}
function validLabel(value: unknown): value is string {
  return typeof value === 'string' && value.trim() === value && !!value && !value.includes('\0') && wellFormed(value) && [...value].length <= 240
}
function json(value: Prisma.JsonValue | null) {
  return value && typeof value === 'object' && !Array.isArray(value) && Buffer.byteLength(JSON.stringify(value)) <= 8192 && value.version === 1 ? value : null
}
export function leaveLabels(row: LeaveRecord) {
  const value = json(row.contextSnapshot)
  return value?.userId === row.userId && value.role === 'LINE_MANAGER' && typeof value.businessId === 'string' && !!value.businessId
    && validLabel(value.displayName) && validLabel(value.businessName)
    ? { ownerName: value.displayName, businessName: value.businessName, role: 'LINE_MANAGER' as const }
    : { ownerName: null, businessName: null, role: null }
}
function coverLabels(row: ReliefAssignment) {
  const value = json(row.contextSnapshot)
  return value?.coveredManagerId === row.coveredManagerId && value.reliefManagerId === row.reliefManagerId && value.reliefRole === 'LINE_MANAGER'
    && typeof value.reliefBusinessId === 'string' && !!value.reliefBusinessId && validLabel(value.coveredDisplayName)
    && validLabel(value.reliefDisplayName) && validLabel(value.reliefBusinessName)
    ? { officerName: value.reliefDisplayName, officerBusiness: value.reliefBusinessName }
    : { officerName: null, officerBusiness: null }
}

type Interval = { start: number; end: number }
const time = (day: Date) => watMidnight(day).getTime()
const atTime = (at: Date | null) => at?.getTime() ?? Infinity
const overlaps = (left: Interval, right: Interval) => Math.max(left.start, right.start) < Math.min(left.end, right.end)

export function leaveInterval(leave: Pick<LeaveRecord, 'startsOn' | 'expectedReturnOn' | 'actualReturnOn' | 'cancelledAt' | 'createdAt'>): Interval {
  return { start: Math.max(time(leave.startsOn), leave.createdAt.getTime()),
    end: Math.min(time(leave.actualReturnOn ?? leave.expectedReturnOn), atTime(leave.cancelledAt)) }
}
export function coverInterval(row: ReliefAssignment, leave: LeaveRecord): Interval {
  const window = leaveInterval(leave)
  return { start: Math.max(window.start, time(row.startsOn), row.createdAt.getTime()),
    end: Math.min(window.end, time(row.endsOn), atTime(row.endedAt)) }
}
export const unended = (rows: ReliefAssignment[]) => rows.filter((row) => row.endedAt === null)

export function coverEvidence(row: ReliefAssignment, leave: LeaveRecord, at: Date, current?: { name: string; business: string } | null): CoverEvidence {
  const interval = coverInterval(row, leave)
  const valid = interval.start < interval.end
  const state = (row.endedAt && row.endedAt <= at) || (leave.cancelledAt && leave.cancelledAt <= at) ? 'Ended'
    : interval.end <= at.getTime() ? 'Expired' : !valid || current === null ? 'Unavailable' : interval.start > at.getTime() ? 'Scheduled' : 'Active'
  return { id: row.id, startsOn: isoDay(row.startsOn), endsOn: isoDay(row.endsOn), ...coverLabels(row),
    ...(current ? { officerName: current.name, officerBusiness: current.business } : {}),
    effectiveStartsAt: valid ? new Date(interval.start).toISOString() : null,
    effectiveEndsAt: valid ? new Date(interval.end).toISOString() : null, createdAt: row.createdAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null, endedById: row.endedById, state }
}

export function remainingGap(leave: LeaveRecord, row: ReliefAssignment | null, at: Date, eligible: boolean) {
  const leaveTime = leaveInterval(leave)
  const remaining = Math.max(leaveTime.start, at.getTime())
  if (remaining >= leaveTime.end) return false
  if (!row || !eligible) return true
  const cover = coverInterval(row, leave)
  return cover.start > remaining || cover.end < leaveTime.end
}

export function officerSelect(at: Date, start: Date, end: Date) {
  return {
    id: true, name: true, email: true, accountStatus: true,
    authIdentity: { select: { email: true, provisionedAt: true } },
    assignments: { where: effective(at), take: 2, include: { business: { select: { name: true } } } },
    leaves: { where: { startsOn: { lt: end }, OR: [{ actualReturnOn: { gt: start } }, { actualReturnOn: null, expectedReturnOn: { gt: start } }] } },
  } satisfies Prisma.UserSelect
}
type OfficerSource = Prisma.UserGetPayload<{ select: ReturnType<typeof officerSelect> }>
export function eligibleOfficer(user: OfficerSource | null, ownerId: string, at: Date, startsOn: Date, endsOn: Date) {
  if (!user || user.id === ownerId || user.accountStatus !== 'ACTIVE' || user.assignments.length !== 1) return null
  const assignment = user.assignments[0]
  if (assignment.role !== 'LINE_MANAGER' || !assignment.businessId || !assignment.business) return null
  if (user.authIdentity?.provisionedAt && user.authIdentity.email.trim().toLowerCase() !== user.email.trim().toLowerCase()) return null
  const requested = { start: Math.max(time(startsOn), at.getTime()), end: time(endsOn) }
  if (user.leaves.some((leave) => overlaps(requested, leaveInterval(leave)))) return null
  return { id: user.id, name: displayLabel(user.name), business: displayLabel(assignment.business.name), businessId: assignment.businessId,
    assignmentId: assignment.id, loginReady: !!user.authIdentity?.provisionedAt }
}
export function selectedOfficer(tx: Tx, id: string, at: Date, start: Date, end: Date) {
  return tx.user.findUnique({ where: { id }, select: officerSelect(at, start, end) })
}

export async function hasIncomingCommitment(tx: Tx, officerId: string, start: Date, end: Date, at: Date) {
  const incoming = await tx.reliefAssignment.findMany({ where: { reliefManagerId: officerId, startsOn: { lt: end }, endsOn: { gt: start },
    manager: { accountStatus: 'ACTIVE' } }, include: { leave: true,
    manager: { select: { assignments: { where: effective(at), take: 2 } } } },
  })
  const requested = { start: Math.max(at.getTime(), time(start)), end: time(end) }
  return incoming.some((row) => row.manager.assignments.length === 1 && row.manager.assignments[0].role === 'LINE_MANAGER'
    && overlaps(requested, coverInterval(row, row.leave)))
}
