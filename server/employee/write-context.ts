import type { Prisma } from '../../src/generated/prisma/client.ts'
import type { SessionContext } from '../../src/features/auth/contracts.ts'
import { EmployeeFailure, weekProjection } from './calendar.ts'
import { employeePrincipal } from './reads.ts'

export type Tx = Prisma.TransactionClient
export async function lockPrincipal(tx: Tx, context: SessionContext, sessionId: string) {
  const id = context.user.id
  await tx.$queryRaw`SELECT id FROM "User" WHERE id=${id} FOR UPDATE`
  await tx.$queryRaw`SELECT id FROM "AuthSession" WHERE id=${sessionId} AND "userId"=${id} FOR SHARE`
  await tx.$queryRaw`SELECT id FROM "AuthUser" WHERE id=${id} FOR SHARE`
  await tx.$queryRaw`SELECT id FROM "EmploymentAssignment" WHERE "userId"=${id} ORDER BY id FOR SHARE`
  await tx.$queryRaw`SELECT id FROM "LeaveRecord" WHERE "userId"=${id} ORDER BY id FOR SHARE`
  await tx.$queryRaw`SELECT id FROM "TrackerSettings" WHERE id='workforce-group' FOR SHARE`
}
export async function principal(tx: Tx, context: SessionContext, sessionId: string, asOf: Date) {
  if (!await tx.authSession.findFirst({ where: { id: sessionId, userId: context.user.id, expiresAt: { gt: asOf } }, select: { id: true } })) throw new EmployeeFailure('SESSION_REQUIRED', 401)
  return employeePrincipal(tx, context, asOf)
}
export async function ensureWeek(tx: Tx, start: Date) {
  let week = await tx.workWeek.findUnique({ where: { startsOn: start } })
  if (!week) {
    const settings = await tx.trackerSettings.findUnique({ where: { id: 'workforce-group' } })
    const { state } = weekProjection(start, null, settings, [], new Date(), false)
    week = await tx.workWeek.create({ data: { startsOn: start, planningLocksAt: state.planningLocksAt, freezesAt: state.freezesAt } })
  }
  await tx.$queryRaw`SELECT id FROM "WorkWeek" WHERE id=${week.id} FOR SHARE`
  await tx.$queryRaw`SELECT id FROM "PlanningUnlock" WHERE "weekId"=${week.id} ORDER BY id FOR SHARE`
  return tx.workWeek.findUniqueOrThrow({ where: { id: week.id } })
}
export async function tracker(tx: Tx, userId: string, weekId: string, fresh: Awaited<ReturnType<typeof employeePrincipal>>) {
  const { person, assignment: a } = fresh
  const contextSnapshot = { version: 1, userId, displayName: person.name?.trim() || 'Staff member', accountStatus: 'ACTIVE', role: a.role,
    businessId: a.businessId, businessName: a.business?.name ?? null, unitId: a.unitId, unitName: a.unit?.name ?? null,
    managerId: a.managerId, managerName: a.manager?.name ?? null, departmentLabel: a.departmentLabel }
  const old = await tx.weeklyTracker.findUnique({ where: { userId_weekId: { userId, weekId } } })
  if (old?.snapshotAt) throw new EmployeeFailure('SERVICE_UNAVAILABLE', 503)
  return tx.weeklyTracker.upsert({ where: { userId_weekId: { userId, weekId } }, create: { userId, weekId, assignmentId: a.id, contextSnapshot }, update: { assignmentId: a.id, contextSnapshot } })
}
