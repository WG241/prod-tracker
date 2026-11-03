import { createContext } from 'react'

export type Announcement = { id: string; message: string; intent: 'status' | 'alert' }
type Sink = { modal: boolean; ready: boolean; queue: Announcement[]; publish: (event: Announcement) => void; clear: () => void }

export class AnnouncementBus {
  sinks = new Map<string, Sink>()
  seen = new Set<string>()
  private version = 0
  private listeners = new Set<() => void>()
  getVersion = () => this.version
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  reset() {
    ++this.version
    this.seen.clear()
    for (const sink of this.sinks.values()) { sink.queue = []; sink.clear() }
    for (const listener of this.listeners) listener()
  }
  register(id: string, sink: Sink) {
    if (sink.modal) for (const current of this.sinks.values()) {
      if (!current.modal) { current.queue = []; current.clear() }
    }
    this.sinks.set(id, sink)
  }
  remove(id: string) {
    for (const event of this.sinks.get(id)?.queue ?? []) this.seen.delete(event.id)
    this.sinks.delete(id)
  }
  ready(id: string) {
    const sink = this.sinks.get(id)
    if (!sink) return
    sink.ready = true
    for (const event of sink.queue.splice(0)) sink.publish(event)
  }
  send(event: Announcement, owner: string, version = this.version) {
    if (version !== this.version || !event.message || this.seen.has(event.id) || !this.sinks.has(owner)) return
    const modal = [...this.sinks.values()].find((sink) => sink.modal)
    const sink = modal ?? this.sinks.get(owner)!
    this.seen.add(event.id)
    if (sink.ready) sink.publish(event)
    else sink.queue.push(event)
  }
}

export const BusContext = createContext<AnnouncementBus | null>(null)
export const ScopeContext = createContext('')
