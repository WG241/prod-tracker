import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { AnnounceEvent } from '../../components/accessibility/Announcements.tsx'
import { BrandLoader } from '../../components/ui/BrandLoader.tsx'
import { Button } from '../../components/ui/Button.tsx'
import { Card } from '../../components/ui/Card.tsx'
import { NoticeToast } from '../../components/ui/NoticeToast.tsx'
import type { SessionContext } from '../auth/contracts.ts'
import type { ProfileResponse } from './contracts.ts'
import { ProfileHeading, ProfilePage } from './ProfilePage.tsx'
import { PasswordDialog } from './PasswordDialog.tsx'
import { usePreferenceOperations } from './preference-operations.ts'
import type { PreferenceOperations } from './preference-operations.ts'

type ProfileResult = { attempt: number; data: ProfileResponse } | { attempt: number; error: string }
const loadError = 'Your profile could not be loaded. Please try again.'

export function AccountProfile({ context, headingRef, onSessionInvalid, onSignOut, signingOut, signOutRetrySeconds, preferenceOperations, onPasswordPending, onReauthenticate }: {
  context: SessionContext
  headingRef: RefObject<HTMLHeadingElement | null>
  onSessionInvalid: () => void
  onSignOut: () => void
  signingOut: boolean
  signOutRetrySeconds: number
  preferenceOperations: PreferenceOperations
  onPasswordPending: (pending: boolean) => void
  onReauthenticate: (confirmed: boolean) => void
}) {
  const [result, setResult] = useState<ProfileResult | null>(null)
  const [attempt, setAttempt] = useState(0)
  const retryButton = useRef<HTMLButtonElement>(null)
  const preferenceControl = useRef<HTMLInputElement>(null)
  const preferenceRetry = useRef<HTMLButtonElement>(null)
  const reloadLatest = useRef<HTMLButtonElement>(null)
  const retryWasFocused = useRef(false)
  const passwordOpener = useRef<HTMLButtonElement>(null)
  const [passwordOpen, setPasswordOpen] = useState(false)
  const operations = usePreferenceOperations(preferenceOperations)
  const operation = operations.record
  const [retryRemaining, setRetryRemaining] = useState(0)
  const focusHeading = useRef(false)
  const invalidateSession = useEffectEvent(onSessionInvalid)
  const expectedEmail = context.user.email.trim().toLowerCase()
  const expectedRole = context.role

  useEffect(() => {
    const update = () => setRetryRemaining(Math.max(0, Math.ceil(((operation?.retryUntil ?? 0) - Date.now()) / 1000)))
    update()
    if (!operation?.retryUntil) return
    const timer = window.setInterval(update, 1000)
    return () => window.clearInterval(timer)
  }, [operation?.retryUntil])

  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      try {
        const response = await fetch('/api/account/profile', {
          credentials: 'same-origin', cache: 'no-store',
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]),
        })
        if (controller.signal.aborted) return
        if (response.status === 401) { invalidateSession(); return }
        if (response.status === 403) {
          const failure = await response.json().catch(() => null)
          if (controller.signal.aborted) return
          if (failure?.error?.code === 'FORBIDDEN') invalidateSession()
          else setResult({ attempt, error: 'Your account is not available. Contact HR.' })
          return
        }
        if (!response.ok) throw new Error(loadError)
        const data = await response.json() as ProfileResponse
        if (controller.signal.aborted) return
        if (typeof data?.person?.email !== 'string' || typeof data.preference?.emailRemindersEnabled !== 'boolean') throw new Error(loadError)
        if (data.person.email !== expectedEmail || data.person.role !== expectedRole) {
          invalidateSession()
          return
        }
        focusHeading.current = retryButton.current !== null && document.activeElement === retryButton.current
        setResult({ attempt, data })
      } catch {
        if (!controller.signal.aborted) setResult({ attempt, error: loadError })
      }
    })()
    return () => controller.abort()
  }, [attempt, expectedEmail, expectedRole])

  useLayoutEffect(() => {
    if (focusHeading.current && result && 'data' in result) {
      focusHeading.current = false
      headingRef.current?.focus()
    }
  }, [headingRef, result])

  useLayoutEffect(() => {
    if (!retryWasFocused.current || operation?.phase === 'saving') return
    if (document.activeElement === document.body || document.activeElement === preferenceRetry.current) {
      if (operation?.phase === 'stale') reloadLatest.current?.focus()
      if (operation?.phase === 'saved') preferenceControl.current?.focus()
    }
    retryWasFocused.current = false
  }, [operation])

  const loaded = result && 'data' in result && result.attempt === attempt ? result.data : null
  const receipt = operation?.result?.preference
  const preference = loaded && (receipt && receipt.revision >= loaded.preference.revision ? receipt : loaded.preference)
  const retainedIntent = operations.locked && operation ? operation.input.emailRemindersEnabled : undefined
  const saving = operation?.phase === 'saving'
  const canRetry = operation?.phase === 'uncertain' || operation?.phase === 'rejected' || (saving && operation.attempt > 1)
  const preferenceFeedback = operation && (saving || operation.message) ? <div className="profile-preference-feedback">
    {saving ? <>
      <p className="ui-help">Saving email preference…</p>
      <AnnounceEvent event={{ id: `preference-saving:${operation.id}:${operation.attempt}`, message: 'Saving email preference…', intent: 'status' }} />
    </> : operation.message && <>
      <p className="auth-banner auth-error">{operation.message}</p>
      <AnnounceEvent event={{ id: `preference-error:${operation.id}:${operation.attempt}`, message: operation.message, intent: 'alert' }} />
    </>}
    {canRetry && <Button ref={preferenceRetry} size="small" busy={saving || retryRemaining > 0} onClick={(event) => {
      retryWasFocused.current = document.activeElement === event.currentTarget
      void operations.send(null, onSessionInvalid)
    }}>
      {retryRemaining ? `Retry (${retryRemaining}s)` : 'Retry'}
    </Button>}
    {operation.phase === 'stale' && <Button ref={reloadLatest} size="small" onClick={() => {
      headingRef.current?.focus()
      operations.discard()
      setAttempt((value) => value + 1)
    }}>Reload latest</Button>}
  </div> : null

  return <>
    <ProfileHeading headingRef={headingRef} />
    {result && 'error' in result ? <Card>
        <p className="auth-banner auth-error">{result.error}</p>
        <AnnounceEvent event={{ id: `profile-load-error:${result.attempt}`, message: result.error, intent: 'alert' }} />
        <Button ref={retryButton} busy={attempt !== result.attempt} onClick={() => setAttempt((value) => value + 1)}>Retry</Button>
      </Card> : loaded && preference ? <ProfilePage
        person={loaded.person}
        emailRemindersEnabled={retainedIntent ?? preference.emailRemindersEnabled}
        onEmailRemindersChange={(emailRemindersEnabled) => void operations.send({ emailRemindersEnabled, expectedRevision: preference.revision }, onSessionInvalid)}
        preferenceLocked={operations.locked || retryRemaining > 0}
        preferenceBusy={operation?.phase === 'saving'}
        preferenceFeedback={preferenceFeedback}
        preferenceControl={preferenceControl}
        passwordOpener={passwordOpener}
        onChangePassword={loaded.canChangePassword ? () => setPasswordOpen(true) : undefined}
        passwordUnavailableReason={loaded.canChangePassword ? undefined : 'Contact HR to change your password.'}
        onSignOut={onSignOut}
        signingOut={signingOut}
        signOutRetrySeconds={signOutRetrySeconds}
      /> : <div className="workspace-content-fallback"><BrandLoader label="Loading profile…" /></div>}
    {operation?.phase === 'saved' && operation.savedAt && loaded
      ? <NoticeToast key={operation.id} id={operation.id} expiresAt={operation.savedAt + 6000} message="Email preference saved." /> : null}
    {passwordOpen && loaded && <PasswordDialog
      returnFocusRef={passwordOpener}
      onClose={() => setPasswordOpen(false)}
      onPending={onPasswordPending}
      onReauthenticate={onReauthenticate}
    />}
  </>
}
