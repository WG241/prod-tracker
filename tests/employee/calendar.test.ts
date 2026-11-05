import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { LeaveRecord, PlanningUnlock, TrackerSettings, WorkWeek } from '../../src/generated/prisma/client.ts'
import { EmployeeFailure, leaveSummary, monday, nextChange, parseDay, readQuery, weekProjection } from '../../server/employee/calendar.ts'
import { pageOffset } from '../../server/employee/reads.ts'
import { isoWeek, isoWeekYear, rangeError, shiftDate } from '../../src/features/employee/date.ts'

const at = new Date('2026-11-02T10:00:00Z')
const settings = { timezone: 'Africa/Lagos', lockDay: 'TUESDAY', lockTime: '14:00' } as TrackerSettings
const week = { id: 'week', startsOn: parseDay('2026-11-02'), planningLocksAt: new Date('2026-11-03T13:00:00Z'), freezesAt: new Date('2026-11-06T23:00:00Z'), manuallyLockedAt: null, lockReason: null } as WorkWeek
const unlock = { grantedAt: new Date('2026-11-03T14:00:00Z'), expiresAt: new Date('2026-11-04T14:00:00Z'), revokedAt: null } as PlanningUnlock

test('AC-3 WAT weeks cross Sunday at 23:00 UTC and ISO weeks cross years', () => {
  assert.equal(monday(new Date('2026-11-01T22:59:59Z')).toISOString().slice(0, 10), '2026-10-26')
  assert.equal(monday(new Date('2026-11-01T23:00:00Z')).toISOString().slice(0, 10), '2026-11-02')
  assert.equal(isoWeek('2026-01-01'), 1)
  assert.equal(isoWeek('2021-01-01'), 53)
  assert.equal(isoWeekYear('2021-01-01'), '2020')
  assert.equal(isoWeekYear('2024-12-30'), '2025')
  assert.equal(shiftDate('2024-02-26', 7), '2024-03-04')
  assert.equal(shiftDate('0001-01-01', -7), null)
  assert.equal(shiftDate('9999-12-27', 7), null)
})

test('isoWeek keeps matching midnight anchors so Friday-start ISO years are not one ahead', () => {
  // 2027 starts on Friday; noon vs midnight Jan 4 previously made Math.round advance every week label.
  assert.equal(isoWeek('2027-01-04'), 1)
  assert.equal(isoWeek('2027-01-11'), 2)
  assert.equal(isoWeek('2027-06-14'), 24)
  assert.equal(isoWeek('2027-12-27'), 52)
  assert.equal(isoWeekYear('2027-01-04'), '2027')
  assert.equal(isoWeek('2026-01-01'), 1)
  assert.equal(isoWeek('2028-01-03'), 1)
})

test('AC-3 only real four digit dates and valid, exclusive selections are accepted', () => {
  assert.equal(parseDay('0001-01-01').getUTCFullYear(), 1)
  assert.equal(parseDay('2024-02-29').toISOString().slice(0, 10), '2024-02-29')
  for (const value of ['0000-01-01', '10000-01-01', '2026-02-29', '2026-04-31', '2026-13-01', '26-01-01']) assert.throws(() => parseDay(value), EmployeeFailure)
  for (const query of ['week=2026-11-03', 'week=2026-11-02&week=2026-11-02', 'from=2026-11-02', 'to=2026-11-03', 'from=2026-11-03&to=2026-11-02', 'week=2026-11-02&from=2026-11-02&to=2026-11-03', 'userId=someone', 'page=0', 'page=-1', 'page=1.5', 'page=9007199254740992', 'page[]=1']) assert.throws(() => readQuery('/home?' + query, false, at), EmployeeFailure, query)
  assert.equal(readQuery('/home?from=2024-01-01&to=2024-12-31', false, at).selection.kind, 'range')
  assert.throws(() => readQuery('/home?from=2024-01-01&to=2025-01-01', false, at), EmployeeFailure)
  assert.throws(() => readQuery('/task?page=1', true, at), EmployeeFailure)
  assert.equal(readQuery('/home', false, at).selection.kind, 'week')
  assert.equal(readQuery('/home?page=9007199254740991', false, at).page, Number.MAX_SAFE_INTEGER)
  assert.deepEqual(rangeError('2024-01-01', '2024-12-31'), {})
  assert.ok(rangeError('2024-01-01', '2025-01-01').to)
})

