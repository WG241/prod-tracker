import { useState } from 'react'
import type { RefObject } from 'react'
import { MessageSquare, OctagonAlert } from 'lucide-react'
import { Badge } from '../components/ui/Badge.tsx'
import { Button } from '../components/ui/Button.tsx'
import { Drawer } from '../components/ui/Dialog.tsx'
import { SelectField, TextareaField } from '../components/ui/Field.tsx'
import { NoticeToast } from '../components/ui/NoticeToast.tsx'
import { displayDate, shiftDate } from '../features/employee/date.ts'
import type { Page, Selection } from '../features/employee/contracts.ts'
import { ManagerDashboard } from '../features/line-manager/ManagerDashboard.tsx'
import type { BlockedTask, DashboardData, DashboardRead, DashboardSection } from '../features/line-manager/dashboard-view.ts'

// Sample data for the development role preview. The authenticated route will use the dashboard API.
const currentWeek = '2026-10-19'
const asOf = '2026-10-19T10:00:00.000Z'
const approvals = ['Ada Okafor', 'Chidi Eze', 'Bola Adeyemi', 'Zainab Musa', 'Damilola James'].map((employeeName, i) => ({
  employeeId: String(i), employeeName, unitName: 'Recruitment', taskCount: i === 0 ? 2 : 1, oldestDays: i === 0 ? 4 : 1, overdue: i === 0,
}))
const missing = ['Tosin Ajayi', 'Ibrahim Yusuf', 'Kunle Adebayo'].map((employeeName, i) => ({
  employeeId: String(i + 5), employeeName, unitName: i === 0 ? 'Assessment' : 'Recruitment', managerName: 'Tunde Bakare', week: currentWeek,
}))
const blocked = [
  { id: 'assessment-report', title: 'Publish the assessment report', ownerName: 'Ada Okafor', reason: 'Waiting for the client to share the final assessment data.' },
  { id: 'question-bank', title: 'Refresh the assessment question bank', ownerName: 'Zainab Musa', reason: 'Subject matter expert review is outstanding.' },
]
const activity = [
  { id: 'decision', kind: 'decision', summary: 'Ada’s candidate shortlist was approved.' },
  { id: 'leave', kind: 'leave', summary: 'Femi Lawson is on leave until 26 Oct.' },
] as const
const trend = [80, 86, 83, 91, 89, 94].map((submission, i) => ({
  week: shiftDate(currentWeek, (i - 5) * 7) ?? currentWeek,
  submission,
  completion: [45, 51, 57, 53, 68, 72][i],
}))

const modes = ['Sample data', 'Empty', 'Loading', 'Unavailable history', 'Read error', 'Stale data'] as const
type Mode = typeof modes[number]
type Range = Extract<Selection, { kind: 'range' }>

function page<T>(items: readonly T[], pageNumber: number): Page<T> {
  const start = (pageNumber - 1) * 25
  return { items: items.slice(start, start + 25), page: pageNumber, pageSize: 25, total: items.length }
}

function includedWeeks(range: Range) {
  const offset = (date: string) => (new Date(date).getUTCDay() + 6) % 7
  const fromOffset = offset(range.from)
  const first = shiftDate(range.from, fromOffset >= 5 ? 7 - fromOffset : -fromOffset)
  const last = shiftDate(range.to, -offset(range.to))
  return first && last && first <= last ? { first, last } : null
}

function PreviewTaskDrawer({ task, onClose }: { task: BlockedTask; onClose: () => void }) {
  return <Drawer open title="Task details" onClose={onClose} footer={<><small>Sample record</small><Button onClick={onClose}>Close</Button></>}>
    <Badge status="BLOCKED" />
    <h3 className="employee-detail-title">{task.title}</h3>
    <div className="employee-banner employee-amber"><OctagonAlert aria-hidden="true" /><p>{task.reason}</p></div>
    <dl className="employee-detail-meta">
      <div><dt>Owner</dt><dd>{task.ownerName}</dd></div>
      <div><dt>Dates</dt><dd>{displayDate(currentWeek, false)} to {displayDate('2026-10-23')}</dd></div>
    </dl>
    <div className="employee-activity"><p className="eyebrow">Activity</p><p>{task.title} for the team’s current week.</p></div>
    <h3 className="employee-comments-heading">Manager comments</h3>
    <p className="employee-read-message">No comments yet.</p>
    <div className="employee-reply">
      <TextareaField label="Reply" placeholder="Add a helpful update…" disabled description="Posting is unavailable in this preview." />
      <Button size="small" disabled><MessageSquare aria-hidden="true" />Post reply</Button>
    </div>
  </Drawer>
}

