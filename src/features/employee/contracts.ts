import type { TaskPermissions } from './mutations.ts'

export const taskStatuses = {
  PENDING: 'Pending', IN_PROGRESS: 'In progress', BLOCKED: 'Blocked',
  AWAITING_APPROVAL: 'Awaiting approval', APPROVED: 'Approved', DECLINED: 'Declined',
  ON_HOLD: 'On hold', CANCELLED: 'Cancelled',
} as const

export type Selection = { kind: 'week'; week: string } | { kind: 'range'; from: string; to: string }
export const unavailable = 'Available when task changes are built.'
export type EmployeeView = { userId: string; selection: Selection | null; anchor: string | null; page: number; attentionPage: number; view: 'List' | 'Card' }
export function initialEmployeeView(userId: string): EmployeeView { return { userId, selection: null, anchor: null, page: 1, attentionPage: 1, view: 'List' } }
export type Page<T> = { items: T[]; page: number; pageSize: 25; total: number }
export type TaskEntry = {
  revision: number
  permissions: TaskPermissions
  id: string
  title: string
  activity: string
  startsOn: string
  endsOn: string
  status: keyof typeof taskStatuses
  carryRequested: boolean
  carriedFrom: boolean
  week: string
  reason: string | null
}
export type WeekState = {
  startsOn: string
  planningLocksAt: string
  freezesAt: string
  planningOpen: boolean
  pausedForLeave: boolean
  manualLockReason: string | null
}
export type ReadClock = { asOf: string; timezone: 'Africa/Lagos'; currentWeekStart: string; nextChangeAt: string }
export type HomeResponse = ReadClock & {
  canCreate: boolean
  createRestriction: string | null
  selection: Selection
  week: WeekState | null
  leave: { paused: boolean; returnsOn: string | null; returnTarget?: string | null; repairRequired?: boolean }
  tasks: Page<TaskEntry>
  attention: Page<TaskEntry>
}
export type DetailResponse = ReadClock & {
  task: TaskEntry
  owner: { name: string; business: string | null; unit: string | null; manager: string | null; department: string | null }
  week: WeekState
  frozen: boolean
  review: {
    attempt: number; state: string; submittedAt: string
    decision: null | { kind: string; method: string; reason: string | null; decidedAt: string; reviewer: string; coveredManager: string | null }
  } | null
  comments: Page<{ id: string; body: string; author: string; createdAt: string }>
}
