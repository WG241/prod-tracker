import type { AccountStatus, Role } from '../../src/generated/prisma/client.ts'

export type AssignmentPeriod = {
  id: string
  userId: string
  role: Role
  effectiveFrom: Date
  effectiveTo: Date | null
}

export type AccountPeriod = {
  accountStatus: AccountStatus
  createdAt: Date
  deactivatedAt: Date | null
}

export type LeavePeriod = {
  userId: string
  startsOn: Date
  expectedReturnOn: Date
  actualReturnOn: Date | null
  cancelledAt: Date | null
}

export function day(value: string) {
  return new Date(`${value}T00:00:00.000Z`)
}

export function isoDay(value: Date) {
  return value.toISOString().slice(0, 10)
}

export function shiftDay(value: Date, count: number) {
  return new Date(value.getTime() + count * 86400000)
}

export function watMidnight(value: Date) {
  // The release's fixed Africa/Lagos calendar is WAT, UTC+01:00.
  return new Date(`${isoDay(value)}T00:00:00.000+01:00`)
}

export function referenceForWeek(freezesAt: Date, asOf: Date) {
  return new Date(Math.min(asOf.getTime(), freezesAt.getTime() - 1))
}

export function assignmentForWeek<T extends AssignmentPeriod>(
  assignments: readonly T[], startsOn: Date, freezesAt: Date, asOf: Date,
): T | undefined {
  const reference = referenceForWeek(freezesAt, asOf)
  const relevant = assignments.filter((a) => a.effectiveFrom <= reference
    && (a.effectiveTo === null || a.effectiveTo > watMidnight(startsOn)))
  return relevant.find((a) => a.effectiveTo === null || a.effectiveTo > reference)
    ?? relevant.toSorted((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime())[0]
}

export function activeAt(account: AccountPeriod, at: Date) {
  if (account.createdAt > at) return false
  if (account.deactivatedAt) return account.deactivatedAt > at
  return account.accountStatus === 'ACTIVE'
}

export function expectedWorkingDays(
  account: AccountPeriod, assignments: readonly AssignmentPeriod[], leaves: readonly LeavePeriod[],
  startsOn: Date, freezesAt: Date, asOf: Date,
) {
  const reference = referenceForWeek(freezesAt, asOf)
  if (!activeAt(account, reference) || assignmentForWeek(assignments, startsOn, freezesAt, asOf)?.role !== 'EMPLOYEE') return 0
  let available = 0
  for (let offset = 0; offset < 5; offset++) {
    const date = shiftDay(startsOn, offset)
    const beginning = watMidnight(date)
    const end = watMidnight(shiftDay(date, 1))
    const employed = assignments.some((a) => a.role === 'EMPLOYEE' && a.effectiveFrom < end
      && (a.effectiveTo === null || a.effectiveTo > beginning))
    const away = leaves.some((leave) => (leave.cancelledAt === null || leave.cancelledAt > reference)
      && leave.startsOn <= date && (leave.actualReturnOn ?? leave.expectedReturnOn) > date)
    if (employed && !away) available++
  }
  return available
}