export function ManagerDashboardPreview({ headingRef, onApprovals }: { headingRef: RefObject<HTMLHeadingElement | null>; onApprovals: () => void }) {
  const [anchor, setAnchor] = useState(currentWeek)
  const [range, setRange] = useState<Range | null>(null)
  const [{ mode, revision, showNotice }, setPreview] = useState<{ mode: Mode; revision: number; showNotice: boolean }>({ mode: 'Sample data', revision: 0, showNotice: false })
  const [pages, setPages] = useState<Partial<Record<DashboardSection, number>>>({})
  const [task, setTask] = useState<BlockedTask | null>(null)
  const weeks = range ? includedWeeks(range) : { first: anchor, last: anchor }
  const future = !!weeks && weeks.first > currentWeek
  const unavailable = mode === 'Unavailable history'
  const populated = !!weeks && weeks.first <= currentWeek && weeks.last >= currentWeek && mode !== 'Empty'
  const trendEnd = weeks && weeks.last < currentWeek ? weeks.last : currentWeek
  const trendStart = shiftDate(trendEnd, -35) ?? trendEnd
  const data: DashboardData = {
    asOf,
    metrics: {
      members: unavailable || future ? null : populated ? 16 : 0,
      completion: unavailable || future ? null : populated ? 72 : 0,
      awaiting: future ? null : populated ? approvals.length : 0,
      inProgress: unavailable || future ? null : populated ? 1 : 0,
    },
    trend: weeks && !future && mode !== 'Empty' ? trend.filter((point) => point.week >= trendStart && point.week <= trendEnd).map((point, index) =>
      unavailable && index === 2 ? { ...point, submission: null, completion: null } : point,
    ) : [],
    availabilityMessage: unavailable ? 'Some historical totals are unavailable. Available records are shown below.' : future ? 'This workweek has not opened yet.' : undefined,
    approvals: page(populated ? approvals : [], pages.approvals ?? 1),
    missing: page(populated ? missing : [], pages.missing ?? 1),
    blocked: page(populated ? blocked : [], pages.blocked ?? 1),
    activity: page(populated ? activity : [], pages.activity ?? 1),
  }
  const read: DashboardRead = mode === 'Loading' ? { kind: 'loading' }
    : mode === 'Read error' ? { kind: 'error', message: 'We couldn’t load the team dashboard. Try again.' }
    : { kind: 'ready', data, staleMessage: mode === 'Stale data' ? 'This dashboard may be out of date.' : undefined }

  function selectRange(next: Range | null) {
    setRange(next)
    setPages({})
  }

  function reload() {
    setPreview((current) => ({ mode: 'Sample data', revision: current.revision + 1, showNotice: true }))
  }

  return <>
    <div className="employee-banner employee-gray manager-preview-options">
      <p>Development preview with sample data. Reviews, reminders and comment posting are unavailable.</p>
      <SelectField label="Preview state" value={mode} onChange={(event) => {
        const next = modes.find((item) => item === event.target.value)
        if (next) {
          setPreview((current) => ({ mode: next, revision: current.revision + 1, showNotice: false }))
          setPages({})
        }
      }}>{modes.map((item) => <option key={item}>{item}</option>)}</SelectField>
    </div>
    <ManagerDashboard headingRef={headingRef} anchor={anchor} currentWeek={currentWeek} asOf={asOf} range={range}
      rangeWeeks={weeks ? `Included workweeks start ${displayDate(weeks.first)}${weeks.first === weeks.last ? '' : ` to ${displayDate(weeks.last)}`}.` : 'No workweeks fall within this range.'}
      read={read} readId={String(revision)} onWeek={(week) => { setAnchor(week); selectRange(null) }} onRange={selectRange}
      onPage={(section, pageNumber) => setPages((current) => ({ ...current, [section]: pageNumber }))} onRetry={reload} onReloadLatest={reload}
      onApprovals={onApprovals} onComment={setTask} />
    {task && <PreviewTaskDrawer task={task} onClose={() => setTask(null)} />}
    {showNotice && <NoticeToast key={revision} id={`dashboard-preview:${revision}`} message="Dashboard preview reloaded." />}
  </>
}
