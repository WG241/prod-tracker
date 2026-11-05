import { useId, useRef, useState } from 'react'
import { Dialog } from '../../components/ui/Dialog.tsx'
import { Button } from '../../components/ui/Button.tsx'
import { InputField } from '../../components/ui/Field.tsx'
import { useFormValidation } from '../../components/accessibility/useFormValidation.ts'
import type { Selection } from './contracts.ts'
import { rangeError, shiftDate } from './date.ts'

export function DateRange({ selection, anchor, currentWeek, asOf, onApply, onClose }: { selection: Selection | null; anchor: string; currentWeek: string; asOf: string; onApply: (range: Selection | null) => void; onClose: () => void }) {
  const [from, setFrom] = useState(selection?.kind === 'range' ? selection.from : anchor)
  const [to, setTo] = useState(selection?.kind === 'range' ? selection.to : shiftDate(anchor, 4) ?? anchor)
  const fromRef = useRef<HTMLInputElement>(null), toRef = useRef<HTMLInputElement>(null)
  const formId = useId()
  const validation = useFormValidation({ fields: [{ name: 'from', label: 'From', ref: fromRef }, { name: 'to', label: 'To', ref: toRef }], validate: () => rangeError(fromRef.current?.value ?? from, toRef.current?.value ?? to) })
  function preset(name: string) {
    const today = new Date(Date.parse(asOf) + 3600000).toISOString().slice(0, 10)
    const month = today.slice(0, 7)
    const last = new Date(`${month}-01T00:00:00Z`)
    last.setUTCMonth(last.getUTCMonth() + 1, 0)
    setFrom(name === 'This month' ? `${month}-01` : name === 'Last 4 weeks' ? shiftDate(currentWeek, -21) ?? currentWeek : currentWeek)
    setTo(name === 'This month' ? last.toISOString().slice(0, 10) : shiftDate(currentWeek, 4) ?? currentWeek)
    validation.clear()
  }
  return <Dialog open title="Choose a date range" onClose={onClose} footer={<><Button variant="ghost" onClick={() => onApply(null)}>Clear</Button><Button onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form={formId}>Apply range</Button></>}>
    <form id={formId} noValidate onSubmit={(event) => { event.preventDefault(); if (validation.submit()) onApply({ kind: 'range', from, to }) }}>
      <div className="employee-presets">{['This week', 'Last 4 weeks', 'This month'].map((name) => <Button key={name} size="small" onClick={() => preset(name)}>{name}</Button>)}</div>
      <div className="employee-form-grid"><InputField label="From" type="date" min="0001-01-01" max="9999-12-31" required ref={fromRef} value={from} onChange={(e) => { setFrom(e.target.value); validation.revalidate('from') }} error={validation.errors.from} /><InputField label="To" type="date" min="0001-01-01" max="9999-12-31" required ref={toRef} value={to} onChange={(e) => { setTo(e.target.value); validation.revalidate('to') }} error={validation.errors.to} /></div>
    </form>
  </Dialog>
}
