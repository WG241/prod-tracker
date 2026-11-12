import type { Prisma, PrismaClient } from '../../src/generated/prisma/client.ts'
import type { SessionContext } from '../../src/features/auth/contracts.ts'
import { databaseClock, databaseErrorCode } from '../db.ts'
import { staffContext } from './context.ts'
import { AuthFailure } from './errors.ts'

const writeBounds = { isolationLevel: 'ReadCommitted', maxWait: 5000, timeout: 15000 } as const
type Tx = Prisma.TransactionClient
export type Actor = { context: SessionContext; sessionId: string }

export async function lockOwner(tx: Tx, { context, sessionId }: Actor, operation: 'password' | 'preference' | 'notification') {
  const passwordChange = operation === 'password'
  const id = context.user.id
  // The same owner mutex as Employee writes and sign-in completion. The
  // AuthUser update lock excludes concurrent AuthSession foreign key inserts.
  await tx.$queryRaw`SELECT id FROM "User" WHERE id=${id} FOR UPDATE`
  if (passwordChange) {
    await tx.$queryRaw`SELECT id FROM "AuthSession" WHERE id=${sessionId} AND "userId"=${id} FOR UPDATE`
    await tx.$queryRaw`SELECT id FROM "AuthUser" WHERE id=${id} FOR UPDATE`
  } else {
    await tx.$queryRaw`SELECT id FROM "AuthSession" WHERE id=${sessionId} AND "userId"=${id} FOR SHARE`
    await tx.$queryRaw`SELECT id FROM "AuthUser" WHERE id=${id} FOR SHARE`
  }
  await tx.$queryRaw`SELECT id FROM "EmploymentAssignment" WHERE "userId"=${id} AND "effectiveTo" IS NULL ORDER BY id FOR SHARE`
  if (passwordChange) {
    await tx.$queryRaw`SELECT id FROM "AuthAccount" WHERE "userId"=${id} AND "accountId"=${id} AND "providerId"='credential' FOR UPDATE`
  } else if (operation === 'preference') {
    await tx.$queryRaw`SELECT id FROM "AuthAccount" WHERE "userId"=${id} AND "accountId"=${id} AND "providerId"='credential' FOR SHARE`
    await tx.$queryRaw`SELECT "userId" FROM "NotificationPreference" WHERE "userId"=${id} FOR UPDATE`
  }
}

export async function owner(tx: Tx, { context, sessionId }: Actor) {
  const userId = context.user.id
  const at = await databaseClock(tx)
  if (!await tx.authSession.findFirst({ where: { id: sessionId, userId, expiresAt: { gt: at } }, select: { id: true } })) {
    throw new AuthFailure('SESSION_REQUIRED', 401)
  }
  const staff = await staffContext(tx, userId, true, at)
  if (!staff) throw new AuthFailure('ACCOUNT_UNAVAILABLE', 403)
  if (staff.assignment.role !== context.role || staff.assignment.businessId !== context.businessId || staff.assignment.unitId !== context.unitId
    || staff.person.email.trim().toLowerCase() !== context.user.email.trim().toLowerCase()) throw new AuthFailure('FORBIDDEN', 403)
  return { staff, at, userId }
}

export async function retryKnownRollback<T>(write: () => Promise<T>, retry?: (error: unknown) => boolean) {
  for (let attempt = 1; ; attempt++) {
    try { return await write() }
    catch (error) {
      if (attempt >= 3 || (!retry?.(error) && !['40001', '40P01', '23505', 'P2002', 'P2034'].includes(databaseErrorCode(error) ?? ''))) throw error
    }
  }
}

export function withKnownRollbackRetry<T>(db: PrismaClient, write: (tx: Tx) => Promise<T>, retry?: (error: unknown) => boolean) {
  return retryKnownRollback(() => db.$transaction(write, writeBounds), retry)
}
