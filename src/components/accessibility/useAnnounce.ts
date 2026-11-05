import { useCallback, useContext, useLayoutEffect, useSyncExternalStore } from 'react'
import { BusContext, ScopeContext } from './announcementContext.ts'
import type { Announcement } from './announcementContext.ts'

const emptySubscribe = () => () => {}
const emptySnapshot = () => 0

export function useAnnounce() {
  const bus = useContext(BusContext)
  const owner = useContext(ScopeContext)
  const version = useSyncExternalStore(bus?.subscribe ?? emptySubscribe, bus?.getVersion ?? emptySnapshot, emptySnapshot)
  return useCallback((event: Announcement) => bus?.send(event, owner, version), [bus, owner, version])
}

export function useAnnouncementReset(contextKey: string) {
  const bus = useContext(BusContext)
  const scope = useContext(ScopeContext)
  const key = `${scope}:${contextKey}`
  useLayoutEffect(() => { if (key) bus?.reset() }, [bus, key])
}
