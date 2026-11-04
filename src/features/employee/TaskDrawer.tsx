import { useRef, useState } from 'react'
import { Drawer } from '../../components/ui/Dialog.tsx'
import { Button } from '../../components/ui/Button.tsx'
import { Badge } from '../../components/ui/Badge.tsx'
import { SelectField, TextareaField } from '../../components/ui/Field.tsx'
import { SkeletonDetail } from '../../components/ui/Skeleton.tsx'
import { AnnounceEvent } from '../../components/accessibility/Announcements.tsx'
import type { DetailResponse } from './contracts.ts'
import { taskStatuses } from './contracts.ts'
import { displayDate, displayTime } from './date.ts'
import { useEmployeeRead } from './useEmployeeRead.ts'
import { Pagination } from './Pagination.tsx'
import type { TaskEntry } from './contracts.ts'
import type { TaskAction } from './TaskMenu.tsx'
import { useTaskOperations } from './operations.ts'
import type { TaskOperations } from './operations.ts'
import { useEffect } from 'react'
import { useFormValidation } from '../../components/accessibility/useFormValidation.ts'
import { pendingTextProps } from './pending-fields.ts'

export function TaskDrawer({ taskId, onClose, onSessionInvalid, inspection, operations, onAction }: { taskId: string; onClose: () => void; onSessionInvalid: () => void; inspection: boolean; operations: TaskOperations; onAction: (task: TaskEntry, action: TaskAction) => void }) {
  const [page, setPage] = useState(1)
  const recordRef = useRef<HTMLDivElement>(null)
  const read = useEmployeeRead<DetailResponse>(`/api/employee/tasks/${encodeURIComponent(taskId)}?commentPage=${page}`, onSessionInvalid)
  const data = read.data
  const store = useTaskOperations(operations), seenCommit = useRef(store.commits)
  useEffect(() => { if (seenCommit.current !== store.commits) { seenCommit.current = store.commits; read.retry() } }, [store.commits, read])
  const editableContext = data && !inspection && !data.frozen && data.week.startsOn === data.currentWeekStart && !data.week.pausedForLeave
  const approved = !inspection && !data?.frozen && data?.task.status === 'APPROVED'
  return <Drawer open title={data?.frozen ? 'Frozen task record' : 'Task details'} onClose={onClose} initialFocusRef={recordRef} footer={<>{(approved || editableContext) ? <Button disabled={!data?.task.permissions.canEdit || read.stale} title={data?.task.permissions.reason ?? undefined} onClick={() => data && onAction(data.task, 'EDIT')}>Edit task</Button> : <small></small>}<Button onClick={onClose}>Close</Button></>}>
    <div ref={recordRef} role="region" aria-label="Task record" tabIndex={0} aria-busy={read.loading || undefined}>
      {read.loading && !data && <SkeletonDetail />}
      {read.loading && <AnnounceEvent event={{ id: `detail-loading:${taskId}:${page}`, message: 'Loading task…', intent: 'status' }} />}
      {read.error && <div className="employee-banner employee-amber"><p>{read.error}</p><Button size="small" onClick={read.retry}>Retry</Button><AnnounceEvent event={{ id: `detail-error:${taskId}:${page}:${read.error}`, message: read.error, intent: 'alert' }} /></div>}
      {data && <>
        {read.stale && <p className="employee-read-message">This task may be out of date. Last loaded {displayTime(data.asOf)}.</p>}
        <div className="employee-panel-status"><Badge status={taskStatuses[data.task.status]} />{(approved || editableContext) && <SelectField label="Update status" className="employee-status-select" value={data.task.status} disabled={!data.task.permissions.canChangeStatus || read.stale} title={data.task.permissions.reason ?? undefined} onChange={(event) => onAction(data.task, event.target.value as TaskAction)}>{!['PENDING', 'IN_PROGRESS', 'BLOCKED'].includes(data.task.status) && <option value={data.task.status}>{taskStatuses[data.task.status]}</option>}<option value="PENDING">Pending</option><option value="IN_PROGRESS">In progress</option><option value="BLOCKED">Blocked</option><option value="COMPLETED">Completed</option></SelectField>}</div>
        <h3 className="employee-detail-title">{data.task.title}</h3>
        {(data.task.status === 'BLOCKED' || data.task.status === 'DECLINED') && <p className="employee-banner employee-amber">{data.task.status === 'DECLINED' ? 'Declined: ' : 'Blocked: '}{data.task.reason ?? '—'}</p>}
        {data.task.status === 'AWAITING_APPROVAL' && <p className="employee-banner employee-amber">Awaiting manager approval. Your completion is waiting for sign-off.</p>}
        <dl className="employee-detail-meta"><div><dt>Owner</dt><dd>{data.owner.name}</dd></div><div><dt>Dates</dt><dd>{displayDate(data.task.startsOn, false)} – {displayDate(data.task.endsOn)}</dd></div>
          {data.frozen && <><div><dt>Manager at the time</dt><dd>{data.owner.manager ?? '—'}</dd></div><div><dt>Business / Unit</dt><dd>{data.owner.business ?? '—'} / {data.owner.unit ?? '—'}</dd></div></>}
          {data.review?.decision && <div><dt>{data.review.decision.kind === 'APPROVE' ? 'Approver' : 'Reviewer'}</dt><dd>{data.review.decision.reviewer} · {displayTime(data.review.decision.decidedAt)}{data.review.decision.method === 'AUTOMATIC' && ' · Auto-approved'}{data.review.decision.coveredManager && `, for ${data.review.decision.coveredManager}`}</dd></div>}
        </dl>
        {data.review?.decision?.reason && <p className="employee-banner employee-amber">{data.review.decision.reason}</p>}
        <section className="employee-activity"><h4>Activity</h4><p>{data.task.activity}</p></section>
        <h3 className="employee-comments-heading">Manager comments</h3>
        {data.comments.items.length ? data.comments.items.map((comment) => <article className="employee-comment" key={comment.id}><div><b>{comment.author}</b><small>{displayTime(comment.createdAt)}</small></div><p>{comment.body}</p></article>) : <p className="employee-muted">No comments yet.</p>}
        <Pagination value={data.comments} label="comments" onPage={setPage} />
        {editableContext && <Reply task={data.task} operations={operations} disabled={read.stale || !data.task.permissions.canComment} onSessionInvalid={onSessionInvalid} />}
      </>}
      <p className="employee-muted employee-read-message">{data?.task.permissions.reason}</p>
    </div>
  </Drawer>
}

