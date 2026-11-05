import { useEffect, useId, useRef, useState } from 'react'
import { Button } from '../components/ui/Button.tsx'
import { InputField, TextareaField } from '../components/ui/Field.tsx'
import { AnnounceEvent } from '../components/accessibility/Announcements.tsx'
import { useAnnounce } from '../components/accessibility/useAnnounce.ts'
import { useFormValidation } from '../components/accessibility/useFormValidation.ts'

export function ExampleForm() {
  const title = useRef<HTMLInputElement>(null)
  const activity = useRef<HTMLTextAreaElement>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState('')
  const lock = useRef(false)
  const attempt = useRef(0)
  const timer = useRef(0)
  const announce = useAnnounce()
  const validation = useFormValidation({
    fields: [{ name: 'title', label: 'Example title', ref: title }, { name: 'activity', label: 'Example activity', ref: activity }],
    validate: () => ({ title: title.current?.value.trim() ? undefined : 'Enter an example title.', activity: activity.current?.value.trim() ? undefined : 'Describe the example activity.' }),
  })
  useEffect(() => () => window.clearTimeout(timer.current), [])
  return <form aria-label="Example task form" noValidate aria-busy={busy} onSubmit={(event) => {
    event.preventDefault()
    if (lock.current || !validation.submit()) return
    lock.current = true
    setBusy(true)
    setResult('')
    const id = ++attempt.current
    timer.current = window.setTimeout(() => {
      lock.current = false
      setBusy(false)
      setResult('Example complete. No task was saved.')
      announce({ id: `example-form:${id}`, message: 'Example complete. No task was saved.', intent: 'status' })
    }, 800)
  }}>
    <p className="ui-help">Component example only. Both example fields are required; this form never saves a task.</p>
    <InputField label="Example title" ref={title} required readOnly={busy} error={validation.errors.title} onChange={() => validation.revalidate('title')} />
    <TextareaField label="Example activity" ref={activity} required readOnly={busy} error={validation.errors.activity} onChange={() => validation.revalidate('activity')} />
    <div className="preview-row"><Button type="submit" variant="primary" busy={busy}>{busy ? 'Completing example…' : 'Complete example'}</Button><Button onClick={() => {
      const message = 'Example service error. No task was saved.'
      setResult(message)
      announce({ id: `example-error:${++attempt.current}`, message, intent: 'alert' })
    }}>Simulate form error</Button></div>
    {result && <p>{result}</p>}
  </form>
}

export function AnnouncementExamples({ modal = false, immediateId, onClose, onCompleteAfterClose }: { modal?: boolean; immediateId?: number; onClose?: () => void; onCompleteAfterClose?: () => void }) {
  const announce = useAnnounce()
  const instance = useId()
  const count = useRef(0)
  const last = useRef('')
  const label = modal ? 'Modal' : 'Root'
  return <div className="preview-row">
    {immediateId !== undefined && <AnnounceEvent event={{ id: `${instance}:modal-open:${immediateId}`, message: 'Modal example ready.', intent: 'status' }} />}
    <Button onClick={() => { last.current = `${instance}:${label}:${++count.current}`; announce({ id: last.current, message: `${label} example status.`, intent: 'status' }) }}>{label} status example</Button>
    <Button onClick={() => { last.current = `${instance}:${label}:${++count.current}`; announce({ id: last.current, message: `${label} example error.`, intent: 'alert' }) }}>{label} alert example</Button>
    <Button onClick={() => announce({ id: last.current, message: `${label} example status.`, intent: 'status' })}>Repeat {label.toLowerCase()} event</Button>
    {onClose && <Button onClick={() => { announce({ id: `${instance}:cancel:${++count.current}`, message: 'Discard this closed modal example.', intent: 'status' }); onClose() }}>Close before announcement</Button>}
    {onCompleteAfterClose && <Button onClick={onCompleteAfterClose}>Complete after closing</Button>}
  </div>
}
