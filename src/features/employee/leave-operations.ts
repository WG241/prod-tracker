import { useSyncExternalStore } from 'react'
import type { LeaveOperation, LeaveResult } from './leave-contracts.ts'
import { leaveRequest } from './leave-contracts.ts'

type LeaveAttempt = { id: string; operation: LeaveOperation; state: 'pending' | 'uncertain' | 'rejected' | 'committed'; error: string; code: string; attempt: number; recovering: boolean; fields?: Record<string, string>; result?: LeaveResult }
export class LeaveOperations {
  private actor = ''
  private generation = 0
  private version = 0
  private listeners = new Set<() => void>()
  private controller: AbortController | null = null
  record: LeaveAttempt | null = null
  commits = 0
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  snapshot = () => this.version
  private emit() { this.version++; this.listeners.forEach((listener) => listener()) }
  bind(actor: string) { if (this.actor !== actor) { this.clear(); this.actor = actor } }
  clear() { this.generation++; this.actor = ''; this.controller?.abort(); this.record = null; this.emit() }
  discard() { if (!this.busy) { this.record = null; this.emit() } }
  get busy() { return this.record?.state === 'pending' || this.record?.state === 'uncertain' }
  async send(operation: LeaveOperation, invalid: () => void) {
    if (this.record?.state === 'pending' || !this.actor) return
    const recovering = this.record?.state === 'uncertain'
    const record: LeaveAttempt = recovering && this.record ? this.record : { id: crypto.randomUUID(), operation: structuredClone(operation), state: 'pending', error: '', code: '', attempt: 0, recovering: false }
    record.recovering = recovering; record.attempt++
    this.record = record; record.state = 'pending'; record.error = ''; record.fields = undefined; this.emit()
    const generation = this.generation, controller = new AbortController()
    this.controller = controller
    const timeout = window.setTimeout(() => controller.abort(), 20000)
    try {
      const request = leaveRequest(record.operation)
      const response = await fetch(request.path, { method: 'POST', credentials: 'same-origin', signal: controller.signal, headers: { 'Content-Type': 'application/json', 'Idempotency-Key': record.id }, body: JSON.stringify(request.body) })
      if (generation !== this.generation) return
      if (response.status === 401 || response.status === 403) { this.clear(); invalid(); return }
      const value = await response.json() as LeaveResult & { error?: { message?: string; code?: string; fields?: Record<string, string> } }
      if (generation !== this.generation) return
      if (!response.ok) {
        record.state = response.status >= 500 ? 'uncertain' : 'rejected'
        record.error = value.error?.message || 'The change could not be confirmed. Please try again.'
        record.code = value.error?.code ?? ''; record.fields = value.error?.fields
      } else if (value.version !== 1 || value.requestId !== record.id || value.operation !== record.operation.kind || typeof value.leaveId !== 'string' || typeof value.changed !== 'boolean' || !Array.isArray(value.notificationWarnings)) throw new Error('Invalid receipt')
      else { record.result = value; record.state = 'committed'; this.commits++ }
    } catch {
      if (generation !== this.generation) return
      record.state = 'uncertain'; record.error = 'The result could not be confirmed. Retry to check this same change.'
    } finally {
      window.clearTimeout(timeout)
      if (generation === this.generation) { this.controller = null; this.emit() }
    }
  }
}
export function useLeaveOperations(operations: LeaveOperations) { useSyncExternalStore(operations.subscribe, operations.snapshot, operations.snapshot); return operations }
