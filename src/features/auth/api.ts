import { roleRoutes, routeContext } from './contracts.ts'
import type { SessionContext } from './contracts.ts'

export class SessionError extends Error {
  readonly status: number
  readonly retryAfter: number
  constructor(status: number, message: string, retryAfter = 0) {
    super(message)
    this.status = status
    this.retryAfter = retryAfter
  }
}

function decodeContext(value: unknown): SessionContext {
  if (!value || typeof value !== 'object' || !('role' in value) || typeof value.role !== 'string' || !Object.hasOwn(roleRoutes, value.role)) throw new Error('Invalid session response')
  const context = value as SessionContext
  if (!context.user || typeof context.user.id !== 'string' || typeof context.user.name !== 'string'
    || typeof context.user.email !== 'string' || !context.session || typeof context.session.expiresAt !== 'string'
    || !Number.isFinite(Date.parse(context.session.expiresAt))
    || !(context.businessId === null || typeof context.businessId === 'string')
    || !(context.unitId === null || typeof context.unitId === 'string')) throw new Error('Invalid session response')
  const routes = routeContext(context.role)
  return { user: { id: context.user.id, name: context.user.name, email: context.user.email }, role: context.role, businessId: context.businessId, unitId: context.unitId, ...routes, session: { expiresAt: context.session.expiresAt } }
}

export async function authRequest(path: '/api/session' | '/api/auth/sign-in' | '/api/auth/sign-out', body?: object, signal?: AbortSignal) {
  const response = await fetch(path, {
    method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000),
  })
  if (!response.ok) {
    const failure: unknown = await response.json().catch(() => null)
    const forbidden = failure && typeof failure === 'object' && 'error' in failure
      && failure.error && typeof failure.error === 'object' && 'code' in failure.error
      && failure.error.code === 'FORBIDDEN'
    const messages: Record<number, string> = {
      400: 'Check your email and password.', 401: path === '/api/auth/sign-in' ? 'Email or password is incorrect.' : 'Please sign in to continue.',
      403: forbidden ? 'You do not have access to that page.' : 'Your account is not available. Contact HR.', 429: 'Too many attempts. Please wait and try again.',
    }
    const retry = Number(response.headers.get('retry-after'))
    throw new SessionError(response.status, messages[response.status] ?? 'The service is unavailable. Please try again.', Number.isFinite(retry) ? Math.max(0, retry) : 0)
  }
  return response.status === 204 ? null : decodeContext(await response.json())
}
