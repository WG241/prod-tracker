import { createHash } from 'node:crypto'
import { recordLeaveEvent } from '../notifications/events.ts'
import type { LeaveRecipient } from '../notifications/events.ts'
import { requestEmailPass } from '../email/worker.ts'
import type { Prisma, PrismaClient, LeaveRecord } from '../../src/generated/prisma/client.ts'
import type { SessionContext } from '../../src/features/auth/contracts.ts'
import type { LeaveOperation, LeaveResult, LeaveWarning } from '../../src/features/employee/leave-contracts.ts'
import { leaveDraftErrors, leaveRequest } from '../../src/features/employee/leave-contracts.ts'
import { databaseErrorCode } from '../db.ts'
import { day, isoDay, watCalendarDay } from '../data-model/calendar.ts'
import { databaseClock } from './history-evidence.ts'
import { currentLeave } from './leave-state.ts'
import { EmployeeFailure } from './calendar.ts'
import { lockPrincipal, principal } from './write-context.ts'
import { LeaveFailure } from './leave-validation.ts'

type Tx = Prisma.TransactionClient
export type LeaveClock = (tx: Tx) => Promise<Date>
class LeaveDayChanged extends Error {}
function safe(row: LeaveRecord) { return { startsOn: isoDay(row.startsOn), expectedReturnOn: isoDay(row.expectedReturnOn), actualReturnOn: row.actualReturnOn ? isoDay(row.actualReturnOn) : null, cancelledAt: row.cancelledAt?.toISOString() ?? null, cancelledById: row.cancelledById } }
function replay(value: Prisma.JsonValue, requestId: string, operation: LeaveOperation['kind'], leaveId: string): LeaveResult {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !['version', 'requestId', 'operation', 'leaveId', 'appliedAt', 'changed', 'replayed', 'notificationWarnings'].includes(key)) || value.version !== 1 || value.requestId !== requestId || value.operation !== operation || value.leaveId !== leaveId || typeof value.appliedAt !== 'string' || !Number.isFinite(Date.parse(value.appliedAt)) || typeof value.changed !== 'boolean' || value.replayed !== false || !Array.isArray(value.notificationWarnings) || value.notificationWarnings.some((v) => v !== 'MANAGER_UNAVAILABLE' && v !== 'HR_UNAVAILABLE')) throw new EmployeeFailure('SERVICE_UNAVAILABLE', 503)
  return { version: 1, requestId, operation, leaveId, appliedAt: value.appliedAt, changed: value.changed, replayed: true, notificationWarnings: value.notificationWarnings as LeaveWarning[] }
}
export async function lockSourceWeeks(tx: Tx, startsOn: Date, endsOn: Date) {
  // The RETURN contribution is contained in the original interval, as is cancellation.
  await tx.$queryRaw`SELECT id FROM "WorkWeek" WHERE ${startsOn}::date<="startsOn"+4 AND ${endsOn}::date>"startsOn" ORDER BY "startsOn" FOR SHARE`
}
async function recipients(tx: Tx, userId: string, source: { id: string; managerId: string | null; businessId: string | null }, clock: LeaveClock) {
  const { managerId, businessId } = source
  const discoveredAt = await clock(tx)
  const candidates = await tx.user.findMany({ where: { OR: [ ...(managerId ? [{ id: managerId }] : []), { accountStatus: 'ACTIVE', assignments: { some: { role: 'HR_ADMIN', effectiveFrom: { lte: discoveredAt }, effectiveTo: null } } } ] }, select: { id: true }, orderBy: { id: 'asc' } })
  for (const row of candidates) {
    if (row.id !== userId) await tx.$queryRaw`SELECT id FROM "User" WHERE id=${row.id} FOR SHARE`
    await tx.$queryRaw`SELECT id FROM "EmploymentAssignment" WHERE "userId"=${row.id} ORDER BY id FOR SHARE`
  }
  const at = await clock(tx), recipients = new Map<string, LeaveRecipient['basis']>([[userId, { version: 1, relationship: 'OWNER', sourceUserId: userId }]])
  let manager = false, hr = false
  for (const candidate of candidates) {
    const row = await tx.user.findUnique({ where: { id: candidate.id }, include: { assignments: { where: { effectiveFrom: { lte: at }, effectiveTo: null }, take: 2 } } })
    if (!row || row.accountStatus !== 'ACTIVE' || row.assignments.length !== 1) continue
    const a = row.assignments[0]
    if (row.id === managerId && a.role === 'LINE_MANAGER' && businessId && a.businessId === businessId) {
      manager = true
      if (!recipients.has(row.id)) recipients.set(row.id, { version: 1, relationship: 'MANAGER', sourceUserId: userId, sourceAssignmentId: source.id, recipientAssignmentId: a.id, businessId })
    }
    if (a.role === 'HR_ADMIN') {
      hr = true
      if (!recipients.has(row.id)) recipients.set(row.id, { version: 1, relationship: 'HR', sourceUserId: userId, recipientAssignmentId: a.id })
    }
  }
  const warnings: LeaveWarning[] = []
  if (!manager) warnings.push('MANAGER_UNAVAILABLE')
  if (!hr) warnings.push('HR_UNAVAILABLE')
  return { recipients: [...recipients.keys()].sort().map((id) => ({ id, basis: recipients.get(id)! })), warnings, resolvedAt: at.toISOString() }
}
export function guardRefusal(error: unknown, depth = 0): boolean {
  if (!error || typeof error !== 'object' || depth > 5) return false
  const value = error as Record<string, unknown>
  return ['message', 'originalMessage'].some((key) => value[key] === 'Historical leave contribution is immutable') || ['meta', 'driverAdapterError', 'cause'].some((key) => guardRefusal(value[key], depth + 1))
}
export async function mutateLeave(db: PrismaClient, context: SessionContext, sessionId: string, suppliedKey: string, operation: LeaveOperation, clock: LeaveClock = databaseClock): Promise<LeaveResult> {
  const requestId = suppliedKey.toLowerCase(), request = leaveRequest(operation)
  const digest = createHash('sha256').update(JSON.stringify({ kind: operation.kind, path: request.path, body: request.body })).digest('hex')
  for (let attempt = 0; ; attempt++) {
    try {
      const committed = await db.$transaction(async (tx) => {
        const userId = context.user.id
        await lockPrincipal(tx, context, sessionId)
        let at = await clock(tx)
        let authority = await principal(tx, context, sessionId, at)
        const receipt = await tx.leaveMutationReceipt.findUnique({ where: { userId_requestId: { userId, requestId } } })
        if (receipt) {
          if (receipt.requestHash !== digest) throw new LeaveFailure('IDEMPOTENCY_CONFLICT', 409)
          return replay(receipt.result, requestId, operation.kind, receipt.leaveId)
        }
        let row = operation.kind === 'CREATE' ? null : await tx.leaveRecord.findFirst({ where: { id: operation.leaveId, userId } })
        if (operation.kind !== 'CREATE' && !row) throw new LeaveFailure('NOT_FOUND', 404)
        if (row && ((operation.kind === 'CANCEL' && row.actualReturnOn) || (operation.kind === 'RETURN' && row.cancelledAt))) throw new LeaveFailure('LEAVE_CHANGED', 409)
        const changed = !row || (operation.kind === 'CANCEL' ? !row.cancelledAt : !row.actualReturnOn)
        let notificationWarnings: LeaveWarning[] = []
        if (changed) {
          const start = row?.startsOn ?? day(operation.kind === 'CREATE' ? operation.draft.startsOn : '')
          const end = row?.expectedReturnOn ?? day(operation.kind === 'CREATE' ? operation.draft.expectedReturnOn : '')
          await lockSourceWeeks(tx, start, end)
          const targets = await recipients(tx, userId, authority.assignment, clock)
          at = await clock(tx)
          authority = await principal(tx, context, sessionId, at)
          const projection = await currentLeave(tx, userId, at), today = watCalendarDay(at)
          if (projection.state === 'REPAIR_REQUIRED') throw new LeaveFailure('LEAVE_REPAIR_REQUIRED', 409)
          if (operation.kind === 'CREATE') {
            const fields = leaveDraftErrors(operation.draft, projection.today, projection.bounds.latestStartOn)
            if (Object.keys(fields).length || !projection.canCreate && projection.state === 'NONE') throw new LeaveFailure('INVALID_INPUT', 400, fields)
            if (!projection.canCreate) throw new LeaveFailure('LEAVE_CONFLICT', 409)
          } else if (!row || projection.current?.id !== row.id || (operation.kind === 'CANCEL' ? !projection.current.canCancel : !projection.current.canReturn)) throw new LeaveFailure('LEAVE_CHANGED', 409)
          const before = row ? safe(row) : null
          row = operation.kind === 'CREATE'
            ? await tx.leaveRecord.create({ data: { userId, startsOn: start, expectedReturnOn: end, createdAt: at } })
            : await tx.leaveRecord.update({ where: { id: row!.id, userId }, data: operation.kind === 'CANCEL' ? { cancelledAt: at, cancelledById: userId } : { actualReturnOn: today } })
          const after = await clock(tx)
          await principal(tx, context, sessionId, after)
          if (isoDay(watCalendarDay(after)) !== projection.today) throw new LeaveDayChanged()
          notificationWarnings = targets.warnings
          const event = operation.kind === 'CREATE' ? 'RECORDED' : operation.kind === 'CANCEL' ? 'CANCELLED' : 'RETURNED'
          const name = authority.person.name?.trim() || 'Staff member'
          for (const recipient of targets.recipients) await recordLeaveEvent(tx, recipient, event, row, name, at)
          await tx.auditEvent.create({ data: { actorId: userId, action: `LEAVE_${event}`, targetType: 'LeaveRecord', targetId: row.id, createdAt: at,
            before: before ?? undefined, after: { ...safe(row), requestId, recipientIds: targets.recipients.map(({ id }) => id), resolvedAt: targets.resolvedAt, notificationWarnings } } })
        }
        if (!row) throw new EmployeeFailure('SERVICE_UNAVAILABLE', 503)
        const result: LeaveResult = { version: 1, requestId, operation: operation.kind, leaveId: row.id, appliedAt: at.toISOString(), changed, replayed: false, notificationWarnings }
        await tx.leaveMutationReceipt.create({ data: { userId, requestId, operation: operation.kind, requestHash: digest, leaveId: row.id, result: { ...result }, createdAt: at } })
        return result
      }, { isolationLevel: 'ReadCommitted', maxWait: 5000, timeout: 15000 })
      if (committed.changed && !committed.replayed) requestEmailPass()
      return committed
    } catch (error) {
      const code = databaseErrorCode(error)
      if (attempt < 2 && (error instanceof LeaveDayChanged || ['P2002', 'P2034', '40P01', '40001'].includes(code ?? ''))) continue
      if (code === '23514' && guardRefusal(error)) throw new LeaveFailure('HISTORY_PROTECTED', 423)
      throw error
    }
  }
}
