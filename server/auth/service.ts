import { APIError } from 'better-auth'
import type { PrismaClient } from '../../src/generated/prisma/client.ts'
import type { AuthProvider } from './provider.ts'
import { safeContext, staffContext } from './context.ts'
import { AuthFailure } from './errors.ts'

export function providerHeaders(incoming: { cookie?: string; origin?: string; 'user-agent'?: string }) {
  const headers = new Headers()
  for (const name of ['cookie', 'origin', 'user-agent'] as const) {
    if (incoming[name]) headers.set(name, incoming[name])
  }
  return headers
}

export function createAuthService(db: PrismaClient, auth: AuthProvider) {
  async function audit(action: string, session: { id: string; userId: string }) {
    await db.auditEvent.create({ data: { actorId: session.userId, action, targetType: 'AuthSession', targetId: session.id } })
  }
  async function outcome(action: string, session: { id: string; userId: string }) {
    try { await audit(action, session) }
    catch { console.error('auth_outcome_audit_failed') }
  }
  async function revoke(session: { id: string; userId: string }, all: boolean, headers: Headers) {
    await audit('auth.revocation.requested', session)
    await db.authSession.deleteMany({ where: all ? { userId: session.userId } : { id: session.id } })
    const result = await auth.api.signOut({ headers, returnHeaders: true })
    await outcome('auth.revocation.completed', session)
    return result.headers
  }
  async function current(headers: Headers) {
    const result = await auth.api.getSession({ headers, returnHeaders: true })
    if (!result.response) return { context: null, headers: result.headers }
    const session = result.response.session
    const staff = await staffContext(db, session.userId)
    if (!staff) {
      const person = await db.user.findUnique({ where: { id: session.userId }, select: { accountStatus: true } })
      const expired = await revoke(session, person?.accountStatus === 'INACTIVE', headers)
      return { context: null, headers: expired }
    }
    return { context: safeContext(staff, session.expiresAt), headers: result.headers }
  }
  async function signIn(email: string, password: string, headers: Headers, emailKey?: string) {
    let result
    try { result = await auth.api.signInEmail({ body: { email, password }, headers, returnHeaders: true }) }
    catch (error) {
      if (error instanceof APIError && error.body?.code === 'INVALID_EMAIL_OR_PASSWORD') throw new AuthFailure('INVALID_CREDENTIALS', 401)
      if (error instanceof APIError && error.body?.code === 'INVALID_EMAIL') throw new AuthFailure('INVALID_INPUT', 400)
      if (error instanceof APIError && error.body?.code === 'ACCOUNT_UNAVAILABLE') throw new AuthFailure('ACCOUNT_UNAVAILABLE', 403)
      throw error
    }
    const session = await db.authSession.findUnique({ where: { token: result.response.token } })
    if (!session) throw new AuthFailure('SERVICE_UNAVAILABLE', 503)
    try {
      const staff = await staffContext(db, session.userId)
      if (!staff) throw new AuthFailure('ACCOUNT_UNAVAILABLE', 403)
      const context = safeContext(staff, session.expiresAt)
      await db.$transaction(async (tx) => {
        if (emailKey) await tx.loginThrottle.deleteMany({ where: { key: emailKey } })
        await tx.auditEvent.create({ data: { actorId: session.userId, action: 'auth.signin.completed', targetType: 'AuthSession', targetId: session.id } })
      }, { maxWait: 5000, timeout: 5000 })
      return { context, headers: result.headers }
    } catch (error) {
      // Cookies have not been issued. Retain requested evidence if cleanup fails.
      try {
        await audit('auth.revocation.requested', session)
        await db.authSession.deleteMany({ where: { id: session.id } })
        await outcome('auth.revocation.completed', session)
      } catch { console.error('auth_unissued_session_cleanup_failed') }
      throw error
    }
  }
  async function signOut(headers: Headers) {
    const result = await auth.api.getSession({ headers, returnHeaders: true })
    const session = result.response?.session
    if (session) await audit('auth.signout.requested', session)
    const signedOut = await auth.api.signOut({ headers, returnHeaders: true })
    // Better Auth intentionally catches deletion errors. Its response alone does
    // not establish revocation, so do not issue expiry cookies until checked.
    if (session && await db.authSession.findUnique({ where: { id: session.id }, select: { id: true } })) {
      throw new AuthFailure('SERVICE_UNAVAILABLE', 503)
    }
    if (session) await outcome('auth.signout.completed', session)
    return signedOut.headers
  }
  return { current, signIn, signOut }
}

export type AuthService = ReturnType<typeof createAuthService>
