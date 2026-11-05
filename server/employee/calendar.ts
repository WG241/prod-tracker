import type { LeaveRecord, PlanningUnlock, TrackerSettings, WorkWeek } from '../../src/generated/prisma/client.ts'
import type { Selection, WeekState } from '../../src/features/employee/contracts.ts'
import { day, isoDay, shiftDay, watCalendarDay } from '../data-model/calendar.ts'

// Date only inputs are UTC midnight. Numeric conversion also handles the
// Saturday after the final selectable week, which falls in ISO year +010000.
function watMidnight(value: Date) { return new Date(value.getTime() - 3600000) }

export class EmployeeFailure extends Error {
  readonly code: 'INVALID_INPUT' | 'NOT_FOUND' | 'SESSION_REQUIRED' | 'FORBIDDEN' | 'SERVICE_UNAVAILABLE'
  readonly status: number
  constructor(code: EmployeeFailure['code'], status: number) {
    super({ INVALID_INPUT: 'Check the dates and page selection.', NOT_FOUND: 'This task is not available.', SESSION_REQUIRED: 'Please sign in to continue.', FORBIDDEN: 'You do not have access to that page.', SERVICE_UNAVAILABLE: 'The service is unavailable. Please try again.' }[code])
    this.code = code
    this.status = status
  }
}

export function parseDay(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '0001-01-01' || value > '9999-12-31') throw new EmployeeFailure('INVALID_INPUT', 400)
  const result = day(value)
  if (!Number.isFinite(result.getTime()) || isoDay(result) !== value) throw new EmployeeFailure('INVALID_INPUT', 400)
  return result
}

export function monday(at: Date) {
  const date = watCalendarDay(at)
  return shiftDay(date, -((date.getUTCDay() + 6) % 7))
}

export function readQuery(url: string, detail: boolean, asOf: Date) {
  const query = new URL(url, 'http://local').searchParams
  const allowed = detail ? ['commentPage'] : ['week', 'from', 'to', 'page', 'attentionPage']
  for (const key of query.keys()) if (!allowed.includes(key) || query.getAll(key).length !== 1) throw new EmployeeFailure('INVALID_INPUT', 400)
  const page = (key: string) => {
    const value = query.get(key) ?? '1'
    if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) throw new EmployeeFailure('INVALID_INPUT', 400)
    return Number(value)
  }
  let selection: Selection = { kind: 'week', week: isoDay(monday(asOf)) }
  if (query.has('from') || query.has('to')) {
    if (query.has('week') || !query.has('from') || !query.has('to')) throw new EmployeeFailure('INVALID_INPUT', 400)
    const from = query.get('from')!, to = query.get('to')!
    const length = (parseDay(to).getTime() - parseDay(from).getTime()) / 86400000 + 1
    if (length < 1 || length > 366) throw new EmployeeFailure('INVALID_INPUT', 400)
    selection = { kind: 'range', from, to }
  } else if (query.has('week')) {
    const week = query.get('week')!
    if (parseDay(week).getUTCDay() !== 1) throw new EmployeeFailure('INVALID_INPUT', 400)
    selection = { kind: 'week', week }
  }
  return { selection, page: page('page'), attentionPage: page('attentionPage'), commentPage: page('commentPage') }
}

export function leaveSummary(rows: Pick<LeaveRecord, 'startsOn' | 'expectedReturnOn' | 'actualReturnOn' | 'cancelledAt'>[], asOf: Date) {
  const merged: { start: Date; end: Date }[] = []
  for (const row of rows.filter((r) => !r.cancelledAt || r.cancelledAt > asOf).toSorted((a, b) => a.startsOn.getTime() - b.startsOn.getTime())) {
    const end = row.actualReturnOn ?? row.expectedReturnOn
    if (end <= row.startsOn) continue
    const last = merged.at(-1)
    if (last && row.startsOn <= last.end) { if (end > last.end) last.end = end }
    else merged.push({ start: row.startsOn, end })
  }
  const today = watCalendarDay(asOf)
  const current = merged.find((r) => r.start <= today && today < r.end)
  return {
    paused: !!current, returnsOn: current ? isoDay(current.end) : null,
    transitions: merged.flatMap((r) => [watMidnight(r.start), watMidnight(r.end)]),
  }
}

export function weekProjection(start: Date, stored: WorkWeek | null, settings: TrackerSettings | null, unlocks: PlanningUnlock[], asOf: Date, paused: boolean) {
  let lock: Date, freeze: Date
  if (stored) { lock = stored.planningLocksAt; freeze = stored.freezesAt }
  else {
    const days = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']
    if (!settings || settings.timezone !== 'Africa/Lagos' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(settings.lockTime) || !days.includes(settings.lockDay)) throw new EmployeeFailure('SERVICE_UNAVAILABLE', 503)
    lock = new Date(`${isoDay(shiftDay(start, days.indexOf(settings.lockDay)))}T${settings.lockTime}:00+01:00`)
    freeze = watMidnight(shiftDay(start, 5))
    if (lock >= freeze) throw new EmployeeFailure('SERVICE_UNAVAILABLE', 503)
  }
  const manual = !!stored?.manuallyLockedAt && stored.manuallyLockedAt <= asOf
  const validUnlocks = unlocks.filter((u) => u.expiresAt <= freeze && (!u.revokedAt || u.revokedAt > asOf))
  const unlocked = validUnlocks.some((u) => u.grantedAt <= asOf && asOf < u.expiresAt)
  const current = isoDay(start) === isoDay(monday(asOf))
  const state: WeekState = {
    startsOn: isoDay(start), planningLocksAt: lock.toISOString(), freezesAt: freeze.toISOString(),
    planningOpen: current && asOf < freeze && ((!manual && asOf < lock) || unlocked),
    pausedForLeave: current && paused,
    manualLockReason: manual ? stored?.lockReason ?? null : null,
  }
  return { state, transitions: [lock, freeze, ...(stored?.manuallyLockedAt ? [stored.manuallyLockedAt] : []), ...validUnlocks.flatMap((u) => [u.grantedAt, u.expiresAt, ...(u.revokedAt ? [u.revokedAt] : [])])] }
}

export function nextChange(asOf: Date, transitions: Date[]) {
  const nextMonday = watMidnight(shiftDay(monday(asOf), 7))
  return new Date(Math.min(nextMonday.getTime(), ...transitions.filter((d) => d > asOf).map((d) => d.getTime()))).toISOString()
}
