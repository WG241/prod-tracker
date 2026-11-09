import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { ArrowRight, Bell, CircleCheck, ShieldCheck, Users } from 'lucide-react'
import { AnnounceEvent } from '../../components/accessibility/Announcements.tsx'
import { useFormValidation } from '../../components/accessibility/useFormValidation.ts'
import { Avatar } from '../../components/ui/Avatar.tsx'
import { Badge } from '../../components/ui/Badge.tsx'
import { Button } from '../../components/ui/Button.tsx'
import { Card } from '../../components/ui/Card.tsx'
import { Dialog } from '../../components/ui/Dialog.tsx'
import { InputField, SelectField } from '../../components/ui/Field.tsx'
import { NoticeToast } from '../../components/ui/NoticeToast.tsx'
import { SkeletonForm, SkeletonTable } from '../../components/ui/Skeleton.tsx'
import { Table } from '../../components/ui/Table.tsx'
import { displayDate, displayTime } from '../employee/date.ts'
import { leaveDraftErrors } from '../employee/leave-contracts.ts'
import { useLeaveOperations } from '../employee/leave-operations.ts'
import { Pagination } from '../employee/Pagination.tsx'
import { useEmployeeRead } from '../employee/useEmployeeRead.ts'
import { coverDraftErrors, managerLeaveEndpoint, managerLeaveWarnings } from './leave-contracts.ts'
import type { CoverDraft, CoverEvidence, CoverHistory, ManagerLeave, ManagerLeaveHistory, ManagerLeaveOperation, ManagerLeaveView, ReliefCandidates } from './leave-contracts.ts'
import type { ManagerLeaveOperations } from './leave-operations.ts'
import '../employee/employee.css'
import './manager-leave.css'

