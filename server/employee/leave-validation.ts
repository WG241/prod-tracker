import type { LeaveOperation } from '../../src/features/employee/leave-contracts.ts'
import { leaveDraftErrors } from '../../src/features/employee/leave-contracts.ts'

const messages = {
  INVALID_INPUT: 'Check the leave dates and try again.', NOT_FOUND: 'This leave is not available.',
  LEAVE_CONFLICT: 'You already have a current or upcoming leave period. Reload the latest leave.',
  LEAVE_REPAIR_REQUIRED: 'Your leave periods need review. Contact HR before making another change.',
  LEAVE_CHANGED: 'This leave can no longer be changed in that way. Reload the latest leave.',
  IDEMPOTENCY_CONFLICT: 'This request identity was already used for a different change.',
  HISTORY_PROTECTED: 'This change would affect frozen history. Contact HR for review.',
  INCOMING_COVER: 'You are already covering another manager during these dates. Arrange replacement cover before booking leave.',
  RELIEF_UNAVAILABLE: 'The selected relief officer is no longer available for these dates. Reload and choose an officer.',
  RELIEF_CHANGED: 'The cover arrangement changed. Reload the latest leave before saving.',
} as const
export class LeaveFailure extends Error {
  readonly code: keyof typeof messages
  readonly status: number
  readonly fields?: Record<string, string>
  constructor(code: keyof typeof messages, status: number, fields?: Record<string, string>) { super(messages[code]); this.code = code; this.status = status; this.fields = fields }
}
export function parseLeaveOperation(kind: LeaveOperation['kind'], leaveId: string | undefined, body: unknown): LeaveOperation {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new LeaveFailure('INVALID_INPUT', 400)
  const value = body as Record<string, unknown>
  if (kind !== 'CREATE') {
    if (!leaveId || !/^[A-Za-z0-9_-]{1,160}$/.test(leaveId) || Object.keys(value).length) throw new LeaveFailure('INVALID_INPUT', 400)
    return { kind, leaveId }
  }
  if (Object.keys(value).length !== 2 || typeof value.startsOn !== 'string' || typeof value.expectedReturnOn !== 'string') throw new LeaveFailure('INVALID_INPUT', 400)
  const draft = { startsOn: value.startsOn, expectedReturnOn: value.expectedReturnOn }, fields = leaveDraftErrors(draft)
  if (Object.keys(fields).length) throw new LeaveFailure('INVALID_INPUT', 400, fields)
  return { kind, draft }
}
