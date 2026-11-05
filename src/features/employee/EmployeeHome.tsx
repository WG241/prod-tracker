import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { ArrowRight, CalendarDays, Check, CheckCircle2, ChevronLeft, ChevronRight, Circle, Clock, Grid2X2, Hourglass, Info, List, LockKeyhole, LockKeyholeOpen, OctagonAlert, Pause, Plus, Repeat2, Umbrella, Undo2, X } from 'lucide-react'
import { Button, IconButton } from '../../components/ui/Button.tsx'
import { Badge } from '../../components/ui/Badge.tsx'
import { SkeletonTaskList } from '../../components/ui/Skeleton.tsx'
import { AnnounceEvent } from '../../components/accessibility/Announcements.tsx'
import type { EmployeeView, HomeResponse, Selection, TaskEntry } from './contracts.ts'
import { taskStatuses } from './contracts.ts'
import { displayDate, displayTime, isoWeek, shiftDate } from './date.ts'
import { useEmployeeRead } from './useEmployeeRead.ts'
import { Pagination } from './Pagination.tsx'
import { DateRange } from './DateRange.tsx'
import { TaskDrawer } from './TaskDrawer.tsx'
import { TaskMenu } from './TaskMenu.tsx'
import type { TaskAction } from './TaskMenu.tsx'
import { TaskActionDialog } from './TaskActionDialog.tsx'
import type { ActionSelection } from './TaskActionDialog.tsx'
import { useTaskOperations } from './operations.ts'
import type { TaskOperations } from './operations.ts'
import { useLeaveOperations } from './leave-operations.ts'
import type { LeaveOperations } from './leave-operations.ts'
import { LeaveFeedback } from './EmployeeLeave.tsx'
import './employee.css'

function TaskItem({ task, onOpen, onAction, stale }: { task: TaskEntry; onOpen: (id: string) => void; onAction: (task: TaskEntry, action: TaskAction) => void; stale: boolean }) {
  const StatusIcon = { PENDING: Circle, IN_PROGRESS: Clock, BLOCKED: OctagonAlert, AWAITING_APPROVAL: Hourglass, APPROVED: CheckCircle2, DECLINED: Undo2, ON_HOLD: Pause, CANCELLED: Circle }[task.status]
  return <article className="employee-task">
    <button className="employee-task-open" onClick={() => onOpen(task.id)}><span className={`employee-task-check employee-status-${task.status}`} aria-hidden="true"><StatusIcon /></span><span className="employee-task-content"><h3>{task.title}</h3><p>{task.activity}</p><span className="employee-task-flags">{(task.carryRequested || task.carriedFrom) && <span><Repeat2 aria-hidden="true" />{task.carriedFrom ? 'Carried over' : 'Carries over'}</span>}{task.status === 'AWAITING_APPROVAL' && <span>Awaiting manager</span>}{(task.status === 'BLOCKED' || task.status === 'DECLINED') && <span>{taskStatuses[task.status]}</span>}</span></span></button>
    <div className="employee-task-side"><div className="employee-task-side-top"><small className="employee-task-date">{displayDate(task.startsOn, false)} – {displayDate(task.endsOn)}</small><TaskMenu task={task} onAction={onAction} stale={stale} /></div><Badge status={taskStatuses[task.status]} /></div>
  </article>
}

function SavedNotice({ commit, message }: { commit: number; message: string }) {
  const [visible, setVisible] = useState(true)
  useEffect(() => { const timer = window.setTimeout(() => setVisible(false), 6000); return () => window.clearTimeout(timer) }, [])
  return visible ? <><p className="auth-toast">{message}</p><AnnounceEvent event={{ id: `task-saved:${commit}`, message, intent: 'status' }} /></> : null
}

