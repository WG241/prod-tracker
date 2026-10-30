import type { PrismaClient, Prisma } from '../../src/generated/prisma/client.ts'
import type { SessionContext } from '../../src/features/auth/contracts.ts'

export function ownPerson(context: SessionContext, personId: string) {
  return context.user.id === personId
}

export function aggregateScope(context: SessionContext, businessId?: string) {
  return context.role === 'HR_ADMIN' || context.role === 'EXECUTIVE'
    || (context.role === 'BUSINESS_DIRECTOR' && !!businessId && context.businessId === businessId)
}

function currentEmployees(now: Date): Prisma.EmploymentAssignmentWhereInput {
  return { role: 'EMPLOYEE', effectiveTo: null, effectiveFrom: { lte: now }, user: { accountStatus: 'ACTIVE' } }
}

export async function canReadPerson(db: PrismaClient, context: SessionContext, personId: string, now = new Date()) {
  if (ownPerson(context, personId) || context.role === 'HR_ADMIN') return !!await db.user.findUnique({ where: { id: personId }, select: { id: true } })
  if (context.role !== 'LINE_MANAGER' && context.role !== 'BUSINESS_DIRECTOR') return false
  if (context.role === 'BUSINESS_DIRECTOR' && !context.businessId) return false
  return !!await db.employmentAssignment.findFirst({ where: {
    effectiveTo: null, effectiveFrom: { lte: now }, user: { accountStatus: 'ACTIVE' }, userId: personId,
    ...(context.role === 'LINE_MANAGER' ? { role: 'EMPLOYEE' as const } : {}),
    ...(context.role === 'LINE_MANAGER' ? { managerId: context.user.id } : { businessId: context.businessId }),
  }, select: { id: true } })
}

function recordedContext(value: Prisma.JsonValue, ownerId: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  if (value.version !== 1 || value.userId !== ownerId || !['EMPLOYEE', 'LINE_MANAGER'].includes(String(value.role))
    || typeof value.businessId !== 'string' || !value.businessId
    || typeof value.unitId !== 'string' || !value.unitId
    || !(value.managerId === null || typeof value.managerId === 'string')) return null
  return value
}

export async function canReadTask(db: PrismaClient, context: SessionContext, taskId: string, view: 'own' | 'current' | 'historical', now = new Date()) {
  if (context.role === 'EXECUTIVE') return false
  let scope: Prisma.WeeklyTaskWhereInput
  if (context.role === 'HR_ADMIN') scope = {}
  else if (view === 'own') {
    if (context.role !== 'EMPLOYEE' && context.role !== 'LINE_MANAGER') return false
    scope = { ownerId: context.user.id }
  } else if (context.role === 'LINE_MANAGER') {
    scope = view === 'historical'
      ? { tracker: { snapshotAt: { not: null }, contextSnapshot: { path: ['managerId'], equals: context.user.id } } }
      : { owner: { assignments: { some: { ...currentEmployees(now), managerId: context.user.id } } } }
  } else if (context.role === 'BUSINESS_DIRECTOR' && context.businessId) {
    scope = view === 'historical'
      ? { tracker: { snapshotAt: { not: null }, contextSnapshot: { path: ['businessId'], equals: context.businessId } } }
      : { owner: { assignments: { some: { effectiveTo: null, effectiveFrom: { lte: now }, user: { accountStatus: 'ACTIVE' }, businessId: context.businessId } } } }
  } else return false
  const task = await db.weeklyTask.findFirst({ where: {
    id: taskId, deletedAt: null, ...scope,
    AND: view === 'current' && context.role !== 'HR_ADMIN' ? [{ tracker: { snapshotAt: null } }] : [],
  }, select: { ownerId: true, tracker: { select: { contextSnapshot: true } } } })
  if (!task) return false
  if (view === 'historical' && context.role !== 'HR_ADMIN') {
    const snapshot = recordedContext(task.tracker.contextSnapshot, task.ownerId)
    return !!snapshot && (context.role === 'LINE_MANAGER' ? snapshot.role === 'EMPLOYEE' && snapshot.managerId === context.user.id : snapshot.businessId === context.businessId)
  }
  return true
}

export async function canReviewRelief(db: PrismaClient, context: SessionContext, requestId: string, now = new Date()) {
  if (context.role !== 'LINE_MANAGER') return false
  const date = new Date(`${new Date(now.getTime() + 3600000).toISOString().slice(0, 10)}T00:00:00Z`)
  return !!await db.approvalRequest.findFirst({ where: {
    id: requestId, state: 'PENDING',
    reviewer: { coveredLeaves: { some: {
      reliefManagerId: context.user.id, startsOn: { lte: date }, endsOn: { gt: date },
      AND: [{ OR: [{ endedAt: null }, { endedAt: { gt: now } }] }],
      leave: {
        startsOn: { lte: date },
        AND: [
          { OR: [{ cancelledAt: null }, { cancelledAt: { gt: now } }] },
          { OR: [{ actualReturnOn: { gt: date } }, { actualReturnOn: null, expectedReturnOn: { gt: date } }] },
        ],
      },
    } } },
  }, select: { id: true } })
}
