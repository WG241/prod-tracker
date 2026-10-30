import type { PrismaClient } from '../../src/generated/prisma/client.ts'
import type { SessionContext } from '../../src/features/auth/contracts.ts'
import { routeContext } from '../../src/features/auth/contracts.ts'

export async function staffContext(db: PrismaClient, id: string, requireReady = true) {
  const now = new Date()
  const person = await db.user.findUnique({ where: { id }, include: {
    authIdentity: true,
    assignments: { where: { effectiveTo: null, effectiveFrom: { lte: now } }, take: 2 },
  } })
  if (!person || person.accountStatus !== 'ACTIVE' || person.assignments.length !== 1) return null
  const assignment = person.assignments[0]
  const identity = person.authIdentity
  if (requireReady && (!identity?.provisionedAt || person.email.trim().toLowerCase() !== identity.email)) return null
  if ((assignment.role === 'EMPLOYEE' || assignment.role === 'LINE_MANAGER') && (!assignment.businessId || !assignment.unitId)) return null
  if (assignment.role === 'BUSINESS_DIRECTOR' && !assignment.businessId) return null
  return { person, assignment }
}

export function safeContext(staff: NonNullable<Awaited<ReturnType<typeof staffContext>>>, expiresAt: Date): SessionContext {
  const { person, assignment } = staff
  return {
    user: { id: person.id, name: person.name?.trim() || 'Staff member', email: person.email },
    role: assignment.role,
    businessId: assignment.businessId,
    unitId: assignment.unitId,
    ...routeContext(assignment.role),
    session: { expiresAt: expiresAt.toISOString() },
  }
}
