import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { MessageSquare, OctagonAlert } from 'lucide-react'
import { AnnounceEvent } from '../../components/accessibility/Announcements.tsx'
import { useFormValidation } from '../../components/accessibility/useFormValidation.ts'
import { Badge } from '../../components/ui/Badge.tsx'
import { Button } from '../../components/ui/Button.tsx'
import { Drawer } from '../../components/ui/Dialog.tsx'
import { TextareaField } from '../../components/ui/Field.tsx'
import { SkeletonDetail } from '../../components/ui/Skeleton.tsx'
import { wellFormed } from '../auth/contracts.ts'
import { taskStatuses } from '../employee/contracts.ts'
import { displayDate, displayTime } from '../employee/date.ts'
import { Pagination } from '../employee/Pagination.tsx'
import { useEmployeeRead } from '../employee/useEmployeeRead.ts'
import type { TeamTaskDetail } from './dashboard-view.ts'
import { useManagerOperation } from './manager-operations.ts'
import type { ManagerOperations } from './manager-operations.ts'
import './manager-dashboard.css'

export function ChangeRecovery({ operations, onSessionInvalid, onReload, focusRef }: { operations: ManagerOperations; onSessionInvalid: () => void; onReload: () => void; focusRef: RefObject<HTMLElement | null> }) {
  const record = useManagerOperation(operations)
  const [now, setNow] = useState(Date.now)
  const retryAt = record?.phase === 'uncertain' ? record.retryAt : 0
  useEffect(() => {
    if (!retryAt) return
    const timer = window.setTimeout(() => setNow(Date.now()), Math.max(0, retryAt - Date.now()))
    return () => window.clearTimeout(timer)
  }, [retryAt])
  if (record?.phase !== 'uncertain' && record?.phase !== 'rejected') return null
  return <div className="employee-banner employee-amber">
    <p>{record.message}</p>
    {record.phase === 'uncertain'
      ? <Button size="small" disabled={now < retryAt} onClick={() => { focusRef.current?.focus(); void operations.retry(onSessionInvalid) }}>Retry</Button>
      : <Button size="small" onClick={() => { focusRef.current?.focus(); operations.discard(); onReload() }}>Reload latest</Button>}
    <AnnounceEvent event={{ id: `manager-change:${record.id}:${record.attempt}`, message: record.message, intent: 'alert' }} />
  </div>
}

function Reply({ id, disabled, operations, onSessionInvalid }: { id: string; disabled: boolean; operations: ManagerOperations; onSessionInvalid: () => void }) {
  const record = useManagerOperation(operations)
  const [, edit] = useState(0)
  const body = operations.draft(id)
  const input = useRef<HTMLTextAreaElement>(null)
  const matching = record?.command.operation === 'LM_TASK_COMMENT' && 'taskId' in record.command && record.command.taskId === id ? record : null
  const unresolved = !!record && record.phase !== 'committed'
  const validation = useFormValidation({ fields: [{ name: 'body', label: 'Reply', ref: input }], validate: (): Record<string, string> => {
    const text = (input.current?.value ?? body).trim()
    return text && text.length <= 4000 && !text.includes('\0') && wellFormed(text) ? {} : { body: 'Enter a reply of 1 to 4,000 characters.' }
  } })
  return <form className="employee-reply" noValidate onSubmit={(event) => {
    event.preventDefault()
    if (!disabled && !unresolved && validation.submit()) void operations.send({ operation: 'LM_TASK_COMMENT', taskId: id, body: body.trim() }, onSessionInvalid)
  }}>
    <TextareaField ref={input} label="Reply" value={body} required maxLength={4000} disabled={disabled} readOnly={unresolved}
      error={validation.errors.body} placeholder="Add a helpful update…" onChange={(event) => {
        operations.setDraft(id, event.target.value)
        edit((value) => value + 1)
        validation.revalidate('body')
      }} />
    <Button type="submit" busy={matching?.phase === 'pending'} aria-disabled={disabled || unresolved}><MessageSquare aria-hidden="true" />Post reply</Button>
  </form>
}

