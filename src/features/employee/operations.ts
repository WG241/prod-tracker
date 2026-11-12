import { useSyncExternalStore } from 'react'
import type { MutationResult, OwnTaskRole, TaskOperation } from './mutations.ts'
import { operationKey, operationRequest } from './mutations.ts'

export type OperationRecord = { id: string; operation: TaskOperation; state: 'pending' | 'uncertain' | 'rejected' | 'committed'; error: string; code: string; fields?: Record<string, string>; result?: MutationResult }
// Owned by AuthApp, so closing a dialog or withholding a workspace never loses a request identity.
export class TaskOperations {
  private actor = ''
  private role: OwnTaskRole = 'EMPLOYEE'
  private generation = 0
  private version = 0
  private listeners = new Set<() => void>()
  private records = new Map<string, OperationRecord>()
  private controllers = new Set<AbortController>()
  // Unsent form text, keyed like operation records. Survives foreground
  // revalidation's temporary unmount; cleared with everything else on sign
  // out or identity change so a new actor never inherits it.
  private drafts = new Map<string, unknown>()
  commits = 0
  notice = ''
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  snapshot = () => this.version
  private emit() { this.version++; this.listeners.forEach((listener) => listener()) }
  bind(actor: string, role: OwnTaskRole = 'EMPLOYEE') {
    if (this.actor !== actor || this.role !== role) { this.clear(); this.actor = actor; this.role = role }
  }
  clear() { this.generation++; this.actor = ''; this.records.clear(); this.controllers.forEach((c) => c.abort()); this.controllers.clear(); this.drafts.clear(); this.notice = ''; this.emit() }
  get(key: string) { return this.records.get(key) }
  getDraft<T>(key: string) { return this.drafts.get(key) as T | undefined }
  setDraft(key: string, value: unknown) { this.drafts.set(key, value) }
  discardDraft(key: string) { this.drafts.delete(key) }
  carryRecord() { return Array.from(this.records.values()).reverse().find((r) => r.operation.kind === 'CARRY' && r.state !== 'committed') }
  discard(key: string) { const old = this.records.get(key); if (old?.state !== 'pending' && old?.state !== 'uncertain') { this.records.delete(key); this.emit() } }
  async send(operation: TaskOperation, invalid: () => void) {
    const key = operationKey(operation)
    let record = this.records.get(key)
    if (!this.actor || record?.state === 'pending') return
    if (record?.state !== 'uncertain') {
      record = { id: crypto.randomUUID(), operation: structuredClone(operation), state: 'pending', error: '', code: '' }
      this.records.set(key, record)
    }
    record.state = 'pending'; record.error = ''; this.emit()
    const generation = this.generation, controller = new AbortController()
    this.controllers.add(controller)
    const timeout = window.setTimeout(() => controller.abort(), 20000)
    const role = this.role
    const request = operationRequest(record.operation, role)
    try {
      const response = await fetch(request.path, { method: request.method, credentials: 'same-origin', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': record.id, ...(request.revision === undefined ? {} : { 'If-Match': `"${request.revision}"` }) }, body: JSON.stringify(request.body) })
      if (generation !== this.generation) return
      if (response.status === 401 || response.status === 403) { this.clear(); invalid(); return }
      const data = await response.json() as { error?: { code?: string; message?: string; fields?: Record<string, string> } } & MutationResult
      if (generation !== this.generation) return
      if (!response.ok) {
        record.state = response.status >= 500 ? 'uncertain' : 'rejected'
        record.error = data.error?.message || 'The change could not be confirmed. Please try again.'
        record.code = data.error?.code || ''
        record.fields = data.error?.fields
      } else if (data.version !== 1 || data.requestId !== record.id || typeof data.taskId !== 'string') throw new Error('Invalid receipt')
      else {
        record.state = 'committed'; record.result = data
        this.commits++; this.notice = role === 'LINE_MANAGER' && data.approvalRequestId ? 'Task completed and automatically approved.' : 'Change saved.'
      }
    } catch {
      if (generation !== this.generation) return
      record.state = 'uncertain'; record.error = 'The result could not be confirmed. Retry to check this same change.'
    } finally {
      window.clearTimeout(timeout); this.controllers.delete(controller)
      if (generation === this.generation) this.emit()
    }
  }
}
export function useTaskOperations(operations: TaskOperations) { useSyncExternalStore(operations.subscribe, operations.snapshot, operations.snapshot); return operations }
