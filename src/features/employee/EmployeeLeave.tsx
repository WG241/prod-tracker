import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { Bell, ShieldCheck, Users } from 'lucide-react'
import { Card } from '../../components/ui/Card.tsx'
import { Button } from '../../components/ui/Button.tsx'
import { Badge } from '../../components/ui/Badge.tsx'
import { InputField } from '../../components/ui/Field.tsx'
import { AnnounceEvent } from '../../components/accessibility/Announcements.tsx'
import { useFormValidation } from '../../components/accessibility/useFormValidation.ts'
import { useEmployeeRead } from './useEmployeeRead.ts'
import { displayDate } from './date.ts'
import { leaveDraftErrors } from './leave-contracts.ts'
import type { LeaveResponse, LeaveView } from './leave-contracts.ts'
import { useLeaveOperations } from './leave-operations.ts'
import type { LeaveOperations } from './leave-operations.ts'
import './employee.css'

export function LeaveFeedback({ operations, onRetry, onReload }: { operations: LeaveOperations; onRetry: () => void; onReload: () => void }) {
  const record = operations.record
  if (!record) return null
  const message = record.state === 'committed' ? record.result?.changed ? 'Leave change saved.' : 'This leave change was already recorded.' : record.state === 'pending' && record.recovering ? 'Checking this same leave change…' : record.error
  const warnings = record.result?.notificationWarnings ?? []
  return <>
    {record.state === 'committed' ? <LeaveSaved key={record.id} id={record.id} message={message} /> : message && <><div className="employee-banner employee-amber"><p>{message}</p>{(record.state === 'uncertain' || record.state === 'pending' && record.recovering || record.state === 'rejected' && record.code === 'RATE_LIMITED') && <Button busy={record.state === 'pending'} onClick={onRetry}>Retry</Button>}{record.state === 'rejected' && ['LEAVE_CHANGED', 'LEAVE_CONFLICT', 'LEAVE_REPAIR_REQUIRED'].includes(record.code) && <Button onClick={onReload}>Reload latest</Button>}</div><AnnounceEvent event={{ id: `leave:${record.id}:${record.state}:${record.attempt}`, message, intent: record.state === 'pending' ? 'status' : 'alert' }} /></>}
    {!!warnings.length && <><div className="employee-banner employee-amber"><p>Leave was saved. {warnings.includes('MANAGER_UNAVAILABLE') && 'Your manager notification could not be created. '}{warnings.includes('HR_UNAVAILABLE') && 'No active HR notification recipient was available. '}Contact HR to check the notification configuration.</p></div><AnnounceEvent event={{ id: `leave-warning:${record.id}`, message: 'Leave was saved, but some notification recipients were unavailable. Contact HR to check the notification configuration.', intent: 'alert' }} /></>}
  </>
}

function LeaveSaved({ id, message }: { id: string; message: string }) {
  const [visible, setVisible] = useState(true)
  useEffect(() => { const timer = window.setTimeout(() => setVisible(false), 6000); return () => window.clearTimeout(timer) }, [])
  return visible ? <><p className="auth-toast">{message}</p><AnnounceEvent event={{ id: `leave-saved:${id}`, message, intent: 'status' }} /></> : null
}

