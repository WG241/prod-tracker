import type { EmailPreferenceInput, PasswordInput, PasswordReceipt, PreferenceReceipt } from './contracts.ts'

export class AccountRequestError extends Error {
  readonly status: number
  readonly code: string
  readonly fields?: Partial<Record<keyof PasswordInput, string>>
  readonly retryAfter: number
  constructor(
    status: number, code: string, message: string,
    fields?: Partial<Record<keyof PasswordInput, string>>, retryAfter = 0,
  ) {
    super(message)
    this.status = status
    this.code = code
    this.fields = fields
    this.retryAfter = retryAfter
  }
}

async function writeAccount<T>(path: string, requestId: string, body: object, signal?: AbortSignal): Promise<T> {
  const timeout = AbortSignal.timeout(20000)
  const response = await fetch(path, {
    method: 'POST', credentials: 'same-origin', cache: 'no-store',
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': requestId },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const data = await response.json().catch(() => null)
    const error = data?.error
    const retryAfter = Number(response.headers.get('Retry-After'))
    throw new AccountRequestError(
      response.status, typeof error?.code === 'string' ? error.code : '',
      typeof error?.message === 'string' ? error.message : 'The change could not be confirmed.',
      error?.fields, Number.isFinite(retryAfter) ? Math.max(0, retryAfter) : 0,
    )
  }
  return await response.json() as T
}

export async function writeEmailPreference(id: string, input: EmailPreferenceInput, signal: AbortSignal) {
  const result = await writeAccount<PreferenceReceipt & { replayed: boolean }>('/api/account/email-preference', id, input, signal)
  if (result?.version !== 1 || result.operation !== 'EMAIL_PREFERENCE' || result.requestId !== id
    || typeof result.changed !== 'boolean' || typeof result.replayed !== 'boolean'
    || typeof result.preference?.emailRemindersEnabled !== 'boolean' || !Number.isInteger(result.preference.revision)) throw new Error('Invalid preference receipt')
  return result
}

export async function writePassword(input: PasswordInput, signal: AbortSignal) {
  const id = crypto.randomUUID()
  const result = await writeAccount<PasswordReceipt>('/api/account/password', id, input, signal)
  if (result?.version !== 1 || result.operation !== 'PASSWORD_CHANGE' || result.requestId !== id || result.reauthRequired !== true) throw new Error('Invalid password receipt')
}
