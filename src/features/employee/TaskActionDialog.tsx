import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { Dialog } from '../../components/ui/Dialog.tsx'
import { Button } from '../../components/ui/Button.tsx'
import { TextareaField } from '../../components/ui/Field.tsx'
import { AnnounceEvent } from '../../components/accessibility/Announcements.tsx'
import { useFormValidation } from '../../components/accessibility/useFormValidation.ts'
import { ChevronRight, Repeat2, Trash2 } from 'lucide-react'
import type { TaskEntry } from './contracts.ts'
import type { TaskAction } from './TaskMenu.tsx'
import type { OwnTaskRole, TaskDraft, TaskOperation } from './mutations.ts'
import { TaskForm } from './TaskForm.tsx'
import { useTaskOperations } from './operations.ts'
import type { TaskOperations } from './operations.ts'
import { pendingTextProps } from './pending-fields.ts'

export type ActionSelection = { kind: TaskAction | 'CREATE'; task?: TaskEntry; week: string }
export function TaskActionDialog({ selection, operations, onClose, onReload, onSessionInvalid, returnFocusRef, onNext, role = 'EMPLOYEE' }: {
  selection: ActionSelection; operations: TaskOperations; onClose: () => void; onReload: () => void; onSessionInvalid: () => void; returnFocusRef: RefObject<HTMLElement | null>; onNext: (next: ActionSelection) => void; role?: OwnTaskRole
}) {
  const store = useTaskOperations(operations)
  const { task, week, kind } = selection
  const baseKind = kind === 'CREATE' || kind === 'EDIT' || kind === 'CARRY' || kind === 'DELETE' ? kind : 'STATUS'
  const key = kind === 'CREATE' ? 'CREATE' : `${baseKind}:${task!.id}`
  const draftKey = `FORM:${key}`
  const record = store.get(key)
  const unresolved = record?.state === 'pending' || record?.state === 'uncertain'
  const prior = unresolved ? record.operation : null
  const [draft, setDraft] = useState<TaskDraft | undefined>(() => prior && (prior.kind === 'CREATE' || prior.kind === 'EDIT') ? prior.draft : store.getDraft<TaskDraft>(draftKey))
  const [step, setStep] = useState<'form' | 'confirm' | 'blocker' | 'next'>(() => kind === 'EDIT' || kind === 'CREATE' ? 'form' : kind === 'BLOCKED' ? 'blocker' : 'confirm')
  const [reason, setReason] = useState(prior && (prior.kind === 'STATUS' || prior.kind === 'EDIT') ? (prior.kind === 'EDIT' ? prior.draft.blockerReason : prior.blockerReason) ?? '' : task?.status === 'BLOCKED' ? task.reason ?? '' : '')
  const reasonValue = useRef(reason)
  const reasonRef = useRef<HTMLTextAreaElement>(null)
  const submitted = useRef(unresolved)
  const pending = record?.state === 'pending', uncertain = record?.state === 'uncertain'
  const conflict = record?.state === 'rejected' && ['STALE_TASK', 'WEEK_CHANGED', 'OWN_TASK_REVIEW_CONFLICT'].includes(record.code)
  const validation = useFormValidation({ fields: [{ name: 'blockerReason', label: 'Reason', ref: reasonRef }], validate: () => !reasonValue.current.trim() || reasonValue.current.trim().length > 2000 ? { blockerReason: 'Enter a reason of 1 to 2,000 characters.' } : {} })
  useEffect(() => {
    if (!submitted.current || record?.state !== 'committed') return
    submitted.current = false
    const operation = record.operation
    const blocked = operation.kind === 'STATUS' ? operation.status === 'BLOCKED' : operation.kind === 'EDIT' && operation.draft.status === 'BLOCKED'
    let active = true
    queueMicrotask(() => { if (active) { if (blocked) setStep('next'); else onClose() } })
    return () => { active = false }
  }, [record?.state, record, onClose])
  function send(operation: TaskOperation) { submitted.current = true; store.discardDraft(draftKey); void store.send(operation, onSessionInvalid) }
  function save(value: TaskDraft) {
    setDraft(value)
    if (value.status === 'BLOCKED') { setStep('blocker'); return }
    if (value.status === 'COMPLETED') { setStep('confirm'); return }
    send(kind === 'CREATE' ? { kind: 'CREATE', week, draft: value } : { kind: 'EDIT', taskId: task!.id, revision: task!.revision, draft: value })
  }
  function confirm() {
    if (unresolved && record) { send(record.operation); return }
    if (kind === 'EDIT') send({ kind: 'EDIT', taskId: task!.id, revision: task!.revision, draft: { ...draft!, ...(step === 'blocker' ? { blockerReason: reason.trim() } : {}) } })
    else if (kind === 'CARRY') send({ kind: 'CARRY', taskId: task!.id, revision: task!.revision, carryRequested: !task!.carryRequested })
    else if (kind === 'DELETE') send({ kind: 'DELETE', taskId: task!.id, revision: task!.revision })
    else send({ kind: 'STATUS', taskId: task!.id, revision: task!.revision, status: kind as 'PENDING' | 'IN_PROGRESS' | 'BLOCKED' | 'COMPLETED', ...(kind === 'BLOCKED' ? { blockerReason: reason.trim() } : {}) })
  }
  function back() { if (kind === 'EDIT' && !unresolved) setStep('form'); else onClose() }
  if (step === 'form') return <TaskForm week={week} task={task} initial={draft} pending={pending} uncertain={uncertain} conflict={conflict} error={record?.error ?? ''} fields={record?.fields} returnFocusRef={returnFocusRef}
    onSubmit={save} onClose={onClose} onDraftChange={(value) => store.setDraft(draftKey, value)} onRetry={() => record && send(record.operation)} onReload={() => { store.discard(key); onReload() }} />
  if (step === 'next') return <Dialog open size="small" title="What would you like to do next?" onClose={onClose} returnFocusRef={returnFocusRef} footer={<Button onClick={onClose}>Cancel</Button>}><p className="employee-muted employee-form-intro">Your blocker is saved. Choose what happens to this task.</p><div className="employee-next-actions">{(['CARRY', 'DELETE'] as const).map((next) => <button className="employee-next-action" key={next} disabled={next === 'CARRY' ? !task?.permissions.canCarry : !task?.permissions.canDelete} onClick={() => task && onNext({ kind: next, week, task: { ...task, revision: record?.result?.taskRevision ?? task.revision, status: 'BLOCKED', reason } })}>{next === 'CARRY' ? <Repeat2 aria-hidden="true" /> : <Trash2 aria-hidden="true" />}<span><strong>{next === 'CARRY' ? 'Carry over to next week' : 'Delete task'}</strong><small>{next === 'CARRY' ? 'Keep the task and its blocker visible.' : 'Remove it from your weekly plan.'}</small></span>{next === 'CARRY' && <ChevronRight aria-hidden="true" />}</button>)}</div></Dialog>
  const completing = kind === 'COMPLETED' || draft?.status === 'COMPLETED'
  const completionMessage = role === 'LINE_MANAGER' ? 'This task will be auto-approved on completion.' : 'This will be sent to your line manager for approval.'
  const title = step === 'blocker' ? 'What is blocking this task?' : kind === 'DELETE' ? 'Delete this task?' : kind === 'CARRY' ? task?.carryRequested ? 'Clear carry over?' : 'Carry over next week?' : completing ? 'Complete this task?' : kind === 'IN_PROGRESS' ? 'Set this task to In progress?' : 'Set this task to Pending?'
  return <Dialog open size="small" title={title} onClose={back} returnFocusRef={returnFocusRef} footer={<>
    {conflict && <Button onClick={() => { store.discard(key); onReload() }}>Reload latest</Button>}<Button onClick={back}>Cancel</Button><Button variant={kind === 'DELETE' ? 'danger' : 'primary'} busy={pending} disabled={conflict} onClick={() => { if (step !== 'blocker' || unresolved || validation.submit()) confirm() }}>{uncertain ? 'Retry' : step === 'blocker' ? 'Save blocker' : kind === 'DELETE' ? 'Delete task' : completing ? 'Mark completed' : 'Save'}</Button>
  </>}>
    {step === 'blocker' ? <TextareaField label="Reason" ref={reasonRef} maxLength={2000} value={reason} {...pendingTextProps(pending || uncertain)} error={validation.errors.blockerReason || record?.fields?.blockerReason} onChange={(event) => { reasonValue.current = event.target.value; setReason(event.target.value); validation.revalidate('blockerReason') }} /> : <p>{kind === 'DELETE' ? 'This task will be removed from your weekly tracker. This cannot be undone.' : completing ? completionMessage : kind === 'CARRY' ? 'Your next week record will be updated.' : 'Keep your task status up to date.'}</p>}
    {record?.error && <><p className="ui-error">{record.error}</p><AnnounceEvent event={{ id: `${record.id}:${record.state}`, message: record.error, intent: 'alert' }} /></>}
  </Dialog>
}