export function EmployeeLeave({ state, onState, headingRef, onSessionInvalid, operations }: { state: LeaveView; onState: (value: LeaveView) => void; headingRef: RefObject<HTMLHeadingElement | null>; onSessionInvalid: () => void; operations: LeaveOperations }) {
  const read = useEmployeeRead<LeaveResponse>('/api/employee/leave', onSessionInvalid), data = read.data
  const store = useLeaveOperations(operations), record = store.record
  const starts = state.draft ? state.draft.startsOn : data?.defaults.startsOn ?? '', ends = state.draft ? state.draft.expectedReturnOn : data?.defaults.expectedReturnOn ?? ''
  const startRef = useRef<HTMLInputElement>(null), endRef = useRef<HTMLInputElement>(null)
  const seen = useRef(store.commits)
  const reported = useRef('')
  const [savedRefresh, setSavedRefresh] = useState(false)
  const form = useFormValidation({ fields: [{ name: 'startsOn', label: 'Start date', ref: startRef }, { name: 'expectedReturnOn', label: 'Expected return date', ref: endRef }], validate: () => {
    return leaveDraftErrors({ startsOn: starts, expectedReturnOn: ends }, data?.today, data?.bounds.latestStartOn)
  } })
  const checkedDraft = useRef({ starts, ends })
  useEffect(() => {
    if (checkedDraft.current.starts === starts && checkedDraft.current.ends === ends) return
    checkedDraft.current = { starts, ends }; form.revalidate('startsOn'); form.revalidate('expectedReturnOn')
  }, [starts, ends, form])
  useEffect(() => {
    if (record?.state === 'rejected' && record.fields && reported.current !== record.id) { reported.current = record.id; form.reportErrors(record.fields) }
  }, [record, form])
  useEffect(() => {
    if (seen.current !== store.commits) { seen.current = store.commits; setSavedRefresh(true); headingRef.current?.focus(); onState({ userId: state.userId, draft: null }); form.clear(); read.retry() }
  }, [store.commits, state.userId, onState, form, read, headingRef])
  const retry = () => { if (record) void store.send(record.operation, onSessionInvalid) }
  const reload = () => { store.discard(); form.clear(); onState({ userId: state.userId, draft: null }); read.retry() }
  const disabled = record?.state === 'uncertain' || read.loading || read.stale
  const draft = record?.state === 'uncertain' && record.operation.kind === 'CREATE' ? record.operation.draft : { startsOn: starts, expectedReturnOn: ends }
  return <>
    <header className="employee-heading"><div><h1 ref={headingRef} tabIndex={-1}>Time to recharge</h1><p>Set your dates. Your manager and HR will be kept informed.</p></div></header>
    <LeaveFeedback operations={store} onRetry={retry} onReload={reload} />
    {read.loading && <><p className="employee-read-message">Loading leave…</p><AnnounceEvent event={{ id: 'leave-loading', message: 'Loading leave…', intent: 'status' }} /></>}
    {read.error && <div className="employee-banner employee-amber"><p>{savedRefresh ? 'Your change was saved, but the latest leave state could not be loaded. ' : ''}{read.error}</p><Button onClick={read.retry}>Retry</Button><AnnounceEvent event={{ id: `leave-read:${read.error}`, message: read.error, intent: 'alert' }} /></div>}
    {data && <div className="employee-leave-columns" aria-busy={read.loading || undefined}>
      <Card title={data.current ? 'Your leave dates' : 'I’m going on leave'} actions={data.current && <Badge status={data.state === 'SCHEDULED' ? 'Scheduled' : 'On leave'} />}>
        {data.state === 'REPAIR_REQUIRED' ? <div className="employee-banner employee-amber"><p>Your leave periods need review. Contact HR before making another leave change.</p><Button onClick={read.retry}>Retry</Button></div> : data.current ? <>
          <dl className="employee-leave-dates"><div><dt>Leave starts</dt><dd>{displayDate(data.current.startsOn)}</dd></div><div><dt>Expected return</dt><dd>{displayDate(data.current.expectedReturnOn)}</dd></div></dl>
          <p className="employee-muted employee-leave-explanation">{data.state === 'SCHEDULED' ? 'Your tracker remains active until your leave starts.' : 'Your tracker is paused. Full leave weeks are excluded from expected submission; partial weeks keep their available workdays.'}</p>
          <Button variant="primary" disabled={disabled} busy={record?.state === 'pending'} onClick={() => data.current && void store.send({ kind: data.current.canCancel ? 'CANCEL' : 'RETURN', leaveId: data.current.id }, onSessionInvalid)}>{data.current.canCancel ? 'Cancel leave' : 'I’m back — end leave now'}</Button>
        </> : <form noValidate onSubmit={(event) => { event.preventDefault(); if (!disabled && data.canCreate && form.submit()) void store.send({ kind: 'CREATE', draft }, onSessionInvalid) }}>
          <div className="employee-form-grid"><InputField ref={startRef} label="Start date" type="date" min={data.today} max={data.bounds.latestStartOn} required value={draft.startsOn} disabled={store.busy} error={form.errors.startsOn} onChange={(e) => { onState({ ...state, draft: { startsOn: e.target.value, expectedReturnOn: ends } }); form.revalidate('startsOn') }} /><InputField ref={endRef} label="Expected return date" type="date" min={starts} max="9999-12-31" required value={draft.expectedReturnOn} disabled={store.busy} error={form.errors.expectedReturnOn} onChange={(e) => { onState({ ...state, draft: { startsOn: starts, expectedReturnOn: e.target.value } }); form.revalidate('expectedReturnOn') }} /></div>
          {!data.canCreate && <p className="ui-error">Leave dates are unavailable. Please contact HR.</p>}
          <Button className="employee-leave-confirm" variant="primary" type="submit" busy={record?.state === 'pending'} disabled={disabled || !data.canCreate}>Confirm leave</Button>
        </form>}
      </Card>
      <Card><h2>Take a proper break.</h2><div className="employee-leave-notice"><Bell aria-hidden="true" /><p>No reminders while you’re away.</p></div><div className="employee-leave-notice"><ShieldCheck aria-hidden="true" /><p>Full leave weeks don’t count against your expected submission.</p></div><div className="employee-leave-notice"><Users aria-hidden="true" /><p>No approval needed. Your manager and HR are kept informed.</p></div></Card>
    </div>}
  </>
}
