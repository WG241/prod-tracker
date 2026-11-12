import { useRef, useState } from 'react'
import type { RefObject } from 'react'
import { ArrowRight, Bell, CalendarDays, ChevronLeft, ChevronRight, CircleCheck, Clock, Hourglass, OctagonAlert, Umbrella, Users } from 'lucide-react'
import { AnnounceEvent } from '../../components/accessibility/Announcements.tsx'
import { Avatar } from '../../components/ui/Avatar.tsx'
import { Button, IconButton } from '../../components/ui/Button.tsx'
import { Card } from '../../components/ui/Card.tsx'
import { SkeletonText, SkeletonTable } from '../../components/ui/Skeleton.tsx'
import { Table } from '../../components/ui/Table.tsx'
import { DateRange } from '../employee/DateRange.tsx'
import { displayDate, displayTime, isoWeek, shiftDate } from '../employee/date.ts'
import { Pagination } from '../employee/Pagination.tsx'
import type { Page, Selection } from '../employee/contracts.ts'
import type { ApprovalGroup, BlockedTask, DashboardMetrics, DashboardRead, DashboardSection, MissingSubmission } from './dashboard-view.ts'
import { TeamTrend } from './TeamTrend.tsx'
import '../employee/employee.css'
import './manager-dashboard.css'

const metrics = [
  { key: 'members', label: 'Team members', detail: 'Your assigned team', icon: Users },
  { key: 'completion', label: 'Team completion rate', detail: 'Approved completions only', icon: CircleCheck },
  { key: 'awaiting', label: 'Awaiting my approval', detail: 'Employees awaiting a decision', icon: Hourglass },
  { key: 'inProgress', label: 'In progress', detail: 'Tasks currently in motion', icon: Clock },
] as const

function Metrics({ values, loading }: { values?: DashboardMetrics; loading: boolean }) {
  return <dl className="manager-metrics">
    {metrics.map(({ key, label, detail, icon: Icon }) => {
      const value = values?.[key]
      return <div key={key} className="manager-metric">
        <dt>{label}<Icon aria-hidden="true" /></dt>
        <dd className="manager-metric-value">{loading ? <SkeletonText width="short" /> : value == null ? <span>Unavailable</span> : `${value}${key === 'completion' ? '%' : ''}`}</dd>
        <dd>{detail}</dd>
      </div>
    })}
  </dl>
}

function Empty({ children }: { children: string }) {
  return <p className="manager-empty">{children}</p>
}

function PageFooter({ value, label, onPage, showCount = false }: { value: Page<unknown>; label: string; onPage: (page: number) => void; showCount?: boolean }) {
  if (value.total <= value.pageSize && value.page === 1 && (!showCount || !value.total)) return null
  return <Pagination value={value} label={label} onPage={onPage} />
}

type DashboardProps = {
  headingRef: RefObject<HTMLHeadingElement | null>
  anchor: string | null
  currentWeek: string | null
  asOf: string
  range: Extract<Selection, { kind: 'range' }> | null
  rangeWeeks: string
  read: DashboardRead
  readId: string
  onWeek: (week: string) => void
  onRange: (range: Extract<Selection, { kind: 'range' }> | null) => void
  onPage: (section: DashboardSection, page: number) => void
  onRetry: () => void
  onReloadLatest: () => void
  onApprovals: (group?: ApprovalGroup, opener?: HTMLButtonElement) => void
  onComment: (task: BlockedTask) => void
  onRemind?: (person: MissingSubmission) => void
  reminderBusy?: (person: MissingSubmission) => boolean
  writesPaused?: boolean
}

