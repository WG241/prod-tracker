export const messages = {
  INVALID_INPUT: 'Check your email and password.',
  INVALID_CREDENTIALS: 'Email or password is incorrect.',
  ACCOUNT_UNAVAILABLE: 'Your account is not available. Contact HR.',
  SESSION_REQUIRED: 'Please sign in to continue.',
  FORBIDDEN: 'You do not have access to that page.',
  RATE_LIMITED: 'Too many attempts. Please wait and try again.',
  SERVICE_UNAVAILABLE: 'The service is unavailable. Please try again.',
} as const

export class AuthFailure extends Error {
  readonly status: number
  readonly code: keyof typeof messages
  readonly retryAfter?: number
  constructor(code: keyof typeof messages, status: number, retryAfter?: number) {
    super(messages[code])
    this.code = code
    this.status = status
    this.retryAfter = retryAfter
  }
}
