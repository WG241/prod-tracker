import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { WorkspaceShell } from '../../components/layout/WorkspaceShell.tsx'
import { BrandLoader } from '../../components/ui/BrandLoader.tsx'
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
import { AnnounceEvent } from '../../components/accessibility/Announcements.tsx'
import { useAnnounce, useAnnouncementReset } from '../../components/accessibility/useAnnounce.ts'
import { useWorkspaceView } from '../telemetry/client.ts'
import { initialEmployeeView } from '../employee/contracts.ts'
import type { EmployeeView } from '../employee/contracts.ts'
import { TaskOperations } from '../employee/operations.ts'
import { initialHistoryView } from '../employee/history-contracts.ts'
import type { HistoryView } from '../employee/history-contracts.ts'
import { initialLeaveView } from '../employee/leave-contracts.ts'
import type { LeaveView } from '../employee/leave-contracts.ts'
import { LeaveOperations } from '../employee/leave-operations.ts'
import { clearWorkspaceOperations, restoreWorkspaceOperations, sessionActor } from './workspace-operations.ts'

const EmployeeHome = lazy(() => import('../employee/EmployeeHome.tsx').then((m) => ({ default: m.EmployeeHome })))
const EmployeeHistory = lazy(() => import('../employee/EmployeeHistory.tsx').then((m) => ({ default: m.EmployeeHistory })))
const EmployeeLeave = lazy(() => import('../employee/EmployeeLeave.tsx').then((m) => ({ default: m.EmployeeLeave })))

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
  return visible ? <><p className="auth-toast"><CircleAlert aria-hidden="true" />{message}</p><AnnounceEvent event={{ id: `notice:${message}`, message, intent: 'status' }} /></> : null
}

function WorkspaceContentFallback() {
  return <div className="workspace-content-fallback" aria-busy="true"><BrandLoader label="Loading…" /></div>
}

function UnavailableFeature({ role, selected, headingRef, signingOut }: { role: string; selected: string; headingRef: RefObject<HTMLHeadingElement | null>; signingOut: boolean }) {
  return <><div className="workspace-page-heading"><p className="eyebrow">{role} workspace</p><h1 ref={headingRef} tabIndex={-1}>{selected}</h1></div><div className="workspace-unavailable" role="note"><span className="workspace-unavailable-dot" aria-hidden="true" /><span>{signingOut ? 'Signing out…' : 'This page is coming soon.'}</span></div></>
}

