import { useEffect, useEffectEvent, useId, useLayoutEffect, useRef, useState } from 'react'
import { Bell, CalendarDays, CircleCheck, FileText, MessageSquare, ShieldCheck } from 'lucide-react'
import { AnnounceEvent } from '../../components/accessibility/Announcements.tsx'
import { BrandLoader } from '../../components/ui/BrandLoader.tsx'
import { Button, IconButton } from '../../components/ui/Button.tsx'
import { useRetryDelay } from '../auth/useRetryDelay.ts'
import type { NotificationIcon, NotificationTarget, ReadCommand, UnreadPage, UnreadSummary } from './contracts.ts'
import { useNotificationOperation } from './read-operations.ts'
import type { NotificationOperations } from './read-operations.ts'
import './notifications.css'

const icons = { check: CircleCheck, calendar: CalendarDays, message: MessageSquare, security: ShieldCheck, generic: Bell } satisfies Record<NotificationIcon, typeof Bell>
const timeZone = 'Africa/Lagos'
const day = new Intl.DateTimeFormat('en-CA', { timeZone, dateStyle: 'short' })
const time = new Intl.DateTimeFormat('en-GB', { timeZone, hour: 'numeric', minute: '2-digit', hour12: true })
const date = new Intl.DateTimeFormat('en-GB', { timeZone, day: 'numeric', month: 'short', year: 'numeric' })

function notificationDate(createdAt: string, asOf: string) {
  const created = new Date(createdAt)
  const label = day.format(created) === day.format(new Date(asOf)) ? 'Today' : date.format(created)
  return `${label}, ${time.format(created)}`
}

type PageState = { key: string; data: UnreadPage | null; error?: string }

async function fetchNotifications<T extends UnreadSummary>(path: string, signal: AbortSignal, onInvalid: () => void) {
  const response = await fetch(path, {
    cache: 'no-store', credentials: 'same-origin',
    signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
  })
  if (signal.aborted) return null
  if (response.status === 401 || response.status === 403) { onInvalid(); return null }
  if (!response.ok) throw new Error('Notifications could not be loaded.')
  const result = await response.json() as T
  if (signal.aborted) return null
  if (!Number.isSafeInteger(result?.unreadCount) || result.unreadCount < 0 || !Number.isFinite(Date.parse(result.asOf))) throw new Error('Invalid notification response')
  return result
}