function Reply({ task, operations, disabled, onSessionInvalid }: { task: TaskEntry; operations: TaskOperations; disabled: boolean; onSessionInvalid: () => void }) {
  const store = useTaskOperations(operations), key = `COMMENT:${task.id}`, record = store.get(key)
  const [body, setBody] = useState(() => record?.operation.kind === 'COMMENT' && ['pending', 'uncertain'].includes(record.state) ? record.operation.body : '')
  const bodyRef = useRef(body)
  const ref = useRef<HTMLTextAreaElement>(null)
  const validation = useFormValidation({ fields: [{ name: 'body', label: 'Reply', ref }], validate: () => !bodyRef.current.trim() || bodyRef.current.trim().length > 4000 ? { body: 'Enter a reply of 1 to 4,000 characters.' } : {} })
  const seen = useRef(record?.state)
  useEffect(() => {
    if (record?.state === 'committed' && seen.current !== 'committed') { bodyRef.current = ''; setBody('') }
    seen.current = record?.state
  }, [record?.state])
  const pending = record?.state === 'pending', uncertain = record?.state === 'uncertain'
  return <form className="employee-reply" noValidate onSubmit={(event) => { event.preventDefault(); if (!disabled && !pending && (uncertain || validation.submit())) void store.send({ kind: 'COMMENT', taskId: task.id, body: body.trim() }, onSessionInvalid) }}><TextareaField ref={ref} label="Reply" value={body} maxLength={4000} disabled={disabled} {...pendingTextProps(pending || uncertain)} placeholder="Add a helpful update…" error={validation.errors.body || record?.fields?.body} onChange={(event) => { bodyRef.current = event.target.value; setBody(event.target.value); validation.revalidate('body') }} /><Button type="submit" busy={pending} disabled={disabled}>{uncertain ? 'Retry' : 'Post reply'}</Button>{record?.error && <><p className="ui-error">{record.error}</p><AnnounceEvent event={{ id: `${record.id}:${record.state}`, message: record.error, intent: 'alert' }} /></>}</form>
}