function AuthenticatedWorkspace({ context, notice, employeeView, onEmployeeView, onSessionInvalid, operations, historyView, onHistoryView, leaveOperations, leaveView, onLeaveView, revalidating }: { context: SessionContext; notice: string; employeeView: EmployeeView; onEmployeeView: (value: EmployeeView) => void; onSessionInvalid: () => void; operations: TaskOperations; historyView: HistoryView; onHistoryView: (next: HistoryView) => void; leaveOperations: LeaveOperations; leaveView: LeaveView; onLeaveView: (next: LeaveView) => void; revalidating: boolean }) {
  useWorkspaceView()
  const role = roleRoutes[context.role].label
  const workspace = { ...workspaces[role], name: context.user.name }
  const [path, setPath] = useState(window.location.pathname)
  const selected = path === '/profile' ? 'Profile' : context.navigation.find((item) => item.path === path)?.label ?? workspace.destinations[0].label
  useEffect(() => { const pop = () => setPath(window.location.pathname); window.addEventListener('popstate', pop); return () => window.removeEventListener('popstate', pop) }, [])
  const heading = useRef<HTMLHeadingElement>(null)
  const didFocus = useRef(false)
  const focusedFor = useRef('')
  const signOutLock = useRef(false)
  const [signingOut, setSigningOut] = useState(false)
  const [error, setError] = useState('')
  const announce = useAnnounce()
  const signOutAttempt = useRef(0)
  const retry = useRetryDelay()
  useLayoutEffect(() => { document.title = `${selected} · Workforce` }, [selected])
  // Focus the destination heading once it is mounted. Because pages are lazy
  // loaded, the heading ref may still be null when `selected` first changes.
  // This post-render effect keeps checking until the heading for the current
  // destination attaches, then focuses it exactly once per destination.
  useEffect(() => {
    if (!didFocus.current) { didFocus.current = true; return }
    if (focusedFor.current === selected) return
    if (heading.current) { heading.current.focus(); focusedFor.current = selected }
  })
  async function signOut() {
    if (signOutLock.current || retry.seconds) return
    signOutLock.current = true
    setSigningOut(true)
    const actor = sessionActor(context.user.id, context.role)
    clearWorkspaceOperations(operations, leaveOperations)
    onLeaveView(initialLeaveView(context.user.id))
    setError('')
    try { await authRequest('/api/auth/sign-out', {}); window.location.replace('/sign-in') }
    catch (failure) {
      restoreWorkspaceOperations(operations, leaveOperations, actor)
      const message = failure instanceof SessionError ? failure.message : 'Sign out could not be confirmed. Please try again.'
      setError(message)
      announce({ id: `sign-out:${++signOutAttempt.current}`, message, intent: 'alert' })
      if (failure instanceof SessionError && failure.retryAfter) retry.start(failure.retryAfter)
    } finally { signOutLock.current = false; setSigningOut(false) }
  }
  return <WorkspaceShell workspace={workspace} selected={selected} onSelect={() => {}} onNavigate={(next) => { window.history.pushState(null, '', next); setPath(next) }} headingRef={heading} navigation={context.navigation} onSignOut={() => void signOut()} signingOut={signingOut} signOutRetrySeconds={retry.seconds}>
    {notice && <NoticeToast message={notice} />}
    {error && <p className="auth-banner auth-error">{error}</p>}
    {revalidating ? <WorkspaceContentFallback /> : context.role === 'EMPLOYEE' && selected === 'Home' && !signingOut ? <Suspense fallback={<WorkspaceContentFallback />}><EmployeeHome leaveOperations={leaveOperations} operations={operations} name={context.user.name} state={employeeView.userId === context.user.id ? employeeView : initialEmployeeView(context.user.id)} onState={onEmployeeView} headingRef={heading} onSessionInvalid={onSessionInvalid} /></Suspense> : context.role === 'EMPLOYEE' && selected === 'History' && !signingOut ? <Suspense fallback={<WorkspaceContentFallback />}><EmployeeHistory operations={operations} state={historyView.userId === context.user.id ? historyView : initialHistoryView(context.user.id)} onState={onHistoryView} headingRef={heading} onSessionInvalid={onSessionInvalid} /></Suspense> : context.role === 'EMPLOYEE' && selected === 'Leave' && !signingOut ? <Suspense fallback={<WorkspaceContentFallback />}><EmployeeLeave operations={leaveOperations} state={leaveView.userId === context.user.id ? leaveView : initialLeaveView(context.user.id)} onState={onLeaveView} headingRef={heading} onSessionInvalid={onSessionInvalid} /></Suspense> : <UnavailableFeature role={role} selected={selected} headingRef={heading} signingOut={signingOut} />}
  </WorkspaceShell>
}

