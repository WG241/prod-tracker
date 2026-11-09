import { useSyncExternalStore } from 'react'
import { AccountRequestError, writeEmailPreference } from './api.ts'
import type { EmailPreferenceInput, PreferenceReceipt } from './contracts.ts'

type PendingPreference = {
  id: string
  input: EmailPreferenceInput
  phase: 'saving' | 'uncertain' | 'stale' | 'rejected' | 'saved'
  attempt: number
  message?: string
  result?: PreferenceReceipt
  savedAt?: number
  retryUntil?: number
}

export class PreferenceOperations {
  private actor = ''
  private version = 0
  private controller: AbortController | null = null
  private listeners = new Set<() => void>()
  record: PendingPreference | null = null

  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  snapshot = () => this.version
  private publish() { this.version++; this.listeners.forEach((listener) => listener()) }
  bind(actor: string) { if (this.actor !== actor) { this.clear(); this.actor = actor } }
  clear() {
    this.controller?.abort()
    this.controller = null
    this.actor = ''
    this.record = null
    this.publish()
  }
  discard() {
    if (this.record?.phase !== 'stale') return
    this.record = null
    this.publish()
  }
  get locked() {
    const phase = this.record?.phase
    return phase === 'saving' || phase === 'uncertain' || phase === 'stale'
  }

  async send(input: EmailPreferenceInput | null, onSessionInvalid: () => void) {
    if (!this.actor || this.record?.phase === 'saving' || this.record?.phase === 'stale') return
    const prior = this.record
    const retrying = input === null
    const wasUncertain = prior?.phase === 'uncertain'
    if ((wasUncertain && !retrying) || (prior?.retryUntil && prior.retryUntil > Date.now())) return
    if (retrying && (!prior || (prior.phase !== 'uncertain' && prior.phase !== 'rejected'))) return
    const controller = new AbortController()
    this.controller = controller
    const record: PendingPreference = input
      ? { id: crypto.randomUUID(), input, phase: 'saving', attempt: 1 }
      : { ...prior!, phase: 'saving', attempt: prior!.attempt + 1, message: undefined, retryUntil: undefined }
    this.record = record
    this.publish()
    try {
      const result = await writeEmailPreference(record.id, record.input, controller.signal)
      if (this.controller !== controller) return
      this.record = { ...record, phase: 'saved', result, savedAt: Date.now() }
    } catch (failure) {
      if (this.controller !== controller) return
      if (failure instanceof AccountRequestError && (failure.status === 401 || failure.status === 403)) {
        this.record = { ...record, phase: wasUncertain ? 'uncertain' : 'rejected', message: 'Sign in again to check this change.' }
        onSessionInvalid()
      } else if (failure instanceof AccountRequestError && failure.code === 'STALE_PREFERENCE') {
        this.record = { ...record, phase: 'stale', message: failure.message }
      } else if (failure instanceof AccountRequestError && failure.status < 500 && (!wasUncertain || failure.status === 429)) {
        this.record = {
          ...record, phase: wasUncertain ? 'uncertain' : 'rejected', message: failure.message,
          retryUntil: failure.retryAfter ? Date.now() + failure.retryAfter * 1000 : undefined,
        }
      } else {
        this.record = { ...record, phase: 'uncertain', message: 'Your change could not be confirmed. Retry to check the same request.' }
      }
    } finally {
      if (this.controller === controller) { this.controller = null; this.publish() }
    }
  }
}

export function usePreferenceOperations(operations: PreferenceOperations) {
  useSyncExternalStore(operations.subscribe, operations.snapshot, operations.snapshot)
  return operations
}
