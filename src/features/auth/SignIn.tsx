import { useId, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowRight, Eye, EyeOff } from 'lucide-react'
import { Button, IconButton } from '../../components/ui/Button.tsx'
import { Dialog } from '../../components/ui/Dialog.tsx'
import { InputField } from '../../components/ui/Field.tsx'
import { Avatar } from '../../components/ui/Avatar.tsx'
import { Badge } from '../../components/ui/Badge.tsx'
import { authRequest, SessionError } from './api.ts'
import { validPassword, wellFormed } from './contracts.ts'
import { useRetryDelay } from './useRetryDelay.ts'
import { AnnounceEvent } from '../../components/accessibility/Announcements.tsx'
import { useAnnounce } from '../../components/accessibility/useAnnounce.ts'
import { useFormValidation } from '../../components/accessibility/useFormValidation.ts'

export function SignIn({ notice = '' }: { notice?: string }) {
  const [visible, setVisible] = useState(false)
  const [recoverySoonOpen, setRecoverySoonOpen] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const retry = useRetryDelay()
  const emailRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const passwordId = useId()
  const inFlight = useRef(false)
  const attempt = useRef(0)
  const announce = useAnnounce()
  const validation = useFormValidation({
    fields: [{ name: 'email', label: 'Work email', ref: emailRef }, { name: 'password', label: 'Password', ref: passwordRef }],
    validate: () => {
      const email = emailRef.current?.value.trim() ?? ''
      return {
        email: !email || email.length > 254 || !wellFormed(email) || !emailRef.current?.validity.valid ? 'Enter a valid work email.' : undefined,
        password: !validPassword(passwordRef.current?.value ?? '') ? 'Use at least 6 characters with an uppercase letter and a number.' : undefined,
      }
    },
  })

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (inFlight.current) return
    const email = emailRef.current?.value.trim().toLowerCase() ?? ''
    const password = passwordRef.current?.value ?? ''
    if (retry.seconds) return
    setError('')
    if (!validation.submit()) return
    inFlight.current = true
    setBusy(true)
    setError('')
    try {
      const context = await authRequest('/api/auth/sign-in', { email, password })
      if (!context) throw new Error('No session')
      window.location.replace(context.landingPath)
    } catch (failure) {
      const message = failure instanceof SessionError ? failure.message : 'The service is unavailable. Please try again.'
      setError(message)
      announce({ id: `sign-in-error:${++attempt.current}`, intent: 'alert', message })
      if (failure instanceof SessionError && failure.retryAfter) retry.start(failure.retryAfter)
      if (passwordRef.current) passwordRef.current.value = ''
    } finally { inFlight.current = false; setBusy(false) }
  }

  return <main className="auth-login">
    <section className="auth-art" aria-label="Weekly performance">
      <div>
        <span className="wordmark">workforce<span className="brand-dot" /><small>GROUP</small></span>
      </div>
      <div className="auth-art-copy">
        <p className="eyebrow">Weekly performance</p>
        <h2>Meaningful progress.<br />One week at a time.</h2>
        <p className="auth-art-description">Plan what matters, keep your team connected, and make good work visible.</p>
        <div className="auth-visual" aria-hidden="true">
          <div className="auth-visual-heading">
            <h3>Your week, in focus</h3>
            <span className="auth-week-pill">Week 43</span>
          </div>
          <div className="auth-example">
            <Avatar name="Ada Okafor" />
            <div className="auth-example-body">
              <h3>Deliver the Lagos client proposal</h3>
              <p>A clear priority. A shared outcome.</p>
            </div>
          </div>
          <div className="auth-visual-foot">
            <span>Every step counts.</span>
            <Badge status="In progress" />
          </div>
        </div>
      </div>
      <p className="auth-art-footer">Workforce Group · Connecting people to possibilities.</p>
    </section>
    <section className="auth-form-panel" aria-labelledby="sign-in-title">
      <div>
        <h1 id="sign-in-title">Welcome back</h1>
        <p className="auth-intro">Sign in to your weekly workspace.</p>
        {notice && <><p className="auth-banner">{notice}</p><AnnounceEvent event={{ id: `sign-in-notice:${notice}`, message: notice, intent: 'status' }} /></>}
        <form onSubmit={(event) => void submit(event)} noValidate aria-busy={busy}>
          <InputField ref={emailRef} label="Work email" type="email" name="email" autoComplete="username" required maxLength={254} readOnly={busy} error={validation.errors.email} onChange={() => validation.revalidate('email')} />
          <div className="ui-field">
            <label htmlFor={passwordId}>Password</label>
            <div className="auth-password">
              <input
                ref={passwordRef}
                id={passwordId}
                className="ui-control"
                type={visible ? 'text' : 'password'}
                name="password"
                autoComplete="current-password"
                required
                maxLength={256}
                readOnly={busy}
                aria-invalid={validation.errors.password ? true : undefined}
                aria-describedby={validation.errors.password ? `${passwordId}-error` : undefined}
                onChange={() => validation.revalidate('password')}
              />
              <IconButton label={visible ? 'Hide password' : 'Show password'} aria-pressed={visible} onClick={() => setVisible(!visible)}>{visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}</IconButton>
            </div>
            {validation.errors.password && <p className="ui-error" id={`${passwordId}-error`}>{validation.errors.password}</p>}
          </div>
          <div className="auth-recovery">
            <Button type="button" variant="ghost" size="small" onClick={() => setRecoverySoonOpen(true)}>Forgot password?</Button>
          </div>
          {error && <p className="auth-banner auth-error">{error}</p>}
          <Button type="submit" variant="primary" busy={busy} disabled={retry.seconds > 0}>{busy ? 'Signing in…' : retry.seconds ? `Sign in (${retry.seconds}s)` : 'Sign in'}<ArrowRight aria-hidden="true" /></Button>
        </form>
      </div>
      <Dialog
        open={recoverySoonOpen}
        title="Coming soon"
        size="small"
        description="Password recovery is coming soon in Feature 6."
        onClose={() => setRecoverySoonOpen(false)}
        footer={<Button variant="primary" onClick={() => setRecoverySoonOpen(false)}>Back to sign in</Button>}
      >
        {null}
      </Dialog>
    </section>
  </main>
}
