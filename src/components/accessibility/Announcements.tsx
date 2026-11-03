import { useContext, useEffect, useId, useLayoutEffect, useState } from 'react'
import type { ReactNode } from 'react'

import { AnnouncementBus, BusContext, ScopeContext } from './announcementContext.ts'
import type { Announcement } from './announcementContext.ts'
import { useAnnounce } from './useAnnounce.ts'

function Host({ children, modal = false, active = true }: { children: ReactNode; modal?: boolean; active?: boolean }) {
  const bus = useContext(BusContext)
  const id = useId()
  const [events, setEvents] = useState<Announcement[]>([])
  const [spoken, setSpoken] = useState<Announcement | null>(null)
  useLayoutEffect(() => {
    if (!active || !bus) return
    let cancelled = false
    bus.register(id, { modal, ready: false, queue: [], clear: () => { setEvents([]); setSpoken(null) }, publish: (event) => {
      // Separate updates retain deliberate identical wording with different ids.
      setEvents((current) => [...current, event])
    } })
    let second = 0
    const first = requestAnimationFrame(() => { second = requestAnimationFrame(() => {
      if (!cancelled) bus.ready(id)
    }) })
    return () => { cancelled = true; bus.remove(id); cancelAnimationFrame(first); cancelAnimationFrame(second) }
  }, [active, bus, id, modal])
  useEffect(() => {
    if (!active || !events.length) return
    const clear = window.setTimeout(() => setSpoken(null), 0)
    const timer = window.setTimeout(() => {
      setSpoken(events[0])
      setEvents((current) => current.slice(1))
    }, 80)
    return () => { window.clearTimeout(clear); window.clearTimeout(timer) }
  }, [active, events])
  return <ScopeContext.Provider value={id}>
    {children}
    <div className="sr-only" role="status" aria-atomic="true">{active && spoken?.intent === 'status' ? spoken.message : ''}</div>
    <div className="sr-only" role="alert" aria-atomic="true">{active && spoken?.intent === 'alert' ? spoken.message : ''}</div>
  </ScopeContext.Provider>
}

function Root({ children }: { children: ReactNode }) {
  const [bus] = useState(() => new AnnouncementBus())
  return <BusContext.Provider value={bus}><Host>{children}</Host></BusContext.Provider>
}

export function AnnouncementProvider({ contextKey, children }: { contextKey: string; children: ReactNode }) {
  return <Root key={contextKey}>{children}</Root>
}

export function ModalAnnouncements({ open, children }: { open: boolean; children: ReactNode }) {
  // A fresh scope on every open prevents old modal text or queued events replaying.
  return open ? <Host modal>{children}</Host> : children
}

export function AnnounceEvent({ event }: { event: Announcement | null }) {
  const announce = useAnnounce()
  useEffect(() => { if (event) announce(event) }, [announce, event])
  return null
}
