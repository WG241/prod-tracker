import { validPassword, wellFormed } from '../../src/features/auth/contracts.ts'
import type { EmailPreferenceInput, PasswordInput } from '../../src/features/profile/contracts.ts'

export class AccountFailure extends Error {
  readonly code: string
  readonly status: number
  readonly fields?: Partial<Record<keyof PasswordInput, string>>
  constructor(code: string, status: number, message: string, fields?: Partial<Record<keyof PasswordInput, string>>) {
    super(message)
    this.code = code
    this.status = status
    this.fields = fields
  }
}

export const invalidAccountRequest = () => new AccountFailure('INVALID_INPUT', 400, 'The account request is invalid.')

export function accountRequestId(value: string | undefined) {
  if (!value || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw invalidAccountRequest()
  return value.toLowerCase()
}

function exactFields(value: unknown, fields: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== fields.length || !fields.every((key) => Object.hasOwn(value, key))) throw invalidAccountRequest()
  return value as Record<string, unknown>
}

export function preferenceInput(value: unknown): EmailPreferenceInput {
  const { emailRemindersEnabled, expectedRevision } = exactFields(value, ['emailRemindersEnabled', 'expectedRevision'])
  if (typeof emailRemindersEnabled !== 'boolean' || typeof expectedRevision !== 'number'
    || !Number.isInteger(expectedRevision) || expectedRevision < 0 || expectedRevision > 2147483647) throw invalidAccountRequest()
  return { emailRemindersEnabled, expectedRevision }
}

export function passwordInput(value: unknown): PasswordInput {
  const { currentPassword, newPassword, confirmPassword } = exactFields(value, ['currentPassword', 'newPassword', 'confirmPassword'])
  if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || typeof confirmPassword !== 'string') throw invalidAccountRequest()
  const fields: Partial<Record<keyof PasswordInput, string>> = {}
  if (!currentPassword || currentPassword.includes('\0') || !wellFormed(currentPassword) || [...currentPassword].length > 256) fields.currentPassword = 'Enter your current password.'
  if (!validPassword(newPassword)) fields.newPassword = 'Use 6 to 128 characters with an uppercase letter (A–Z) and a number (0–9).'
  if (confirmPassword !== newPassword || !confirmPassword) fields.confirmPassword = 'Your passwords don’t match.'
  if (Object.keys(fields).length) throw new AccountFailure('INVALID_PASSWORD_FIELDS', 400, 'Check the password fields.', fields)
  return { currentPassword, newPassword, confirmPassword }
}
