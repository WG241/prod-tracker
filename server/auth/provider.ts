import { betterAuth, APIError } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import type { PrismaClient } from '../../src/generated/prisma/client.ts'
import type { AuthConfig } from './config.ts'
import { staffContext } from './context.ts'

export function createAuth(db: PrismaClient, config: AuthConfig) {
  return betterAuth({
    appName: 'Workforce',
    secret: config.secret,
    baseURL: config.origin,
    trustedOrigins: [config.origin],
    database: prismaAdapter(db, { provider: 'postgresql', transaction: true }),
    user: { modelName: 'authUser', changeEmail: { enabled: false }, deleteUser: { enabled: false } },
    account: { modelName: 'authAccount', accountLinking: { enabled: false } },
    verification: { modelName: 'authVerification' },
    session: { modelName: 'authSession', expiresIn: 604800, updateAge: 86400, cookieCache: { enabled: false } },
    emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 6, maxPasswordLength: 256 },
    advanced: {
      cookiePrefix: 'workforce',
      useSecureCookies: config.secure,
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', path: '/' },
      ipAddress: { ipAddressHeaders: [] },
    },
    logger: { disabled: true },
    databaseHooks: {
      user: { create: { before: async () => { throw new APIError('FORBIDDEN', { code: 'FORBIDDEN', message: 'Registration is unavailable.' }) } } },
      session: { create: { before: async (session) => {
        if (!await staffContext(db, session.userId)) throw new APIError('FORBIDDEN', { code: 'ACCOUNT_UNAVAILABLE', message: 'Your account is not available. Contact HR.' })
      } } },
    },
  })
}

export type AuthProvider = ReturnType<typeof createAuth>
