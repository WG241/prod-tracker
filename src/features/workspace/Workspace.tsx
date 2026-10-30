import { useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Card } from '../../components/ui/Card.tsx'
import { WorkspaceShell } from '../../components/layout/WorkspaceShell.tsx'
import { workspaces } from './config.ts'
import type { WorkspaceRole } from './config.ts'

export function Workspace({ role = 'Employee', developmentControls }: { role?: WorkspaceRole; developmentControls?: ReactNode }) {
  const workspace = workspaces[role]
  const [selected, setSelected] = useState(workspace.destinations[0].label)
  const headingRef = useRef<HTMLHeadingElement>(null)
  useLayoutEffect(() => {
    document.title = `${selected} · Workforce`
    headingRef.current?.focus()
  }, [selected])
  return (
    <WorkspaceShell workspace={workspace} selected={selected} onSelect={setSelected} headingRef={headingRef} developmentControls={developmentControls}>
      <div className="workspace-page-heading"><p className="eyebrow">Preview workspace</p><h1 ref={headingRef} tabIndex={-1}>{selected}</h1></div>
      <Card><p className="unfinished-message">This feature is not built yet.</p></Card>
    </WorkspaceShell>
  )
}