export function AuthApp() {
  const [operations] = useState(() => new TaskOperations())
  const [leaveOperations] = useState(() => new LeaveOperations())
  const [context, setContext] = useState<SessionContext | null>(null)
  const [revalidating, setRevalidating] = useState(false)
  const [state, setState] = useState<'loading' | 'ready' | 'anonymous' | 'error'>(
    window.location.pathname === '/sign-in' ? 'anonymous' : 'loading',
  )
  const [error, setError] = useState('')
  const { start: startRetry, ...retry } = useRetryDelay()
  const [revision, setRevision] = useState(0)
  const [employeeView, setEmployeeView] = useState(() => initialEmployeeView(''))
  const [historyView, setHistoryView] = useState(() => initialHistoryView(''))
  const [leaveView, setLeaveView] = useState(() => initialLeaveView(''))
  const [notice] = useState(() => notices[new URLSearchParams(window.location.search).get('notice') ?? ''] ?? '')
  const controller = useRef<AbortController | null>(null)
  const requestVersion = useRef(0)
  const leaveActor = useRef('')
  const protectedView = useRef(window.location.pathname !== '/sign-in')
  const hasContext = useRef(false)
  useAnnouncementReset(context ? `${context.user.id}:${context.role}` : `session:${revision}`)

  useEffect(() => {
    const url = new URL(window.location.href)
    if (url.searchParams.has('notice')) { url.searchParams.delete('notice'); window.history.replaceState(null, '', url.pathname + url.search + url.hash) }
    async function resolveSession() {
      const version = ++requestVersion.current
      controller.current?.abort()
      const abort = new AbortController()
      controller.current = abort
      const hadContext = hasContext.current
      if (!hadContext && window.location.pathname !== '/sign-in') { setContext(null); setState('loading') }
      // Unmount private views while re-checking an existing session so a
      // different identity cannot inherit the previous employee's reads.
      if (hadContext) setRevalidating(true)
      try {
        const next = await authRequest('/api/session', undefined, abort.signal)
        if (abort.signal.aborted || version !== requestVersion.current || !next) return
        const allowed = window.location.pathname === '/profile' || next.navigation.some((item) => item.path === window.location.pathname)
        if (!allowed) { window.location.replace(next.landingPath); return }
        const actor = `${next.user.id}:${next.role}`
        if (leaveActor.current !== actor) { leaveActor.current = actor; setLeaveView(initialLeaveView(next.user.id)) }
        hasContext.current = true
        setContext(next)
        operations.bind(`${next.user.id}:${next.role}`)
        leaveOperations.bind(`${next.user.id}:${next.role}`)
        protectedView.current = true
        setRevalidating(false)
        setState('ready')
      } catch (failure) {
        const aborted = failure instanceof DOMException && failure.name === 'AbortError'
        if (aborted || version !== requestVersion.current) return
        const onSignIn = window.location.pathname === '/sign-in'
        const unauthorized = failure instanceof SessionError && failure.status === 401
        setRevalidating(false)
        if (unauthorized || onSignIn) {
          hasContext.current = false
          operations.clear()
          leaveOperations.clear()
          leaveActor.current = ''
          setLeaveView(initialLeaveView(''))
          if (!onSignIn) { window.location.replace('/sign-in?notice=session-required'); return }
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
      if (document.visibilityState === 'hidden') { controller.current?.abort(); ++requestVersion.current }
      else void resolveSession()
    }
    const foreground = () => { if (protectedView.current && document.visibilityState === 'visible') void resolveSession() }
    document.addEventListener('visibilitychange', visibility)
    window.addEventListener('focus', foreground)
    window.addEventListener('pageshow', foreground)
    return () => { controller.current?.abort(); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('focus', foreground); window.removeEventListener('pageshow', foreground) }
  }, [revision, startRetry, operations, leaveOperations])
  if (state === 'anonymous') return <SignIn notice={notice} />
  if (state === 'ready' && context) return <AuthenticatedWorkspace key={`${context.user.id}:${context.role}`} leaveOperations={leaveOperations} leaveView={leaveView} onLeaveView={setLeaveView} historyView={historyView} onHistoryView={setHistoryView} operations={operations} context={context} notice={notice} employeeView={employeeView} onEmployeeView={setEmployeeView} onSessionInvalid={() => { hasContext.current = false; operations.clear(); leaveOperations.clear(); setEmployeeView(initialEmployeeView('')); setHistoryView(initialHistoryView('')); setLeaveView(initialLeaveView('')); setContext(null); setState('loading'); setRevision((value) => value + 1) }} revalidating={revalidating} />
  if (state === 'loading') {
    return <main className="auth-pending auth-pending-loading">
      <BrandLoader label="Loading workspace…" />
      <AnnounceEvent event={{ id: `loading:${revision}`, message: 'Loading workspace…', intent: 'status' }} />
    </main>
  }
  return <main className="auth-pending"><Card><p className="auth-banner auth-error">{error}</p><AnnounceEvent event={{ id: `session-error:${revision}:${error}`, message: error, intent: 'alert' }} /><Button disabled={retry.seconds > 0} onClick={() => setRevision(revision + 1)}>{retry.seconds ? `Retry (${retry.seconds}s)` : 'Retry'}</Button></Card></main>
}
