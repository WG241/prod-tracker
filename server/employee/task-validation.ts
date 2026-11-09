import type { TaskDraft, TaskOperation, WorkingStatus } from '../../src/features/employee/mutations.ts'
import { parseDay } from './calendar.ts'
import { isoDay, shiftDay } from '../data-model/calendar.ts'
import { wellFormed } from '../../src/features/auth/contracts.ts'

export const taskErrors = {
  INVALID_INPUT: 'Check the task fields and try again.',
  STALE_TASK: 'This task changed elsewhere. Reload the latest task before saving.',
  IDEMPOTENCY_CONFLICT: 'This request identity was already used for a different change.',
  CARRY_IN_USE: 'The next week record has been used and cannot be removed by this change.',
  WEEK_CHANGED: 'The week changed. Reload the current week before creating a task.',
  SAVE_BEFORE_RESUBMIT: 'Save the task changes first, then mark it completed again.',
  MANAGER_UNAVAILABLE: 'Your line manager is not available for review. Contact HR.',
  OWN_TASK_REVIEW_CONFLICT: 'This task has unresolved review evidence. Contact HR before changing it.',
  TASK_LOCKED: 'This change is not available while the tracker or task is locked.',
  ON_LEAVE: 'Your tracker is paused while you are on leave.',
} as const

export class TaskFailure extends Error {
  readonly code: keyof typeof taskErrors
  readonly status: number
  readonly fields?: Record<string, string>
  constructor(code: keyof typeof taskErrors, status: number, fields?: Record<string, string>) {
    super(taskErrors[code])
    this.code = code
    this.status = status
    this.fields = fields
  }
}
function invalid(fields?: Record<string, string>): never { throw new TaskFailure('INVALID_INPUT', 400, fields) }
function record(value: unknown, allowed: string[], required = allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid()
  const result = value as Record<string, unknown>
  if (Object.keys(result).some((key) => !allowed.includes(key)) || required.some((key) => !Object.hasOwn(result, key))) return invalid()
  return result
}
function text(value: unknown, field: string, max: number) {
  if (typeof value !== 'string' || !wellFormed(value) || !value.trim() || value.trim().length > max || value.includes('\0')) return invalid({ [field]: `Enter ${field === 'body' ? 'a reply' : field} of 1 to ${max.toLocaleString('en-US')} characters.` })
  return value.trim()
}
function date(value: unknown, field: string) {
  if (typeof value !== 'string') return invalid({ [field]: 'Choose a valid calendar date.' })
  try { parseDay(value); return value } catch { return invalid({ [field]: 'Choose a valid calendar date.' }) }
}
function flag(value: unknown) { if (typeof value !== 'boolean') return invalid(); return value }
function status(value: unknown): WorkingStatus {
  if (typeof value !== 'string' || !['PENDING', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED'].includes(value)) return invalid({ status: 'Choose a working status.' })
  return value as WorkingStatus
}
export function requestIdentity(value: string | undefined) {
  if (!value || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) return invalid()
  return value.toLowerCase()
}
export function taskIdentity(value: unknown) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(value)) return invalid()
  return value
}
export function editRevision(value: string | undefined) {
  if (!value || !/^"(?:0|[1-9]\d*)"$/.test(value)) return invalid()
  const revision = Number(value.slice(1, -1))
  if (!Number.isSafeInteger(revision)) return invalid()
  return revision
}
export function parseOperation(kind: TaskOperation['kind'], taskId: unknown, body: unknown, version: string | undefined): TaskOperation {
  if (kind === 'CREATE' || kind === 'EDIT') {
    const keys = ['title', 'activity', 'startsOn', 'endsOn', 'carryRequested']
    const input = record(body, [...keys, ...(kind === 'CREATE' ? ['week'] : ['status', 'blockerReason'])], [...keys, ...(kind === 'CREATE' ? ['week'] : [])])
    const draft: TaskDraft = { title: text(input.title, 'title', 120), activity: text(input.activity, 'activity', 6000), startsOn: date(input.startsOn, 'startsOn'), endsOn: date(input.endsOn, 'endsOn'), carryRequested: flag(input.carryRequested) }
    if (kind === 'CREATE') {
      const week = date(input.week, 'week')
      if (parseDay(week).getUTCDay() !== 1) return invalid()
      return { kind, week, draft }
    }
    if (input.status !== undefined) draft.status = status(input.status)
    if (input.blockerReason !== undefined) draft.blockerReason = text(input.blockerReason, 'blockerReason', 2000)
    return { kind, taskId: taskIdentity(taskId), revision: editRevision(version), draft }
  }
  const id = taskIdentity(taskId)
  if (kind === 'COMMENT') { const input = record(body, ['body']); return { kind, taskId: id, body: text(input.body, 'body', 4000) } }
  const revision = editRevision(version)
  if (kind === 'DELETE') { record(body, []); return { kind, taskId: id, revision } }
  if (kind === 'CARRY') { const input = record(body, ['carryRequested']); return { kind, taskId: id, revision, carryRequested: flag(input.carryRequested) } }
  const input = record(body, ['status', 'blockerReason'], ['status'])
  return { kind: 'STATUS', taskId: id, revision, status: status(input.status), ...(input.blockerReason === undefined ? {} : { blockerReason: text(input.blockerReason, 'blockerReason', 2000) }) }
}

export function validateTaskDates(draft: TaskDraft, week: Date, previous?: { startsOn: Date; endsOn: Date; carryRequested: boolean }) {
  const changed = !previous || draft.startsOn !== isoDay(previous.startsOn) || draft.endsOn !== isoDay(previous.endsOn)
  const start = parseDay(draft.startsOn), end = parseDay(draft.endsOn), friday = shiftDay(week, 4)
  if (changed && (start < week || start > friday)) invalid({ startsOn: 'Choose a start date from this Monday to Friday.' })
  if (changed && (end < start || (end.getTime() - start.getTime()) / 86400000 >= 366)) invalid({ endsOn: 'Choose an end date on or after the start, within 366 days.' })
  if (end > friday && !draft.carryRequested && (changed || previous?.carryRequested)) invalid({ carryRequested: 'Carry over is required for this end date.' })
}