export function EmployeeHome({ name, state, onState, headingRef, onSessionInvalid, operations, leaveOperations }: { name: string; state: EmployeeView; onState: (value: EmployeeView) => void; headingRef: RefObject<HTMLHeadingElement | null>; onSessionInvalid: () => void; operations: TaskOperations; leaveOperations: LeaveOperations }) {
  const { selection, page, attentionPage, view } = state
  const params = new URLSearchParams({ ...(selection?.kind === 'week' ? { week: selection.week } : selection?.kind === 'range' ? { from: selection.from, to: selection.to } : {}), page: String(page), attentionPage: String(attentionPage) })
  const read = useEmployeeRead<HomeResponse>(`/api/employee/home?${params}`, onSessionInvalid)
  const data = read.data
  const store = useTaskOperations(operations)
  const leaveStore = useLeaveOperations(leaveOperations)
  const seenLeave = useRef(leaveStore.commits)
  useEffect(() => { if (seenLeave.current !== leaveStore.commits) { seenLeave.current = leaveStore.commits; headingRef.current?.focus(); read.retry() } }, [leaveStore.commits, read, headingRef])
  const carryRecord = store.carryRecord()
  const [action, setAction] = useState<ActionSelection | null>(null)
  const opener = useRef<HTMLElement | null>(null)
  const seenCommit = useRef(store.commits)
  useEffect(() => { if (seenCommit.current !== store.commits) { seenCommit.current = store.commits; read.retry() } }, [store.commits, read])
  useEffect(() => {
    if (!data || read.loading) return
    const last = Math.max(1, Math.ceil(data.tasks.total / 25)), attentionLast = Math.max(1, Math.ceil(data.attention.total / 25))
    if (page > last || attentionPage > attentionLast) onState({ ...state, page: Math.min(page, last), attentionPage: Math.min(attentionPage, attentionLast) })
  }, [data, read.loading, page, attentionPage, state, onState])
  function act(task: TaskEntry, kind: TaskAction, carryRequested = !task.carryRequested) {
    if (kind === 'CARRY') {
      setAction(null)
      void store.send({ kind: 'CARRY', taskId: task.id, revision: task.revision, carryRequested }, onSessionInvalid)
      return
    }
    const key = `${['EDIT', 'CARRY', 'DELETE'].includes(kind) ? kind : 'STATUS'}:${task.id}`
    const existing = store.get(key)
    if ((existing?.state === 'pending' || existing?.state === 'uncertain') && existing.operation.kind === 'STATUS') kind = existing.operation.status
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setTaskId(null); setAction({ kind, task, week: task.week })
  }
  function add() {
    if (!data) return
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setTaskId(null); setAction({ kind: 'CREATE', week: data.currentWeekStart })
  }
  const [rangeOpen, setRangeOpen] = useState(false)
  const [taskId, setTaskId] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const previousPeriod = useRef('')
  const periodKey = JSON.stringify(selection)
  useEffect(() => { if (previousPeriod.current !== periodKey) { setTaskId(null); setAction(null); setDismissed(false); previousPeriod.current = periodKey } }, [periodKey])
  // The initial server choice becomes an explicit anchor, so a Monday refresh
  // reclassifies the selected week instead of silently navigating to a new one.
  useEffect(() => {
    if (data && !selection && data.selection.kind === 'week') onState({ ...state, selection: data.selection, anchor: data.selection.week })
  }, [data, selection, onState, state])
  const anchor = state.anchor ?? (data?.selection.kind === 'week' ? data.selection.week : null)
  const period = selection ?? data?.selection
  const start = period?.kind === 'week' ? period.week : period?.from
  const end = period?.kind === 'week' ? shiftDate(period.week, 4) ?? period.week : period?.to
  const periodLabel = start && end ? `${displayDate(start)} to ${displayDate(end)}` : 'This week'
  const current = !!data && period?.kind === 'week' && period.week === data.currentWeekStart
  const frozen = !!data?.week && Date.parse(data.asOf) >= Date.parse(data.week.freezesAt)
  const inspection = !current || frozen
  const planningOpen = !!data?.week?.planningOpen && !read.stale
  function choose(next: Selection | null) {
    setTaskId(null); setDismissed(false)
    onState({ ...state, selection: next, anchor: next?.kind === 'week' ? next.week : anchor, page: 1, attentionPage: 1 })
  }
  function move(days: number) { if (anchor) { const next = shiftDate(anchor, days); if (next) choose({ kind: 'week', week: next }) } }
  return <>
    <header className="employee-heading">
      <div><h1 ref={headingRef} tabIndex={-1}>Good morning, {name.trim() === 'Staff member' ? 'Staff member' : name.trim().split(/\s+/)[0] || 'Staff member'}{data && <span className={`employee-tracker-pill ${planningOpen ? 'open' : 'closed'}`}>{planningOpen ? <LockKeyholeOpen aria-hidden="true" /> : <LockKeyhole aria-hidden="true" />}Tracker {planningOpen ? 'open' : 'closed'}</span>}</h1><p>Focus on the work that matters. Keep your week up to date.</p></div>
      <div className="employee-week-controls"><IconButton label="Previous week" disabled={!anchor || !shiftDate(anchor, -7)} onClick={() => move(-7)}><ChevronLeft aria-hidden="true" /></IconButton><span className="employee-period-label"><b>{period?.kind === 'range' ? 'Custom range' : start ? `Week ${isoWeek(start)}` : 'This week'}</b><small>{periodLabel}</small></span><IconButton label="Next week" disabled={!anchor || !shiftDate(anchor, 7)} onClick={() => move(7)}><ChevronRight aria-hidden="true" /></IconButton><IconButton label="Open date range" disabled={!data || !anchor} onClick={() => { setTaskId(null); setRangeOpen(true) }}><CalendarDays aria-hidden="true" /></IconButton>{period?.kind === 'range' && <Button variant="ghost" size="small" onClick={() => anchor && choose({ kind: 'week', week: anchor })}>Clear <X aria-hidden="true" /></Button>}<button className="employee-this-week" onClick={() => choose(null)}>This week</button></div>
    </header>
    {data && <>
      {period?.kind === 'range' ? <p className="employee-banner employee-gray"><LockKeyhole aria-hidden="true" />Custom range. This is a read only view.</p>
        : period?.kind === 'week' && period.week > data.currentWeekStart ? <p className="employee-banner employee-gray"><Clock aria-hidden="true" />Week not open. Your next tracker opens on Monday {displayDate(period.week)}.</p>
        : current && data.leave.paused ? <div className="employee-banner employee-teal"><Umbrella aria-hidden="true" /><span>You’re on leave until {data.leave.returnsOn && displayDate(data.leave.returnsOn)}. Your tracker is paused.</span><Button busy={leaveStore.record?.state === 'pending'} disabled={!data.leave.returnTarget || leaveStore.record?.state === 'uncertain' || read.stale || read.loading} size="small" onClick={() => data.leave.returnTarget && void leaveStore.send({ kind: 'RETURN', leaveId: data.leave.returnTarget }, onSessionInvalid)}>I’m back</Button></div>
        : inspection ? <p className="employee-banner employee-gray"><LockKeyhole aria-hidden="true" />Week ended. This is a frozen, read-only record.</p> : null}
      {data.week?.manualLockReason && <p className="employee-banner employee-gray"><LockKeyhole aria-hidden="true" />{data.week.manualLockReason}</p>}
      {!!data.attention.total && !dismissed && <section className="ui-card employee-attention"><header className="ui-card-head"><div className="employee-attention-title"><span><Info aria-hidden="true" /></span><div><h2>Needs your attention</h2><p>{data.attention.total} {data.attention.total === 1 ? 'task needs' : 'tasks need'} a next step</p></div></div><IconButton label="Dismiss attention card" onClick={() => setDismissed(true)}><X aria-hidden="true" /></IconButton></header>{data.attention.items.map((task) => <div className="employee-attention-item" key={task.id}><div><h3>{task.title}</h3><p><b>{taskStatuses[task.status]}:</b> {task.reason ?? '—'}</p></div><div className="employee-actions">{!inspection && task.status === 'BLOCKED' && <><Button disabled={!task.permissions.canCarry || read.stale} size="small" onClick={() => act(task, 'CARRY')}><Repeat2 aria-hidden="true" />{task.carryRequested ? 'Clear carry over' : 'Carry over'}</Button><Button disabled={!task.permissions.canDelete || read.stale} variant="ghost" size="small" onClick={() => act(task, 'DELETE')}>Delete</Button></>}<Button size="small" onClick={() => setTaskId(task.id)}>{!inspection && task.status === 'DECLINED' ? 'Review task' : 'View'}<ArrowRight aria-hidden="true" /></Button></div></div>)}{data.attention.total > 25 && <Pagination value={data.attention} label="attention" onPage={(attentionPage) => { setTaskId(null); onState({ ...state, attentionPage }) }} />}</section>}
    </>}
    <section className="ui-card employee-week-card" aria-busy={read.loading || undefined}>
      <header className="ui-card-head"><div><h2>Your weekly tracker</h2><p>{data ? `${data.tasks.total} ${data.tasks.total === 1 ? 'task' : 'tasks'} · ${periodLabel}` : periodLabel}</p></div><div className="employee-actions"><div className="employee-view-switch" role="group" aria-label="Task view">{(['List', 'Card'] as const).map((item) => <button key={item} aria-pressed={view === item} onClick={() => onState({ ...state, view: item })}>{item === 'List' ? <List aria-hidden="true" /> : <Grid2X2 aria-hidden="true" />}{item}</button>)}</div><Button variant="primary" disabled={!data?.canCreate || read.stale} title={data?.createRestriction ?? undefined} onClick={add}><Plus aria-hidden="true" />Add task</Button></div></header>
      <div className="ui-card-body">
        {read.loading && !data && <SkeletonTaskList count={5} />}
        {read.loading && <AnnounceEvent event={{ id: `home-loading:${params}`, message: 'Loading tracker…', intent: 'status' }} />}
        {read.error && <div className="employee-banner employee-amber"><p>{read.error}</p><Button size="small" onClick={read.retry}>Retry</Button><AnnounceEvent event={{ id: `home-error:${params}:${read.error}`, message: read.error, intent: 'alert' }} /></div>}
        {data && <>{read.stale && <p className="employee-read-message">This tracker may be out of date. Last loaded {displayTime(data.asOf)}.</p>}{data.tasks.items.length ? <div className={`employee-tasks ${view === 'Card' ? 'employee-task-grid' : ''}`}>{data.tasks.items.map((task) => <TaskItem key={task.id} task={task} onOpen={setTaskId} onAction={act} stale={read.stale} />)}</div> : <div className="employee-empty"><CalendarDays aria-hidden="true" /><h3>A fresh week, a clear focus.</h3><p>Add your first task to this week’s tracker.</p>{!inspection && planningOpen && !data.leave.paused && <Button variant="primary" disabled={read.stale} onClick={add}>Add task</Button>}</div>}<Pagination value={data.tasks} label="tasks" onPage={(page) => { setTaskId(null); onState({ ...state, page }) }} /></>}
      </div>
      <div className="employee-week-bottom"><Check aria-hidden="true" />Your updates are your submission. There’s nothing extra to submit.</div>
    </section>
    <div className="employee-support"><span><LockKeyhole aria-hidden="true" /><span className="employee-support-text">Visible to your line manager and authorised leadership</span></span><a href="/employee/leave"><Umbrella aria-hidden="true" />Taking time off?</a></div>
    {data?.leave.repairRequired && <p className="employee-banner employee-amber">Your leave periods need review. Contact HR before making another leave change.</p>}
    <LeaveFeedback operations={leaveStore} onRetry={() => { if (leaveStore.record) void leaveStore.send(leaveStore.record.operation, onSessionInvalid) }} onReload={() => { leaveStore.discard(); read.retry() }} />
    {leaveStore.record?.state === 'committed' && read.error && <p className="employee-banner employee-amber">Your leave change was saved. Retry loading the latest tracker.</p>}
    {store.notice && <SavedNotice key={store.commits} commit={store.commits} message={store.notice} />}
    {store.notice && read.error && <p className="employee-banner employee-amber">Change saved. This view may be out of date. Retry loading it.</p>}
    {carryRecord && carryRecord.operation.kind === 'CARRY' && <div className="employee-banner employee-amber"><p>{carryRecord.state === 'pending' ? 'Saving carry over…' : carryRecord.error}</p>{carryRecord.state === 'uncertain' ? <Button onClick={() => void store.send(carryRecord.operation, onSessionInvalid)}>Retry</Button> : carryRecord.state === 'rejected' && <Button onClick={() => { const op = carryRecord.operation; if (op.kind === 'CARRY') store.discard(`CARRY:${op.taskId}`); read.retry() }}>Reload latest</Button>}</div>}
    {rangeOpen && data && anchor && <DateRange selection={selection} anchor={anchor} currentWeek={data.currentWeekStart} asOf={data.asOf} onClose={() => setRangeOpen(false)} onApply={(range) => { setRangeOpen(false); choose(range ?? { kind: 'week', week: anchor }) }} />}
    {taskId && !rangeOpen && !action && <TaskDrawer operations={operations} onAction={act} key={taskId} taskId={taskId} inspection={inspection} onClose={() => setTaskId(null)} onSessionInvalid={onSessionInvalid} />}
    {action && <TaskActionDialog key={`${action.kind}:${action.task?.id ?? 'new'}`} selection={action} operations={operations} returnFocusRef={opener} onSessionInvalid={onSessionInvalid} onClose={() => setAction(null)} onNext={(next) => { if (next.task) act(next.task, next.kind as TaskAction, true) }} onReload={() => { const id = action.task?.id; setAction(null); read.retry(); if (id) setTaskId(id); else choose(null) }} />}
  </>
}
