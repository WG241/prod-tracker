import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { ArrowLeft, ArrowRight, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Circle, Clock, FileText, Grid2X2, Hourglass, Info, List, LockKeyhole, OctagonAlert, Pause, Repeat2, Search, Umbrella, Undo2 } from 'lucide-react'
import { AnnounceEvent } from '../../components/accessibility/Announcements.tsx'
import { Badge } from '../../components/ui/Badge.tsx'
import { Button, IconButton } from '../../components/ui/Button.tsx'
import { InputField, SelectField } from '../../components/ui/Field.tsx'
import { SkeletonTable, SkeletonTaskList } from '../../components/ui/Skeleton.tsx'
import { Table } from '../../components/ui/Table.tsx'
import { taskStatuses } from '../employee/contracts.ts'
import type { ReadClock, Selection } from '../employee/contracts.ts'
import { displayDate, displayTime, isoWeek, isoWeekYear, shiftDate } from '../employee/date.ts'
import { DateRange } from '../employee/DateRange.tsx'
import { Pagination } from '../employee/Pagination.tsx'
import { useEmployeeRead } from '../employee/useEmployeeRead.ts'
import { useManagerOperation } from './manager-operations.ts'
import type { ManagerOperations } from './manager-operations.ts'
import type { TeamTaskDetail } from './dashboard-view.ts'
import { ChangeRecovery, TeamTaskDrawer } from './TeamTaskDrawer.tsx'
import { participationOptions } from './team-history-contracts.ts'
import type { Participation, TeamHistory, TeamHistoryRow, TeamHistoryView, TeamPeople, TeamWeek, TeamWeekTask } from './team-history-contracts.ts'
import '../employee/employee.css'
import './team-history.css'

const endpoint = '/api/line-manager/team-history'
const weekDates = (week: string) => `${displayDate(week, false)} to ${displayDate(shiftDate(week, 4) ?? week)}`
const rowKey = (row: TeamHistoryRow) => `${row.id}:${row.week}`
type Drill = NonNullable<TeamHistoryView['drill']>
type Props = {
  headingRef: RefObject<HTMLHeadingElement | null>
  view: TeamHistoryView
  onView: (view: TeamHistoryView) => void
  onSessionInvalid: () => void
}

function WeekControls({ anchor, current, range, onWeek, onRange }: {
  anchor: string | null; current: string | null; range?: Extract<Selection, { kind: 'range' }> | null
  onWeek: (week: string | null) => void; onRange?: () => void
}) {
  const previous = anchor && shiftDate(anchor, -7), next = anchor && shiftDate(anchor, 7)
  return <div className="employee-week-controls" role="group" aria-label="Workweek">
    <IconButton label="Previous week" disabled={!previous} onClick={() => previous && onWeek(previous)}><ChevronLeft aria-hidden="true" /></IconButton>
    <span className="employee-period-label">
      <b>{range ? 'Custom range' : anchor ? `Week ${isoWeek(anchor)}` : 'Workweek'}</b>
      <small>{range ? `${displayDate(range.from)} to ${displayDate(range.to)}` : anchor ? weekDates(anchor) : 'Current week'}</small>
    </span>
    <IconButton label="Next week" disabled={!next} onClick={() => next && onWeek(next)}><ChevronRight aria-hidden="true" /></IconButton>
    {onRange && <IconButton label="Open date range" disabled={!current} onClick={onRange}><CalendarDays aria-hidden="true" /></IconButton>}
    <button type="button" className="employee-this-week" disabled={!current} onClick={() => onWeek(null)}>This week</button>
  </div>
}

function ReadFeedback({ id, read, label, headingRef }: {
  id: string; read: { data: ReadClock | null; loading: boolean; error: string; stale: boolean; retry: () => void }
  label: string; headingRef: RefObject<HTMLHeadingElement | null>
}) {
  return <>
    {read.loading && <AnnounceEvent event={{ id: `${id}:loading`, message: `Loading ${label}…`, intent: 'status' }} />}
    {read.error && <div className="employee-banner employee-amber">
      <p>{read.error}</p>
      <Button size="small" onClick={() => { headingRef.current?.focus(); read.retry() }}>Retry</Button>
      <AnnounceEvent event={{ id: `${id}:error`, message: read.error, intent: 'alert' }} />
    </div>}
    {read.stale && read.data && <p className="employee-read-message">This {label} may be out of date. Last loaded {displayTime(read.data.asOf)}.</p>}
  </>
}