export function TeamTaskDrawer({ id, headingRef, onClose, operations, onSessionInvalid, commit }: { id: string; headingRef: RefObject<HTMLHeadingElement | null>; onClose: () => void; operations: ManagerOperations; onSessionInvalid: () => void; commit: string | null }) {
  const [page, setPage] = useState(1)
  const read = useEmployeeRead<TeamTaskDetail>(`/api/line-manager/team-tasks/${encodeURIComponent(id)}?commentPage=${page}`, onSessionInvalid, 'This task is not available.')
  const record = useManagerOperation(operations)
  const seen = useRef(commit)
  const focus = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (seen.current === commit) return
    seen.current = commit
    read.retry()
  }, [commit, read])
  const detail = read.data
  const matching = record?.command.operation === 'LM_TASK_COMMENT' && 'taskId' in record.command && record.command.taskId === id ? record : null
  return <Drawer open title="Task details" onClose={onClose} fallbackFocusRef={headingRef}
    initialFocusRef={focus} footer={<><small>{detail?.frozen ? 'Read-only record' : 'Employee task'}</small><Button onClick={onClose}>Close</Button></>}>
    <div ref={focus} tabIndex={-1} role="region" aria-label="Team task record">
      {matching && <ChangeRecovery operations={operations} onSessionInvalid={onSessionInvalid} onReload={read.retry} focusRef={focus} />}
      {matching?.phase === 'committed' && <div className="employee-banner employee-teal">
        <p>Comment posted.</p><AnnounceEvent event={{ id: `manager-committed:${matching.id}`, message: 'Comment posted.', intent: 'status' }} />
      </div>}
      {read.loading && !detail && <SkeletonDetail />}
      {read.error && <div className="employee-banner employee-amber">
        <p>{read.error}{detail ? ' This record may be out of date.' : ''}</p><Button size="small" onClick={read.retry}>Retry</Button>
        <AnnounceEvent event={{ id: `manager-task:${id}:${page}:${read.error}`, message: read.error, intent: 'alert' }} />
      </div>}
      {detail && <>
        <Badge status={taskStatuses[detail.task.status]} />
        <h3 className="employee-detail-title">{detail.task.title}</h3>
        {detail.task.reason && <div className="employee-banner employee-amber"><OctagonAlert aria-hidden="true" /><p>{detail.task.reason}</p></div>}
        <dl className="employee-detail-meta">
          <div><dt>Owner</dt><dd>{detail.ownerName}</dd></div>
          <div><dt>Dates</dt><dd>{displayDate(detail.task.startsOn, false)} to {displayDate(detail.task.endsOn)}</dd></div>
          {detail.frozen && <><div><dt>Unit</dt><dd>{detail.owner.unit}</dd></div><div><dt>Line manager</dt><dd>{detail.owner.manager}</dd></div></>}
        </dl>
        <div className="employee-activity"><h4>Activity</h4><p>{detail.task.activity}</p></div>
        {detail.review && <p className="employee-read-message">Latest review submitted {displayTime(detail.review.submittedAt)}.
          {detail.review.decision ? ` ${detail.review.decision === 'APPROVE' ? 'Approved' : 'Declined'}${detail.review.decidedAt ? ` ${displayTime(detail.review.decidedAt)}` : ''}.` : ''}
          {detail.review.reason && detail.review.reason !== detail.task.reason ? ` ${detail.review.reason}` : ''}</p>}
        <h3 className="employee-comments-heading">Manager comments</h3>
        {detail.comments.items.length ? <ul className="manager-notices">{detail.comments.items.map((comment) => <li key={comment.id}>
          <div><strong>{comment.authorName}</strong><small>{displayTime(comment.createdAt)}</small><p className="manager-comment-body">{comment.body}</p></div>
        </li>)}</ul> : <p className="employee-read-message">No comments on this page.</p>}
        {detail.comments.total > 25 && <Pagination value={detail.comments} label="comment" onPage={setPage} />}
        {!detail.frozen && <>{detail.reason && <p className="employee-read-message">{detail.reason}</p>}
          <Reply id={id} disabled={!detail.canComment || read.stale || read.loading} operations={operations} onSessionInvalid={onSessionInvalid} /></>}
      </>}
    </div>
  </Drawer>
}