export function NotificationTray({ open, onOpenChange, onSessionInvalid, operations, onTarget }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSessionInvalid: () => void
  operations: NotificationOperations
  onTarget: (target: Exclude<NotificationTarget, { kind: 'UNAVAILABLE' }>) => void
}) {
  const region = useId()
  const root = useRef<HTMLDivElement>(null)
  const bell = useRef<HTMLButtonElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const retryButton = useRef<HTMLButtonElement>(null)
  const returnFromRetry = useRef(false)
  const listBody = useRef<HTMLUListElement>(null)
  const focusedRow = useRef<number | null>(null)
  const userInitiated = useRef(false)
  const summaryRequest = useRef<AbortController | null>(null)
  const [summary, setSummary] = useState<UnreadSummary | null>(null)
  const [page, setPage] = useState(1)
  const [revision, setRevision] = useState(0)
  const [list, setList] = useState<PageState | null>(null)
  const [feedback, setFeedback] = useState<{ id: string; message: string } | null>(null)
  const pending = useNotificationOperation(operations)
  const { seconds: retrySeconds, start: startRetry } = useRetryDelay()
  useEffect(() => {
    const until = pending?.phase === 'uncertain' ? pending.retryUntil ?? 0 : 0
    startRetry(Math.max(0, Math.ceil((until - Date.now()) / 1000)))
  }, [pending, startRetry])
  const invalid = useEffectEvent(onSessionInvalid)
  const closeOutside = useEffectEvent(() => onOpenChange(false))
  const requestKey = `${page}:${revision}`

  function applySummary(next: UnreadSummary) {
    setSummary((current) => current && current.asOf > next.asOf ? current : { asOf: next.asOf, unreadCount: next.unreadCount })
  }

  const refreshSummary = useEffectEvent(() => {
    if (document.hidden || summaryRequest.current) return
    const controller = new AbortController()
    summaryRequest.current = controller
    void fetchNotifications<UnreadSummary>('/api/notifications/summary', controller.signal, invalid)
      .then((next) => { if (next && !controller.signal.aborted) applySummary(next) })
      .catch(() => { /* Keep a previously known count, or show it as unavailable. */ })
      .finally(() => { if (summaryRequest.current === controller) summaryRequest.current = null })
  })

  const complete = useEffectEvent((entry: NonNullable<typeof pending>) => {
    if (entry.phase !== 'complete') return
    operations.dismiss(entry.id)
    const response = entry.response
    // A summary started before the write may finish after it. Cancel that read
    // and take the transaction count until a fresh summary or list arrives.
    summaryRequest.current?.abort()
    summaryRequest.current = null
    setSummary((current) => ({ asOf: current?.asOf ?? response.result.appliedAt, unreadCount: response.unreadCount }))
    refreshSummary()
    if (!open) return
    const target = 'target' in response ? response.target : null
    if (target && target.kind !== 'UNAVAILABLE' && userInitiated.current) {
      onOpenChange(false)
      onTarget(target)
      return
    }
    if (root.current?.contains(document.activeElement)) {
      const buttons = Array.from(listBody.current?.querySelectorAll('button') ?? [])
      const index = buttons.findIndex((button) => button === document.activeElement)
      focusedRow.current = index >= 0 ? index : null
      heading.current?.focus()
    }
    setFeedback({ id: entry.id, message: target?.kind === 'UNAVAILABLE' ? 'This notification’s destination is no longer available.'
      : target ? 'Notification marked as read.' : 'All available notifications marked as read.' })
    setRevision((value) => value + 1)
  })

  useEffect(() => {
    if (!open) userInitiated.current = false
    if (pending?.phase !== 'complete') return
    let active = true
    queueMicrotask(() => { if (active && operations.snapshot() === pending) complete(pending) })
    return () => { active = false }
  }, [open, pending, operations])

  useEffect(() => {
    refreshSummary()
    const timer = window.setInterval(() => refreshSummary(), 30000)
    const foreground = () => { if (!document.hidden) refreshSummary() }
    document.addEventListener('visibilitychange', foreground)
    window.addEventListener('focus', foreground)
    return () => {
      summaryRequest.current?.abort()
      summaryRequest.current = null
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', foreground)
      window.removeEventListener('focus', foreground)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    refreshSummary()
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) closeOutside()
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open])

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    void fetchNotifications<UnreadPage>(`/api/notifications?page=${page}`, controller.signal, invalid)
      .then((next) => {
        if (!next || controller.signal.aborted) return
        if (!Array.isArray(next.items) || !Number.isSafeInteger(next.totalPages) || next.page !== page) throw new Error('Invalid notification page')
        applySummary(next)
        const lastPage = Math.max(1, next.totalPages)
        if (page > lastPage) { setPage(lastPage); return }
        returnFromRetry.current = retryButton.current !== null && document.activeElement === retryButton.current
        setList({ key: requestKey, data: next })
      })
      .catch(() => {
        if (!controller.signal.aborted) setList((previous) => ({ key: requestKey, data: previous?.data ?? null, error: 'Notifications could not be loaded.' }))
      })
    return () => controller.abort()
  }, [open, page, requestKey])

  useLayoutEffect(() => {
    if (open) heading.current?.focus()
  }, [open])

  useLayoutEffect(() => {
    if (!list || list.key !== requestKey) return
    if (returnFromRetry.current) { returnFromRetry.current = false; heading.current?.focus() }
    if (focusedRow.current !== null) {
      const rows = listBody.current?.querySelectorAll('button')
      const next = rows?.[Math.min(focusedRow.current, rows.length - 1)]
      if (document.activeElement === heading.current) next?.focus()
      focusedRow.current = null
    }
  }, [list, requestKey])

  const data = list?.data
  const loading = list?.key !== requestKey
  const error = list?.error
  const unread = summary?.unreadCount
  const label = unread === undefined ? 'Notifications, unread count unavailable' : `Notifications, ${unread} unread`
  const locked = !!pending || loading || !!error
  const sending = pending?.phase === 'saving'
  function send(command: ReadCommand | null) {
    userInitiated.current = true
    setFeedback(null)
    void operations.send(command, onSessionInvalid)
  }

  return <div className="notification-control" ref={root} onBlur={(event) => {
    if (open && (!event.relatedTarget || !root.current?.contains(event.relatedTarget))) onOpenChange(false)
  }} onKeyDown={(event) => {
    if (!open || event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    onOpenChange(false)
    bell.current?.focus()
  }}>
    <IconButton label={label} title="Notifications" ref={bell} className="notification-bell"
      aria-expanded={open} aria-controls={open ? region : undefined}
      onClick={() => {
        if (!open) { focusedRow.current = null; setFeedback(null); setList(null); setPage(1); setRevision((value) => value + 1) }
        onOpenChange(!open)
      }}>
      <Bell aria-hidden="true" />
      {unread !== undefined && unread > 0 && <span className="notification-badge" aria-hidden="true">{unread > 99 ? '99+' : unread}</span>}
    </IconButton>
    {open && <section id={region} className="ui-card notification-tray" aria-labelledby={`${region}-heading`}>
      <header className="notification-tray-header">
        <h2 ref={heading} tabIndex={-1} id={`${region}-heading`}>Notifications</h2>
        <Button className="notification-mark-all" variant="ghost" size="small" disabled={!pending && !loading && data?.unreadCount === 0}
          aria-disabled={locked || undefined} busy={sending && pending.command.operation === 'NOTIFICATIONS_READ_ALL'}
          onClick={() => { if (!locked && data?.unreadCount) send({ operation: 'NOTIFICATIONS_READ_ALL' }) }}>Mark all as read</Button>
      </header>
      {pending && (pending.phase === 'uncertain' || pending.phase === 'rejected') && <div className="notification-feedback">
        <p>{pending.message}</p>
        <AnnounceEvent event={{ id: `${pending.id}:${pending.attempt}:error`, message: pending.message, intent: 'alert' }} />
        <Button size="small" aria-disabled={retrySeconds > 0 || undefined} onClick={() => {
          if (pending.phase === 'uncertain') {
            if ((pending.retryUntil ?? 0) > Date.now()) return
            heading.current?.focus()
            send(null)
          } else {
            heading.current?.focus()
            operations.dismiss(pending.id)
            setRevision((value) => value + 1)
          }
        }}>{pending.phase === 'uncertain' ? retrySeconds > 0 ? `Retry (${retrySeconds}s)` : 'Retry' : 'Reload latest'}</Button>
      </div>}
      {feedback && <div className="notification-feedback"><p>{feedback.message}</p><AnnounceEvent event={{ id: feedback.id, message: feedback.message, intent: 'status' }} /></div>}
      <div className="notification-tray-body" aria-busy={loading || undefined}>
        {loading && !data && !error && <BrandLoader label="Loading notifications…" />}
        {error && <div className="notification-tray-error">
          <p>{error}{data ? ' The messages shown may be out of date.' : ''}</p>
          <Button ref={retryButton} size="small" busy={loading} onClick={() => setRevision((value) => value + 1)}>Retry</Button>
          <AnnounceEvent event={{ id: `notifications-error:${requestKey}`, message: error, intent: 'alert' }} />
        </div>}
        {data && data.items.length > 0 && <ul ref={listBody} className="notification-items" aria-label="Unread messages">
          {data.items.map((item) => {
            const Icon = icons[item.icon] ?? Bell
            return <li key={item.id}><button type="button" className="notification-row"
              aria-disabled={locked || undefined} aria-busy={(sending && pending.command.operation === 'NOTIFICATION_READ' && pending.command.notificationId === item.id) || undefined}
              onClick={() => { if (!locked) send({ operation: 'NOTIFICATION_READ', notificationId: item.id }) }}>
              <Icon aria-hidden="true" />
              <span><span className="notification-title">{item.title}</span><span className="notification-message">{item.body}</span>
                <time dateTime={item.createdAt}>{notificationDate(item.createdAt, data.asOf)}</time></span>
            </button></li>
          })}
        </ul>}
        {!loading && !error && data?.unreadCount === 0 && <div className="notification-empty">
          <FileText aria-hidden="true" />
          <p>You’re all caught up.</p>
          <span>No unread notifications.</span>
        </div>}
      </div>
      {data && data.totalPages > 1 && <nav className="notification-pagination" aria-label="Notification pages">
        <Button size="small" busy={loading} aria-disabled={page <= 1 || undefined} onClick={() => setPage(page - 1)}>Previous</Button>
        <span>Page {data.page} of {data.totalPages}</span>
        <Button size="small" busy={loading} aria-disabled={page >= data.totalPages || undefined} onClick={() => setPage(page + 1)}>Next</Button>
      </nav>}
    </section>}
  </div>
}
