import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { Check, MessageSquare } from 'lucide-react'
import { AnnounceEvent } from '../../components/accessibility/Announcements.tsx'
import { useFormValidation } from '../../components/accessibility/useFormValidation.ts'
import { Badge } from '../../components/ui/Badge.tsx'
import { Button } from '../../components/ui/Button.tsx'
import { Dialog, Drawer } from '../../components/ui/Dialog.tsx'
import { TextareaField } from '../../components/ui/Field.tsx'
import { SkeletonDetail } from '../../components/ui/Skeleton.tsx'
import { wellFormed } from '../auth/contracts.ts'
import type { Selection } from '../employee/contracts.ts'
import { displayDate, displayTime } from '../employee/date.ts'
import { Pagination } from '../employee/Pagination.tsx'
import { useEmployeeRead } from '../employee/useEmployeeRead.ts'
import type { ReviewAttempt, ReviewCommand, ReviewDetail, ReviewPerson } from './approvals-contracts.ts'
import { approvalEndpoint, periodParams } from './approvals-contracts.ts'
import { reviewDraft, useManagerOperation } from './manager-operations.ts'
import type { ManagerOperations } from './manager-operations.ts'
import { ChangeRecovery } from './TeamTaskDrawer.tsx'

const missing = 'This review is no longer available.'
const historyUnavailable = 'This task can be reviewed once its frozen week is available.'
const item = (attempt: ReviewAttempt) => ({ requestId: attempt.requestId, expectedTaskRevision: attempt.revision })
type Shared = { headingRef: RefObject<HTMLHeadingElement | null>; operations: ManagerOperations; onSessionInvalid: () => void; onClose: () => void }

function Failure({ message, retry, identity }: { message: string; retry: () => void; identity: string }) {
  return <div className="employee-banner employee-amber">
    <p>{message}</p><Button size="small" onClick={retry}>Retry</Button>
    <AnnounceEvent event={{ id: `review-failure:${identity}:${message}`, message, intent: 'alert' }} />
  </div>
}

function ReviewActions({ attempt, disabled, onDecline, onApprove }: {
  attempt: ReviewAttempt; disabled: boolean; onDecline: (attempt: ReviewAttempt) => void; onApprove: (command: ReviewCommand) => void
}) {
  return <>
    <Button size="small" variant="danger" aria-disabled={disabled} onClick={() => onDecline(attempt)}>Decline</Button>
    <Button size="small" variant="success" aria-disabled={disabled} onClick={() => onApprove({ operation: 'LM_APPROVE', ...item(attempt) })}><Check aria-hidden="true" />Approve</Button>
  </>
}

export function ReviewGroupDialog({ personId, selection, headingRef, returnFocusRef, operations, onSessionInvalid, onClose, onDecline, onDetail, focusRequest, page, onPage }: Shared & {
  personId: string; selection: Selection | null; onDecline: (attempt: ReviewAttempt) => void; onDetail: (attempt: ReviewAttempt) => void; focusRequest?: string
  returnFocusRef?: RefObject<HTMLButtonElement | null>
  page: number; onPage: (page: number) => void
}) {
  const focus = useRef<HTMLDivElement>(null)
  const record = useManagerOperation(operations)
  const read = useEmployeeRead<ReviewPerson>(`${approvalEndpoint}/people/${encodeURIComponent(personId)}/pending?${new URLSearchParams({ ...periodParams(selection), page: String(page) })}`, onSessionInvalid, missing)
  const { retry } = read
  const commit = record?.phase === 'committed' && 'items' in record.result ? record.id : null
  const seen = useRef(commit)
  const returnFocus = useRef<HTMLButtonElement>(null)
  const data = read.data
  useEffect(() => {
    if (seen.current === commit) return
    seen.current = commit
    focus.current?.focus()
    retry()
  }, [commit, retry])
  useEffect(() => { if (!read.loading && focusRequest && document.activeElement === focus.current) returnFocus.current?.focus() }, [read.loading, focusRequest])
  const canWrite = !!data && !data.workPaused && !read.stale && !read.loading && !read.error && (!record || record.phase === 'committed')
  const send = (command: ReviewCommand) => { if (canWrite) void operations.send(command, onSessionInvalid) }
  const shown = data?.requests.items ?? []
  const eligible = shown.filter((attempt) => !attempt.decisionUnavailable)
  return <Dialog open size="wide" title={data ? `Review · ${data.person.label}` : 'Review completions'} initialFocusRef={focus}
    returnFocusRef={returnFocusRef} fallbackFocusRef={headingRef} onClose={onClose} footer={<><Button onClick={onClose}>Close</Button>
      {!!eligible.length && <Button variant="success" aria-disabled={!canWrite} busy={record?.phase === 'pending' && record.command.operation === 'LM_APPROVE_BATCH'}
        onClick={() => send({ operation: 'LM_APPROVE_BATCH', items: eligible.map(item) })}><Check aria-hidden="true" />Approve all ({eligible.length})</Button>}</>}>
    <div ref={focus} tabIndex={-1} role="region" aria-label="Submitted completions">
      <ChangeRecovery operations={operations} onSessionInvalid={onSessionInvalid} onReload={read.retry} focusRef={focus} />
      {commit && <AnnounceEvent event={{ id: `approval-saved:${commit}`, message: 'Decision saved.', intent: 'status' }} />}
      {read.loading && !data && <SkeletonDetail />}
      {read.error === missing && commit ? <p>All completions reviewed or no longer available.</p>
        : read.error && <Failure message={read.error} retry={read.retry} identity={personId} />}
      {read.stale && <p className="employee-read-message">These completions may be out of date.</p>}
      {data && <>
        <h3>{data.person.label}</h3><p className="employee-read-message">{data.requests.total} {data.requests.total === 1 ? 'completion' : 'completions'} awaiting your decision</p>
        {data.workPaused && <p className="employee-banner employee-gray">Your work actions are paused while you are on leave.</p>}
        {shown.map((attempt) => <section className="review-task" key={attempt.requestId}>
          <div className="review-task-heading"><h3>{attempt.title}</h3><Badge status="Awaiting approval" /></div>
          <p>{attempt.activity}</p><small>{displayDate(attempt.startsOn, false)} to {displayDate(attempt.endsOn)}</small>
          {attempt.note && <div className="review-employee-note"><strong>Employee comment</strong><p>{attempt.note.body}</p><small>{displayTime(attempt.note.createdAt)}</small></div>}
          <div className="employee-actions">
            {attempt.decisionUnavailable ? <p className="employee-read-message">{historyUnavailable}</p>
              : <ReviewActions attempt={attempt} disabled={!canWrite} onApprove={send} onDecline={(row) => { if (canWrite) onDecline(row) }} />}
            <Button ref={focusRequest === attempt.requestId ? returnFocus : undefined} variant="ghost" size="small" disabled={read.stale || read.loading} onClick={() => onDetail(attempt)}>View task</Button>
          </div>
        </section>)}
        {!shown.length && <p className="employee-read-message">No completions on this page.</p>}
        {(data.requests.total > 25 || page > 1) && <Pagination value={data.requests} label="review" onPage={onPage} />}
      </>}
    </div>
  </Dialog>
}