type FormProps = {
  draft: CoverDraft; onDraft: (draft: CoverDraft) => void; onSubmit: () => void
  cover: boolean; earliest: string; latest: string; locked: boolean; pending: boolean
  serverError?: { id: string; fields: Record<string, string> }; onCancel?: () => void; onSessionInvalid: () => void
}
function CoverForm({ draft, onDraft, onSubmit, cover, earliest, latest, locked, pending, serverError, onCancel, onSessionInvalid }: FormProps) {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [selectedName, setSelectedName] = useState('')
  const start = useRef<HTMLInputElement>(null), end = useRef<HTMLInputElement>(null), officer = useRef<HTMLSelectElement>(null)
  useLayoutEffect(() => { if (cover) start.current?.focus() }, [cover])
  const reported = useRef('')
  const startLabel = cover ? 'Cover starts' : 'Start date'
  const endLabel = cover ? 'Cover ends' : 'Expected return date'
  function dateErrors(startsOn: string, endsOn: string) {
    if (cover) return coverDraftErrors({ startsOn, endsOn }, earliest, latest)
    const errors = leaveDraftErrors({ startsOn, expectedReturnOn: endsOn }, earliest, latest)
    return { ...(errors.startsOn ? { startsOn: errors.startsOn } : {}), ...(errors.expectedReturnOn ? { endsOn: errors.expectedReturnOn } : {}) }
  }
  const form = useFormValidation({
    fields: [{ name: 'startsOn', label: startLabel, ref: start }, { name: 'endsOn', label: endLabel, ref: end }, { name: 'reliefManagerId', label: 'Relief officer', ref: officer }],
    validate: () => ({ ...dateErrors(start.current?.value ?? draft.startsOn, end.current?.value ?? draft.endsOn),
      ...((officer.current?.value ?? draft.reliefManagerId) ? {} : { reliefManagerId: 'Choose a relief officer.' }) }),
  })
  useEffect(() => {
    if (!serverError || reported.current === serverError.id) return
    reported.current = serverError.id
    const { expectedReturnOn, ...errors } = serverError.fields
    form.reportErrors({ ...errors, ...(expectedReturnOn ? { endsOn: expectedReturnOn } : {}) })
  }, [serverError, form])
  const params = new URLSearchParams({ startsOn: draft.startsOn, endsOn: draft.endsOn, search, page: String(page) })
  const eligibleDates = !Object.keys(dateErrors(draft.startsOn, draft.endsOn)).length
  const read = useEmployeeRead<ReliefCandidates>(eligibleDates ? `${managerLeaveEndpoint}/relief-candidates?${params}` : null, onSessionInvalid)
  const options = read.data?.candidates.items ?? []
  const changeDate = (field: 'startsOn' | 'endsOn', value: string) => {
    setPage(1)
    setSelectedName('')
    onDraft({ ...draft, [field]: value, reliefManagerId: '' })
    form.revalidate(field)
    if (field === 'startsOn') form.revalidate('endsOn')
  }
  return <form className="manager-leave-form" noValidate onSubmit={(event) => {
    event.preventDefault()
    if (!locked && !pending && form.submit()) onSubmit()
  }}>
    <div className="employee-form-grid">
      <InputField ref={start} label={startLabel} type="date" min={earliest} max={latest} value={draft.startsOn} readOnly={locked}
        required error={form.errors.startsOn} onChange={(event) => changeDate('startsOn', event.target.value)} />
      <InputField ref={end} label={endLabel} type="date" min={draft.startsOn} max={cover ? latest : '9999-12-31'} value={draft.endsOn} readOnly={locked}
        required error={form.errors.endsOn} onChange={(event) => changeDate('endsOn', event.target.value)} />
    </div>
    <InputField label="Search relief officers" type="search" value={search} maxLength={120} placeholder="Search name or business…" readOnly={locked}
      onChange={(event) => { setSearch(event.target.value); setPage(1) }} />
    <SelectField ref={officer} id={cover ? 'cover-officer' : 'initial-officer'} label="Relief officer" value={draft.reliefManagerId} required
      disabled={locked} error={form.errors.reliefManagerId}
      description="Your colleague can review your team’s completions during these dates."
      onChange={(event) => {
        const id = event.target.value
        setSelectedName(options.find((option) => option.id === id)?.name ?? '')
        onDraft({ ...draft, reliefManagerId: id })
        form.revalidate('reliefManagerId')
      }}>
      <option value="">Choose an officer</option>
      {draft.reliefManagerId && !options.some((option) => option.id === draft.reliefManagerId) &&
        <option value={draft.reliefManagerId}>{selectedName || 'Selected officer'}</option>}
      {options.map((option) => <option key={option.id} value={option.id}>{option.name} · {option.business}</option>)}
    </SelectField>
    {eligibleDates && read.loading && <AnnounceEvent event={{ id: `cover-options:${params}`, message: 'Loading relief officers…', intent: 'status' }} />}
    {read.error && <div className="employee-banner employee-amber"><p>Relief officers could not be loaded.</p><Button size="small" onClick={read.retry}>Retry officers</Button></div>}
    {read.data && !read.loading && !read.error && !read.data.candidates.total &&
      <p className="employee-read-message">{search ? 'No eligible officers match this search.' : 'No relief officer is available for these dates. Contact HR to arrange cover.'}</p>}
    {read.data && (read.data.candidates.total > 25 || page > 1) && <Pagination value={read.data.candidates} label="officer" onPage={setPage} />}
    <div className="employee-actions">
      <Button type="submit" variant="primary" busy={pending} aria-disabled={locked}>{cover ? 'Save cover' : 'Confirm leave'}</Button>
      {onCancel && <Button onClick={onCancel} disabled={locked}>Cancel</Button>}
    </div>
  </form>
}

function CoverRow({ row }: { row: CoverEvidence }) {
  return <li className="manager-cover-evidence">
    <div><strong>{row.officerName ?? 'Name not recorded'}</strong>
      {row.officerBusiness && <small> · {row.officerBusiness}</small>}</div>
    <small>{displayDate(row.startsOn, false)} to {displayDate(row.endsOn)} · {row.state}</small>
    {row.effectiveStartsAt && row.effectiveEndsAt && <small>Effective {displayTime(row.effectiveStartsAt)} to {displayTime(row.effectiveEndsAt)}</small>}
    {row.endedAt && <small>Ended {displayTime(row.endedAt)}</small>}
  </li>
}
function PreviousCover({ leaveId, exclude, onSessionInvalid, revision }: { leaveId: string; exclude?: string; onSessionInvalid: () => void; revision: number }) {
  const [page, setPage] = useState(1)
  const read = useEmployeeRead<CoverHistory>(`${managerLeaveEndpoint}/${encodeURIComponent(leaveId)}/cover-history?page=${page}`, onSessionInvalid, 'This leave is no longer available.')
  const seen = useRef(revision)
  const { retry } = read
  useEffect(() => { if (seen.current !== revision) { seen.current = revision; retry() } }, [revision, retry])
  const rows = read.data?.arrangements.items.filter(({ id }) => id !== exclude) ?? []
  return <div aria-busy={read.loading || undefined}>
    {read.loading && !read.data && <p>Loading cover arrangements…</p>}
    {read.error && <div className="employee-banner employee-amber"><p>{read.error}</p><Button size="small" onClick={read.retry}>Retry cover history</Button></div>}
    {read.stale && <p className="employee-read-message">This cover history may be out of date.</p>}
    {read.data && (rows.length ? <ul className="manager-cover-list">{rows.map((row) => <CoverRow key={row.id} row={row} />)}</ul>
      : <p className="employee-read-message">No previous relief arrangements on this page.</p>)}
    {read.data && (read.data.arrangements.total > 25 || page > 1) && <Pagination value={read.data.arrangements} label="cover history" onPage={setPage} />}
  </div>
}

