import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import type { Selection } from '../employee/contracts.ts'
import type { ReviewAttempt } from './approvals-contracts.ts'
import { useManagerOperation } from './manager-operations.ts'
import type { ManagerOperations } from './manager-operations.ts'
import { DeclineDialog, ReviewDrawer, ReviewGroupDialog } from './ReviewDialogs.tsx'
import './approvals.css'

type Group = { kind: 'group'; personId: string; page: number; focusRequest?: string }
type Task = { kind: 'review'; id: string; expected?: { taskId: string; week: string }; back?: Group }
export type ReviewSurface = Group | Task | { kind: 'reason'; attempt: ReviewAttempt; back: Group | Task }

export function ReviewOverlay({ surface, onSurface, selection, headingRef, returnFocusRef, operations, onSessionInvalid, onResolved }: {
  surface: ReviewSurface; onSurface: (surface: ReviewSurface | null) => void; selection: Selection | null
  headingRef: RefObject<HTMLHeadingElement | null>; operations: ManagerOperations; onSessionInvalid: () => void
  returnFocusRef?: RefObject<HTMLButtonElement | null>
  onResolved?: (attempt: ReviewAttempt) => void
}) {
  const record = useManagerOperation(operations)
  const commit = record?.phase === 'committed' && 'items' in record.result ? record.id : null
  const seen = useRef(commit)
  useEffect(() => {
    if (!commit || seen.current === commit) return
    const timer = window.setTimeout(() => {
      seen.current = commit
      if (surface.kind === 'reason') onSurface(surface.back.kind === 'group' ? surface.back : surface.back.back ?? null)
      if (surface.kind === 'review') onSurface(surface.back ?? null)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [commit, onSurface, surface])

  const close = () => {
    if (surface.kind === 'reason') onSurface(surface.back)
    else if (surface.kind === 'review' && surface.back) onSurface({ ...surface.back, focusRequest: surface.id })
    else onSurface(null)
  }
  const shared = { operations, onSessionInvalid, headingRef, onClose: close }
  if (surface.kind === 'group') return <ReviewGroupDialog key={surface.personId} {...shared} personId={surface.personId}
    selection={selection} returnFocusRef={returnFocusRef} focusRequest={surface.focusRequest} page={surface.page} onPage={(page) => onSurface({ ...surface, page })}
    onDetail={(attempt) => onSurface({ kind: 'review', id: attempt.requestId, back: surface })}
    onDecline={(attempt) => onSurface({ kind: 'reason', attempt, back: { ...surface, focusRequest: attempt.requestId } })} />
  if (surface.kind === 'review') return <ReviewDrawer key={surface.id} {...shared} id={surface.id} expected={surface.expected}
    onResolved={(attempt) => { if (surface.expected) onResolved?.(attempt) }}
    onDecline={(attempt) => onSurface({ kind: 'reason', attempt, back: surface })} />
  return <DeclineDialog key={surface.attempt.requestId} {...shared} attempt={surface.attempt} onReload={close} />
}
