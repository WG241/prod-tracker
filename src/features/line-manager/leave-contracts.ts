import type { Page, ReadClock } from '../employee/contracts.ts'
import { leaveDraftErrors } from '../employee/leave-contracts.ts'
import type { LeaveDraft, LeaveResponse } from '../employee/leave-contracts.ts'

export const managerLeaveEndpoint = '/api/line-manager/leave'
export type ManagerLeaveDraft = LeaveDraft & { reliefManagerId: string }
export type CoverDraft = { startsOn: string; endsOn: string; reliefManagerId: string }
export type ManagerLeaveOperation =
  | { kind: 'MANAGER_CREATE'; draft: ManagerLeaveDraft }
  | { kind: 'MANAGER_CANCEL' | 'MANAGER_RETURN'; leaveId: string }
  | { kind: 'RELIEF_REPLACE'; leaveId: string; expectedReliefId: string | null; draft: CoverDraft }
  | { kind: 'RELIEF_END'; leaveId: string; expectedReliefId: string }

export const managerLeaveWarnings = {
  COVER_GAP: 'Some remaining leave dates are uncovered. Arrange cover or contact HR.',
  OFFICER_NOT_PROVISIONED: 'The selected officer needs HR to enable sign-in before they can review.',
  OFFICER_UNAVAILABLE: 'A previous relief officer could not be notified.',
  DIRECTOR_UNAVAILABLE: 'No current business director could be notified.',
  HR_UNAVAILABLE: 'No active HR recipient could be notified.',
} as const
export type ManagerLeaveWarning = keyof typeof managerLeaveWarnings
export type ManagerLeaveResult = {
  version: 1; requestId: string; operation: ManagerLeaveOperation['kind']; leaveId: string; appliedAt: string; changed: boolean; replayed: boolean
  coverId: string | null; endedCoverIds: string[]; actualReturnOn: string | null; notificationWarnings: ManagerLeaveWarning[]
}

export function managerLeaveRequest(operation: ManagerLeaveOperation) {
  if (operation.kind === 'MANAGER_CREATE') return { path: managerLeaveEndpoint, body: operation.draft }
  const base = `${managerLeaveEndpoint}/${encodeURIComponent(operation.leaveId)}`
  if (operation.kind === 'RELIEF_REPLACE') return { path: `${base}/cover`, body: { expectedReliefId: operation.expectedReliefId, ...operation.draft } }
  if (operation.kind === 'RELIEF_END') return { path: `${base}/cover/end`, body: { expectedReliefId: operation.expectedReliefId } }
  return { path: `${base}/${operation.kind === 'MANAGER_CANCEL' ? 'cancel' : 'return'}`, body: {} }
}

export function coverDraftErrors(draft: Pick<CoverDraft, 'startsOn' | 'endsOn'>, earliest?: string, latest?: string) {
  const errors = leaveDraftErrors({ startsOn: draft.startsOn, expectedReturnOn: draft.endsOn })
  return {
    ...(errors.startsOn ? { startsOn: 'Choose a valid cover start date.' }
      : earliest && draft.startsOn < earliest ? { startsOn: 'Choose a start within your remaining leave.' } : {}),
    ...(errors.expectedReturnOn ? { endsOn: 'Choose a cover end after the start and within 366 days.' }
      : latest && draft.endsOn > latest ? { endsOn: 'Choose an end within your remaining leave.' } : {}),
  }
}

export type CoverEvidence = {
  id: string; officerName: string | null; officerBusiness: string | null
  startsOn: string; endsOn: string; effectiveStartsAt: string | null; effectiveEndsAt: string | null
  createdAt: string; endedAt: string | null; endedById: string | null
  state: 'Scheduled' | 'Active' | 'Ended' | 'Expired' | 'Unavailable'
}
export type ManagerLeave = LeaveResponse & {
  cover: CoverEvidence | null; coverState: CoverEvidence['state'] | 'Uncovered' | 'Repair required'
  coverGap: boolean; canEditCover: boolean; canEndCover: boolean
}
export type LeaveHistoryItem = LeaveDraft & {
  id: string; ownerName: string | null; role: 'LINE_MANAGER' | null; businessName: string | null
  returnedOn: string | null; days: number; state: 'Completed' | 'Returned early' | 'Cancelled'
  coverCount: number; lastCover: CoverEvidence | null
}
export type ManagerLeaveHistory = ReadClock & { periods: Page<LeaveHistoryItem> }
export type CoverHistory = ReadClock & { arrangements: Page<CoverEvidence> }
export type ReliefCandidate = { id: string; name: string; business: string }
export type ReliefCandidates = ReadClock & { candidates: Page<ReliefCandidate> }
export type ManagerLeaveView = {
  draft: ManagerLeaveDraft | null
  replacement: { leaveId: string; expectedReliefId: string | null; draft: CoverDraft } | null
  historyPage: number
}
export const initialManagerLeaveView: ManagerLeaveView = { draft: null, replacement: null, historyPage: 1 }
