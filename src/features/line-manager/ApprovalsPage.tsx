import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { ArrowRight, CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { AnnounceEvent } from '../../components/accessibility/Announcements.tsx'
import { Badge } from '../../components/ui/Badge.tsx'
import { Button, IconButton } from '../../components/ui/Button.tsx'
import { InputField, SelectField } from '../../components/ui/Field.tsx'
import { NoticeToast } from '../../components/ui/NoticeToast.tsx'
import { SkeletonTable } from '../../components/ui/Skeleton.tsx'
import { Table } from '../../components/ui/Table.tsx'
import type { Selection } from '../employee/contracts.ts'
import { DateRange } from '../employee/DateRange.tsx'
import { displayDate, displayTime, isoWeek, shiftDate } from '../employee/date.ts'
import { Pagination } from '../employee/Pagination.tsx'
import { useEmployeeRead } from '../employee/useEmployeeRead.ts'
import type { NotificationTarget } from '../notifications/contracts.ts'
import { approvalEndpoint, approvalTabs, periodParams } from './approvals-contracts.ts'
import type { ApprovalTab, ApprovalsView, ReviewList, ReviewPeople } from './approvals-contracts.ts'
import { useManagerOperation } from './manager-operations.ts'
import type { ManagerOperations } from './manager-operations.ts'
import { ReviewOverlay } from './ReviewOverlay.tsx'
import type { ReviewSurface } from './ReviewOverlay.tsx'
import { ChangeRecovery, TeamTaskDrawer } from './TeamTaskDrawer.tsx'
import '../employee/employee.css'
import './approvals.css'

type Overlay = ReviewSurface | { kind: 'blocker'; id: string }
export type ApprovalOpen = Extract<NotificationTarget, { kind: 'REVIEW_REQUEST' }>
const tabs: Record<ApprovalTab, string> = { AWAITING: 'Awaiting', APPROVED: 'Approved', DECLINED: 'Declined', BLOCKERS: 'Blockers' }

export function ApprovalsPage({ view, onView, open, onOpenHandled, headingRef, operations, onSessionInvalid }: {
  view: ApprovalsView; onView: (view: ApprovalsView) => void; open: ApprovalOpen | null; onOpenHandled: () => void
  headingRef: RefObject<HTMLHeadingElement | null>; operations: ManagerOperations; onSessionInvalid: () => void
}) {
  const [overlay, setOverlay] = useState<Overlay | null>(() => open
    ? { kind: 'review', id: open.requestId, expected: { taskId: open.taskId, week: open.week } } : null)
  const [rangeOpen, setRangeOpen] = useState(false)
  const record = useManagerOperation(operations)
  const commit = record?.phase === 'committed' ? record.id : null
  const seen = useRef(commit)
  const params = new URLSearchParams({ tab: view.tab, ...periodParams(view.selection), page: String(view.page),
    ...(view.personId ? { personId: view.personId } : {}) })
  const peopleParams = new URLSearchParams({ tab: view.tab, ...periodParams(view.selection), page: String(view.peoplePage), search: view.search })
  const read = useEmployeeRead<ReviewList>(`${approvalEndpoint}?${params}`, onSessionInvalid)
  const people = useEmployeeRead<ReviewPeople>(`${approvalEndpoint}/people?${peopleParams}`, onSessionInvalid)
  const { retry: retryList } = read
  const { retry: retryPeople } = people
  useEffect(() => {
    if (open) onOpenHandled()
  }, [open, onOpenHandled])
  useEffect(() => {
    if (commit === seen.current) return
    seen.current = commit
    retryList()
    retryPeople()
  }, [commit, retryList, retryPeople])
  const settled = record?.phase === 'committed' && 'items' in record.result

  const data = read.data
  const clock = data ?? people.data
  const current = clock?.currentWeekStart ?? null
  const anchor = view.selection?.kind === 'week' ? view.selection.week : current
  const range = view.selection?.kind === 'range' ? view.selection : null
  const weeks = data?.weeks ?? []
  const allWeeks = view.tab === 'AWAITING' ? 'All pending weeks' : 'All workweeks'
  const periodLabel = range ? 'Custom range' : view.selection?.kind === 'week' ? `Week ${isoWeek(view.selection.week)}` : allWeeks
  const dateLabel = range ? `${displayDate(range.from)} to ${displayDate(range.to)}`
    : view.selection?.kind === 'week' ? `${displayDate(view.selection.week, false)} to ${displayDate(shiftDate(view.selection.week, 4) ?? view.selection.week)}` : null
  const options = people.data?.people.items ?? []
  function change(update: Partial<ApprovalsView>) {
    setOverlay(null)
    onView({ ...view, page: 1, peoplePage: 1, ...update })
  }
  function choose(selection: Selection | null) { change({ selection }) }
  function move(days: number) {
    const week = anchor ? shiftDate(anchor, days) : null
    if (week) choose({ kind: 'week', week })
  }
  const stale = read.stale || read.loading || !!read.error
  const resultLabel = settled ? record.result.operation === 'LM_DECLINE' ? 'Decline sent.' : 'Approval saved.' : ''
  return <div className="manager-approvals">
    <header className="employee-heading manager-heading">
      <div><h1 ref={headingRef} tabIndex={-1}>Approvals</h1><p>Review completions and track feedback and blockers for your team.</p></div>
      <div className="employee-week-controls" role="group" aria-label="Approval period">
        <IconButton label="Previous week" disabled={!anchor || !shiftDate(anchor, -7)} onClick={() => move(-7)}><ChevronLeft aria-hidden="true" /></IconButton>
        <span className="employee-period-label"><b>{periodLabel}</b>{dateLabel && <small>{dateLabel}</small>}</span>
        <IconButton label="Next week" disabled={!anchor || !shiftDate(anchor, 7)} onClick={() => move(7)}><ChevronRight aria-hidden="true" /></IconButton>
        <IconButton label="Open date range" disabled={!clock} onClick={() => setRangeOpen(true)}><CalendarDays aria-hidden="true" /></IconButton>
        <button type="button" className="employee-this-week" disabled={!current} onClick={() => current && choose({ kind: 'week', week: current })}>This week</button>
      </div>
    </header>
    <div className="employee-view-switch review-tabs" role="group" aria-label="Approval views">
      {approvalTabs.map((tab) => <button key={tab} type="button" aria-pressed={view.tab === tab} onClick={() => change({ tab, personId: '', search: '' })}>
        {tabs[tab]}{data ? ` (${data.counts[tab]})` : ''}</button>)}
    </div>
    <div className="employee-history-filters team-history-filters review-filters">
      <InputField type="search" label="Find an employee to filter by" placeholder="Search employee or unit…" maxLength={120} value={view.search}
        onChange={(event) => change({ search: event.target.value, page: view.page })} />
      <SelectField label="Employee" value={view.personId} onChange={(event) => change({ personId: event.target.value, peoplePage: view.peoplePage })}>
        <option value="">All employees</option>
        {view.personId && !options.some(({ id }) => id === view.personId) && <option value={view.personId}>Selected employee</option>}
        {options.map(({ id, label, unit }) => <option key={id} value={id}>{label}{unit ? ` · ${unit}` : ''}</option>)}
      </SelectField>
      <SelectField label="Workweek" value={range ? 'range' : view.selection?.kind === 'week' ? view.selection.week : ''}
        onChange={(event) => { const week = event.target.value; if (week !== 'range') choose(week ? { kind: 'week', week } : null) }}>
        <option value="">{allWeeks}</option>
        {range && <option value="range">Custom range</option>}
        {[...new Set([...weeks, ...(view.selection?.kind === 'week' ? [view.selection.week] : [])])].sort().reverse()
          .map((week) => <option key={week} value={week}>Week {isoWeek(week)} · {displayDate(week)}</option>)}
      </SelectField>
    </div>
    {people.data && (people.data.people.total > 25 || view.peoplePage > 1) && <Pagination value={people.data.people} label="employee option"
      onPage={(peoplePage) => onView({ ...view, peoplePage })} />}
    {people.error && <div className="employee-banner employee-amber"><p>Employee options are unavailable.</p><Button size="small" onClick={people.retry}>Retry options</Button></div>}
    {data?.workPaused && <p className="employee-banner employee-gray">Your work actions are paused while you are on leave.</p>}
    {!!data?.routingUnavailableCount && <p className="employee-banner employee-amber">Some pending work needs routing review. Contact HR.</p>}
    {read.error && <div className="employee-banner employee-amber"><p>{read.error}{data ? ' These approvals may be out of date.' : ''}</p>
      <Button size="small" onClick={read.retry}>Retry</Button><AnnounceEvent event={{ id: `approvals-error:${params}`, message: read.error, intent: 'alert' }} /></div>}
    {!overlay && <ChangeRecovery operations={operations} onSessionInvalid={onSessionInvalid} onReload={read.retry} focusRef={headingRef} />}
    <section className="ui-card employee-history-card" aria-label={`${tabs[view.tab]} approvals`} aria-busy={read.loading || undefined}>
      {read.loading && !data && <div className="ui-card-body"><SkeletonTable rows={5} cols={5} /></div>}
      {data && view.tab === 'AWAITING' && <>
        <Table caption="Completions awaiting review" headings={['Employee', 'Completions awaiting review', 'Oldest wait', 'Action']}>
          {data.groups.items.length ? data.groups.items.map((group) => <tr key={group.employeeId}>
            <th scope="row">{group.employeeName}<small className="review-unit">{group.unitName}</small></th>
            <td>{group.taskCount} {group.taskCount === 1 ? 'task' : 'tasks'}</td><td>{group.overdue ? <Badge status="Overdue" /> : null} {group.oldestDays} {group.oldestDays === 1 ? 'day' : 'days'}</td>
            <td><Button size="small" disabled={stale} aria-label={`Review ${group.employeeName}`} onClick={() => setOverlay({ kind: 'group', personId: group.employeeId, page: 1 })}>Review <ArrowRight aria-hidden="true" /></Button></td>
          </tr>) : <tr><td colSpan={4} className="employee-history-empty">{data.routingUnavailableCount ? 'No available completions match this selection.' : 'Nothing waiting for your approval.'}</td></tr>}
        </Table><Pagination value={data.groups} label="awaiting approval" onPage={(page) => onView({ ...view, page })} />
      </>}
      {data && (view.tab === 'APPROVED' || view.tab === 'DECLINED') && <>
        <Table caption={`${tabs[view.tab]} attempts`} headings={['Employee', 'Task', 'Status', 'Note / Reason', 'Action']}>
          {data.decisions.items.length ? data.decisions.items.map((row) => <tr key={row.requestId}>
            <th scope="row">{row.ownerName}<small className="review-unit">{row.unit}</small></th>
            <td><b>{row.title}</b><small className="review-unit">{row.activity}</small></td>
            <td><Badge status={tabs[view.tab]} /></td><td>{row.decision.reason ?? `Signed off by ${row.decision.actor} · ${displayTime(row.decision.decidedAt)}`}</td>
            <td><Button size="small" disabled={stale} aria-label={`View details for ${row.title}`} onClick={() => setOverlay({ kind: 'review', id: row.requestId })}>View details</Button></td>
          </tr>) : <tr><td colSpan={5} className="employee-history-empty">No decisions match this selection.</td></tr>}
        </Table><Pagination value={data.decisions} label="decision" onPage={(page) => onView({ ...view, page })} />
      </>}
      {data && view.tab === 'BLOCKERS' && <>
        <Table caption="Blocked tasks" headings={['Employee', 'Task', 'Reason', 'Blocked on', 'Carried over', 'Action']}>
          {data.blockers.items.length ? data.blockers.items.map((row) => <tr key={row.taskId}>
            <th scope="row">{row.ownerName}<small className="review-unit">{row.unit}</small></th>
            <td><b>{row.title}</b><small className="review-unit">{row.activity}</small></td><td>{row.reason}</td><td>{displayDate(row.startsOn)}</td><td>{row.carried ? 'Yes' : 'No'}</td>
            <td><Button size="small" disabled={stale} aria-label={`Comment on ${row.title}`} onClick={() => setOverlay({ kind: 'blocker', id: row.taskId })}>Comment</Button></td>
          </tr>) : <tr><td colSpan={6} className="employee-history-empty">No blocked tasks match this selection.</td></tr>}
        </Table><Pagination value={data.blockers} label="blocker" onPage={(page) => onView({ ...view, page })} />
      </>}
    </section>
    {rangeOpen && anchor && clock && <DateRange selection={range} anchor={anchor} currentWeek={clock.currentWeekStart} asOf={clock.asOf}
      onClose={() => setRangeOpen(false)} onApply={(selection) => { setRangeOpen(false); choose(selection) }} />}
    {overlay && overlay.kind !== 'blocker' && <ReviewOverlay surface={overlay} onSurface={setOverlay} selection={view.selection}
      headingRef={headingRef} operations={operations} onSessionInvalid={onSessionInvalid}
      onResolved={(attempt) => { if (view.personId !== attempt.ownerId) onView({ ...view, personId: attempt.ownerId, page: 1 }) }} />}
    {overlay?.kind === 'blocker' && <TeamTaskDrawer key={overlay.id} id={overlay.id} headingRef={headingRef} operations={operations}
      onSessionInvalid={onSessionInvalid} onClose={() => setOverlay(null)} commit={commit} />}
    {settled && commit && resultLabel && <NoticeToast key={commit} id={`approval-result:${commit}`} message={resultLabel} />}
  </div>
}
