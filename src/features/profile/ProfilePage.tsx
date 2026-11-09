import type { ReactNode, RefObject } from 'react'
import { CircleCheck, LockKeyhole, LogOut } from 'lucide-react'
import { Avatar } from '../../components/ui/Avatar.tsx'
import { Badge } from '../../components/ui/Badge.tsx'
import { Button } from '../../components/ui/Button.tsx'
import { Card } from '../../components/ui/Card.tsx'
import { CheckboxField } from '../../components/ui/Field.tsx'
import type { ProfilePerson } from './contracts.ts'
import './profile.css'

export function ProfileHeading({ headingRef }: { headingRef: RefObject<HTMLHeadingElement | null> }) {
  return <header className="workspace-page-heading">
    <h1 ref={headingRef} tabIndex={-1}>Your profile</h1>
    <p>Your account details and notification preferences.</p>
  </header>
}

export function ProfilePage({
  person, emailRemindersEnabled, onEmailRemindersChange, onChangePassword, onSignOut, passwordOpener,
  passwordUnavailableReason, signingOut, signOutRetrySeconds = 0, preferenceLocked, preferenceBusy, preferenceFeedback, preferenceControl,
}: {
  person: ProfilePerson
  emailRemindersEnabled: boolean
  onEmailRemindersChange?: (enabled: boolean) => void
  onChangePassword?: () => void
  passwordUnavailableReason?: string
  onSignOut?: () => void
  signingOut?: boolean
  signOutRetrySeconds?: number
  passwordOpener?: RefObject<HTMLButtonElement | null>
  preferenceLocked?: boolean
  preferenceBusy?: boolean
  preferenceFeedback?: ReactNode
  preferenceControl?: RefObject<HTMLInputElement | null>
}) {
  const details = [
    ['Full name', person.name],
    ['Email', person.email],
    ['Role', person.roleLabel],
    ['Business', person.business],
    ['Unit', person.unit],
    ['Line manager', person.manager],
  ]

  return <div className="profile-columns">
      <section className="ui-card" aria-labelledby="profile-identity-heading">
        <div className="ui-card-head">
          <div className="profile-identity">
            <Avatar name={person.name} />
            <div>
              <h2 id="profile-identity-heading">{person.name}</h2>
              <p>{person.roleLabel}</p>
            </div>
          </div>
          <Badge status={person.status} icon={<CircleCheck aria-hidden="true" />} />
        </div>
        <div className="ui-card-body">
          <dl className="profile-details">
            {details.map(([label, value]) => <div key={label}>
              <dt>{label}</dt><dd>{value ?? '—'}</dd>
            </div>)}
          </dl>
          <p className="ui-help">Contact HR if any of these details need to change.</p>
        </div>
      </section>
      <div className="profile-side">
        <Card title="Notifications & security">
          <div className="profile-preference">
            <CheckboxField
              label="Email reminders"
              ref={preferenceControl}
              checked={emailRemindersEnabled}
              disabled={!onEmailRemindersChange}
              aria-disabled={preferenceLocked || undefined}
              aria-busy={preferenceBusy || undefined}
              description={onEmailRemindersChange ? 'In-app notifications are always on.' : 'In-app notifications are always on. Email reminders are read only for now.'}
              onClick={(event) => { if (preferenceLocked) event.preventDefault() }}
              onChange={onEmailRemindersChange ? (event) => { if (!preferenceLocked) onEmailRemindersChange(event.currentTarget.checked) } : undefined}
            />
            {preferenceFeedback}
          </div>
          <Button className="profile-action" ref={passwordOpener} disabled={!onChangePassword} onClick={onChangePassword}
            aria-describedby={passwordUnavailableReason ? 'profile-password-unavailable' : undefined}><LockKeyhole aria-hidden="true" />Change password</Button>
          {passwordUnavailableReason && <p className="ui-help" id="profile-password-unavailable">{passwordUnavailableReason}</p>}
        </Card>
        <Card>
          <h2 className="profile-session-heading">End this session</h2>
          <p className="ui-help">You can sign back in at any time.</p>
          <Button className="profile-action" disabled={!onSignOut || signOutRetrySeconds > 0} busy={signingOut} onClick={onSignOut}>
            <LogOut aria-hidden="true" />{signingOut ? 'Signing out…' : signOutRetrySeconds ? `Sign out (${signOutRetrySeconds}s)` : 'Sign out'}
          </Button>
        </Card>
      </div>
  </div>
}
