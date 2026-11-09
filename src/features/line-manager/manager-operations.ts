import { useSyncExternalStore } from 'react'
import type { ManagerCommand, ManagerReceipt } from './dashboard-view.ts'
import type { ReviewCommand, ReviewReceipt, ReviewSummary } from './approvals-contracts.ts'

type Command = ManagerCommand | ReviewCommand
type Receipt = ManagerReceipt | ReviewReceipt
type Record = { id: string; command: Command; attempt: number } & (
  | { phase: 'pending' }
  | { phase: 'uncertain' | 'rejected'; message: string; retryAt: number }
  | { phase: 'committed'; result: Receipt; summary?: ReviewSummary | null }
)

function request(command: Command) {
  const base = '/api/line-manager'
  if (command.operation === 'LM_REMIND') return { path: `${base}/reminders`, body: { employeeId: command.employeeId, week: command.week } }
  if (command.operation === 'LM_APPROVE_BATCH') return { path: `${base}/approvals/approve-batch`, body: { items: command.items } }
  if (command.operation === 'LM_TASK_COMMENT') {
    const path = 'taskId' in command ? `${base}/team-tasks/${encodeURIComponent(command.taskId)}`
      : `${base}/approvals/requests/${encodeURIComponent(command.requestId)}`
    return { path: `${path}/comments`, body: { body: command.body } }
  }
  const approve = command.operation === 'LM_APPROVE'
  return { path: `${base}/approvals/requests/${encodeURIComponent(command.requestId)}/${approve ? 'approve' : 'decline'}`,
    body: { expectedTaskRevision: command.expectedTaskRevision, ...(approve ? {} : { reason: command.reason }) } }
}

export const reviewDraft = (requestId: string) => `review:${requestId}`
const draftKey = (command: Extract<Command, { operation: 'LM_TASK_COMMENT' }>) =>
  'taskId' in command ? command.taskId : reviewDraft(command.requestId)

export class ManagerOperations {
  private actor = ''
  private controller: AbortController | null = null
  private record: Record | null = null
  private listeners = new Set<() => void>()
  private drafts = new Map<string, string>()
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  snapshot = () => this.record
  private publish(record: Record | null) { this.record = record; this.listeners.forEach((listener) => listener()) }
  bind(actor: string) { if (actor !== this.actor) { this.clear(); this.actor = actor } }
  clear() {
    this.controller?.abort()
    this.controller = null
    this.actor = ''
    this.drafts.clear()
    this.publish(null)
  }
  draft(id: string) { return this.drafts.get(id) ?? '' }
  setDraft(id: string, body: string) { this.drafts.set(id, body) }
  discard() {
    if (this.record?.phase !== 'rejected') return
    if (this.record.command.operation === 'LM_TASK_COMMENT') this.drafts.delete(draftKey(this.record.command))
    this.publish(null)
  }
  async retry(invalid: () => void) {
    const saved = this.record
    if (saved?.phase === 'uncertain' && Date.now() >= saved.retryAt) await this.send(saved.command, invalid)
  }
  async send(command: Command, invalid: () => void) {
    if (!this.actor || this.record?.phase === 'pending' || this.record?.phase === 'rejected') return
    const old = this.record?.phase === 'uncertain' ? this.record : null
    if (old && (JSON.stringify(old.command) !== JSON.stringify(command) || Date.now() < old.retryAt)) return
    const operation = { id: old?.id ?? crypto.randomUUID(), command, attempt: (old?.attempt ?? 0) + 1 }
    const controller = new AbortController()
    this.controller = controller
    this.publish({ ...operation, phase: 'pending' })
    const { path, body } = request(command)
    try {
      const response = await fetch(path, {
        method: 'POST', credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]),
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': operation.id }, body: JSON.stringify(body),
      })
      if (this.controller !== controller) return
      if (response.status === 401 || response.status === 403) { this.clear(); invalid(); return }
      const data = await response.json() as { result?: Receipt; summary?: ReviewSummary | null; error?: { message?: string } }
      if (this.controller !== controller) return
      if (!response.ok) {
        const retrySeconds = Number(response.headers.get('Retry-After') ?? '0')
        const retryAt = Date.now() + (Number.isFinite(retrySeconds) ? Math.max(0, retrySeconds) : 0) * 1000
        // A failed replay does not establish the outcome of an earlier attempt.
        const uncertain = response.status >= 500 || response.status === 429
        this.publish({ ...operation, phase: uncertain ? 'uncertain' : 'rejected', retryAt, message: data.error?.message ?? 'This change could not be confirmed.' })
      } else {
        const result = data.result
        if (result?.version !== 1 || result.requestId !== operation.id || result.operation !== command.operation) throw new Error('Invalid receipt')
        if (command.operation === 'LM_TASK_COMMENT') this.drafts.delete(draftKey(command))
        this.publish({ ...operation, phase: 'committed', result, summary: data.summary })
      }
    } catch {
      if (this.controller === controller) this.publish({ ...operation, phase: 'uncertain', retryAt: 0, message: 'The result could not be confirmed. Retry to check this same change.' })
    } finally {
      if (this.controller === controller) this.controller = null
    }
  }
}

export function useManagerOperation(operations: ManagerOperations) {
  return useSyncExternalStore(operations.subscribe, operations.snapshot, operations.snapshot)
}
