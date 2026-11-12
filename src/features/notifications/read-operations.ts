import { useSyncExternalStore } from 'react'
import type { NotificationTarget, ReadCommand, ReadResult } from './contracts.ts'

type Intent = { id: string; command: ReadCommand; attempt: number }
type Pending = Intent & (
  | { phase: 'saving' }
  | { phase: 'uncertain' | 'rejected'; message: string; retryUntil?: number }
  | { phase: 'complete'; response: ReadResult }
)

function validTarget(target: NotificationTarget | undefined) {
  if (target?.kind === 'PROFILE' || target?.kind === 'EMPLOYEE_LEAVE' || target?.kind === 'MANAGER_LEAVE' || target?.kind === 'MANAGER_APPROVALS') return true
  if (target?.kind === 'UNAVAILABLE') return target.reason === 'TARGET_UNAVAILABLE'
  if (target?.kind !== 'OWN_TASK' && target?.kind !== 'OWN_TRACKER' && target?.kind !== 'REVIEW_REQUEST' && target?.kind !== 'TEAM_TASK') return false
  const id = (value: string) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value)
  return typeof target.week === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(target.week)
    && (target.kind === 'OWN_TRACKER' || id(target.taskId))
    && (target.kind !== 'REVIEW_REQUEST' || id(target.requestId))
}

export class NotificationOperations {
  private actor = ''
  private controller: AbortController | null = null
  private listeners = new Set<() => void>()
  private pending: Pending | null = null

  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  snapshot = () => this.pending
  private publish(next: Pending | null) { this.pending = next; this.listeners.forEach((listener) => listener()) }
  bind(actor: string) { if (this.actor !== actor) { this.clear(); this.actor = actor } }
  clear() {
    this.controller?.abort()
    this.controller = null
    this.actor = ''
    this.publish(null)
  }

  dismiss(id: string) {
    if (this.pending?.id === id && (this.pending.phase === 'complete' || this.pending.phase === 'rejected')) this.publish(null)
  }

  async send(command: ReadCommand | null, onSessionInvalid: () => void) {
    const prior = this.pending
    if (!this.actor || prior?.phase === 'saving' || prior?.phase === 'complete' || prior?.phase === 'rejected') return
    if (command ? prior !== null : prior?.phase !== 'uncertain' || (prior.retryUntil ?? 0) > Date.now()) return
    const intent: Intent = command ? { id: crypto.randomUUID(), command, attempt: 1 }
      : { id: prior!.id, command: prior!.command, attempt: prior!.attempt + 1 }
    const controller = new AbortController()
    this.controller = controller
    const current = () => this.controller === controller && !controller.signal.aborted
    this.publish({ ...intent, phase: 'saving' })
    const path = intent.command.operation === 'NOTIFICATION_READ' ? `/${encodeURIComponent(intent.command.notificationId)}/read` : '/read-all'
    try {
      const response = await fetch(`/api/notifications${path}`, {
        method: 'POST', credentials: 'same-origin', cache: 'no-store', body: '{}',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': intent.id },
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]),
      })
      if (!current()) return
      if (response.status === 401 || response.status === 403) {
        this.publish({ ...intent, phase: 'uncertain', message: 'Retry to confirm which notifications were marked as read.' })
        onSessionInvalid()
        return
      }
      if (response.status === 429) {
        const seconds = Number(response.headers.get('retry-after'))
        this.publish({ ...intent, phase: 'uncertain', message: 'Wait a moment, then retry the same request.',
          retryUntil: Date.now() + 1000 * (Number.isFinite(seconds) && seconds > 0 ? seconds : 60) })
        return
      }
      if ([400, 404, 409, 413, 415].includes(response.status)) {
        this.publish({ ...intent, phase: 'rejected', message: 'This notification request could not be completed. Reload the latest messages.' })
        return
      }
      if (!response.ok) throw new Error('Notification update failed')
      const result = await response.json() as ReadResult
      if (!current()) return
      if (!Number.isSafeInteger(result?.unreadCount) || result.unreadCount < 0 || result.result?.version !== 1
        || result.result.requestId !== intent.id || result.result.operation !== intent.command.operation
        || !Number.isFinite(Date.parse(result.result.appliedAt)) || typeof result.result.changed !== 'boolean' || typeof result.result.replayed !== 'boolean'
        || (result.result.operation === 'NOTIFICATIONS_READ_ALL' && (!Number.isSafeInteger(result.result.changedCount) || result.result.changedCount < 0))
        || (intent.command.operation === 'NOTIFICATION_READ' && (result.result.operation !== 'NOTIFICATION_READ'
          || result.result.notificationId !== intent.command.notificationId || !Number.isFinite(Date.parse(result.result.readAt))
          || !('target' in result) || !validTarget(result.target)))) {
        throw new Error('Invalid notification response')
      }
      this.publish({ ...intent, phase: 'complete', response: result })
    } catch {
      if (current()) this.publish({ ...intent, phase: 'uncertain', message: 'The read update could not be confirmed. Retry the same request.' })
    } finally {
      if (current()) this.controller = null
    }
  }
}

export function useNotificationOperation(operations: NotificationOperations) {
  return useSyncExternalStore(operations.subscribe, operations.snapshot)
}
