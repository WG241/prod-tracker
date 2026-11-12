import { useEffect, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { NoticeToast } from '../../components/ui/NoticeToast.tsx'
import { displayDate } from '../employee/date.ts'
import { useEmployeeRead } from '../employee/useEmployeeRead.ts'
import { ManagerDashboard } from './ManagerDashboard.tsx'
import type { DashboardRead, DashboardResponse, DashboardSection, DashboardSelectionState } from './dashboard-view.ts'
import type { Selection } from '../employee/contracts.ts'
import { ReviewOverlay } from './ReviewOverlay.tsx'
import type { ReviewSurface } from './ReviewOverlay.tsx'
import { useManagerOperation } from './manager-operations.ts'
import type { ManagerOperations } from './manager-operations.ts'
import { ChangeRecovery, TeamTaskDrawer } from './TeamTaskDrawer.tsx'

const pageKeys = { approvals: 'approvalPage', missing: 'missingPage', blocked: 'blockedPage', activity: 'activityPage' } as const

function parameters({ selection, pages }: DashboardSelectionState) {
  const query = new URLSearchParams(selection?.kind === 'week' ? { week: selection.week }
    : selection?.kind === 'range' ? { from: selection.from, to: selection.to } : undefined)
  for (const section of Object.keys(pageKeys) as DashboardSection[]) {
    const page = pages[section]
    if (page && page > 1) query.set(pageKeys[section], String(page))
  }
  return query.toString()
}

export function ManagerDashboardPage({ headingRef, view, onView, operations, onSessionInvalid, onApprovals, onBadge }: {
  headingRef: RefObject<HTMLHeadingElement | null>; view: DashboardSelectionState; onView: (view: DashboardSelectionState) => void;
  operations: ManagerOperations; onSessionInvalid: () => void; onApprovals: () => void; onBadge: (count: number) => void;
}) {
  const params = parameters(view)
  const read = useEmployeeRead<DashboardResponse>(`/api/line-manager/dashboard${params ? `?${params}` : ''}`, onSessionInvalid)
  const data = read.data
  const record = useManagerOperation(operations)
  const [taskId, setTaskId] = useState<string | null>(null)
  const [review, setReview] = useState<ReviewSurface | null>(null)
  const [reviewSelection, setReviewSelection] = useState<Selection | null>(null)
  const reviewOpener = useRef<HTMLButtonElement | null>(null)
  const [attempt, setAttempt] = useState(0)
  const commit = record?.phase === 'committed' ? record.id : null
  const seen = useRef(commit)
  useEffect(() => {
    if (!commit || seen.current === commit) return
    seen.current = commit
    read.retry()
  }, [commit, read])
  useEffect(() => { if (data && !read.stale && !read.loading) onBadge(data.approvalBadge) }, [data, read.stale, read.loading, onBadge])
  const range = view.selection?.kind === 'range' ? view.selection : null
  const current = data?.currentWeekStart ?? null
  const anchor = view.anchor ?? current
  const normalized = data?.includedWeeks
  const rangeWeeks = normalized?.length ? `Included workweeks start ${displayDate(normalized[0])}${normalized.length > 1 ? ` to ${displayDate(normalized.at(-1)!)}` : ''}.`
    : normalized ? 'No workweeks fall within this range.' : ''
  const state: DashboardRead = data ? { kind: 'ready', data, staleMessage: read.stale || read.loading ? (read.error || 'This dashboard may be out of date.') : undefined }
    : read.error ? { kind: 'error', message: read.error } : { kind: 'loading' }
  const refresh = () => { setAttempt((n) => n + 1); read.retry() }
  let recovery: ReactNode = null
  if (record?.phase === 'uncertain' || record?.phase === 'rejected') {
    const handledInDrawer = taskId && record.command.operation === 'LM_TASK_COMMENT' && 'taskId' in record.command && record.command.taskId === taskId
    if (!handledInDrawer && !review) recovery = <ChangeRecovery operations={operations} onSessionInvalid={onSessionInvalid} onReload={refresh} focusRef={headingRef} />
  }
  const saved = record?.phase === 'committed' ? (record.result.operation === 'LM_TASK_COMMENT' ? 'Comment posted.'
    : record.result.operation === 'LM_REMIND' ? record.result.alreadyReminded ? 'This employee was already reminded today.' : 'Reminder sent.'
    : record.result.operation === 'LM_DECLINE' ? 'Decline sent.' : 'items' in record.result ? 'Approval saved.' : '') : ''
  return <>
    {recovery}
    <ManagerDashboard headingRef={headingRef} anchor={anchor} currentWeek={current} asOf={data?.asOf ?? ''} range={range} rangeWeeks={rangeWeeks}
      read={state} readId={`${params}:${attempt}:${read.loading}`} onWeek={(week) => onView({ anchor: week, selection: { kind: 'week', week }, pages: {} })}
      onRange={(value) => onView({ anchor, selection: value ?? (anchor ? { kind: 'week', week: anchor } : null), pages: {} })}
      onPage={(section, page) => onView({ ...view, pages: { ...view.pages, [section]: page } })}
      onRetry={refresh} onReloadLatest={refresh} onApprovals={(group, opener) => {
        if (!group) { onApprovals(); return }
        if (!data) return
        reviewOpener.current = opener ?? null
        setReviewSelection(data.selection)
        setReview({ kind: 'group', personId: group.employeeId, page: 1 })
      }} onComment={(task) => setTaskId(task.id)}
      writesPaused={!!record && record.phase !== 'committed'}
      reminderBusy={(person) => record?.phase === 'pending' && record.command.operation === 'LM_REMIND' && record.command.employeeId === person.employeeId && record.command.week === person.week}
      onRemind={(person) => void operations.send({ operation: 'LM_REMIND', employeeId: person.employeeId, week: person.week }, onSessionInvalid)} />
    {taskId && <TeamTaskDrawer key={taskId} id={taskId} headingRef={headingRef} onClose={() => setTaskId(null)} operations={operations} onSessionInvalid={onSessionInvalid} commit={commit} />}
    {review && <ReviewOverlay surface={review} onSurface={setReview} selection={reviewSelection}
      headingRef={headingRef} returnFocusRef={reviewOpener} operations={operations} onSessionInvalid={onSessionInvalid} />}
    {commit && saved && !(taskId && record?.command.operation === 'LM_TASK_COMMENT' && 'taskId' in record.command && record.command.taskId === taskId) &&
      <NoticeToast key={commit} id={`manager-committed:${commit}`} message={saved} />}
  </>
}
