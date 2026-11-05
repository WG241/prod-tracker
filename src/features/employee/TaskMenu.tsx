import { useEffect, useId, useRef, useState } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { IconButton } from '../../components/ui/Button.tsx'
import type { TaskEntry } from './contracts.ts'

export type TaskAction = 'EDIT' | 'IN_PROGRESS' | 'COMPLETED' | 'BLOCKED' | 'PENDING' | 'CARRY' | 'DELETE'
export function TaskMenu({ task, onAction, stale }: { task: TaskEntry; onAction: (task: TaskEntry, action: TaskAction) => void; stale: boolean }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null), id = useId()
  function focusButton() { root.current?.querySelector<HTMLButtonElement>('button')?.focus() }
  useEffect(() => {
    if (!open) return
    root.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus()
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open])
  return <div className="employee-menu" ref={root}><IconButton label={`Actions for ${task.title}`} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(!open)}><MoreHorizontal aria-hidden="true" /></IconButton>{open && <div role="menu" id={id} aria-label={`Actions for ${task.title}`} onKeyDown={(event) => {
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
    const index = items.indexOf(document.activeElement as HTMLButtonElement)
    if (event.key === 'Escape') { event.preventDefault(); setOpen(false); focusButton() }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) { event.preventDefault(); items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus() }
    if (event.key === 'Tab') { focusButton(); setOpen(false) }
  }}>{([['EDIT', 'Edit', task.permissions.canEdit], ['IN_PROGRESS', 'In progress', task.permissions.canChangeStatus], ['COMPLETED', 'Completed', task.permissions.canChangeStatus], ['DELETE', 'Delete', task.permissions.canDelete]] as const).map(([action, label, enabled]) => <button role="menuitem" tabIndex={-1} key={action} disabled={!enabled || stale} title={!enabled ? task.permissions.reason ?? undefined : stale ? 'This tracker is out of date. Reload to check available actions.' : undefined} onClick={() => { focusButton(); setOpen(false); onAction(task, action) }}>{label}</button>)}</div>}</div>
}