export function ManagerDashboard({ headingRef, anchor, currentWeek, asOf, range, rangeWeeks, read, readId, onWeek, onRange, onPage, onRetry, onReloadLatest, onApprovals, onComment, onRemind, reminderBusy, writesPaused }: DashboardProps) {
  const [rangeOpen, setRangeOpen] = useState(false)
  const rangeButton = useRef<HTMLButtonElement>(null)
  const previous = anchor && shiftDate(anchor, -7)
  const next = anchor && shiftDate(anchor, 7)
  const data = read.kind === 'ready' ? read.data : null
  const stale = read.kind === 'ready' ? read.staleMessage : undefined
  const loading = read.kind === 'loading'

  return <div className="manager-dashboard">
    <div className="employee-heading manager-heading">
      <div>
        <p className="eyebrow">Team overview</p>
        <h1 ref={headingRef} tabIndex={-1}>Your team, in focus</h1>
        <p>Give your team a clear next step.</p>
      </div>
      <div className="employee-week-controls" role="group" aria-label="Dashboard period">
        <IconButton label="Previous week" disabled={!previous} onClick={() => previous && onWeek(previous)}><ChevronLeft aria-hidden="true" /></IconButton>
        <span className="employee-period-label">
          <b>{range ? 'Custom range' : anchor ? `Week ${isoWeek(anchor)}` : 'Workweek'}</b>
          <small>{range ? `${displayDate(range.from, range.from.slice(0, 4) !== range.to.slice(0, 4))} to ${displayDate(range.to)}` : anchor ? `${displayDate(anchor, false)} to ${displayDate(shiftDate(anchor, 4) ?? anchor)}` : 'Current week'}</small>
        </span>
        <IconButton label="Next week" disabled={!next} onClick={() => next && onWeek(next)}><ChevronRight aria-hidden="true" /></IconButton>
        <IconButton ref={rangeButton} label="Open date range" disabled={!currentWeek} onClick={() => setRangeOpen(true)}><CalendarDays aria-hidden="true" /></IconButton>
        {range && <Button variant="ghost" size="small" onClick={() => { rangeButton.current?.focus(); onRange(null) }}>Clear range</Button>}
        <button type="button" className="employee-this-week" disabled={!currentWeek} onClick={() => currentWeek && onWeek(currentWeek)}>This week</button>
      </div>
    </div>
    {range && <p className="manager-range-summary">{rangeWeeks}</p>}
    {loading && <AnnounceEvent event={{ id: `manager-dashboard-loading:${readId}`, message: 'Loading team dashboard…', intent: 'status' }} />}
    {read.kind === 'error' && <div className="employee-banner employee-amber">
      <p>{read.message}</p><Button size="small" onClick={() => { headingRef.current?.focus(); onRetry() }}>Retry</Button>
      <AnnounceEvent event={{ id: `manager-dashboard-error:${readId}`, message: read.message, intent: 'alert' }} />
    </div>}
    {stale && data && <div className="employee-banner employee-amber">
      <p>{stale} Last loaded {displayTime(data.asOf)}.</p>
      <Button size="small" onClick={() => { headingRef.current?.focus(); onReloadLatest() }}>Reload latest</Button>
      <AnnounceEvent event={{ id: `manager-dashboard-stale:${readId}`, message: stale, intent: 'status' }} />
    </div>}
    {data?.availabilityMessage && <div className="employee-banner employee-gray"><p>{data.availabilityMessage}</p></div>}
    <div className="manager-sections" aria-busy={loading || undefined}>
      <Metrics values={data?.metrics} loading={loading} />
      <Card title="Awaiting your approval" description="Grouped by employee, so no one gets lost in the queue." className="manager-table-card"
        actions={<Button size="small" variant="ghost" onClick={() => onApprovals()}>View approvals <ArrowRight aria-hidden="true" /></Button>}>
        {loading ? <SkeletonTable /> : !data ? <Empty>Approval data is unavailable.</Empty> : <>
          {data.approvals.items.length ? <Table caption="Employees awaiting approval" headings={['Employee', 'Completions awaiting review', 'Oldest wait', 'Action']}>
            {data.approvals.items.map((group) => {
              const wait = `${group.oldestDays} ${group.oldestDays === 1 ? 'day' : 'days'}`
              return <tr key={group.employeeId} className={group.overdue ? 'manager-overdue-row' : undefined}>
                <th scope="row"><div className="manager-person"><Avatar name={group.employeeName} /><span>{group.employeeName}<small>{group.unitName}</small></span></div></th>
                <td>{group.taskCount} {group.taskCount === 1 ? 'task' : 'tasks'} · oldest {wait}</td>
                <td>{group.overdue ? <span className="manager-overdue"><Clock aria-hidden="true" />{wait} · Overdue</span> : wait}</td>
                <td><Button size="small" disabled={!group.requestId || !!stale} onClick={(event) => onApprovals(group, event.currentTarget)} aria-label={`Review work for ${group.employeeName}`}>Review <ArrowRight aria-hidden="true" /></Button></td>
              </tr>
            })}
          </Table> : <Empty>{data.approvals.total ? 'No approvals on this page.' : 'No completions are awaiting your approval.'}</Empty>}
          <PageFooter value={data.approvals} label="approval" showCount onPage={(page) => onPage('approvals', page)} />
        </>}
      </Card>
      <div className="manager-pair">
        <Card title="Weekly team trend" description="A steady view of submission and delivery">
          {loading ? <SkeletonTable rows={3} cols={3} /> : data ? <TeamTrend weeks={data.trend} /> : <Empty>Trend data is unavailable.</Empty>}
        </Card>
        <Card title="Haven’t submitted yet" className="manager-table-card manager-missing">
          {loading ? <SkeletonTable rows={3} /> : !data ? <Empty>Submission data is unavailable.</Empty> : <>
            {data.missing.items.length ? <Table caption="Employees who haven’t submitted yet" headings={['Employee', 'Unit', 'Manager', 'Action']}>
              {data.missing.items.map((person) => <tr key={`${person.employeeId}:${person.week}`}>
                <th scope="row">{person.employeeName}</th><td>{person.unitName}</td><td>{person.managerName}</td>
                <td><Button size="small" busy={reminderBusy?.(person)} aria-disabled={!person.canRemind || !!stale || !!writesPaused}
                  onClick={() => onRemind?.(person)} aria-label={person.reminded ? `Reminder sent to ${person.employeeName}` : `Remind ${person.employeeName}`}>
                  <Bell aria-hidden="true" />{person.reminded ? 'Reminded' : 'Remind'}</Button></td>
              </tr>)}
            </Table> : <Empty>{data.missing.total ? 'No employees on this page.' : data.availabilityMessage ? 'No missing submissions to show.' : 'Everyone expected has submitted.'}</Empty>}
            <PageFooter value={data.missing} label="missing submission" onPage={(page) => onPage('missing', page)} />
          </>}
        </Card>
      </div>
      <div className="manager-pair">
        <Card title="Blocked tasks">
          {loading ? <SkeletonTable rows={3} cols={2} /> : !data ? <Empty>Blocked task data is unavailable.</Empty> : <>
            {data.blocked.items.length ? <ul className="manager-notices">
              {data.blocked.items.map((task) => <li key={task.id}>
                <OctagonAlert aria-hidden="true" /><div><strong>{task.title}</strong><small>{task.ownerName} · {task.reason}</small></div>
                <Button size="small" disabled={!!stale || task.current === false} onClick={() => onComment(task)} aria-label={`Comment on ${task.title}`}>Comment</Button>
              </li>)}
            </ul> : <Empty>{data.blocked.total ? 'No blockers on this page.' : 'No blocked tasks to show.'}</Empty>}
            <PageFooter value={data.blocked} label="blocker" onPage={(page) => onPage('blocked', page)} />
          </>}
        </Card>
        <Card title="Recent activity">
          {loading ? <SkeletonTable rows={2} cols={2} /> : !data ? <Empty>Activity data is unavailable.</Empty> : <>
            {data.activity.items.length ? <ul className="manager-notices">
              {data.activity.items.map(({ id, kind, summary }) => <li key={id}>{kind === 'decision' ? <CircleCheck aria-hidden="true" /> : <Umbrella aria-hidden="true" />}<p>{summary}</p></li>)}
            </ul> : <Empty>{data.activity.total ? 'No activity on this page.' : 'No recent activity to show.'}</Empty>}
            <PageFooter value={data.activity} label="activity" onPage={(page) => onPage('activity', page)} />
          </>}
        </Card>
      </div>
    </div>
    {rangeOpen && anchor && currentWeek && <DateRange selection={range} anchor={anchor} currentWeek={currentWeek} asOf={asOf} onApply={(selection) => {
      onRange(selection?.kind === 'range' ? selection : null)
      setRangeOpen(false)
    }} onClose={() => setRangeOpen(false)} />}
  </div>
}
