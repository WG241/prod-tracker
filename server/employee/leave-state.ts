import type { LeaveRecord, Prisma } from '../../src/generated/prisma/client.ts'
import type { LeaveResponse } from '../../src/features/employee/leave-contracts.ts'
import { day, isoDay, shiftDay, watCalendarDay } from '../data-model/calendar.ts'
import { monday } from './calendar.ts'

export type LeaveRow = Pick<LeaveRecord, 'id' | 'startsOn' | 'expectedReturnOn' | 'actualReturnOn' | 'cancelledAt'>
export function boundedLeaveDay(date: Date, days: number) { return new Date(Math.min(shiftDay(date, days).getTime(), day('9999-12-31').getTime())) }
export function classifyLeave(rows: LeaveRow[], at: Date): LeaveResponse {
  const date = watCalendarDay(at), today = isoDay(date)
  const unresolved = rows.filter((row) => (!row.cancelledAt || row.cancelledAt > at) && (row.actualReturnOn ?? row.expectedReturnOn) > date)
  const validDate = (value: Date) => Number.isFinite(value.getTime()) && value >= day('0001-01-01') && value <= day('9999-12-31')
  const bad = unresolved.length > 1 || unresolved.some((row) => row.actualReturnOn !== null || row.cancelledAt !== null || row.startsOn >= row.expectedReturnOn || !validDate(row.startsOn) || !validDate(row.expectedReturnOn))
  const current = !bad && unresolved.length === 1 ? unresolved[0] : null
  const state = bad ? 'REPAIR_REQUIRED' : !current ? 'NONE' : current.startsOn > date ? 'SCHEDULED' : 'ON_LEAVE'
  const canCreate = state === 'NONE' && today < '9999-12-31'
  const midnight = new Date(shiftDay(date, 1).getTime() - 3600000)
  const changes = unresolved.flatMap((row) => row.cancelledAt && row.cancelledAt > at ? [row.cancelledAt.getTime()] : [])
  return { asOf: at.toISOString(), timezone: 'Africa/Lagos', currentWeekStart: isoDay(monday(at)), nextChangeAt: new Date(Math.min(midnight.getTime(), ...changes)).toISOString(), today,
    defaults: { startsOn: today, expectedReturnOn: isoDay(boundedLeaveDay(date, 7)) }, bounds: { latestStartOn: isoDay(boundedLeaveDay(date, 365)), maxDays: 366 }, state,
    current: current ? { id: current.id, startsOn: isoDay(current.startsOn), expectedReturnOn: isoDay(current.expectedReturnOn), state: state as 'SCHEDULED' | 'ON_LEAVE', canCancel: state === 'SCHEDULED', canReturn: state === 'ON_LEAVE' } : null,
    canCreate, reason: bad ? 'LEAVE_REPAIR_REQUIRED' : current ? 'LEAVE_CONFLICT' : !canCreate ? 'DATE_UNAVAILABLE' : null }
}
export async function currentLeave(tx: Prisma.TransactionClient, userId: string, at: Date) {
  const today = watCalendarDay(at)
  const rows = await tx.leaveRecord.findMany({ where: { userId, AND: [
    { OR: [{ cancelledAt: null }, { cancelledAt: { gt: at } }] },
    { OR: [{ actualReturnOn: { gt: today } }, { actualReturnOn: null, expectedReturnOn: { gt: today } }] },
  ] }, orderBy: [{ startsOn: 'asc' }, { id: 'asc' }], take: 2 })
  return classifyLeave(rows, at)
}