export function ManagerLeavePage({ view, onView, headingRef, operations, onSessionInvalid }: {
  view: ManagerLeaveView; onView: (view: ManagerLeaveView) => void; headingRef: RefObject<HTMLHeadingElement | null>
  operations: ManagerLeaveOperations; onSessionInvalid: () => void
}) {
  const read = useEmployeeRead<ManagerLeave>(managerLeaveEndpoint, onSessionInvalid)
  const history = useEmployeeRead<ManagerLeaveHistory>(`${managerLeaveEndpoint}/history?page=${view.historyPage}`, onSessionInvalid)
  const { retry: retryLeave } = read, { retry: retryHistory } = history
  const store = useLeaveOperations(operations), record = store.record, data = read.data
  const [historyTarget, setHistoryTarget] = useState<string | null>(null)
  const [endTarget, setEndTarget] = useState<{ leaveId: string; expectedReliefId: string } | null>(null)
  const coverOpener = useRef<HTMLButtonElement>(null)
  const restoreCoverFocus = useRef(false)
  const commit = store.commits
  const seen = useRef(commit)
  useEffect(() => {
    if (commit === seen.current) return
    seen.current = commit
    headingRef.current?.focus()
    onView({ draft: null, replacement: null, historyPage: 1 })
    retryLeave()
    retryHistory()
  }, [commit, headingRef, onView, retryLeave, retryHistory])

  const rejected = record?.state === 'rejected' && record.code !== 'INVALID_INPUT'
  const locked = store.busy || !!rejected || read.loading || read.stale || !!read.error
  const pending = record?.state === 'pending'
  const result = record?.result
  const warnings = (result?.notificationWarnings ?? []).filter((warning) => Object.hasOwn(managerLeaveWarnings, warning))
  const initial = view.draft ?? (data ? { ...data.defaults, reliefManagerId: '' } : null)
  const current = data?.current
  const replacement = view.replacement?.leaveId === current?.id ? view.replacement : null
  useLayoutEffect(() => {
    if (!replacement && restoreCoverFocus.current) {
      restoreCoverFocus.current = false
      coverOpener.current?.focus()
    }
  }, [replacement])
  const serverError = record?.state === 'rejected' && record.fields ? { id: record.id, fields: record.fields } : undefined
  const send = (operation: ManagerLeaveOperation) => { if (!locked) void store.send(operation, onSessionInvalid) }
  function reload() {
    store.discard()
    setEndTarget(null)
    onView({ ...view, draft: null, replacement: null })
    retryLeave()
    retryHistory()
    headingRef.current?.focus()
  }
  function editCover() {
    if (!data || !current) return
    const startsOn = data.today > current.startsOn ? data.today : current.startsOn
    onView({ ...view, replacement: { leaveId: current.id, expectedReliefId: data.cover?.id ?? null,
      draft: { startsOn, endsOn: current.expectedReturnOn, reliefManagerId: '' } } })
  }
  return <>
    <header className="employee-heading"><div><h1 ref={headingRef} tabIndex={-1}>Leave &amp; cover</h1><p>Set your leave dates and arrange cover in one place.</p></div></header>
    {record?.state === 'committed' && result && <NoticeToast key={record.id} id={`manager-leave-saved:${record.id}`}
      message={result.changed ? 'Leave change saved.' : 'This leave change was already recorded.'} />}
    {record?.error && record.state !== 'committed' && <div className="employee-banner employee-amber">
      <p>{record.error}</p>
      {record.state === 'uncertain' && <Button onClick={() => void store.send(record.operation, onSessionInvalid)}>Retry</Button>}
      {rejected && <Button onClick={reload}>Reload latest</Button>}
      <AnnounceEvent event={{ id: `manager-leave-error:${record.id}:${record.attempt}`, message: record.error, intent: 'alert' }} />
    </div>}
    {!!warnings.length && <div className="employee-banner employee-amber"><div><strong>Leave change saved</strong>
      <ul>{warnings.map((warning) => <li key={warning}>{managerLeaveWarnings[warning]}</li>)}</ul></div>
      <AnnounceEvent event={{ id: `manager-leave-warning:${record?.id}`, message: warnings.map((warning) => managerLeaveWarnings[warning]).join(' '), intent: 'alert' }} />
    </div>}
    {read.error && <div className="employee-banner employee-amber"><p>{result ? 'Your change was saved. ' : ''}{data ? 'The leave details may be out of date. ' : ''}{read.error}</p><Button onClick={retryLeave}>Retry leave</Button></div>}
    {read.loading && !data && <Card title="I’m going on leave"><SkeletonForm fields={3} /></Card>}
    {data && <div className="employee-leave-columns" aria-busy={read.loading || undefined}>
      <Card title={current ? 'Your leave dates' : 'I’m going on leave'} actions={current && <Badge status={data.state === 'SCHEDULED' ? 'Scheduled' : 'On leave'} />}>
        {data.state === 'REPAIR_REQUIRED' ? <div className="employee-banner employee-amber"><p>Your leave or cover needs review. Contact HR before making another change.</p></div>
          : current ? <>
            <dl className="employee-leave-dates manager-leave-dates">
              <div><dt>Leave starts</dt><dd>{displayDate(current.startsOn)}</dd></div>
              <div><dt>Expected return</dt><dd>{displayDate(current.expectedReturnOn)}</dd></div>
              <div><dt>Relief officer</dt><dd>{data.cover ? data.cover.officerName ?? 'Name not recorded' : 'Uncovered'}</dd></div>
            </dl>
            <p className="employee-muted employee-leave-explanation">{data.state === 'SCHEDULED'
              ? 'Your tracker and work actions stay active until your leave starts.' : 'Your tracker and approval actions are paused while you are on leave.'}</p>
            <Button variant="primary" aria-disabled={locked} busy={pending}
              onClick={() => send({ kind: current.canCancel ? 'MANAGER_CANCEL' : 'MANAGER_RETURN', leaveId: current.id })}>
              {current.canCancel ? 'Cancel leave' : 'I’m back — end leave now'}</Button>
          </> : initial && <CoverForm cover={false} earliest={data.today} latest={data.bounds.latestStartOn}
            draft={{ startsOn: initial.startsOn, endsOn: initial.expectedReturnOn, reliefManagerId: initial.reliefManagerId }}
            onDraft={(draft) => onView({ ...view, draft: { startsOn: draft.startsOn, expectedReturnOn: draft.endsOn, reliefManagerId: draft.reliefManagerId } })}
            onSubmit={() => send({ kind: 'MANAGER_CREATE', draft: initial })} onSessionInvalid={onSessionInvalid} locked={locked || !data.canCreate}
            pending={pending} serverError={serverError} />}
      </Card>
      <Card><h2>Take a proper break.</h2>
        <div className="employee-leave-notice"><Bell aria-hidden="true" /><p>No work reminders while you’re away.</p></div>
        <div className="employee-leave-notice"><ShieldCheck aria-hidden="true" /><p>Your relief officer keeps your team’s approvals moving.</p></div>
        <div className="employee-leave-notice"><Users aria-hidden="true" /><p>No approval needed. Your officer, business director and HR are notified.</p></div>
      </Card>
    </div>}
    {data && current && data.state !== 'REPAIR_REQUIRED' && <Card className="manager-cover-card" title="Relief officer" actions={<Badge status={data.coverState} />}>
      {data.coverGap && <p className="employee-banner employee-amber">Some remaining leave dates are uncovered. Arrange cover or contact HR.</p>}
      <div className="employee-leave-columns manager-cover-columns">
        <div>
          {replacement ? <CoverForm cover earliest={data.today > current.startsOn ? data.today : current.startsOn} latest={current.expectedReturnOn}
            draft={replacement.draft} onDraft={(draft) => onView({ ...view, replacement: { ...replacement, draft } })}
            onSubmit={() => send({ kind: 'RELIEF_REPLACE', ...replacement })} onSessionInvalid={onSessionInvalid}
            locked={locked || replacement.expectedReliefId !== (data.cover?.id ?? null)} pending={pending} serverError={serverError}
            onCancel={() => { restoreCoverFocus.current = true; onView({ ...view, replacement: null }) }} />
            : <>
              {data.cover && <ul className="manager-cover-list"><CoverRow row={data.cover} /></ul>}
              <div className="employee-actions">
                {data.canEditCover && <Button ref={coverOpener} size="small" disabled={locked} onClick={editCover}>{data.cover ? 'Edit cover' : 'Arrange cover'}</Button>}
                {data.canEndCover && data.cover && <Button size="small" variant="danger" disabled={locked}
                  onClick={() => data.cover && setEndTarget({ leaveId: current.id, expectedReliefId: data.cover.id })}>End cover</Button>}
              </div>
            </>}
          {replacement && replacement.expectedReliefId !== (data.cover?.id ?? null) &&
            <div className="employee-banner employee-amber"><p>The cover arrangement changed.</p><Button onClick={reload}>Reload latest</Button></div>}
        </div>
        <section className="manager-previous-cover"><h3>Previous cover</h3><PreviousCover key={current.id} leaveId={current.id} exclude={data.cover?.id} onSessionInvalid={onSessionInvalid} revision={commit} /></section>
      </div>
    </Card>}
    <section className="ui-card employee-history-card manager-leave-history" aria-busy={history.loading || undefined}>
      <header className="ui-card-head"><div><h2>Leave history</h2><p>Your previous leave periods and recorded relief arrangements.</p></div>
        {history.data && <small>{history.data.periods.total} previous {history.data.periods.total === 1 ? 'leave' : 'leaves'}</small>}</header>
      {history.loading && !history.data && <div className="ui-card-body"><SkeletonTable rows={4} cols={4} /></div>}
      {history.error && <div className="employee-banner employee-amber"><p>{history.error}</p><Button onClick={retryHistory}>Retry history</Button></div>}
      {history.stale && <p className="employee-read-message">This leave history may be out of date.</p>}
      {history.data && <><Table caption="Leave history" headings={['Manager & Relief officer', 'Number of days', 'Resumption date', 'Status', 'Cover history']}>
        {history.data.periods.items.length ? history.data.periods.items.map((item) => <tr key={item.id}>
          <th scope="row"><div className="manager-leave-history-people">
            <span>{item.ownerName && <Avatar name={item.ownerName} />}<span>{item.ownerName ?? 'Name not recorded'}
              <small className="manager-leave-muted">{item.role ? 'Line Manager' : 'Role not recorded'}</small></span></span>
            {item.lastCover && <><ArrowRight size={16} aria-hidden="true" /><span>
              {item.lastCover.officerName && <Avatar name={item.lastCover.officerName} tone="teal" />}
              <span>{item.lastCover.officerName ?? 'Name not recorded'}<small className="manager-leave-muted">Last relief officer</small></span>
            </span></>}
          </div></th>
          <td><span className="manager-leave-days">{item.days} {item.days === 1 ? 'day' : 'days'}</span></td>
          <td>{item.returnedOn ? displayDate(item.returnedOn) : '—'}</td>
          <td><Badge status={item.state} icon={item.state !== 'Cancelled' && <CircleCheck size={12} aria-hidden="true" />} /></td>
          <td>{item.coverCount ? <Button size="small" disabled={history.stale} onClick={() => setHistoryTarget(item.id)}
            aria-label={`Previous cover for leave starting ${displayDate(item.startsOn)}`}>Previous cover ({item.coverCount})</Button> : 'None recorded'}</td>
        </tr>) : <tr><td colSpan={5} className="employee-history-empty">No previous leave periods.</td></tr>}
      </Table><Pagination value={history.data.periods} label="leave history" onPage={(historyPage) => onView({ ...view, historyPage })} /></>}
    </section>
    {historyTarget && <Dialog open title="Previous cover" onClose={() => setHistoryTarget(null)} fallbackFocusRef={headingRef}
      footer={<Button onClick={() => setHistoryTarget(null)}>Close</Button>}>
      <PreviousCover key={historyTarget} leaveId={historyTarget} onSessionInvalid={onSessionInvalid} revision={commit} />
    </Dialog>}
    {endTarget && <Dialog open title="End relief cover?" description="Review access ends immediately. Your leave dates stay in place, and remaining dates may be uncovered."
      onClose={() => setEndTarget(null)} fallbackFocusRef={headingRef} footer={<>
        <Button onClick={() => setEndTarget(null)}>Cancel</Button>
        <Button variant="danger" aria-disabled={locked} onClick={() => { if (!locked) { send({ kind: 'RELIEF_END', ...endTarget }); setEndTarget(null) } }}>End cover</Button>
      </>}><p>The previous arrangement stays in your cover history.</p></Dialog>}
  </>
}
