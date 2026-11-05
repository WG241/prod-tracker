import type { ReadClock } from './contracts.ts'

export type LeaveDraft = { startsOn: string; expectedReturnOn: string }
export function leaveDraftErrors(draft: LeaveDraft, today?: string, latest?: string): Record<string, string> {
  const errors: Record<string, string> = {}
  const valid = (value: string) => /^\d{4}-\d\d-\d\d$/.test(value) && value >= '0001-01-01' && value <= '9999-12-31' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value
  if (!valid(draft.startsOn)) errors.startsOn = 'Choose a valid start date.'
  else if (today && latest && (draft.startsOn < today || draft.startsOn > latest)) errors.startsOn = 'Choose a start date from today through 365 days ahead.'
  if (!valid(draft.expectedReturnOn)) errors.expectedReturnOn = 'Choose a valid return date.'
  else if (valid(draft.startsOn)) {
    const days = (Date.parse(draft.expectedReturnOn) - Date.parse(draft.startsOn)) / 86400000
    if (days < 1 || days > 366) errors.expectedReturnOn = 'Choose a return date 1 to 366 days after the start date.'
  }
  return errors
}
export type LeaveView = { userId: string; draft: LeaveDraft | null }
export const initialLeaveView = (userId: string): LeaveView => ({ userId, draft: null })
export type LeaveWarning = 'MANAGER_UNAVAILABLE' | 'HR_UNAVAILABLE'
export type LeaveState = 'NONE' | 'SCHEDULED' | 'ON_LEAVE' | 'REPAIR_REQUIRED'
export type CurrentLeave = LeaveDraft & { id: string; state: 'SCHEDULED' | 'ON_LEAVE'; canCancel: boolean; canReturn: boolean }
export type LeaveResponse = ReadClock & {
  today: string
  defaults: LeaveDraft
  bounds: { latestStartOn: string; maxDays: 366 }
  state: LeaveState
  current: CurrentLeave | null
  canCreate: boolean
  reason: 'LEAVE_REPAIR_REQUIRED' | 'LEAVE_CONFLICT' | 'DATE_UNAVAILABLE' | null
}
export type LeaveOperation = { kind: 'CREATE'; draft: LeaveDraft } | { kind: 'CANCEL' | 'RETURN'; leaveId: string }
export type LeaveResult = { version: 1; requestId: string; operation: LeaveOperation['kind']; leaveId: string; appliedAt: string; changed: boolean; replayed: boolean; notificationWarnings: LeaveWarning[] }
export function leaveRequest(operation: LeaveOperation) {
  return operation.kind === 'CREATE'
    ? { path: '/api/employee/leave', body: operation.draft }
    : { path: `/api/employee/leave/${operation.leaveId}/${operation.kind.toLowerCase()}`, body: {} }
}
