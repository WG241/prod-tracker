import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { WorkspaceShell } from '../../components/layout/WorkspaceShell.tsx'
import { Button } from '../../components/ui/Button.tsx'
import { Card } from '../../components/ui/Card.tsx'
import { workspaces } from '../workspace/config.ts'
import { roleRoutes } from './contracts.ts'
import type { SessionContext } from './contracts.ts'
import { authRequest, SessionError } from './api.ts'
import { SignIn } from './SignIn.tsx'
import { useRetryDelay } from './useRetryDelay.ts'
import { CircleAlert } from 'lucide-react'
import './auth.css'

const notices: Record<string, string> = {
  'access-denied': 'You do not have access to that page.',
  'page-unavailable': 'That page is not available.',
  'session-required': 'Please sign in to continue.',
}

function NoticeToast({ message }: { message: string }) {
  const [visible, setVisible] = useState(true)
  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(false), 6000)
    return () => window.clearTimeout(timer)
  }, [])
  return visible ? <p className="auth-toast" role="status"><CircleAlert aria-hidden="true" />{message}</p> : null
}

function AuthenticatedWorkspace({ context, notice }: { context: SessionContext; notice: string }) {
  const role = roleRoutes[context.role].label
  const workspace = { ...workspaces[role], name: context.user.name }
  const selected = window.location.pathname === '/profile' ? 'Profile' : context.navigation.find((item) => item.path === window.location.pathname)?.label ?? workspace.destinations[0].label
  const heading = useRef<HTMLHeadingElement>(null)
  const signOutLock = useRef(false)
  const [signingOut, setSigningOut] = useState(false)
  const [error, setError] = useState('')
  const retry = useRetryDelay()
  useLayoutEffect(() => { document.title = `${selected} · Workforce`; heading.current?.focus() }, [selected])
  async function signOut() {
    if (signOutLock.current || retry.seconds) return
    signOutLock.current = true
    setSigningOut(true)
    setError('')
    try { await authRequest('/api/auth/sign-out', {}); window.location.replace('/sign-in') }
    catch (failure) {
      setError(failure instanceof SessionError ? failure.message : 'Sign out could not be confirmed. Please try again.')
      if (failure instanceof SessionError && failure.retryAfter) retry.start(failure.retryAfter)
    } finally { signOutLock.current = false; setSigningOut(false) }
  }
  return <WorkspaceShell workspace={workspace} selected={selected} onSelect={() => {}} headingRef={heading} navigation={context.navigation} onSignOut={() => void signOut()} signingOut={signingOut} signOutRetrySeconds={retry.seconds}>
    {notice && <NoticeToast message={notice} />}
    {error && <p className="auth-banner auth-error" role="alert">{error}</p>}
    <div className="workspace-page-heading"><p className="eyebrow">{role} workspace</p><h1 ref={heading} tabIndex={-1}>{selected}</h1></div>
    <Card><p className="unfinished-message">This feature is not built yet.</p></Card>
  </WorkspaceShell>
}

export function AuthApp() {
  const [context, setContext] = useState<SessionContext | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'anonymous' | 'error'>('loading')
  const [error, setError] = useState('')
  const { start: startRetry, ...retry } = useRetryDelay()
  const [revision, setRevision] = useState(0)
  const [notice] = useState(() => notices[new URLSearchParams(window.location.search).get('notice') ?? ''] ?? '')
  const controller = useRef<AbortController | null>(null)
  const requestVersion = useRef(0)
  const protectedView = useRef(window.location.pathname !== '/sign-in')

  useEffect(() => {
    const url = new URL(window.location.href)
    if (url.searchParams.has('notice')) { url.searchParams.delete('notice'); window.history.replaceState(null, '', url.pathname + url.search + url.hash) }
    async function resolveSession() {
      const version = ++requestVersion.current
      controller.current?.abort()
      const abort = new AbortController()
      controller.current = abort
      setContext(null)
      setState('loading')
      try {
        const next = await authRequest('/api/session', undefined, abort.signal)
        if (abort.signal.aborted || version !== requestVersion.current || !next) return
        const allowed = window.location.pathname === '/profile' || next.navigation.some((item) => item.path === window.location.pathname)
        if (!allowed) { window.location.replace(next.landingPath); return }
        setContext(next)
        protectedView.current = true
        setState('ready')
      } catch (failure) {
        if (abort.signal.aborted || version !== requestVersion.current) return
        if (failure instanceof SessionError && failure.status === 401) {
          if (window.location.pathname !== '/sign-in') { window.location.replace('/sign-in?notice=session-required'); return }
          document.title = 'Sign in · Workforce'
          protectedView.current = false
          setState('anonymous')
        } else {
          setError(failure instanceof SessionError ? failure.message : 'The service is unavailable. Please try again.')
          startRetry(failure instanceof SessionError ? failure.retryAfter : 0)
          setState('error')
        }
      }
    }
    void resolveSession()
    const visibility = () => {
      if (!protectedView.current) return
      if (document.visibilityState === 'hidden') { controller.current?.abort(); ++requestVersion.current; setContext(null); setState('loading') }
      else void resolveSession()
    }
    const focus = () => { if (protectedView.current && document.visibilityState === 'visible') void resolveSession() }
    document.addEventListener('visibilitychange', visibility)
    window.addEventListener('focus', focus)
    window.addEventListener('pageshow', focus)
    return () => { controller.current?.abort(); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('focus', focus); window.removeEventListener('pageshow', focus) }
  }, [revision, startRetry])
  if (state === 'anonymous') return <SignIn notice={notice} />
  if (state === 'ready' && context) return <AuthenticatedWorkspace context={context} notice={notice} />
  return <main className="auth-pending"><Card>{state === 'loading' ? <p role="status">Loading workspace…</p> : <><p className="auth-banner auth-error" role="alert">{error}</p><Button disabled={retry.seconds > 0} onClick={() => setRevision(revision + 1)}>{retry.seconds ? `Retry (${retry.seconds}s)` : 'Retry'}</Button></>}</Card></main>
}
