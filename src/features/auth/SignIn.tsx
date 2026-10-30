import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowRight, Eye, EyeOff } from 'lucide-react'
import { Button, IconButton } from '../../components/ui/Button.tsx'
import { InputField } from '../../components/ui/Field.tsx'
import { Avatar } from '../../components/ui/Avatar.tsx'
import { Badge } from '../../components/ui/Badge.tsx'
import { authRequest, SessionError } from './api.ts'
import { validPassword, wellFormed } from './contracts.ts'
import { useRetryDelay } from './useRetryDelay.ts'

export function SignIn({ notice = '' }: { notice?: string }) {
  const [visible, setVisible] = useState(false)
  const [error, setError] = useState('')
  const [fieldError, setFieldError] = useState<'email' | 'password' | null>(null)
  const [busy, setBusy] = useState(false)
  const retry = useRetryDelay()
  const emailRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const inFlight = useRef(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (inFlight.current) return
    const email = emailRef.current?.value.trim().toLowerCase() ?? ''
    const password = passwordRef.current?.value ?? ''
    setFieldError(null)
    if (retry.seconds) return
    if (!email || email.length > 254 || !wellFormed(email) || !emailRef.current?.validity.valid) {
      setError('Enter your work email.'); setFieldError('email'); emailRef.current?.focus(); return
    }
    if (!validPassword(password)) {
      setError('Enter a password of 15 through 128 characters.'); setFieldError('password'); passwordRef.current?.focus(); return
    }
    inFlight.current = true
    setBusy(true)
    setError('')
    try {
      const context = await authRequest('/api/auth/sign-in', { email, password })
      if (!context) throw new Error('No session')
      window.location.replace(context.landingPath)
    } catch (failure) {
      setError(failure instanceof SessionError ? failure.message : 'The service is unavailable. Please try again.')
      if (failure instanceof SessionError && failure.retryAfter) retry.start(failure.retryAfter)
      if (passwordRef.current) passwordRef.current.value = ''
    } finally { inFlight.current = false; setBusy(false) }
  }

  return <main className="auth-login">
    <section className="auth-art" aria-label="Weekly performance">
      <div>
        <span className="wordmark">workforce<span className="brand-dot" /><small>GROUP</small></span>
        <p className="eyebrow">Weekly performance</p>
        <h2>Meaningful progress.<br />One week at a time.</h2>
        <p className="auth-art-description">Plan what matters, keep your team connected, and make good work visible.</p>
        <div className="auth-visual" aria-hidden="true">
          <div className="auth-visual-heading"><h3>Your week, in focus</h3><span>Week 43</span></div>
          <div className="auth-example"><Avatar name="Ada Okafor" /><div><b>Deliver the Lagos client proposal</b><p>A clear priority. A shared outcome.</p></div></div>
          <div className="auth-visual-foot"><span>Every step counts.</span><Badge status="In progress" /></div>
        </div>
      </div>
      <p className="auth-art-footer">Workforce Group · Connecting people to possibilities.</p>
    </section>
    <section className="auth-form-panel" aria-labelledby="sign-in-title">
      <div>
        <h1 id="sign-in-title">Welcome back</h1>
        <p className="auth-intro">Sign in to your weekly workspace.</p>
        {notice && <p className="auth-banner" role="status">{notice}</p>}
        <form onSubmit={(event) => void submit(event)} noValidate aria-busy={busy}>
          <InputField ref={emailRef} label="Work email" type="email" name="email" autoComplete="username" required maxLength={254} readOnly={busy} error={fieldError === 'email' ? 'Enter a valid work email.' : undefined} />
          <div className="auth-password">
            <InputField ref={passwordRef} label="Password" type={visible ? 'text' : 'password'} name="password" autoComplete="current-password" required maxLength={256} readOnly={busy} error={fieldError === 'password' ? 'Use 15 through 128 characters.' : undefined} />
            <IconButton label={visible ? 'Hide password' : 'Show password'} aria-pressed={visible} onClick={() => setVisible(!visible)}>{visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}</IconButton>
          </div>
          <div className="auth-recovery"><button type="button" disabled aria-describedby="recovery-unavailable">Forgot password?</button></div>
          <p className="ui-help" id="recovery-unavailable">Password recovery is not yet available. Contact HR.</p>
          {error && <p className="auth-banner auth-error" role="alert">{error}</p>}
          <Button type="submit" variant="primary" disabled={busy || retry.seconds > 0}>{busy ? 'Signing in…' : retry.seconds ? `Sign in (${retry.seconds}s)` : 'Sign in'}<ArrowRight aria-hidden="true" /></Button>
        </form>
      </div>
    </section>
  </main>
}
