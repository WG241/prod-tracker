import type { AuthRole } from '../auth/contracts.ts'

export type ProfilePerson = {
  name: string
  email: string
  roleLabel: string
  business: string
  unit: string | null
  manager: string | null
  status: 'Active'
}

export type ProfileResponse = {
  asOf: string
  timezone: 'Africa/Lagos'
  person: ProfilePerson & { role: AuthRole }
  preference: { emailRemindersEnabled: boolean; revision: number }
  canChangePassword: boolean
}

export type EmailPreferenceInput = { emailRemindersEnabled: boolean; expectedRevision: number }

export type PasswordInput = {
  currentPassword: string
  newPassword: string
  confirmPassword: string
}

export type PreferenceReceipt = {
  version: 1
  operation: 'EMAIL_PREFERENCE'
  requestId: string
  appliedAt: string
  changed: boolean
  preference: ProfileResponse['preference']
}

export type PasswordReceipt = {
  version: 1
  operation: 'PASSWORD_CHANGE'
  requestId: string
  appliedAt: string
  changed: true
  reauthRequired: true
}