function Roster({ view, onView, headingRef, onSessionInvalid, onOpen, returnFocus, onFocusRestored }: Props & {
  onOpen: (row: TeamHistoryRow, currentWeek: string) => void; returnFocus: string | null; onFocusRestored: () => void
}) {
  const [rangeOpen, setRangeOpen] = useState(false)
  const opener = useRef<HTMLButtonElement>(null)
  const range = view.selection?.kind === 'range' ? view.selection : null
  const period: Record<string, string> = view.selection?.kind === 'week' ? { week: view.selection.week } : range ? { from: range.from, to: range.to } : {}
  const base = { ...period, search: view.search }
  const params = new URLSearchParams({ ...base, ...(view.personId ? { personId: view.personId } : {}), participation: view.participation, page: String(view.page) })
  const peopleParams = new URLSearchParams({ ...base, page: String(view.personPage) })
  const read = useEmployeeRead<TeamHistory>(`${endpoint}?${params}`, onSessionInvalid)
  const choices = useEmployeeRead<TeamPeople>(`${endpoint}/people?${peopleParams}`, onSessionInvalid)
  const data = read.data, current = data?.currentWeekStart ?? choices.data?.currentWeekStart ?? null
  const anchor = view.anchor ?? current
  const options = choices.data?.people.items ?? []
  const selected = data?.selectedPerson
  const multiWeek = (data?.includedWeeks.length ?? 0) > 1
  const headings = ['Employee', 'Unit', ...(multiWeek ? ['Week'] : []), 'Status', 'Tasks', 'Completion', 'Action']
  useLayoutEffect(() => {
    if (!returnFocus || read.loading) return
    const target = opener.current ?? headingRef.current
    onFocusRestored()
    if (document.activeElement === document.body || document.activeElement === headingRef.current) target?.focus()
  }, [read.loading, headingRef, returnFocus, onFocusRestored])

  function change(update: Partial<TeamHistoryView>) {
    onView({ ...view, page: 1, personPage: 1, ...update })
  }
  function chooseWeek(week: string | null) {
    change({ anchor: week, selection: week ? { kind: 'week', week } : null })
  }
  return <>
    <header className="employee-heading manager-heading">
      <div><h1 ref={headingRef} tabIndex={-1}>Team history</h1><p>The week’s work, with the context to support your people.</p></div>
      <WeekControls anchor={anchor} current={current} range={range} onWeek={chooseWeek} onRange={() => setRangeOpen(true)} />
    </header>
    <div className="employee-history-filters team-history-filters">
      <div className="team-history-search"><Search aria-hidden="true" />
        <InputField type="search" label="Search team history" placeholder="Search name or unit…" maxLength={120} value={view.search} onChange={(event) => change({ search: event.target.value })} />
      </div>
      <Button disabled={!data || !anchor} onClick={() => setRangeOpen(true)}><CalendarDays aria-hidden="true" />Date range</Button>
      <SelectField label="Employee" value={view.personId} onChange={(event) => change({ personId: event.target.value, personPage: view.personPage })}>
        <option value="">All employees</option>
        {view.personId && !options.some(({ id }) => id === view.personId) && <option value={view.personId}>{selected?.label ?? 'Selected employee'}</option>}
        {options.map(({ id, label, unit }) => <option key={id} value={id}>{label}{unit ? ` · ${unit}` : ''}</option>)}
      </SelectField>
      <SelectField label="Participation" value={view.participation} onChange={(event) => change({ participation: event.target.value as Participation, personPage: view.personPage })}>
        {Object.entries(participationOptions).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </SelectField>
      {range && <Button size="small" onClick={() => chooseWeek(anchor)}>Clear range</Button>}
    </div>
    <ReadFeedback id={`team-people:${peopleParams}`} read={choices} label="employee options" headingRef={headingRef} />
    {choices.data && (choices.data.people.total > 25 || view.personPage > 1) && <Pagination value={choices.data.people} label="employee option"
      onPage={(personPage) => onView({ ...view, personPage })} />}
    <ReadFeedback id={`team-history:${params}`} read={read} label="team history" headingRef={headingRef} />
    {!!data?.availability.unavailableWeeks.length && <div className="employee-banner employee-gray"><p>Some historical totals are unavailable. Available records are shown below.</p>
      <Button size="small" onClick={read.retry}>Check availability</Button></div>}
    {!!data?.availability.notOpenWeeks.length && <p className="employee-banner employee-gray">Future workweeks have not opened yet.</p>}
    {!!data?.availability.outsideCoverageWeeks.length && <p className="employee-banner employee-gray">Some selected weeks precede history tracking.</p>}
    <section className="ui-card employee-history-card" aria-label="Team history results" aria-busy={read.loading || undefined}>
      {read.loading && !data && <div className="ui-card-body"><SkeletonTable rows={6} cols={6} /></div>}
      {data && <>
        <Table caption="Team history roster" headings={headings}>
          {data.rows.items.length ? data.rows.items.map((row) => <tr key={rowKey(row)}>
            <th scope="row">{row.label}</th><td>{row.unit}</td>
            {multiWeek && <td>Week {isoWeek(row.week)} · {isoWeekYear(row.week)}</td>}
            <td><Badge status={row.participation ? participationOptions[row.participation] : 'Unavailable'}
              icon={row.participation === 'SUBMITTED' ? <CheckCircle2 aria-hidden="true" /> : row.participation === 'ON_LEAVE' ? <Umbrella aria-hidden="true" /> : row.participation === 'NOT_SUBMITTED' ? <FileText aria-hidden="true" /> : undefined} /></td>
            <td>{row.tasks ?? '—'}</td>
            <td>{row.participation === 'ON_LEAVE' || row.participation === 'NOT_EXPECTED' ? 'Excluded' : row.completion === null ? 'Unavailable' : `${row.completion}%`}</td>
            <td>{row.participation && <Button ref={returnFocus === rowKey(row) ? opener : undefined} size="small" disabled={read.stale || read.loading}
              aria-label={`View week for ${row.label}, ${displayDate(row.week)}`} onClick={() => onOpen(row, data.currentWeekStart)}>View week</Button>}</td>
          </tr>) : <tr><td className="employee-history-empty" colSpan={headings.length}>
            {data.availability.unavailableWeeks.length ? 'No available records match this selection.' : 'No employee weeks match this selection.'}
          </td></tr>}
        </Table>
        <Pagination value={data.rows} label="employee week" onPage={(page) => onView({ ...view, page })} />
        {!read.loading && !read.stale && <AnnounceEvent event={{ id: `team-history:${params}:results:${data.rows.total}`,
          message: `${data.rows.total} employee ${data.rows.total === 1 ? 'week' : 'weeks'} found.`, intent: 'status' }} />}
      </>}
    </section>
    {rangeOpen && current && anchor && data && <DateRange selection={range} anchor={anchor} currentWeek={current} asOf={data.asOf}
      onClose={() => setRangeOpen(false)} onApply={(selection) => { setRangeOpen(false); change({ selection, anchor: selection ? anchor : null }) }} />}
  </>
}

function EmployeeWeek({ view, drill, onView, headingRef, onSessionInvalid, operations, onBack }: Props & {
  drill: Drill; operations: ManagerOperations; onBack: () => void
}) {
  const [taskId, setTaskId] = useState<string | null>(null)
  const record = useManagerOperation(operations)
  const commit = record?.phase === 'committed' ? record.id : null
  const params = new URLSearchParams({ page: String(drill.page), attentionPage: String(drill.attentionPage), ...(drill.status ? { status: drill.status } : {}) })
  const read = useEmployeeRead<TeamWeek>(`${endpoint}/${encodeURIComponent(drill.personId)}/weeks/${drill.week}?${params}`, onSessionInvalid, 'This employee week is not available.')
  const data = read.data
  const entered = useRef(false)
  useLayoutEffect(() => {
    if (!entered.current && !read.loading) {
      entered.current = true
      headingRef.current?.focus()
    }
  }, [read.loading, headingRef])
  function change(update: Partial<Drill>) {
    setTaskId(null)
    onView({ ...view, drill: { ...drill, ...update } })
  }
  const period = weekDates(drill.week)
  const stale = read.stale || read.loading
  return <>
    <div className="team-history-breadcrumb">
      <Button variant="ghost" size="small" onClick={onBack}><ArrowLeft aria-hidden="true" />Back to team</Button>
      {data && <span>{data.person.label}</span>}
    </div>
    <header className="employee-heading manager-heading">
      <div><h1 ref={headingRef} tabIndex={-1}>{data ? `${data.person.label}’s week` : 'Employee week'}</h1><p>A clear view of this employee’s weekly deliverables.</p></div>
      <WeekControls anchor={drill.week} current={data?.currentWeekStart ?? drill.currentWeek} onWeek={(week) => {
        const next = week ?? data?.currentWeekStart ?? drill.currentWeek
        change({ week: next, page: 1, attentionPage: 1 })
      }} />
    </header>
    <ReadFeedback id={`team-week:${drill.personId}:${drill.week}:${params}`} read={read} label="employee week" headingRef={headingRef} />
    {data?.frozen && <p className="employee-banner employee-gray"><LockKeyhole aria-hidden="true" />Week ended. This is a frozen, read-only record.</p>}
    {data && <p className="employee-read-message">{[data.person.business, data.person.unit, data.person.department].filter(Boolean).join(' · ')} · Line manager {data.person.manager} · {data.expectedDays} expected {data.expectedDays === 1 ? 'day' : 'days'}</p>}
    {!taskId && <ChangeRecovery operations={operations} onSessionInvalid={onSessionInvalid} onReload={read.retry} focusRef={headingRef} />}
    {!!data?.attention.total && <section className="ui-card employee-attention">
      <header className="ui-card-head"><div className="employee-attention-title"><span><Info aria-hidden="true" /></span>
        <div><h2>Needs your attention</h2><p>{data.attention.total} {data.attention.total === 1 ? 'task needs' : 'tasks need'} a next step</p></div></div></header>
      {data.attention.items.map((task) => <div className="employee-attention-item" key={task.id}>
        <div><h3>{task.title}</h3><p><b>{taskStatuses[task.status]}:</b> {task.reason ?? '—'}</p></div>
        <Button size="small" disabled={stale} aria-label={`View ${task.title}`} onClick={() => setTaskId(task.id)}>View <ArrowRight aria-hidden="true" /></Button>
      </div>)}
      {data.attention.total > 25 && <Pagination value={data.attention} label="attention" onPage={(attentionPage) => change({ attentionPage })} />}
    </section>}
    <section className="ui-card employee-week-card" aria-busy={read.loading || undefined}>
      <header className="ui-card-head">
        <div><h2>Weekly deliverables</h2><p>{data ? `${data.tasks.total} ${data.tasks.total === 1 ? 'task' : 'tasks'} · ` : ''}{period}</p></div>
        <div className="employee-actions">
          <SelectField className="ui-select-compact" label="Task status" value={drill.status} onChange={(event) => change({ status: event.target.value as Drill['status'], page: 1, attentionPage: 1 })}>
            <option value="">All statuses</option>{Object.entries(taskStatuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </SelectField>
          <div className="employee-view-switch" role="group" aria-label="Task view">
            {(['list', 'card'] as const).map((layout) => <button key={layout} aria-pressed={layout === view.layout} onClick={() => { setTaskId(null); onView({ ...view, layout }) }}>
              {layout === 'list' ? <><List aria-hidden="true" />List</> : <><Grid2X2 aria-hidden="true" />Card</>}
            </button>)}
          </div>
        </div>
      </header>
      <div className="ui-card-body">
        {read.loading && !data && <SkeletonTaskList count={4} />}
        {data && <>
          {data.tasks.items.length ? <div className={`employee-tasks${view.layout === 'card' ? ' employee-task-grid' : ''}`}>
            {data.tasks.items.map((task) => <Task key={task.id} task={task} disabled={stale} onOpen={() => setTaskId(task.id)} />)}
          </div> : <p className="employee-history-empty">{drill.status ? 'No tasks match this status.' : 'No tasks in this week.'}</p>}
          <Pagination value={data.tasks} label="task" onPage={(page) => change({ page })} />
        </>}
      </div>
    </section>
    {taskId && <TeamTaskDrawer key={taskId} id={taskId} headingRef={headingRef} operations={operations} onSessionInvalid={onSessionInvalid}
      onClose={() => setTaskId(null)} commit={commit} />}
  </>
}

function Task({ task, disabled, onOpen }: { task: TeamWeekTask; disabled: boolean; onOpen: () => void }) {
  const StatusIcon = { PENDING: Circle, IN_PROGRESS: Clock, BLOCKED: OctagonAlert, AWAITING_APPROVAL: Hourglass,
    APPROVED: CheckCircle2, DECLINED: Undo2, ON_HOLD: Pause, CANCELLED: Circle }[task.status]
  return <article className="employee-task">
    <button type="button" className="employee-task-open" disabled={disabled} onClick={onOpen}>
      <span className={`employee-task-check employee-status-${task.status}`} aria-hidden="true"><StatusIcon /></span>
      <span className="employee-task-content">
        <strong>{task.title}</strong><span className="team-history-task-activity">{task.activity}</span>
        <span className="employee-task-flags">
          {(task.carryRequested || task.carriedFrom) && <span><Repeat2 aria-hidden="true" />{task.carriedFrom ? 'Carried over' : 'Carries over'}</span>}
          {task.status === 'AWAITING_APPROVAL' && <span>Awaiting manager</span>}
        </span>
      </span>
    </button>
    <div className="employee-task-side"><small className="employee-task-date">{displayDate(task.startsOn, false)} to {displayDate(task.endsOn)}</small>
      <Badge status={taskStatuses[task.status]} /></div>
  </article>
}

export function TeamHistoryPage({ operations, target, onTargetHandled, headingRef, view, onView, onSessionInvalid }: Props & {
  operations: ManagerOperations; target?: { taskId: string; week: string } | null; onTargetHandled?: () => void
}) {
  const incoming = useEmployeeRead<TeamTaskDetail>(target ? `/api/line-manager/team-tasks/${encodeURIComponent(target.taskId)}` : null,
    onSessionInvalid, 'This task is no longer available.')
  const matched = !!target && !incoming.stale && incoming.data?.task.id === target.taskId && incoming.data.week === target.week ? incoming.data : null
  const mismatch = !!incoming.data && !!target && !incoming.stale && !matched
  const record = useManagerOperation(operations)
  const handled = useRef<string | null>(null)
  useEffect(() => {
    if (!matched) { handled.current = null; return }
    if (handled.current === matched.task.id) return
    handled.current = matched.task.id
    onView({ ...view, drill: { personId: matched.ownerId, week: matched.week, currentWeek: matched.currentWeekStart,
      status: '', page: 1, attentionPage: 1 }, returnFocus: null })
  }, [matched, onView, view])
  if (target && !matched) return <><header className="employee-heading"><h1 ref={headingRef} tabIndex={-1}>Team history</h1></header>
    <ReadFeedback id={`team-target:${target.taskId}`} read={{ ...incoming, error: mismatch ? 'This task is no longer available.' : incoming.error }}
      label="team task" headingRef={headingRef} />
    <Button onClick={onTargetHandled}>Back to team</Button></>
  if (target && matched) {
    return <>
      {view.drill && <EmployeeWeek view={view} onView={onView} headingRef={headingRef} onSessionInvalid={onSessionInvalid}
        drill={view.drill} operations={operations} onBack={() => { onTargetHandled?.(); onView({ ...view, drill: null }) }} />}
      <TeamTaskDrawer id={target.taskId} headingRef={headingRef} operations={operations} onSessionInvalid={onSessionInvalid}
        onClose={() => onTargetHandled?.()} commit={record?.phase === 'committed' ? record.id : null} />
    </>
  }
  return view.drill ? <EmployeeWeek view={view} onView={onView} headingRef={headingRef} onSessionInvalid={onSessionInvalid}
    drill={view.drill} operations={operations} onBack={() => onView({ ...view, drill: null })} />
    : <Roster view={view} onView={onView} headingRef={headingRef} onSessionInvalid={onSessionInvalid}
      returnFocus={view.returnFocus} onFocusRestored={() => onView({ ...view, returnFocus: null })} onOpen={(row, currentWeek) => {
      onView({ ...view, returnFocus: rowKey(row), drill: { personId: row.id, week: row.week, currentWeek, status: '', page: 1, attentionPage: 1 } })
    }} />
}