test('AC-4 persisted cutoffs, manual locks, unlocks, expiry and freeze have strict boundaries', () => {
  const project = (now: string, row = week, unlocks: PlanningUnlock[] = []) => weekProjection(row.startsOn, row, null, unlocks, new Date(now), false).state.planningOpen
  assert.equal(project('2026-11-03T12:59:59Z'), true)
  assert.equal(project('2026-11-03T13:00:00Z'), false)
  assert.equal(project('2026-11-03T13:59:59Z', week, [unlock]), false)
  assert.equal(project('2026-11-03T14:00:00Z', week, [unlock]), true)
  assert.equal(project('2026-11-04T14:00:00Z', week, [unlock]), false)
  assert.equal(project('2026-11-03T15:00:00Z', week, [{ ...unlock, revokedAt: new Date('2026-11-03T15:00:00Z') }]), false)
  assert.equal(project('2026-11-02T10:00:00Z', { ...week, manuallyLockedAt: new Date('2026-11-02T09:00:00Z') }), false)
  assert.equal(project('2026-11-06T23:00:00Z', week, [{ ...unlock, expiresAt: week.freezesAt }]), false)
  assert.equal(project('2026-10-26T12:00:00Z', week, [{ ...unlock, grantedAt: new Date('2026-10-26T00:00:00Z') }]), false)
  assert.equal(project('2026-11-09T00:00:00Z', week, [unlock]), false)
})

test('AC-4 absent weeks derive settings without guessing, and leave remains separate from planning', () => {
  const result = weekProjection(week.startsOn, null, settings, [], at, true)
  assert.equal(result.state.planningLocksAt, week.planningLocksAt.toISOString())
  assert.equal(result.state.freezesAt, week.freezesAt.toISOString())
  assert.equal(result.state.planningOpen, true)
  assert.equal(result.state.pausedForLeave, true)
  for (const invalid of [null, { ...settings, timezone: 'UTC' }, { ...settings, lockTime: '25:00' }, { ...settings, lockDay: 'SATURDAY' as const }]) assert.throws(() => weekProjection(week.startsOn, null, invalid, [], at, false), EmployeeFailure)
  assert.equal(nextChange(at, []), '2026-11-08T23:00:00.000Z')
  assert.equal(nextChange(at, [new Date('2026-11-02T11:00:00Z')]), '2026-11-02T11:00:00.000Z')
  const finalWeek = weekProjection(parseDay('9999-12-27'), null, settings, [], at, false)
  assert.equal(finalWeek.state.planningOpen, false)
  assert.equal(finalWeek.state.freezesAt, '9999-12-31T23:00:00.000Z')
})

test('AC-4 leave unions overlap and adjoining intervals, excludes cancellation and uses actual return', () => {
  const leave = (start: string, end: string, actual: string | null = null, cancelled: Date | null = null) => ({ startsOn: parseDay(start), expectedReturnOn: parseDay(end), actualReturnOn: actual ? parseDay(actual) : null, cancelledAt: cancelled }) as LeaveRecord
  const rows = [leave('2026-11-01', '2026-11-04'), leave('2026-11-03', '2026-11-07'), leave('2026-11-07', '2026-11-10', '2026-11-09'), leave('2026-11-08', '2026-12-01', null, at)]
  assert.equal(leaveSummary(rows, at).returnsOn, '2026-11-09')
  assert.equal(leaveSummary(rows, new Date('2026-11-08T23:00:00Z')).paused, false)
  assert.equal(leaveSummary([leave('2026-11-03', '2026-11-04')], at).paused, false)
})

test('AC-8 pages beyond the end have no offset, including the largest safe integer', () => {
  assert.equal(pageOffset(1, 0), 0)
  assert.equal(pageOffset(2, 26), 25)
  assert.equal(pageOffset(3, 26), null)
  assert.equal(pageOffset(Number.MAX_SAFE_INTEGER, 26), null)
})
