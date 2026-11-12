import { useRef, useState } from 'react'
import type { RefObject } from 'react'
import { ProfileHeading, ProfilePage } from '../features/profile/ProfilePage.tsx'
import { PasswordDialog } from '../features/profile/PasswordDialog.tsx'
import type { WorkspaceConfig, WorkspaceRole } from '../features/workspace/config.ts'

const units: Record<WorkspaceRole, string> = {
  Employee: 'Recruitment',
  'Line Manager': 'Recruitment',
  'Business Director': 'Workforce Resourcing',
  Executive: 'Workforce Group',
  'HR / Admin': 'People & Culture',
}

export function ProfilePreview({ workspace, headingRef }: {
  workspace: WorkspaceConfig
  headingRef: RefObject<HTMLHeadingElement | null>
}) {
  const { name, role } = workspace
  const [emailRemindersEnabled, setEmailRemindersEnabled] = useState(true)
  const [passwordOpen, setPasswordOpen] = useState(false)
  const passwordOpener = useRef<HTMLButtonElement>(null)

  return <>
    <ProfileHeading headingRef={headingRef} />
    <ProfilePage
      person={{
        name,
        email: `${name.toLowerCase().replaceAll(' ', '.')}@workforcegroup.com`,
        roleLabel: role,
        business: role === 'Executive' || role === 'HR / Admin' ? 'Workforce Group' : 'Workforce Resourcing',
        unit: units[role],
        manager: role === 'Employee' ? 'Tunde Bakare' : null,
        status: 'Active',
      }}
      emailRemindersEnabled={emailRemindersEnabled}
      onEmailRemindersChange={setEmailRemindersEnabled}
      passwordOpener={passwordOpener}
      onChangePassword={() => setPasswordOpen(true)}
    />
    {passwordOpen && <PasswordDialog
      description="Use sample values. Password changes are unavailable in this preview."
      returnFocusRef={passwordOpener}
      onClose={() => setPasswordOpen(false)}
    />}
  </>
}
