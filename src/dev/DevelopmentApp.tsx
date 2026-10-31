import { useState } from 'react'
import { Workspace } from '../features/workspace/Workspace.tsx'
import { workspaces } from '../features/workspace/config.ts'
import type { WorkspaceRole } from '../features/workspace/config.ts'
import { ComponentPreview } from './ComponentPreview.tsx'
import { DataProof } from './data-proof/DataProof.tsx'

export default function DevelopmentApp() {
  const [role, setRole] = useState<WorkspaceRole>('Employee')
  if (window.location.pathname === '/__ui' && new URLSearchParams(window.location.search).get('view') !== 'workspace') return <ComponentPreview />
  if (window.location.pathname === '/__data-proof') return <DataProof />
  return <Workspace key={role} role={role} developmentControls={<div className="development-bar"><span><i className="brand-dot" />Development preview</span><div><a href="/__data-proof">Data proof</a><a href="/__ui">Component preview</a><label htmlFor="preview-role">Explore as</label><select id="preview-role" aria-label="Preview role" value={role} onChange={(event) => { if (Object.hasOwn(workspaces, event.target.value)) setRole(event.target.value as WorkspaceRole) }}>{Object.keys(workspaces).map((name) => <option key={name}>{name}</option>)}</select></div></div>} />
}
