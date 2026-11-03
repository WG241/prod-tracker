import type { Page, ReadClock, taskStatuses } from './contracts.ts'

export type HistoryStatus = keyof typeof taskStatuses
export type HistoryAvailability = 'AVAILABLE' | 'PENDING' | 'REPAIR_REQUIRED'
export type SelectedWeekState = HistoryAvailability | 'NOT_FROZEN' | 'NO_RECORD' | null
export type HistoryView = { userId: string; week: string; status: string; from: string; to: string; page: number }
export function initialHistoryView(userId: string): HistoryView { return { userId, week: '', status: '', from: '', to: '', page: 1 } }
export type HistoryEntry = { id: string; title: string; status: HistoryStatus; startsOn: string; endsOn: string; week: string; ownerName: string }
export type HistoryResponse = ReadClock & {
  selection: { week: string | null; status: HistoryStatus | null; range: { from: string; to: string } | null; page: number }
  records: Page<HistoryEntry>
  weeks: { week: string; state: HistoryAvailability }[]
  availability: { pendingWeeks: number; repairWeeks: number; captureInitialized: boolean }
  selectedWeekState: SelectedWeekState
}
