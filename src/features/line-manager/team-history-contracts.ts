import type { Page, ReadClock, Selection, TaskEntry } from '../employee/contracts.ts'

export const participationOptions = {
  ALL: 'All participation',
  SUBMITTED: 'Submitted',
  NOT_SUBMITTED: 'Not submitted',
  ON_LEAVE: 'On leave',
  NOT_EXPECTED: 'Not expected',
} as const

export type Participation = keyof typeof participationOptions
export type TeamPerson = { id: string; label: string; unit: string }
export type TeamHistoryRow = TeamPerson & {
  week: string
  participation: Exclude<Participation, 'ALL'> | null
  tasks: number | null
  completion: number | null
}
export type TeamHistory = ReadClock & {
  selection: Selection
  includedWeeks: string[]
  rows: Page<TeamHistoryRow>
  selectedPerson: TeamPerson | null
  availability: { unavailableWeeks: string[]; notOpenWeeks: string[]; outsideCoverageWeeks: string[] }
  summary: { personWeeks: number; submission: number; completion: number } | null
}
export type TeamPeople = ReadClock & { people: Page<TeamPerson> }
export type TeamWeekTask = Pick<TaskEntry, 'id' | 'title' | 'activity' | 'status' | 'startsOn' | 'endsOn' | 'reason' | 'carryRequested' | 'carriedFrom'>
export type TeamWeek = ReadClock & {
  week: string
  person: TeamPerson & { manager: string; business: string; department: string | null }
  expectedDays: number
  frozen: boolean
  tasks: Page<TeamWeekTask>
  attention: Page<TeamWeekTask>
}
export type TeamHistoryView = {
  selection: Selection | null
  anchor: string | null
  search: string
  personId: string
  participation: Participation
  page: number
  personPage: number
  drill: { personId: string; week: string; currentWeek: string; status: TeamWeekTask['status'] | ''; page: number; attentionPage: number } | null
  returnFocus: string | null
  layout: 'list' | 'card'
}

export const initialTeamHistoryView: TeamHistoryView = {
  selection: null, anchor: null, search: '', personId: '', participation: 'ALL', page: 1, personPage: 1, drill: null, returnFocus: null, layout: 'list',
}
