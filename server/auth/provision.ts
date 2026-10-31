// Trusted operator process only. Never import this module from an HTTP handler.
import { randomUUID } from 'node:crypto'
import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import type { PrismaClient } from '../../src/generated/prisma/client.ts'
import type { AuthConfig } from './config.ts'
import { staffContext } from './context.ts'
import { validPassword } from '../../src/features/auth/contracts.ts'

export async function provision(db: PrismaClient, config: AuthConfig, id: string, password: string, options: { resume?: boolean; repair?: boolean } = {}) {
  if (!validPassword(password)) throw new Error('Password must be 6 through 128 characters and include an uppercase letter and a number')
  const staff = await staffContext(db, id, false)
  if (!staff || !staff.person.name?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(staff.person.email)
    || staff.person.email !== staff.person.email.trim().toLowerCase()) throw new Error('Staff record is not eligible for provisioning')
  const existing = staff.person.authIdentity
  if (existing?.provisionedAt) {
    if (options.repair) throw new Error('A ready identity cannot be repaired')
    return 'already provisioned'
  }
  if (existing && options.repair) {
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "AuthUser" WHERE id=${id} FOR UPDATE`
      const identity = await tx.authUser.findUnique({ where: { id } })
      if (!identity || identity.provisionedAt || await tx.authAccount.count({ where: { userId: id } })
        || await tx.authSession.count({ where: { userId: id } })
        || await tx.auditEvent.count({ where: { targetType: 'AuthUser', targetId: id, action: 'auth.credential.provisioned' } })) {
        throw new Error('Repair refused, identity is not an incomplete pending record')
      }
      await tx.auditEvent.create({ data: { actorId: null, action: 'auth.credential.repair.requested', targetType: 'AuthUser', targetId: id, after: { source: 'trusted-operator-command' } } })
      await tx.authUser.delete({ where: { id } })
    }, { maxWait: 5000, timeout: 5000 })
  } else if (existing && !options.resume) throw new Error('Pending identity requires explicit resume or guarded repair')
  const auth = betterAuth({
    appName: 'Workforce operator', secret: config.secret, baseURL: config.origin, trustedOrigins: [config.origin],
    database: prismaAdapter(db, { provider: 'postgresql', transaction: true }),
    user: { modelName: 'authUser' }, account: { modelName: 'authAccount', accountLinking: { enabled: false } },
    session: { modelName: 'authSession' }, verification: { modelName: 'authVerification' },
    emailAndPassword: { enabled: true, autoSignIn: false, minPasswordLength: 6, maxPasswordLength: 256 },
    advanced: { database: { generateId: ({ model }) => model === 'authUser' || model === 'user' ? id : randomUUID() } },
    logger: { disabled: true },
    databaseHooks: { user: { create: { before: async (user) => ({ data: { ...user, id, email: staff.person.email, name: staff.person.name!.trim() } }) } } },
  })
  if (existing && options.resume && !options.repair) {
    if (existing.email !== staff.person.email) throw new Error('Pending identity email does not match staff')
    const account = await db.authAccount.findUnique({ where: { providerId_accountId: { providerId: 'credential', accountId: id } } })
    const context = await auth.$context
    if (account?.userId !== id || !account.password || !await context.password.verify({ hash: account.password, password })) {
      throw new Error('Pending credential verification failed')
    }
  } else {
    if (options.resume && !existing) throw new Error('No pending identity to resume')
    await auth.api.signUpEmail({ body: { email: staff.person.email, name: staff.person.name.trim(), password } })
  }
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${id} FOR UPDATE`
    await tx.$queryRaw`SELECT id FROM "AuthUser" WHERE id=${id} FOR UPDATE`
    const person = await tx.user.findUnique({ where: { id }, include: { assignments: { where: { effectiveTo: null, effectiveFrom: { lte: new Date() } }, take: 2 }, authIdentity: true } })
    const identity = person?.authIdentity
    if (identity?.provisionedAt) return
    const account = await tx.authAccount.findUnique({ where: { providerId_accountId: { providerId: 'credential', accountId: id } } })
    if (!person || person.accountStatus !== 'ACTIVE' || person.assignments.length !== 1 || !identity
      || identity.email !== person.email.trim().toLowerCase() || account?.userId !== id || !account.password?.trim()) {
      throw new Error('Activation failed, pending identity remains unusable')
    }
    await tx.$executeRaw`UPDATE "AuthUser" SET "provisionedAt"=clock_timestamp() WHERE id=${id}`
    await tx.auditEvent.create({ data: { actorId: null, action: 'auth.credential.provisioned', targetType: 'AuthUser', targetId: id, after: { source: 'trusted-operator-command' } } })
  }, { maxWait: 5000, timeout: 5000 })
  return 'provisioned'
}
