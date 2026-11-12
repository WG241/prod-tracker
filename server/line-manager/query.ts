import type { Selection } from '../../src/features/employee/contracts.ts'
import { taskStatuses } from '../../src/features/employee/contracts.ts'
import { participationOptions } from '../../src/features/line-manager/team-history-contracts.ts'
import type { Participation } from '../../src/features/line-manager/team-history-contracts.ts'
import { isoDay, shiftDay } from '../data-model/calendar.ts'
import { EmployeeFailure, monday, parseDay } from '../employee/calendar.ts'
import { taskIdentity } from '../employee/task-validation.ts'

const pages = ['approvalPage', 'missingPage', 'blockedPage', 'activityPage'] as const
const invalid = () => new EmployeeFailure('INVALID_INPUT', 400)

export function selectors(url: string, keys: readonly string[]) {
  const query = new URL(url, 'http://localhost').searchParams
  for (const key of query.keys()) if (!keys.includes(key) || query.getAll(key).length !== 1) throw invalid()
  return query
}

export function page(query: URLSearchParams, key: string) {
  const value = query.get(key) ?? '1'
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) throw invalid()
  return Number(value)
}

export function managerWeek(value: string) {
  const date = parseDay(value)
  if (date.getUTCDay() !== 1) throw invalid()
  return date
}

export function detailPage(url: string) {
  return page(selectors(url, ['commentPage']), 'commentPage')
}

export function period(query: URLSearchParams, at: Date) {
  const requested = query.get('week'), from = query.get('from'), to = query.get('to')
  const current = monday(at)
  const included: Date[] = []
  let selection: Selection
  if (from !== null || to !== null) {
    if (from === null || to === null || requested !== null) throw invalid()
    const start = parseDay(from), end = parseDay(to)
    if (end < start || end.getTime() - start.getTime() >= 366 * 86400000) throw invalid()
    const offset = (start.getUTCDay() + 6) % 7
    for (let week = shiftDay(start, offset > 4 ? 7 - offset : -offset); week <= end; week = shiftDay(week, 7)) included.push(week)
    selection = { kind: 'range', from, to }
  } else {
    const anchor = requested === null ? current : managerWeek(requested)
    included.push(anchor)
    selection = { kind: 'week', week: isoDay(anchor) }
  }
  return { selection, current, included }
}

export function dashboardQuery(url: string, at: Date) {
  const query = selectors(url, ['week', 'from', 'to', ...pages])
  const { selection, current, included } = period(query, at)
  const last = included.at(-1)
  const trend: Date[] = []
  if (last) {
    const end = last > current ? current : last
    for (let i = 5; i >= 0; i--) {
      const start = shiftDay(end, -i * 7)
      if (start.getUTCFullYear() >= 1) trend.push(start)
    }
  }
  return { selection, current, included, trend, approvalPage: page(query, 'approvalPage'), missingPage: page(query, 'missingPage'),
    blockedPage: page(query, 'blockedPage'), activityPage: page(query, 'activityPage') }
}

export function teamHistoryQuery(url: string, at: Date, people: boolean) {
  const query = selectors(url, ['week', 'from', 'to', 'search', 'page', ...(people ? [] : ['personId', 'participation'])])
  const search = query.get('search') ?? ''
  if (search.length > 120 || search.includes('\0')) throw invalid()
  const person = query.get('personId')
  const participation = query.get('participation') ?? 'ALL'
  if (!Object.hasOwn(participationOptions, participation)) throw invalid()
  return { ...period(query, at), search: search.trim().toLowerCase(), personId: person === null ? null : taskIdentity(person),
    participation: participation as Participation, page: page(query, 'page') }
}

export function teamWeekQuery(url: string) {
  const query = selectors(url, ['status', 'page', 'attentionPage'])
  const status = query.get('status')
  if (status !== null && !Object.hasOwn(taskStatuses, status)) throw invalid()
  return { status: status as keyof typeof taskStatuses | null, page: page(query, 'page'), attentionPage: page(query, 'attentionPage') }
}
