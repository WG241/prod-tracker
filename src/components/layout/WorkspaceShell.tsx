import { useEffect, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { Bell, ChevronDown, LayoutGrid, LogOut, UserRound } from 'lucide-react'
import type { WorkspaceConfig } from '../../features/workspace/config.ts'
import { Avatar } from '../ui/Avatar.tsx'
import { Button, IconButton } from '../ui/Button.tsx'
import { Dialog } from '../ui/Dialog.tsx'

export function WorkspaceShell({ workspace, selected, onSelect, headingRef, developmentControls, navigation, onSignOut, signingOut, signOutRetrySeconds = 0, children }: {
  workspace: WorkspaceConfig
  selected: string
  onSelect: (destination: string) => void
  headingRef: RefObject<HTMLHeadingElement | null>
  developmentControls?: ReactNode
  navigation?: { path: string; label: string }[]
  onSignOut?: () => void
  signingOut?: boolean
  signOutRetrySeconds?: number
  children: ReactNode
}) {
  const [accountOpen, setAccountOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [displayDate] = useState(() => new Date())
  const accountRef = useRef<HTMLDivElement>(null)
  const accountButton = useRef<HTMLButtonElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const accountId = 'workspace-account'
  const destinations = workspace.destinations
  const mobileItems = destinations.length > 5 ? destinations.slice(0, 4) : destinations
  const moreActive = destinations.slice(4).some((item) => item.label === selected)
  const destination = (label: string, content: ReactNode) => {
    const path = navigation?.find((item) => item.label === label)?.path
    return path
      ? <a key={label} href={path} title={label} aria-label={label} aria-current={selected === label ? 'page' : undefined}>{content}</a>
      : <button key={label} type="button" title={label} aria-label={label} aria-current={selected === label ? 'page' : undefined} onClick={() => navigate(label)}>{content}</button>
  }

  useEffect(() => {
    if (!accountOpen) return
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !accountRef.current?.contains(event.target)) setAccountOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setAccountOpen(false); accountButton.current?.focus() }
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [accountOpen])

  const navigate = (destination: string) => {
    setAccountOpen(false)
    returnFocus.current = headingRef.current
    setMoreOpen(false)
    onSelect(destinations.some((item) => item.label === destination) || destination === 'Profile' ? destination : destinations[0].label)
    // The next layout pass focuses the new title, also when selecting the same page.
    requestAnimationFrame(() => headingRef.current?.focus())
  }

  return (
    <div className={`workspace ${developmentControls ? 'workspace-development' : ''}`}>
      <a className="skip-link" href="#workspace-main">Skip to main content</a>
      {developmentControls}
      <aside className="workspace-sidebar" aria-label="Workspace">
        <div className="workspace-brand"><span className="wordmark">workforce<span className="brand-dot" /> <small>GROUP</small></span></div>
        <p className="workspace-label">Weekly performance</p>
        <nav className="workspace-nav" aria-label="Main navigation">
          {destinations.map(({ label, icon: Icon }) => destination(label, <><Icon aria-hidden="true" /><span>{label}</span></>))}
        </nav>
        <footer className="workspace-sidebar-foot"><span>Workforce Group</span><span>v1.2</span></footer>
      </aside>
      <div className="workspace-body">
        <header className="workspace-topbar">
          <div className="workspace-crumb"><span>Workspace</span><span aria-hidden="true">/</span><strong>{selected}</strong></div>
          <div className="workspace-top-actions">
            {navigation ? <time dateTime={new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(displayDate)}>{new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lagos', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(displayDate)}</time> : <time dateTime="2026-10-19" aria-label="Sample date: Monday, 19 October 2026">Mon, 19 Oct 2026</time>}
            <span className="sr-only" id="notifications-unavailable">Notifications are not built yet.</span>
            <IconButton label="Notifications" disabled aria-describedby="notifications-unavailable"><Bell aria-hidden="true" /></IconButton>
            <div className="workspace-account" ref={accountRef}>
              <button ref={accountButton} type="button" className="workspace-profile" aria-label={`Account for ${workspace.name}`} aria-expanded={accountOpen} aria-controls={accountId} onClick={() => setAccountOpen(!accountOpen)}>
                <Avatar name={workspace.name} /><span className="workspace-person"><b>{workspace.name}</b><small>{workspace.role}</small></span><ChevronDown aria-hidden="true" data-icon="down" />
              </button>
              {accountOpen && <div className="workspace-account-panel" id={accountId}>
                {navigation ? <a href="/profile"><UserRound aria-hidden="true" />Profile &amp; account</a> : <button type="button" onClick={() => navigate('Profile')}><UserRound aria-hidden="true" />Profile &amp; account</button>}
                <button type="button" disabled={!onSignOut || signingOut || signOutRetrySeconds > 0} onClick={onSignOut} aria-describedby={!onSignOut ? 'signout-unavailable' : undefined}><LogOut aria-hidden="true" />{signingOut ? 'Signing out…' : signOutRetrySeconds ? `Sign out (${signOutRetrySeconds}s)` : 'Sign out'}</button>
                {!onSignOut && <p className="ui-help" id="signout-unavailable">Sign in and sign out are not available in this preview.</p>}
              </div>}
            </div>
          </div>
        </header>
        <main className="workspace-content" id="workspace-main" tabIndex={-1}>{children}</main>
      </div>
      <nav className="workspace-mobile-nav" aria-label="Mobile navigation">
        {mobileItems.map(({ label, icon: Icon }) => destination(label, <><Icon aria-hidden="true" /><span>{label}</span></>))}
        {destinations.length > 5 && <button type="button" aria-expanded={moreOpen} aria-haspopup="dialog" aria-current={moreActive ? 'page' : undefined} onClick={() => { returnFocus.current = null; setAccountOpen(false); setMoreOpen(true) }}><LayoutGrid aria-hidden="true" /><span>More</span></button>}
      </nav>
      <Dialog open={moreOpen} title="More from your workspace" onClose={() => setMoreOpen(false)} returnFocusRef={returnFocus} fallbackFocusRef={headingRef} footer={<Button onClick={() => setMoreOpen(false)}>Cancel</Button>}>
        <nav className="workspace-more" aria-label="All workspace destinations">{destinations.map(({ label, icon: Icon }) => destination(label, <><Icon aria-hidden="true" />{label}</>))}</nav>
      </Dialog>
    </div>
  )
}