export function ReviewDrawer({ id, expected, headingRef, operations, onSessionInvalid, onClose, onDecline, onResolved }: Shared & {
  id: string; expected?: { taskId: string; week: string }; onDecline: (attempt: ReviewAttempt) => void; onResolved: (attempt: ReviewAttempt) => void
}) {
  const [page, setPage] = useState(1)
  const [, edit] = useState(0)
  const focus = useRef<HTMLDivElement>(null)
  const field = useRef<HTMLTextAreaElement>(null)
  const resolved = useRef(false)
  const record = useManagerOperation(operations)
  const read = useEmployeeRead<ReviewDetail>(`${approvalEndpoint}/requests/${encodeURIComponent(id)}?commentPage=${page}`, onSessionInvalid, missing)
  const { retry } = read
  const mismatch = !!read.data && !!expected && (read.data.attempt.taskId !== expected.taskId || read.data.attempt.week !== expected.week || !!read.data.decision)
  const detail = mismatch ? null : read.data
  useEffect(() => {
    if (detail && !resolved.current && !read.stale) { resolved.current = true; onResolved(detail.attempt) }
  }, [detail, onResolved, read.stale])
  const commit = record?.phase === 'committed' && record.command.operation === 'LM_TASK_COMMENT'
    && ('requestId' in record.command ? record.command.requestId === id : record.command.taskId === detail?.attempt.taskId) ? record.id : null
  const seen = useRef(commit)
  useEffect(() => { if (seen.current !== commit) { seen.current = commit; retry() } }, [commit, retry])
  const write = !read.loading && !read.stale && !read.error && (!record || record.phase === 'committed')
  const key = detail?.decision ? detail.attempt.taskId : reviewDraft(id)
  const body = operations.draft(key)
  const validation = useFormValidation({ fields: [{ name: 'body', label: 'Reply', ref: field }], validate: () => {
    const text = (field.current?.value ?? body).trim()
    return text && text.length <= 4000 && !text.includes('\0') && wellFormed(text) ? {} : { body: 'Enter a reply of 1 to 4,000 characters.' } as Record<string, string>
  } })
  const canDecide = write && !!detail?.canDecide
  return <Drawer open title="Task details" initialFocusRef={focus} fallbackFocusRef={headingRef} onClose={onClose} footer={<>
    {detail?.canDecide && <ReviewActions attempt={detail.attempt} disabled={!canDecide}
      onDecline={(row) => { if (canDecide) onDecline(row) }} onApprove={(command) => { if (canDecide) void operations.send(command, onSessionInvalid) }} />}
    <Button onClick={onClose}>Close</Button></>}>
    <div ref={focus} tabIndex={-1} role="region" aria-label="Submitted task record">
      <ChangeRecovery operations={operations} onSessionInvalid={onSessionInvalid} onReload={read.retry} focusRef={focus} />
      {commit && <AnnounceEvent event={{ id: `review-reply:${commit}`, message: 'Comment posted.', intent: 'status' }} />}
      {read.loading && !detail && <SkeletonDetail />}
      {(read.error || mismatch) && <Failure message={read.error || missing} identity={id} retry={read.retry} />}
      {read.stale && <p className="employee-read-message">This review may be out of date.</p>}
      {detail && <>
        <Badge status={detail.decision?.kind === 'APPROVE' ? 'Approved' : detail.decision ? 'Declined' : 'Awaiting approval'} />
        <h3 className="employee-detail-title">{detail.attempt.title}</h3>
        {detail.mode === 'RELIEF' && <p className="employee-banner employee-gray">Reviewing on behalf of {detail.coveredManager}.</p>}
        {detail.workPaused && <p className="employee-banner employee-gray">Your work actions are paused while you are on leave.</p>}
        {detail.frozen && <p className="employee-banner employee-gray">The captured task and conversation are read only.</p>}
        {detail.attempt.decisionUnavailable && <p className="employee-banner employee-amber">{historyUnavailable}</p>}
        <dl className="employee-detail-meta"><div><dt>Owner</dt><dd>{detail.attempt.ownerName}</dd></div>
          <div><dt>Dates</dt><dd>{displayDate(detail.attempt.startsOn, false)} to {displayDate(detail.attempt.endsOn)}</dd></div></dl>
        <div className="employee-activity"><h4>Activity</h4><p>{detail.attempt.activity}</p></div>
        {detail.decision && <p className="employee-read-message">{detail.decision.actor}
          {detail.decision.coveredManager ? ` on behalf of ${detail.decision.coveredManager}` : ''} · {displayTime(detail.decision.decidedAt)} {detail.decision.reason}</p>}
        <h3 className="employee-comments-heading">Manager comments</h3>
        {detail.comments.items.length ? <ul className="manager-notices">{detail.comments.items.map((comment) => <li key={comment.id}><div>
          <strong>{comment.author}</strong><small>{displayTime(comment.createdAt)}</small><p className="manager-comment-body">{comment.body}</p>
        </div></li>)}</ul> : <p className="employee-read-message">No comments yet.</p>}
        {detail.comments.total > 25 && <Pagination value={detail.comments} label="comment" onPage={setPage} />}
        {detail.canComment && <form className="employee-reply" noValidate onSubmit={(event) => {
          event.preventDefault()
          if (write && validation.submit()) {
            const command = detail.decision ? { taskId: detail.attempt.taskId } : { requestId: id }
            void operations.send({ operation: 'LM_TASK_COMMENT', ...command, body: body.trim() }, onSessionInvalid)
          }
        }}>
          <TextareaField ref={field} label="Reply" required maxLength={4000} value={body} error={validation.errors.body} readOnly={!write}
            onChange={(event) => { operations.setDraft(key, event.target.value); edit((n) => n + 1); validation.revalidate('body') }} />
          <Button type="submit" aria-disabled={!write}><MessageSquare aria-hidden="true" />Post reply</Button>
        </form>}
      </>}
    </div>
  </Drawer>
}

