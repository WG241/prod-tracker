import { useEffect } from 'react'

type ClientCode = 'RENDER_ERROR' | 'REACT_RECOVERABLE' | 'BROWSER_ERROR' | 'UNHANDLED_REJECTION' | 'API_UNAVAILABLE'
let pending = 0
let available: Promise<boolean> | undefined
const observed = new WeakSet<object>()
const fingerprints = new Map<string, number>()
let navigation = { path: '', id: '', offered: false }

function enabled() {
  // The existing method contract discovers availability without exposing server config.
  available ??= fetch('/api/telemetry/error', { method: 'HEAD', credentials: 'omit', signal: AbortSignal.timeout(3000) })
    .then((response) => response.status === 405 && response.headers.get('Allow') === 'POST').catch(() => false)
  return available
}
async function send(path: 'error' | 'view', body: object) {
  if (pending >= 10) return
  pending++
  try {
    if (!await enabled()) return
    await fetch(`/api/telemetry/${path}`, { method: 'POST', credentials: path === 'error' ? 'omit' : 'same-origin',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(3000) })
  } catch { /* A reporting failure has no user action, auth redirect or retry. */ }
  finally { pending-- }
}
export function reportError(code: ClientCode, error?: unknown, locationKey = 'app') {
  try {
    if (typeof error === 'object' && error !== null) {
      if (observed.has(error)) return
      observed.add(error)
    } else {
      const now = Date.now()
      for (const [key, expires] of fingerprints) if (expires <= now) fingerprints.delete(key)
      const key = `${code}:${locationKey}`
      if (fingerprints.has(key)) return
      if (fingerprints.size >= 100) fingerprints.delete(fingerprints.keys().next().value!)
      fingerprints.set(key, now + 3000)
    }
    // Unknown browser frames are omitted. The server never receives raw exceptions.
    void send('error', { id: crypto.randomUUID(), code, locationKey })
  } catch { /* Even a broken transport cannot break the recovery surface. */ }
}
export function installBrowserReporting() {
  let disposed = false
  const error = (event: ErrorEvent) => { event.preventDefault(); reportError('BROWSER_ERROR', event.error) }
  const rejected = (event: PromiseRejectionEvent) => { event.preventDefault(); reportError('UNHANDLED_REJECTION', event.reason) }
  void enabled().then((active) => {
    if (!active || disposed) return
    window.addEventListener('error', error)
    window.addEventListener('unhandledrejection', rejected)
  })
  return () => { disposed = true; window.removeEventListener('error', error); window.removeEventListener('unhandledrejection', rejected) }
}
export function useWorkspaceView() {
  useEffect(() => {
    const path = window.location.pathname
    const pageKey = path.slice(1)
    if (!navigation.id || navigation.path !== path) navigation = { path, id: crypto.randomUUID(), offered: false }
    if (navigation.offered) return
    navigation.offered = true
    // AuthenticatedWorkspace owns this hook. Preview and sign in never call it.
    void send('view', { id: navigation.id, pageKey })
  }, [])
}
