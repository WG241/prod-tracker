import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ChevronLeft, ChevronRight, MessageSquare, RefreshCw } from 'lucide-react'
import { Badge } from '../../components/ui/Badge.tsx'
import { Button } from '../../components/ui/Button.tsx'
import { Card } from '../../components/ui/Card.tsx'
import { TextareaField } from '../../components/ui/Field.tsx'
import { normalizeProofText, proofTextLimit } from '../../features/data-proof/validation.ts'
import { loadComments, loadTasks, postReply, ProofRequestError } from './api.ts'
import type { ProofComment, ProofPage, TaskPage } from './api.ts'
import { forgetPending, recoverPending, rememberPending } from './pending.ts'
import type { PendingReply } from './pending.ts'
import './proof.css'

const labels: Record<string, string> = { PENDING: 'Pending', IN_PROGRESS: 'In progress', BLOCKED: 'Blocked', AWAITING_APPROVAL: 'Awaiting approval', APPROVED: 'Approved', DECLINED: 'Declined', ON_HOLD: 'On hold', CANCELLED: 'Cancelled' }
const message = (error: unknown) => error instanceof Error ? error.message : 'The local app could not complete this request.'
const date = (value: string) => new Date(`${value}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Lagos' })
const timestamp = (value: string) => new Date(value).toLocaleString('en-GB', { dateStyle: 'full', timeStyle: 'long', timeZone: 'Africa/Lagos' })
type ReadResult<T> = { key: string; data: T | null; error: string }

function Pagination({ page, hasMore, busy, onPage, name }: { page: number; hasMore: boolean; busy: boolean; onPage: (page: number) => void; name: string }) {
  return <nav className="proof-pagination" aria-label={`${name} pages`}><Button size="small" disabled={busy || page <= 1} onClick={() => onPage(page - 1)} aria-label={`Previous ${name} page`}><ChevronLeft aria-hidden="true" />Previous</Button><span>Page {page} · 20 per page</span><Button size="small" disabled={busy || !hasMore || page >= 10000} onClick={() => onPage(page + 1)} aria-label={`Next ${name} page`}>Next<ChevronRight aria-hidden="true" /></Button></nav>
}

export function DataProof() {
  const [recovery] = useState(recoverPending)
  const [pending, setPending] = useState<PendingReply | null>(recovery.pending)
  const pendingRef = useRef(recovery.pending)
  const [storageError, setStorageError] = useState(recovery.storageError)
  const [taskResult, setTaskResult] = useState<ReadResult<TaskPage> | null>(null)
  const [taskPage, setTaskPage] = useState(1)
  const [taskRevision, setTaskRevision] = useState(0)
  const [selectedId, setSelectedId] = useState(recovery.pending?.taskId ?? '')
  const [commentResult, setCommentResult] = useState<ReadResult<ProofPage<ProofComment>> | null>(null)
  const [commentPage, setCommentPage] = useState(1)
  const [commentRevision, setCommentRevision] = useState(0)
  const [draft, setDraft] = useState(recovery.pending?.body ?? '')
  const [fieldError, setFieldError] = useState('')
  const [fieldAnnouncement, setFieldAnnouncement] = useState('')
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'uncertain' | 'saved' | 'cleanup'>(recovery.pending ? 'uncertain' : 'idle')
  const [saveError, setSaveError] = useState(recovery.pending ? 'Save not confirmed. Retry this reply.' : '')
  const [saved, setSaved] = useState<ProofComment | null>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const busyRef = useRef(false)
  const writeController = useRef<AbortController | null>(null)
  const taskKey = `${taskPage}:${taskRevision}`
  const commentKey = `${selectedId}:${commentPage}:${commentRevision}`
  const tasks = taskResult?.key === taskKey ? taskResult.data : null
  const taskError = taskResult?.key === taskKey ? taskResult.error : ''
  const taskBusy = taskResult?.key !== taskKey
  const comments = commentResult?.key === commentKey ? commentResult.data : null
  const commentError = commentResult?.key === commentKey ? commentResult.error : ''
  const commentBusy = !!selectedId && commentResult?.key !== commentKey

  useEffect(() => {
    document.title = 'Development data proof · Workforce'
    return () => writeController.current?.abort()
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void loadTasks(taskPage, controller.signal).then((result) => {
      if (controller.signal.aborted) return
      setTaskResult({ key: taskKey, data: result, error: '' })
      setSelectedId((current) => pendingRef.current?.taskId ?? (result.items.some((task) => task.id === current) ? current : result.items[0]?.id ?? ''))
    }).catch((error: unknown) => { if (!controller.signal.aborted) setTaskResult({ key: taskKey, data: null, error: message(error) }) })
    return () => controller.abort()
  }, [taskPage, taskKey])

  useEffect(() => {
    if (!selectedId) return
    const controller = new AbortController()
    void loadComments(selectedId, commentPage, controller.signal).then((result) => { if (!controller.signal.aborted) setCommentResult({ key: commentKey, data: result, error: '' }) })
      .catch((error: unknown) => { if (!controller.signal.aborted) setCommentResult({ key: commentKey, data: null, error: message(error) }) })
    return () => controller.abort()
  }, [selectedId, commentPage, commentKey])

  const clearRecovery = () => {
    try { forgetPending(); pendingRef.current = null; setPending(null); setStorageError(''); return true }
    catch { setStorageError('This reply is resolved, but its retry entry could not be cleared. Retry cleanup before posting another reply.'); setSaveState('cleanup'); return false }
  }

  const send = async (tuple: PendingReply) => {
    if (busyRef.current) return
    busyRef.current = true
    setSaveState('saving'); setSaveError('')
    const controller = new AbortController()
    writeController.current = controller
    const timeout = window.setTimeout(() => controller.abort(), 12000)
    try {
      const result = await postReply(tuple.taskId, tuple.submissionId, tuple.body, controller.signal)
      setSaved(result.comment); setDraft(''); setFieldError(''); setFieldAnnouncement('')
      if (clearRecovery()) setSaveState('saved')
      setCommentPage(1); setCommentRevision((value) => value + 1)
    } catch (error: unknown) {
      if (error instanceof ProofRequestError && error.status >= 400 && error.status < 500) {
        const cleared = clearRecovery()
        if (cleared) setSaveState('idle')
        setSaveError(error.message)
      } else { setSaveState('uncertain'); setSaveError('Save not confirmed. Retry this reply.') }
    } finally { window.clearTimeout(timeout); busyRef.current = false; writeController.current = null }
  }

  const submit = () => {
    if (busyRef.current || pendingRef.current || !selectedId || storageError) return
    const body = normalizeProofText(draft)
    if (body === null) {
      const error = 'Enter 1 to 500 characters. Unsupported text cannot be saved.'
      setFieldError(error)
      if (document.activeElement === composerRef.current) setFieldAnnouncement(error)
      else { setFieldAnnouncement(''); composerRef.current?.focus() }
      return
    }
    try {
      const tuple = { taskId: selectedId, submissionId: crypto.randomUUID(), body }
      rememberPending(tuple)
      pendingRef.current = tuple; setPending(tuple)
      setSaved(null)
      void send(tuple)
    } catch { setStorageError('This tab cannot store a safe retry identity. Enable session storage and reload before posting. Your draft has not been sent.') }
  }

  const selected = tasks?.items.find((task) => task.id === selectedId)
  const locked = pending !== null || saveState === 'saving' || saveState === 'cleanup'
  const count = Array.from(draft.trim()).length
  const status = saveState === 'saving' ? 'Saving reply…' : saveState === 'uncertain' ? '' : saved ? 'Reply saved to the local database.' : taskBusy ? 'Loading sample tasks…' : commentBusy ? 'Loading replies…' : ''

  return (
    <main className="data-proof" id="workspace-main" tabIndex={-1}>
      <a href="/" className="proof-return"><ArrowLeft aria-hidden="true" />Return to workspace</a>
      <header className="workspace-page-heading"><p className="eyebrow">Local development only</p><h1>Development data proof</h1><p>Fictional actor: {tasks?.actor.name ?? 'Ada Okafor'}</p><p>Sample week: 26–30 October 2026 (Week 44)</p></header>
      <p className="proof-notice">Replies are retained in the local database. An unresolved reply can recover after a reload in this tab. Closing the tab can lose its retry identity.</p>
      <p className="sr-only" role="status" aria-live="polite">{status}</p>
      <div className="proof-grid">
        <Card title="Sample tasks" actions={<Button size="small" disabled={taskBusy} onClick={() => setTaskRevision((value) => value + 1)}><RefreshCw aria-hidden="true" />Reload tasks</Button>}>
          <div aria-busy={taskBusy}>
            {taskBusy && <p>Loading sample tasks…</p>}
            {taskError && <div><p className="ui-error" role="alert">{taskError}</p><Button size="small" onClick={() => setTaskRevision((value) => value + 1)}>Retry task list</Button></div>}
            {tasks && tasks.items.length === 0 && <p>No sample tasks are available.</p>}
            <ul className="proof-tasks">{tasks?.items.map((task) => <li key={task.id}><button type="button" className="proof-task" aria-label={`Select ${task.title}`} aria-pressed={task.id === selectedId} disabled={locked} onClick={() => { if (pendingRef.current) return; setSelectedId(task.id); setCommentPage(1); setDraft(''); setSaved(null); setSaveState('idle'); setSaveError(''); setFieldError(''); setFieldAnnouncement('') }}><strong>{task.title}</strong><p>{task.activity}</p><Badge status={labels[task.status] ?? task.status} /><small>{date(task.startsOn)} to {date(task.endsOn)}</small></button></li>)}</ul>
            <Pagination page={taskPage} hasMore={tasks?.hasMore ?? false} busy={taskBusy || locked} name="tasks" onPage={setTaskPage} />
          </div>
        </Card>
        <Card title={selected?.title ?? 'Selected task'} description="Replies read from the local database.">
          {!selectedId && <p>Select a sample task to read and post replies.</p>}
          {selectedId && <>
            <section aria-label="Replies" aria-busy={commentBusy}>
              {commentBusy && <p>Loading replies…</p>}
              {commentError && <p className="ui-error" role="alert">{saved ? 'Your reply is saved. ' : ''}{commentError}</p>}
              {!commentBusy && !commentError && comments?.items.length === 0 && <p>No replies yet.</p>}
              <ol className="proof-replies" tabIndex={0} aria-label="Persisted replies">{comments?.items.map((reply) => <li key={reply.id}><div><b>{reply.author.name}</b><time dateTime={reply.createdAt} aria-label={timestamp(reply.createdAt)}>{timestamp(reply.createdAt)}</time></div><p>{reply.body}</p></li>)}</ol>
              <Button size="small" disabled={commentBusy} onClick={() => setCommentRevision((value) => value + 1)}>Refresh replies</Button>
              <Pagination page={commentPage} hasMore={comments?.hasMore ?? false} busy={commentBusy} name="replies" onPage={setCommentPage} />
            </section>
            <form className="proof-composer" onSubmit={(event) => { event.preventDefault(); submit() }} noValidate>
              <TextareaField label="Reply" ref={composerRef} value={draft} onChange={(event) => { setDraft(event.target.value); setFieldError(''); setFieldAnnouncement('') }} disabled={locked} required placeholder="Add a helpful update…" description={`${count} of ${proofTextLimit} characters. Surrounding whitespace is removed.`} error={fieldError || undefined} />
              <p className="sr-only" role="status">{fieldAnnouncement}</p>
              {storageError && <p role="alert" className="ui-error">{storageError}</p>}
              {saveError && <p role="alert" className="ui-error">{saveError}</p>}
              {saveState === 'uncertain' && pending && <Button onClick={() => { if (pendingRef.current) void send(pendingRef.current) }}>Retry this reply</Button>}
              {saveState === 'cleanup' && <Button onClick={() => { if (clearRecovery()) setSaveState(saved ? 'saved' : 'idle') }}>Retry recovery cleanup</Button>}
              <Button type="submit" size="small" disabled={locked || !selected || !!storageError}><MessageSquare aria-hidden="true" />{saveState === 'saving' ? 'Saving reply…' : 'Post reply'}</Button>
            </form>
          </>}
          {saved && <div className="proof-saved"><b>Reply saved to the local database.</b><p>{saved.body}</p><time dateTime={saved.createdAt}>{timestamp(saved.createdAt)}</time></div>}
        </Card>
      </div>
    </main>
  )
}
