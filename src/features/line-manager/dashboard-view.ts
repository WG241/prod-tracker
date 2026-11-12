import type { Page, ReadClock, Selection, TaskEntry } from '../employee/contracts.ts'

export type DashboardMetrics = {
  members: number | null
  completion: number | null
  awaiting: number | null
  inProgress: number | null
}

export type TrendWeek = {
  week: string
  submission: number | null
  completion: number | null
}

export type ApprovalGroup = {
  employeeId: string
  employeeName: string
  unitName: string
  taskCount: number
  oldestDays: number
  overdue: boolean
  requestId?: string
  week?: string
}

export type MissingSubmission = {
  employeeId: string
  employeeName: string
  unitName: string
  managerName: string
  week: string
  canRemind?: boolean
  reminded?: boolean
}

export type BlockedTask = {
  id: string
  title: string
  ownerName: string
  reason: string
  week?: string
  current?: boolean
}

export type DashboardActivity = {
  id: string
  kind: 'decision' | 'leave'
  summary: string
}

export type DashboardData = {
  asOf: string
  metrics: DashboardMetrics
  trend: TrendWeek[]
  availabilityMessage?: string
  approvals: Page<ApprovalGroup>
  missing: Page<MissingSubmission>
  blocked: Page<BlockedTask>
  activity: Page<DashboardActivity>
}

export type DashboardSection = 'approvals' | 'missing' | 'blocked' | 'activity'
export type DashboardSelectionState = { anchor: string | null; selection: Selection | null; pages: Partial<Record<DashboardSection, number>> }

export type DashboardResponse = DashboardData & ReadClock & {
  selection: Selection
  includedWeeks: string[]
  availability: { unavailableWeeks: string[]; notOpenWeeks: string[]; routingUnavailableCount: number }
  approvalBadge: number
}

export type TeamTaskDetail = ReadClock & {
  task: Pick<TaskEntry, 'id' | 'title' | 'activity' | 'status' | 'startsOn' | 'endsOn' | 'reason'>
  ownerName: string
  ownerId: string
  owner: { business: string; unit: string; manager: string; department: string | null }
  week: string
  frozen: boolean
  canComment: boolean
  reason: string | null
  review: { attempt: number; state: string; submittedAt: string; decision: string | null; reason: string | null; decidedAt: string | null } | null
  comments: Page<{ id: string; authorName: string; body: string; createdAt: string }>
}

export type ManagerCommand =
  | { operation: 'LM_REMIND'; employeeId: string; week: string }
  | { operation: 'LM_TASK_COMMENT'; taskId: string; body: string }

type ReceiptBase = { version: 1; requestId: string; appliedAt: string; changed: boolean }
export type ManagerReceipt = ReceiptBase & (
  | { operation: 'LM_REMIND'; notificationId: string; alreadyReminded: boolean; emailSuppressed: boolean }
  | { operation: 'LM_TASK_COMMENT'; commentId: string; taskId: string }
)

export type DashboardRead =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; data: DashboardData; staleMessage?: string }