export function DeclineDialog({ attempt, headingRef, operations, onSessionInvalid, onClose, onReload }: Shared & { attempt: ReviewAttempt; onReload: () => void }) {
  const [reason, setReason] = useState('')
  const field = useRef<HTMLTextAreaElement>(null)
  const form = useRef<HTMLFormElement>(null)
  const record = useManagerOperation(operations)
  const locked = !!record && record.phase !== 'committed'
  const validation = useFormValidation({ fields: [{ name: 'reason', label: 'Reason', ref: field }], validate: () => {
    const text = (field.current?.value ?? reason).trim()
    return text.length >= 10 && text.length <= 2000 && !text.includes('\0') && wellFormed(text)
      ? {} : { reason: 'Enter a reason of 10 to 2,000 characters.' } as Record<string, string>
  } })
  return <Dialog open size="small" title="Why are you declining this completion?"
    description={`A clear reason helps ${attempt.ownerName} know what to change.`} onClose={onClose} fallbackFocusRef={headingRef}
    initialFocusRef={field} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="danger" aria-disabled={locked} busy={record?.phase === 'pending'}
      onClick={() => form.current?.requestSubmit()}>Send decline</Button></>}>
    <ChangeRecovery operations={operations} onSessionInvalid={onSessionInvalid} onReload={onReload} focusRef={field} />
    <form ref={form} noValidate onSubmit={(event) => {
      event.preventDefault()
      if (!locked && validation.submit()) void operations.send({ operation: 'LM_DECLINE', ...item(attempt), reason: reason.trim() }, onSessionInvalid)
    }}>
      <TextareaField ref={field} label="Reason" description="At least 10 characters." maxLength={2000} value={reason} required readOnly={locked}
        error={validation.errors.reason} onChange={(event) => { setReason(event.target.value); validation.revalidate('reason') }} />
    </form>
  </Dialog>
}
