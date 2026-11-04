import { useEffect, useId, useRef, useState } from 'react'
import { Button } from '../../components/ui/Button.tsx'
import { CheckboxField, InputField, SelectField, TextareaField } from '../../components/ui/Field.tsx'
import { Dialog } from '../../components/ui/Dialog.tsx'
import { useFormValidation } from '../../components/accessibility/useFormValidation.ts'
import { displayDate, isoWeek, rangeError, shiftDate } from './date.ts'
import { pendingTextProps } from './pending-fields.ts'
import type { TaskDraft, WorkingStatus } from './mutations.ts'
import type { TaskEntry } from './contracts.ts'
import type { RefObject } from 'react'
import { AnnounceEvent } from '../../components/accessibility/Announcements.tsx'

export function TaskForm({ week, task, initial, pending, error, fields: serverFields, conflict, uncertain, onSubmit, onRetry, onReload, onClose, returnFocusRef }: {
  week: string; task?: TaskEntry; initial?: TaskDraft; pending: boolean; error: string; fields?: Record<string, string>; conflict: boolean; uncertain: boolean
  onSubmit: (draft: TaskDraft) => void; onRetry: () => void; onReload: () => void; onClose: () => void; returnFocusRef: RefObject<HTMLElement | null>
}) {
  const friday = shiftDate(week, 4) ?? week
  const [draft, setDraft] = useState<TaskDraft>(() => initial ?? (task ? {
    title: task.title, activity: task.activity, startsOn: task.startsOn, endsOn: task.endsOn, carryRequested: task.carryRequested,
    status: ['PENDING', 'IN_PROGRESS', 'BLOCKED'].includes(task.status) ? task.status as WorkingStatus : 'PENDING',
    ...(task.status === 'BLOCKED' && task.reason ? { blockerReason: task.reason } : {}),
  } : { title: '', activity: '', startsOn: week, endsOn: friday, carryRequested: false }))
  const draftRef = useRef(draft)
  const titleRef = useRef<HTMLInputElement>(null), activityRef = useRef<HTMLTextAreaElement>(null), startRef = useRef<HTMLInputElement>(null), endRef = useRef<HTMLInputElement>(null)
  const carryRef = useRef<HTMLInputElement>(null), reportedFields = useRef<Record<string, string> | undefined>(undefined)
  const formId = useId()
  const datesChanged = !task || draft.startsOn !== task.startsOn || draft.endsOn !== task.endsOn
  const requiredCarry = datesChanged && draft.endsOn > friday
  const planning = !task || task.permissions.planningFieldsEditable
  const frozenInput = pending || uncertain
  const textLock = pendingTextProps(frozenInput)
  const validation = useFormValidation({ fields: [
    { name: 'title', label: 'Task title', ref: titleRef }, { name: 'activity', label: 'Activity', ref: activityRef },
    { name: 'startsOn', label: 'Start date', ref: startRef }, { name: 'endsOn', label: 'End date', ref: endRef },
    { name: 'carryRequested', label: 'Carry into next week', ref: carryRef },
  ], validate: () => {
    const current = draftRef.current
    const next: Record<string, string> = {}
    const changed = !task || current.startsOn !== task.startsOn || current.endsOn !== task.endsOn
    if (!current.title.trim() || current.title.trim().length > 120) next.title = 'Enter a task title of 1 to 120 characters.'
    if (!current.activity.trim() || current.activity.trim().length > 6000) next.activity = 'Enter activity of 1 to 6,000 characters.'
    if (changed) {
      const dateErrors = rangeError(current.startsOn, current.endsOn)
      if (dateErrors.from) next.startsOn = dateErrors.from
      if (dateErrors.to) next.endsOn = dateErrors.to
      if (current.startsOn < week || current.startsOn > friday) next.startsOn = 'Choose a start date from this Monday to Friday.'
    }
    return next
  } })
  const nextWeek = shiftDate(week, 7)
  const carryEnd = nextWeek ? (draft.endsOn > (shiftDate(nextWeek, 4) ?? nextWeek) ? draft.endsOn : shiftDate(nextWeek, 4) ?? nextWeek) : null
  let carryDays = 0
  if (nextWeek && carryEnd && !rangeError(nextWeek, carryEnd).to) {
    for (let i = 0; i < 366; i++) { const value = shiftDate(nextWeek, i); if (!value || value > carryEnd) break; const day = new Date(`${value}T00:00:00Z`).getUTCDay(); if (day > 0 && day < 6) carryDays++ }
  }
  useEffect(() => { if (serverFields && reportedFields.current !== serverFields) { reportedFields.current = serverFields; validation.reportErrors(serverFields) } }, [serverFields, validation])
  const errors = { ...validation.errors, ...serverFields }
  function change<K extends keyof TaskDraft>(key: K, value: TaskDraft[K]) {
    const next = { ...draftRef.current, [key]: value, ...(key === 'endsOn' && String(value) > friday ? { carryRequested: true } : {}) }
    draftRef.current = next
    setDraft(next)
    if (key === 'title' || key === 'activity' || key === 'startsOn' || key === 'endsOn' || key === 'carryRequested') validation.revalidate(key)
  }
  return <Dialog open title={task ? 'Edit task' : 'Add a task'} onClose={onClose} returnFocusRef={returnFocusRef} footer={<>
    {conflict && <Button onClick={onReload}>Reload latest</Button>}
    <Button onClick={onClose}>Cancel</Button>
    {uncertain ? <Button variant="primary" busy={pending} onClick={onRetry}>Retry</Button> : <Button type="submit" form={formId} variant="primary" busy={pending} disabled={conflict}>{task ? 'Save changes' : 'Save task'}</Button>}
  </>}>
    <p className="employee-muted employee-form-intro">A clear outcome, and the work you’ll do to achieve it.</p>
    <form id={formId} noValidate onSubmit={(event) => { event.preventDefault(); if (!pending && !uncertain && !conflict && validation.submit()) onSubmit({ ...draft, carryRequested: requiredCarry || draft.carryRequested }) }}>
      <InputField label="Task title" required maxLength={120} ref={titleRef} value={draft.title} disabled={!planning} {...textLock} onChange={(e) => change('title', e.target.value)} error={errors.title} />
      <TextareaField label="Activity" required maxLength={6000} ref={activityRef} value={draft.activity} {...textLock} onChange={(e) => change('activity', e.target.value)} error={errors.activity} />
      <div className="employee-form-grid"><InputField label="Start date" type="date" required min={week} max={friday} ref={startRef} value={draft.startsOn} disabled={!planning} {...textLock} onChange={(e) => change('startsOn', e.target.value)} error={errors.startsOn} /><InputField label="End date" type="date" required min={draft.startsOn} max="9999-12-31" ref={endRef} value={draft.endsOn} disabled={!planning} {...textLock} onChange={(e) => change('endsOn', e.target.value)} error={errors.endsOn} /></div>
      <CheckboxField ref={carryRef} label="Carry into next week" error={serverFields?.carryRequested} checked={requiredCarry || draft.carryRequested} disabled={!planning || requiredCarry || frozenInput} onChange={(e) => change('carryRequested', e.target.checked)} />
      {(requiredCarry || draft.carryRequested) && nextWeek && carryEnd && <p className="employee-carry-hint">Week {isoWeek(nextWeek)}, {carryDays} working {carryDays === 1 ? 'day' : 'days'}, {displayDate(nextWeek)} to {displayDate(carryEnd)}{requiredCarry && '. Carry over is required for this end date.'}</p>}
      {task && <SelectField label="Status" value={draft.status} disabled={frozenInput} onChange={(e) => change('status', e.target.value as WorkingStatus)}><option value="PENDING">Pending</option><option value="IN_PROGRESS">In progress</option><option value="BLOCKED">Blocked</option><option value="COMPLETED" disabled={task.status === 'AWAITING_APPROVAL'}>Completed</option></SelectField>}
      {task?.status === 'AWAITING_APPROVAL' && <p className="employee-banner employee-amber">Changing this task withdraws its pending review. Submit it again when ready.</p>}
      {task && !planning && <p className="employee-banner employee-amber">Tracker is closed. Title, dates and carry over are locked; activity and status can still be updated.</p>}
      {error && <><p className="ui-error">{error}</p><AnnounceEvent event={{ id: `task-form:${error}`, message: error, intent: 'alert' }} /></>}
    </form>
  </Dialog>
}
