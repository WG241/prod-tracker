import { lazy, Suspense, useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { WorkspaceShell } from '../../components/layout/WorkspaceShell.tsx'
import { BrandLoader } from '../../components/ui/BrandLoader.tsx'
import { Button } from '../../components/ui/Button.tsx'
import { Card } from '../../components/ui/Card.tsx'
import { NoticeToast } from '../../components/ui/NoticeToast.tsx'
import { AccountProfile } from '../profile/AccountProfile.tsx'
import { PreferenceOperations } from '../profile/preference-operations.ts'
import { NotificationOperations } from '../notifications/read-operations.ts'
import type { NotificationTarget } from '../notifications/contracts.ts'
import { workspaces } from '../workspace/config.ts'
import { isPasswordRecoveryNotice, roleRoutes } from './contracts.ts'
import type { SessionContext } from './contracts.ts'
import { authRequest, SessionError } from './api.ts'
import { SignIn } from './SignIn.tsx'
import { useRetryDelay } from './useRetryDelay.ts'
import './auth.css'
import { AnnounceEvent } from '../../components/accessibility/Announcements.tsx'
import { useAnnounce, useAnnouncementReset } from '../../components/accessibility/useAnnounce.ts'
import { initialEmployeeView } from '../employee/contracts.ts'
import type { EmployeeView } from '../employee/contracts.ts'
import { TaskOperations } from '../employee/operations.ts'
import { initialHistoryView } from '../employee/history-contracts.ts'
import type { HistoryView } from '../employee/history-contracts.ts'
import { initialLeaveView } from '../employee/leave-contracts.ts'
import type { LeaveView } from '../employee/leave-contracts.ts'
import { LeaveOperations } from '../employee/leave-operations.ts'
import { clearWorkspaceOperations, restoreWorkspaceOperations, sessionActor } from './workspace-operations.ts'
import { ManagerOperations } from '../line-manager/manager-operations.ts'
import type { ApprovalGroup, DashboardSelectionState } from '../line-manager/dashboard-view.ts'
import { initialTeamHistoryView } from '../line-manager/team-history-contracts.ts'
import { initialApprovalsView } from '../line-manager/approvals-contracts.ts'
import { initialManagerLeaveView } from '../line-manager/leave-contracts.ts'
import { ManagerLeaveOperations } from '../line-manager/leave-operations.ts'
import type { ReviewSummary } from '../line-manager/approvals-contracts.ts'
import type { ApprovalOpen } from '../line-manager/ApprovalsPage.tsx'
import { useEmployeeRead } from '../employee/useEmployeeRead.ts'
import { useManagerOperation } from '../line-manager/manager-operations.ts'

const EmployeeHome = lazy(() => import('../employee/EmployeeHome.tsx').then((m) => ({ default: m.EmployeeHome })))
const EmployeeHistory = lazy(() => import('../employee/EmployeeHistory.tsx').then((m) => ({ default: m.EmployeeHistory })))
const EmployeeLeave = lazy(() => import('../employee/EmployeeLeave.tsx').then((m) => ({ default: m.EmployeeLeave })))
const ManagerDashboardPage = lazy(() => import('../line-manager/ManagerDashboardPage.tsx').then((m) => ({ default: m.ManagerDashboardPage })))
const TeamHistoryPage = lazy(() => import('../line-manager/TeamHistoryPage.tsx').then((m) => ({ default: m.TeamHistoryPage })))
const ApprovalsPage = lazy(() => import('../line-manager/ApprovalsPage.tsx').then((m) => ({ default: m.ApprovalsPage })))
const ManagerLeavePage = lazy(() => import('../line-manager/ManagerLeavePage.tsx').then((m) => ({ default: m.ManagerLeavePage })))

const notices: Record<string, string> = {
  'access-denied': 'You do not have access to that page.',
  'page-unavailable': 'That page is not available.',
  'session-required': 'Please sign in to continue.',
  'password-changed': 'Your password was changed and all sessions ended. Sign in with your new password.',
  'password-outcome-unknown': 'We could not confirm your password change. Sign in again, trying your new password first.',
}

function preferenceActor(context: SessionContext) {
  return JSON.stringify([context.user.id, context.role, context.user.email, context.businessId, context.unitId])
}

function WorkspaceContentFallback() {
  return <div className="workspace-content-fallback" aria-busy="true"><BrandLoader label="Loading…" /></div>
}

function UnavailableFeature({ role, selected, headingRef, signingOut }: { role: string; selected: string; headingRef: RefObject<HTMLHeadingElement | null>; signingOut: boolean }) {
  return <><div className="workspace-page-heading"><p className="eyebrow">{role} workspace</p><h1 ref={headingRef} tabIndex={-1}>{selected}</h1></div><div className="workspace-unavailable" role="note"><span className="workspace-unavailable-dot" aria-hidden="true" /><span>{signingOut ? 'Signing out…' : 'This page is coming soon.'}</span></div></>
}

function FocusNotificationDestination({ request, heading }: { request: number; heading: RefObject<HTMLHeadingElement | null> }) {
  useLayoutEffect(() => { if (request) heading.current?.focus() }, [request, heading])
  return null
}

function AuthenticatedWorkspace({ context, notice, employeeView, onEmployeeView, onSessionInvalid, operations, historyView, onHistoryView, leaveOperations, leaveView, onLeaveView, revalidating, preferences, notifications, managerOperations, managerLeaveOperations, onPasswordPending, onReauthenticate }: { context: SessionContext; notice: string; employeeView: EmployeeView; onEmployeeView: (value: EmployeeView) => void; onSessionInvalid: () => void; operations: TaskOperations; historyView: HistoryView; onHistoryView: (next: HistoryView) => void; leaveOperations: LeaveOperations; leaveView: LeaveView; onLeaveView: (next: LeaveView) => void; revalidating: boolean; preferences: PreferenceOperations; notifications: NotificationOperations; managerOperations: ManagerOperations; managerLeaveOperations: ManagerLeaveOperations; onPasswordPending: (pending: boolean) => void; onReauthenticate: (confirmed: boolean) => void }) {
  const role = roleRoutes[context.role].label
  const workspace = { ...workspaces[role], name: context.user.name }
  const [path, setPath] = useState(window.location.pathname)
  const [managerView, setManagerView] = useState<DashboardSelectionState>({ anchor: null, selection: null, pages: {} })
  const [managerTasks, setManagerTasks] = useState(() => initialEmployeeView(context.user.id))
  const [teamHistory, setTeamHistory] = useState(initialTeamHistoryView)
  const [approvals, setApprovals] = useState(initialApprovalsView)
  const [managerLeaveView, setManagerLeaveView] = useState(initialManagerLeaveView)
  const [approvalOpen, setApprovalOpen] = useState<ApprovalOpen | null>(null)
  const [approvalEpoch, setApprovalEpoch] = useState(0)
  const [teamTarget, setTeamTarget] = useState<Extract<NotificationTarget, { kind: 'TEAM_TASK' }> | null>(null)
  const [approvalBadge, setApprovalBadge] = useState(0)
  const [taskTarget, setTaskTarget] = useState<Extract<NotificationTarget, { kind: 'OWN_TASK' }> | null>(null)
  const [headingRequest, setHeadingRequest] = useState(0)
  const notificationNavigation = useRef(0)
  const selected = path === '/profile' ? 'Profile' : context.navigation.find((item) => item.path === path)?.label ?? workspace.destinations[0].label
  useEffect(() => {
    const pop = () => { setTaskTarget(null); setTeamTarget(null); setApprovalOpen(null); setHeadingRequest(0); setPath(window.location.pathname) }
    window.addEventListener('popstate', pop)
    return () => window.removeEventListener('popstate', pop)
  }, [])
  const heading = useRef<HTMLHeadingElement>(null)
  const didFocus = useRef(false)
  const focusedFor = useRef('')
  const signOutLock = useRef(false)
  const [signingOut, setSigningOut] = useState(false)
  const [error, setError] = useState('')
  const announce = useAnnounce()
  const signOutAttempt = useRef(0)
  const retry = useRetryDelay()
  const activeManager = context.role === 'LINE_MANAGER' && !revalidating && !signingOut
  const summary = useEmployeeRead<ReviewSummary>(activeManager ? '/api/line-manager/approvals/summary' : null, onSessionInvalid)
  const { retry: retryApprovalSummary } = summary
  const managerRecord = useManagerOperation(managerOperations)
  const lastReviewCommit = useRef<string | null>(null)
  useEffect(() => {
    if (!activeManager) return
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') retryApprovalSummary() }, 30000)
    return () => window.clearInterval(timer)
  }, [activeManager, retryApprovalSummary])
  useEffect(() => {
    if (managerRecord?.phase === 'committed' && managerRecord.id !== lastReviewCommit.current) {
      lastReviewCommit.current = managerRecord.id
      if ('approvalRequestId' in managerRecord.result || 'items' in managerRecord.result) retryApprovalSummary()
    }
  }, [managerRecord, retryApprovalSummary])
  useEffect(() => {
    if (!revalidating) return
    const timer = window.setTimeout(() => { setTeamTarget(null); setApprovalOpen(null) }, 0)
    return () => window.clearTimeout(timer)
  }, [revalidating])
  useLayoutEffect(() => { document.title = `${selected} · Workforce` }, [selected])
  // Focus the destination heading once it is mounted. Because pages are lazy
  // loaded, the heading ref may still be null when `selected` first changes.
  // This post-render effect keeps checking until the heading for the current
  // destination attaches, then focuses it exactly once per destination.
  useEffect(() => {
    if (!didFocus.current) { didFocus.current = true; return }
    if (focusedFor.current === selected) return
    if (heading.current) {
      const activeTray = document.activeElement?.closest('.notification-control')?.querySelector('.notification-bell[aria-expanded="true"]')
      if (!activeTray) heading.current.focus()
      focusedFor.current = selected
    }
  })
  function navigate(next: string) {
    if (window.location.pathname + window.location.search !== next) window.history.pushState(null, '', next)
    setPath(window.location.pathname)
  }
  function openApprovals(group?: ApprovalGroup) {
    setTeamTarget(null)
    setApprovals({ ...initialApprovalsView, personId: group?.employeeId ?? '' })
    setApprovalOpen(group ? { personId: group.employeeId } : null)
    setApprovalEpoch((epoch) => epoch + 1)
    navigate('/line-manager/approvals')
  }
  function openNotificationTarget(target: Exclude<NotificationTarget, { kind: 'UNAVAILABLE' }>) {
    if (target.kind === 'PROFILE') {
      setHeadingRequest(++notificationNavigation.current)
      navigate('/profile')
    } else if (context.role === 'EMPLOYEE') {
      if (target.kind === 'EMPLOYEE_LEAVE') {
        setHeadingRequest(++notificationNavigation.current)
        navigate('/employee/leave')
      } else if (target.kind === 'OWN_TASK' || target.kind === 'OWN_TRACKER') {
        setTaskTarget(target.kind === 'OWN_TASK' ? target : null)
        if (target.kind === 'OWN_TRACKER') setHeadingRequest(++notificationNavigation.current)
        onEmployeeView({ ...initialEmployeeView(context.user.id), view: employeeView.view, selection: { kind: 'week', week: target.week }, anchor: target.week })
        navigate('/employee/home')
      }
    } else if (context.role === 'LINE_MANAGER' && target.kind === 'MANAGER_LEAVE') {
      setHeadingRequest(++notificationNavigation.current)
      navigate('/line-manager/leave')
    } else if (context.role === 'LINE_MANAGER' && target.kind === 'MANAGER_APPROVALS') {
      setHeadingRequest(++notificationNavigation.current)
      openApprovals()
    } else if (context.role === 'LINE_MANAGER' && target.kind === 'OWN_TASK') {
      setTaskTarget(target)
      setManagerTasks({ ...initialEmployeeView(context.user.id), view: managerTasks.view, selection: { kind: 'week', week: target.week }, anchor: target.week })
      navigate('/line-manager/my-tasks')
    } else if (context.role === 'LINE_MANAGER' && target.kind === 'REVIEW_REQUEST') {
      setTeamTarget(null)
      setApprovals({ ...initialApprovalsView, selection: { kind: 'week', week: target.week } })
      setApprovalOpen(target)
      setApprovalEpoch((epoch) => epoch + 1)
      navigate('/line-manager/approvals')
    } else if (context.role === 'LINE_MANAGER' && target.kind === 'TEAM_TASK') {
      setApprovalOpen(null)
      setTeamTarget(target)
      navigate('/line-manager/team-history')
    }
  }
  async function signOut() {
    if (signOutLock.current || retry.seconds) return
    signOutLock.current = true
    setSigningOut(true)
    const actor = sessionActor(context.user.id, context.role)
    clearWorkspaceOperations(operations, leaveOperations)
    preferences.clear()
    notifications.clear()
    managerOperations.clear()
    managerLeaveOperations.clear()
    setManagerLeaveView(initialManagerLeaveView)
    setTaskTarget(null)
    setTeamTarget(null)
    setApprovalOpen(null)
    onLeaveView(initialLeaveView(context.user.id))
    setError('')
    try { await authRequest('/api/auth/sign-out', {}); window.location.replace('/sign-in') }
    catch (failure) {
      restoreWorkspaceOperations(operations, leaveOperations, actor, context.role === 'LINE_MANAGER' ? 'LINE_MANAGER' : 'EMPLOYEE')
      preferences.bind(preferenceActor(context))
      notifications.bind(preferenceActor(context))
      managerOperations.bind(preferenceActor(context))
      managerLeaveOperations.bind(preferenceActor(context))
      const message = failure instanceof SessionError ? failure.message : 'Sign out could not be confirmed. Please try again.'
      setError(message)
      announce({ id: `sign-out:${++signOutAttempt.current}`, message, intent: 'alert' })
      if (failure instanceof SessionError && failure.retryAfter) retry.start(failure.retryAfter)
    } finally { signOutLock.current = false; setSigningOut(false) }
  }
  return <WorkspaceShell workspace={workspace} selected={selected} onSelect={() => {}} onNavigate={(next) => { setTaskTarget(null); setTeamTarget(null); setApprovalOpen(null); setHeadingRequest(0); navigate(next) }} headingRef={heading} navigation={context.navigation} onSignOut={() => void signOut()} signingOut={signingOut} signOutRetrySeconds={retry.seconds}
    approvalCount={activeManager ? summary.data?.employeeCount ?? approvalBadge : 0}
    notificationControls={revalidating || signingOut ? undefined : { onSessionInvalid, operations: notifications, onTarget: openNotificationTarget }}>
    {notice && <NoticeToast message={notice} />}
    {error && <p className="auth-banner auth-error">{error}</p>}
    {revalidating ? <WorkspaceContentFallback />
      : selected === 'Profile' ? <><AccountProfile
        key={context.user.email}
        context={context}
        headingRef={heading}
        onSessionInvalid={onSessionInvalid}
        onSignOut={() => void signOut()}
        signingOut={signingOut}
        signOutRetrySeconds={retry.seconds}
        preferenceOperations={preferences}
        onPasswordPending={onPasswordPending}
        onReauthenticate={onReauthenticate}
      /><FocusNotificationDestination request={headingRequest} heading={heading} /></>
      : context.role === 'LINE_MANAGER' && selected === 'Dashboard' && !signingOut ? <Suspense fallback={<WorkspaceContentFallback />}>
        <ManagerDashboardPage headingRef={heading} view={managerView} onView={setManagerView} operations={managerOperations}
          onSessionInvalid={onSessionInvalid} onApprovals={openApprovals} onBadge={setApprovalBadge} />
      </Suspense>
      : context.role === 'LINE_MANAGER' && selected === 'My tasks' && !signingOut ? <Suspense fallback={<WorkspaceContentFallback />}>
        <EmployeeHome role="LINE_MANAGER" name={context.user.name} state={managerTasks} onState={setManagerTasks}
          headingRef={heading} onSessionInvalid={onSessionInvalid} operations={operations} leaveOperations={leaveOperations}
          taskTarget={taskTarget} onTaskTargetHandled={() => setTaskTarget(null)} />
      </Suspense>
      : context.role === 'LINE_MANAGER' && selected === 'Team history' && !signingOut ? <Suspense fallback={<WorkspaceContentFallback />}>
        <TeamHistoryPage headingRef={heading} view={teamHistory} onView={setTeamHistory} operations={managerOperations} onSessionInvalid={onSessionInvalid}
          target={teamTarget} onTargetHandled={() => setTeamTarget(null)} />
      </Suspense>
      : context.role === 'LINE_MANAGER' && selected === 'Approvals' && !signingOut ? <Suspense fallback={<WorkspaceContentFallback />}>
        <ApprovalsPage key={approvalEpoch} headingRef={heading} view={approvals} onView={setApprovals} open={approvalOpen}
          onOpenHandled={() => setApprovalOpen(null)} operations={managerOperations} onSessionInvalid={onSessionInvalid} />
        <FocusNotificationDestination request={headingRequest} heading={heading} />
      </Suspense>
      : context.role === 'LINE_MANAGER' && selected === 'Leave' && !signingOut ? <Suspense fallback={<WorkspaceContentFallback />}>
        <ManagerLeavePage headingRef={heading} view={managerLeaveView} onView={setManagerLeaveView}
          operations={managerLeaveOperations} onSessionInvalid={onSessionInvalid} />
        <FocusNotificationDestination request={headingRequest} heading={heading} />
      </Suspense>
      : context.role === 'EMPLOYEE' && selected === 'Home' && !signingOut ? <Suspense fallback={<WorkspaceContentFallback />}><EmployeeHome leaveOperations={leaveOperations} operations={operations} name={context.user.name} state={employeeView.userId === context.user.id ? employeeView : initialEmployeeView(context.user.id)} onState={onEmployeeView} headingRef={heading} onSessionInvalid={onSessionInvalid} taskTarget={taskTarget} onTaskTargetHandled={() => setTaskTarget(null)} /><FocusNotificationDestination request={headingRequest} heading={heading} /></Suspense> : context.role === 'EMPLOYEE' && selected === 'History' && !signingOut ? <Suspense fallback={<WorkspaceContentFallback />}><EmployeeHistory operations={operations} state={historyView.userId === context.user.id ? historyView : initialHistoryView(context.user.id)} onState={onHistoryView} headingRef={heading} onSessionInvalid={onSessionInvalid} /></Suspense> : context.role === 'EMPLOYEE' && selected === 'Leave' && !signingOut ? <Suspense fallback={<WorkspaceContentFallback />}><EmployeeLeave operations={leaveOperations} state={leaveView.userId === context.user.id ? leaveView : initialLeaveView(context.user.id)} onState={onLeaveView} headingRef={heading} onSessionInvalid={onSessionInvalid} /><FocusNotificationDestination request={headingRequest} heading={heading} /></Suspense> : <UnavailableFeature role={role} selected={selected} headingRef={heading} signingOut={signingOut} />}
  </WorkspaceShell>
}

export function AuthApp() {
  const [operations] = useState(() => new TaskOperations())
  const [leaveOperations] = useState(() => new LeaveOperations())
  const [preferences] = useState(() => new PreferenceOperations())
  const [notifications] = useState(() => new NotificationOperations())
  const [managerOperations] = useState(() => new ManagerOperations())
  const [managerLeaveOperations] = useState(() => new ManagerLeaveOperations())
  const passwordPending = useRef(false)
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

  function reauthenticate(confirmed: boolean) {
    passwordPending.current = false
    controller.current?.abort()
    requestVersion.current++
    hasContext.current = false
    protectedView.current = false
    clearWorkspaceOperations(operations, leaveOperations)
    preferences.clear()
    notifications.clear()
    managerOperations.clear()
    managerLeaveOperations.clear()
    leaveActor.current = ''
    setEmployeeView(initialEmployeeView(''))
    setHistoryView(initialHistoryView(''))
    setLeaveView(initialLeaveView(''))
    setContext(null)
    setState('loading')
    window.location.replace(confirmed ? '/sign-in?notice=password-changed' : '/sign-in?notice=password-outcome-unknown')
  }
  const recoverPassword = useEffectEvent(() => reauthenticate(false))

  useEffect(() => {
    const url = new URL(window.location.href)
    if (url.pathname === '/sign-in' && isPasswordRecoveryNotice(url.searchParams.get('notice'))) return
    if (url.searchParams.has('notice')) { url.searchParams.delete('notice'); window.history.replaceState(null, '', url.pathname + url.search + url.hash) }
    async function resolveSession() {
      if (passwordPending.current) { recoverPassword(); return }
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
        operations.bind(`${next.user.id}:${next.role}`, next.role === 'LINE_MANAGER' ? 'LINE_MANAGER' : 'EMPLOYEE')
        leaveOperations.bind(`${next.user.id}:${next.role}`)
        preferences.bind(preferenceActor(next))
        notifications.bind(preferenceActor(next))
        managerOperations.bind(preferenceActor(next))
        managerLeaveOperations.bind(preferenceActor(next))
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
          preferences.clear()
          notifications.clear()
          managerOperations.clear()
          managerLeaveOperations.clear()
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
      if (passwordPending.current) { recoverPassword(); return }
      if (document.visibilityState === 'hidden') { controller.current?.abort(); ++requestVersion.current }
      else void resolveSession()
    }
    const foreground = () => { if (protectedView.current && document.visibilityState === 'visible') void resolveSession() }
    document.addEventListener('visibilitychange', visibility)
    window.addEventListener('focus', foreground)
    window.addEventListener('pageshow', foreground)
    return () => { controller.current?.abort(); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('focus', foreground); window.removeEventListener('pageshow', foreground) }
  }, [revision, startRetry, operations, leaveOperations, preferences, notifications, managerOperations, managerLeaveOperations])
  if (state === 'anonymous') return <SignIn notice={notice} />
  if (state === 'ready' && context) return <AuthenticatedWorkspace
    key={preferenceActor(context)}
    leaveOperations={leaveOperations} leaveView={leaveView} onLeaveView={setLeaveView}
    historyView={historyView} onHistoryView={setHistoryView} operations={operations}
    context={context} notice={notice} employeeView={employeeView} onEmployeeView={setEmployeeView}
    onSessionInvalid={() => {
      if (passwordPending.current) { reauthenticate(false); return }
      hasContext.current = false
      clearWorkspaceOperations(operations, leaveOperations)
      managerOperations.clear()
      managerLeaveOperations.clear()
      setEmployeeView(initialEmployeeView(''))
      setHistoryView(initialHistoryView(''))
      setLeaveView(initialLeaveView(''))
      setContext(null)
      setState('loading')
      setRevision((value) => value + 1)
    }}
    revalidating={revalidating}
    preferences={preferences}
    notifications={notifications}
    managerOperations={managerOperations}
    managerLeaveOperations={managerLeaveOperations}
    onPasswordPending={(pending) => { passwordPending.current = pending }}
    onReauthenticate={reauthenticate}
  />
  if (state === 'loading') {
    return <main className="auth-pending auth-pending-loading">
      <BrandLoader label="Loading workspace…" />
      <AnnounceEvent event={{ id: `loading:${revision}`, message: 'Loading workspace…', intent: 'status' }} />
    </main>
  }
  return <main className="auth-pending"><Card><p className="auth-banner auth-error">{error}</p><AnnounceEvent event={{ id: `session-error:${revision}:${error}`, message: error, intent: 'alert' }} /><Button disabled={retry.seconds > 0} onClick={() => setRevision(revision + 1)}>{retry.seconds ? `Retry (${retry.seconds}s)` : 'Retry'}</Button></Card></main>
}
