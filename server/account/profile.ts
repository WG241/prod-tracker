import type { PrismaClient } from '../../src/generated/prisma/client.ts'
import { roleRoutes } from '../../src/features/auth/contracts.ts'
import type { SessionContext } from '../../src/features/auth/contracts.ts'
import type { ProfileResponse } from '../../src/features/profile/contracts.ts'
import { AuthFailure } from '../auth/errors.ts'
import { databaseClock } from '../db.ts'

export function readProfile(db: PrismaClient, context: SessionContext, sessionId: string): Promise<ProfileResponse> {
  const userId = context.user.id
  return db.$transaction(async (tx) => {
    const asOf = await databaseClock(tx)
    const session = await tx.authSession.findFirst({
      where: { id: sessionId, userId, expiresAt: { gt: asOf } },
      select: { id: true },
    })
    if (!session) throw new AuthFailure('SESSION_REQUIRED', 401)

    const user = await tx.user.findUnique({
      where: { id: userId },
      select: {
        name: true,
        email: true,
        accountStatus: true,
        emailRemindersEnabled: true,
        notificationPreference: { select: { emailRemindersEnabled: true, revision: true } },
        authIdentity: { select: {
          email: true,
          provisionedAt: true,
          accounts: {
            where: { userId, providerId: 'credential', accountId: userId, password: { not: null } },
            select: { id: true },
            take: 1,
          },
        } },
        assignments: {
          where: { effectiveTo: null, effectiveFrom: { lte: asOf } },
          select: {
            role: true, businessId: true, unitId: true, departmentLabel: true,
            business: { select: { name: true } },
            unit: { select: { name: true } },
            manager: { select: { name: true } },
          },
          take: 2,
        },
      },
    })
    const assignment = user?.assignments[0]
    const email = user?.email.trim().toLowerCase()
    if (!user || user.accountStatus !== 'ACTIVE' || !email || !user.authIdentity?.provisionedAt
      || user.authIdentity.email !== email || user.assignments.length !== 1 || !assignment) {
      throw new AuthFailure('ACCOUNT_UNAVAILABLE', 403)
    }
    if (email !== context.user.email.trim().toLowerCase() || assignment.role !== context.role
      || assignment.businessId !== context.businessId || assignment.unitId !== context.unitId) {
      throw new AuthFailure('FORBIDDEN', 403)
    }
    const groupScope = assignment.role === 'EXECUTIVE' || assignment.role === 'HR_ADMIN'
    const business = groupScope ? 'Workforce Group' : assignment.business?.name
    if (!business) throw new AuthFailure('ACCOUNT_UNAVAILABLE', 403)

    return {
      asOf: asOf.toISOString(),
      timezone: 'Africa/Lagos',
      person: {
        name: user.name?.trim() || 'Staff member',
        email,
        role: assignment.role,
        roleLabel: roleRoutes[assignment.role].label,
        business,
        unit: assignment.unit?.name ?? (assignment.departmentLabel?.trim() || null),
        manager: assignment.role === 'EMPLOYEE' ? assignment.manager?.name?.trim() || null : null,
        status: 'Active',
      },
      preference: user.notificationPreference ?? { emailRemindersEnabled: user.emailRemindersEnabled, revision: 0 },
      canChangePassword: user.authIdentity.accounts.length === 1,
    }
  }, { isolationLevel: 'RepeatableRead', maxWait: 5000, timeout: 15000 })
}
