import { useId, useLayoutEffect, useRef } from 'react'
import type { ReactNode, RefObject } from 'react'
import { X } from 'lucide-react'
import { IconButton } from './Button.tsx'

type DialogProps = {
  open: boolean
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
  onClose: () => void
  size?: 'normal' | 'small' | 'wide'
  initialFocusRef?: RefObject<HTMLElement | null>
  returnFocusRef?: RefObject<HTMLElement | null>
  fallbackFocusRef?: RefObject<HTMLElement | null>
}

function ModalFrame({ open, title, description, children, footer, onClose, size = 'normal', initialFocusRef, returnFocusRef, fallbackFocusRef, drawer = false }: DialogProps & { drawer?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const descriptionId = useId()
  const callbacks = useRef({ onClose, initialFocusRef, returnFocusRef, fallbackFocusRef })
  useLayoutEffect(() => { callbacks.current = { onClose, initialFocusRef, returnFocusRef, fallbackFocusRef } })
  useLayoutEffect(() => {
    const dialog = ref.current
    if (!dialog || !open) return
    // A single native modal owns focus. Callers close it before opening another.
    if (document.querySelector('dialog[open]')) {
      callbacks.current.onClose()
      return
    }
    const opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body && document.activeElement !== document.documentElement ? document.activeElement : null
    const focusRefs = callbacks.current
    // Navigation may replace the return target while the modal is open.
    const returnTarget = () => focusRefs.returnFocusRef?.current ?? opener
    const fallbackTarget = () => focusRefs.fallbackFocusRef?.current ?? document.querySelector<HTMLElement>('main h1')
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialog.showModal()
    const focusTarget = callbacks.current.initialFocusRef?.current ?? dialog.querySelector<HTMLElement>('[data-modal-close]') ?? dialog
    focusTarget.focus()
    return () => {
      dialog.close()
      document.body.style.overflow = previousOverflow
      const target = returnTarget()
      if (target?.isConnected && !target.matches(':disabled')) target.focus()
      else fallbackTarget()?.focus()
    }
  }, [open])

  return (
    <dialog ref={ref} className={`ui-dialog ui-dialog-${size} ${drawer ? 'ui-drawer' : ''}`} aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined} onCancel={(event) => { event.preventDefault(); onClose() }} onClose={() => { if (open && !ref.current?.open) onClose() }} onKeyDown={(event) => {
      if (event.key !== 'Tab') return
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')).filter((element) => element.getClientRects().length > 0)
      const first = controls[0]
      const last = controls[controls.length - 1]
      if (!first) { event.preventDefault(); event.currentTarget.focus() }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }}>
      <header className="ui-dialog-head"><h2 id={titleId}>{title}</h2><IconButton label="Close dialog" data-modal-close onClick={onClose}><X aria-hidden="true" /></IconButton></header>
      <div className="ui-dialog-body">{description && <p className="ui-dialog-description" id={descriptionId}>{description}</p>}{children}</div>
      {footer && <footer className="ui-dialog-footer">{footer}</footer>}
    </dialog>
  )
}

export function Dialog(props: DialogProps) {
  return <ModalFrame {...props} />
}

export function Drawer(props: Omit<DialogProps, 'size'>) {
  return <ModalFrame {...props} drawer />
}
