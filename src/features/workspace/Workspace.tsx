import { useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { WorkspaceShell } from '../../components/layout/WorkspaceShell.tsx'
import { workspaces } from './config.ts'
import type { WorkspaceRole } from './config.ts'
import { useAnnouncementReset } from '../../components/accessibility/useAnnounce.ts'

export function Workspace({ role = 'Employee', developmentControls }: { role?: WorkspaceRole; developmentControls?: ReactNode }) {
  const workspace = workspaces[role]
  const [selected, setSelected] = useState(workspace.destinations[0].label)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const didFocus = useRef(false)
  useAnnouncementReset(`${role}:${selected}`)
  useLayoutEffect(() => {
    document.title = `${selected} · Workforce`
    if (didFocus.current) headingRef.current?.focus()
    else didFocus.current = true
  }, [selected])
  return (
    <WorkspaceShell workspace={workspace} selected={selected} onSelect={setSelected} headingRef={headingRef} developmentControls={developmentControls}>
      <div className="workspace-page-heading"><p className="eyebrow">Preview workspace</p><h1 ref={headingRef} tabIndex={-1}>{selected}</h1></div>
      <div className="workspace-unavailable" role="note"><span className="workspace-unavailable-dot" aria-hidden="true" /><span>This page is coming soon.</span></div>
    </WorkspaceShell>
  )
}
