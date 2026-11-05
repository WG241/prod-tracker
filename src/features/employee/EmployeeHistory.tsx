import { useEffect, useState } from 'react'
import type { RefObject } from 'react'
import { CalendarDays, X } from 'lucide-react'
import { Badge } from '../../components/ui/Badge.tsx'
import { Button } from '../../components/ui/Button.tsx'
import { SelectField } from '../../components/ui/Field.tsx'
import { Table } from '../../components/ui/Table.tsx'
import { SkeletonTable } from '../../components/ui/Skeleton.tsx'
import { AnnounceEvent } from '../../components/accessibility/Announcements.tsx'
import { taskStatuses } from './contracts.ts'
import { displayDate, displayTime, isoWeek, isoWeekYear } from './date.ts'
import { DateRange } from './DateRange.tsx'
import { Pagination } from './Pagination.tsx'
import { TaskDrawer } from './TaskDrawer.tsx'
import { useEmployeeRead } from './useEmployeeRead.ts'
import type { HistoryResponse, HistoryView } from './history-contracts.ts'
import type { TaskOperations } from './operations.ts'
import './employee.css'

export function EmployeeHistory({ state, onState, headingRef, onSessionInvalid, operations }: {
  state: HistoryView; onState: (next: HistoryView) => void; headingRef: RefObject<HTMLHeadingElement | null>; onSessionInvalid: () => void; operations: TaskOperations
}) {
  const params = new URLSearchParams({ page: String(state.page), ...(state.week ? { week: state.week } : {}), ...(state.status ? { status: state.status } : {}), ...(state.from && state.to ? { from: state.from, to: state.to } : {}) })
  const read = useEmployeeRead<HistoryResponse>(`/api/employee/history?${params}`, onSessionInvalid)
  const data = read.data
  const [rangeOpen, setRangeOpen] = useState(false)
  const [taskId, setTaskId] = useState<string | null>(null)
  function change(next: Partial<HistoryView>) { setTaskId(null); onState({ ...state, ...next, page: 1 }) }
  useEffect(() => {
    if (!data || read.loading) return
    const last = Math.max(1, Math.ceil(data.records.total / 25))
    if (state.page > last) onState({ ...state, page: last })
  }, [data, read.loading, state, onState])
  const unavailable = data?.selectedWeekState === 'PENDING' || data?.selectedWeekState === 'REPAIR_REQUIRED'
  const empty = unavailable ? 'Historical records for this week are unavailable.' : data?.selectedWeekState === 'NOT_FROZEN' ? 'This week has not closed yet.' : data?.selectedWeekState === 'NO_RECORD' ? 'No historical record is available for this week.' : state.status || state.from ? 'No tasks match these filters.' : state.week ? 'No tasks in this week.' : 'No historical tasks yet.'
  return <>
    <header className="employee-heading"><div><h1 ref={headingRef} tabIndex={-1}>Your work, week by week</h1><p>Final statuses and the context behind your previous deliverables.</p></div></header>
    <div className="employee-history-filters">
      <Button aria-label="Date range" title="Date range" className="employee-history-date-button" onClick={() => { setTaskId(null); setRangeOpen(true) }} disabled={!data}><CalendarDays aria-hidden="true" /></Button>
      <SelectField className="ui-select-compact employee-history-filter" label="Task status" value={state.status} onChange={(event) => change({ status: event.target.value })}><option value="">All statuses</option>{Object.entries(taskStatuses).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</SelectField>
      {state.from && <><span className="employee-muted">{displayDate(state.from)} to {displayDate(state.to)}</span><Button variant="ghost" size="small" onClick={() => change({ from: '', to: '' })}>Clear <X aria-hidden="true" /></Button></>}
    </div>
    {data && (data.availability.pendingWeeks > 0 || data.availability.repairWeeks > 0 || !data.availability.captureInitialized) && <div className="employee-banner employee-gray"><p>{data.availability.pendingWeeks > 0 && `${data.availability.pendingWeeks} ${data.availability.pendingWeeks === 1 ? 'week is' : 'weeks are'} still being prepared. `}{data.availability.repairWeeks > 0 && `${data.availability.repairWeeks} ${data.availability.repairWeeks === 1 ? 'week needs' : 'weeks need'} historical repair. Contact HR. `}{!data.availability.captureInitialized && 'Automatic history capture has not started. Existing valid records remain available.'}</p><Button size="small" onClick={read.retry}>Retry</Button></div>}
    <section className="ui-card employee-history-card" aria-busy={read.loading || undefined}>
      {read.loading && !data && <div className="ui-card-body"><SkeletonTable rows={8} cols={4} /></div>}
      {read.loading && <AnnounceEvent event={{ id: `history-loading:${params}`, message: 'Loading history…', intent: 'status' }} />}
      {read.error && <div className="employee-banner employee-amber"><p>{read.error}</p><Button size="small" onClick={read.retry}>Retry</Button><AnnounceEvent event={{ id: `history-error:${params}:${read.error}`, message: read.error, intent: 'alert' }} /></div>}
      {data && <>
        {read.stale && <p className="employee-read-message">This history may be out of date. Last loaded {displayTime(data.asOf)}.</p>}
        <Table caption="Your historical tasks" headings={['Week', 'Task', 'Status', 'Dates']}>
          {data.records.items.length ? data.records.items.map((task) => <tr key={task.id}><td><b>Week {isoWeek(task.week)} · {isoWeekYear(task.week)}</b></td><th scope="row"><button className="employee-history-task" onClick={() => setTaskId(task.id)}>{task.title}</button><small className="employee-history-owner">{task.ownerName}</small></th><td><Badge status={taskStatuses[task.status]} /></td><td>{displayDate(task.startsOn, false)} – {displayDate(task.endsOn)}</td></tr>) : <tr><td colSpan={4} className="employee-history-empty">{empty}</td></tr>}
        </Table><Pagination value={data.records} label="history tasks" onPage={(page) => { setTaskId(null); onState({ ...state, page }) }} />
      </>}
    </section>
    {rangeOpen && data && <DateRange selection={state.from ? { kind: 'range', from: state.from, to: state.to } : null} anchor={state.week || data.currentWeekStart} currentWeek={data.currentWeekStart} asOf={data.asOf} onClose={() => setRangeOpen(false)} onApply={(range) => { setRangeOpen(false); change({ from: range?.kind === 'range' ? range.from : '', to: range?.kind === 'range' ? range.to : '' }) }} />}
    {taskId && !rangeOpen && <TaskDrawer key={taskId} taskId={taskId} inspection operations={operations} onAction={() => {}} onClose={() => setTaskId(null)} onSessionInvalid={onSessionInvalid} />}
  </>
}
