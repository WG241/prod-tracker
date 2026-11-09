import { useEffect, useEffectEvent, useId, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { AnnounceEvent } from '../../components/accessibility/Announcements.tsx'
import { useFormValidation } from '../../components/accessibility/useFormValidation.ts'
import { Button } from '../../components/ui/Button.tsx'
import { Dialog } from '../../components/ui/Dialog.tsx'
import { InputField } from '../../components/ui/Field.tsx'
import { validPassword, wellFormed } from '../auth/contracts.ts'
import { useRetryDelay } from '../auth/useRetryDelay.ts'
import { AccountRequestError, writePassword } from './api.ts'
import type { PasswordInput } from './contracts.ts'

const passwordHelp = 'Use 6 to 128 characters with an uppercase letter (A–Z) and a number (0–9).'
type PasswordFeedback = { fields?: Partial<Record<keyof PasswordInput, string>>; message?: string }

function PasswordForm({ formId, locked, onSubmit }: {
  formId: string
  locked: boolean
  onSubmit: (input: PasswordInput) => Promise<PasswordFeedback | undefined>
}) {
  const current = useRef<HTMLInputElement>(null)
  const next = useRef<HTMLInputElement>(null)
  const confirm = useRef<HTMLInputElement>(null)
  const mounted = useRef(false)
  const [notice, setNotice] = useState({ attempt: 0, message: '' })
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const validation = useFormValidation({
    fields: [
      { name: 'currentPassword', label: 'Current password', ref: current },
      { name: 'newPassword', label: 'New password', ref: next },
      { name: 'confirmPassword', label: 'Confirm password', ref: confirm },
    ],
    validate: () => {
      const currentPassword = current.current?.value ?? ''
      const newPassword = next.current?.value ?? ''
      const confirmation = confirm.current?.value ?? ''
      const currentValid = currentPassword && !currentPassword.includes('\0') && wellFormed(currentPassword) && [...currentPassword].length <= 256
      return {
        currentPassword: currentValid ? undefined : 'Enter your current password.',
        newPassword: !validPassword(newPassword) ? passwordHelp
          : newPassword === currentPassword ? 'Choose a password different from your current password.' : undefined,
        confirmPassword: !confirmation ? 'Confirm your new password.'
          : confirmation !== newPassword ? 'Your passwords don’t match.' : undefined,
      }
    },
  })

  return <form id={formId} noValidate onSubmit={async (event) => {
    event.preventDefault()
    if (locked) return
    setNotice((previous) => ({ ...previous, message: '' }))
    if (!validation.submit()) return
    const result = await onSubmit({
      currentPassword: current.current?.value ?? '',
      newPassword: next.current?.value ?? '',
      confirmPassword: confirm.current?.value ?? '',
    })
    if (!result || !mounted.current) return
    if (result.fields) validation.reportErrors(result.fields)
    else if (result.message) setNotice((previous) => ({ attempt: previous.attempt + 1, message: result.message! }))
  }}>
    <InputField ref={current} label="Current password" type="password" autoComplete="current-password" required readOnly={locked} error={validation.errors.currentPassword} onChange={() => {
      validation.revalidate('currentPassword')
      validation.revalidate('newPassword')
    }} />
    <InputField ref={next} label="New password" type="password" autoComplete="new-password" required readOnly={locked} description={passwordHelp} error={validation.errors.newPassword} onChange={() => {
      validation.revalidate('newPassword')
      validation.revalidate('confirmPassword')
    }} />
    <InputField ref={confirm} label="Confirm password" type="password" autoComplete="new-password" required readOnly={locked} error={validation.errors.confirmPassword} onChange={() => validation.revalidate('confirmPassword')} />
    {notice.message && <>
      <p className="auth-banner auth-error">{notice.message}</p>
      <AnnounceEvent event={{ id: `${formId}:password:${notice.attempt}`, message: notice.message, intent: 'alert' }} />
    </>}
  </form>
}

export function PasswordDialog({ description, onClose, onPending, onReauthenticate, returnFocusRef }: {
  description?: string
  onClose: () => void
  onPending?: (pending: boolean) => void
  onReauthenticate?: (confirmed: boolean) => void
  returnFocusRef: RefObject<HTMLButtonElement | null>
}) {
  const formId = useId()
  const [busy, setBusy] = useState(false)
  const retry = useRetryDelay()
  const operation = useRef<AbortController | null>(null)

  function dismiss() {
    if (operation.current) {
      operation.current.abort()
      operation.current = null
      onReauthenticate?.(false)
    }
    onClose()
  }
  const backgroundDismiss = useEffectEvent(dismiss)
  useEffect(() => {
    const onBackground = () => backgroundDismiss()
    const onVisibility = () => { if (document.hidden) backgroundDismiss() }
    window.addEventListener('blur', onBackground)
    window.addEventListener('popstate', onBackground)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('blur', onBackground)
      window.removeEventListener('popstate', onBackground)
      document.removeEventListener('visibilitychange', onVisibility)
      operation.current?.abort()
      operation.current = null
    }
  }, [])

  async function submit(input: PasswordInput): Promise<PasswordFeedback | undefined> {
    if (!onReauthenticate) { onClose(); return }
    if (operation.current || retry.seconds) return
    const controller = new AbortController()
    operation.current = controller
    onPending?.(true)
    setBusy(true)
    try {
      await writePassword(input, controller.signal)
      if (operation.current !== controller) return
      onClose()
      onReauthenticate(true)
    } catch (failure) {
      if (operation.current !== controller) return
      if (failure instanceof AccountRequestError && (failure.status === 400 || failure.status === 429 || failure.code === 'CREDENTIAL_UNAVAILABLE')) {
        if (failure.retryAfter) retry.start(failure.retryAfter)
        return { fields: failure.fields, message: failure.message }
      }
      onClose()
      onReauthenticate(false)
    } finally {
      if (operation.current === controller) {
        operation.current = null
        onPending?.(false)
        setBusy(false)
      }
    }
  }

  return <Dialog open title="Change password" description={description} onClose={dismiss} returnFocusRef={returnFocusRef} footer={<>
    <Button className="profile-password-cancel" onClick={dismiss}>Cancel</Button>
    <Button className="profile-password-submit" variant="primary" type="submit" form={formId} busy={busy || retry.seconds > 0}>
      {busy ? 'Updating password…' : retry.seconds ? `Update password (${retry.seconds}s)` : 'Update password'}
    </Button>
  </>}>
    <PasswordForm formId={formId} locked={busy || retry.seconds > 0} onSubmit={submit} />
  </Dialog>
}
