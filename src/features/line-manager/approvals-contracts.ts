import type { Page, ReadClock, Selection } from '../employee/contracts.ts'
import type { ApprovalGroup } from './dashboard-view.ts'

export const approvalTabs = ['AWAITING', 'APPROVED', 'DECLINED', 'BLOCKERS'] as const
export const approvalEndpoint = '/api/line-manager/approvals'
export function periodParams(value: Selection | null): Record<string, string> {
  return value?.kind === 'week' ? { week: value.week } : value?.kind === 'range' ? { from: value.from, to: value.to } : {}
}
export type ApprovalTab = typeof approvalTabs[number]
export type ReviewItem = { requestId: string; expectedTaskRevision: number }
export type ReviewCommand =
  | ({ operation: 'LM_APPROVE' } & ReviewItem)
  | ({ operation: 'LM_DECLINE'; reason: string } & ReviewItem)
  | { operation: 'LM_APPROVE_BATCH'; items: ReviewItem[] }
  | { operation: 'LM_TASK_COMMENT'; requestId: string; body: string }
export type ReviewReceipt = { version: 1; operation: ReviewCommand['operation']; requestId: string; appliedAt: string; changed: true } & (
  | { items: { approvalRequestId: string; decisionId: string; taskId: string; taskRevision: number }[] }
  | { approvalRequestId: string; taskId: string; commentId: string }
)
export type ReviewSummary = ReadClock & { employeeCount: number; requestCount: number; routingUnavailableCount: number; workPaused: boolean }
export type SubmittedWork = { title: string; activity: string; startsOn: string; endsOn: string; ownerId: string; ownerName: string; week: string }
export type ReviewAttempt = SubmittedWork & {
  requestId: string; taskId: string; revision: number; submittedAt: string; unit: string
  note: { body: string; createdAt: string } | null
  decisionUnavailable?: 'HISTORY_UNAVAILABLE'
}
export type ReviewDetail = ReadClock & {
  attempt: ReviewAttempt; mode: 'PERMANENT' | 'RELIEF' | 'HISTORY'; coveredManager: string
  decision: { kind: 'APPROVE' | 'DECLINE'; reason: string | null; decidedAt: string; actor: string; method: 'HUMAN' | 'AUTOMATIC'; coveredManager: string | null } | null
  comments: Page<{ id: string; body: string; author: string; createdAt: string }>
  canDecide: boolean; canComment: boolean; frozen: boolean; workPaused: boolean
}
export type ReviewPerson = ReadClock & { person: { id: string; label: string }; requests: Page<ReviewAttempt>; workPaused: boolean }
export type ReviewRow = ReviewAttempt & { decision: NonNullable<ReviewDetail['decision']> }
export type BlockerRow = { taskId: string; ownerId: string; ownerName: string; unit: string; title: string; activity: string; startsOn: string; reason: string; carried: boolean }
export type ReviewList = ReadClock & {
  selection: Selection | null; weeks: string[]; counts: Record<ApprovalTab, number>; routingUnavailableCount: number; workPaused: boolean
  groups: Page<ApprovalGroup>; decisions: Page<ReviewRow>; blockers: Page<BlockerRow>
}
export type ReviewPeople = ReadClock & { people: Page<{ id: string; label: string; unit: string }> }
export type ApprovalsView = { tab: ApprovalTab; selection: Selection | null; personId: string; page: number; peoplePage: number; search: string }
export const initialApprovalsView: ApprovalsView = { tab: 'AWAITING', selection: null, personId: '', page: 1, peoplePage: 1, search: '' }
