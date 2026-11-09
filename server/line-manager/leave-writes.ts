import { createHash } from 'node:crypto'
import { Prisma } from '../../src/generated/prisma/client.ts'
import type { LeaveRecord, PrismaClient, ReliefAssignment } from '../../src/generated/prisma/client.ts'
import { leaveDraftErrors } from '../../src/features/employee/leave-contracts.ts'
import { coverDraftErrors, managerLeaveRequest, managerLeaveWarnings } from '../../src/features/line-manager/leave-contracts.ts'
import type { ManagerLeaveOperation, ManagerLeaveResult, ManagerLeaveWarning } from '../../src/features/line-manager/leave-contracts.ts'
import { AuthFailure } from '../auth/errors.ts'
import { lockOwner, withKnownRollbackRetry } from '../auth/owner-write.ts'
import type { Actor } from '../auth/owner-write.ts'
import { databaseClock, databaseErrorCode } from '../db.ts'
import { day, isoDay, watCalendarDay } from '../data-model/calendar.ts'
import { currentLeave } from '../employee/leave-state.ts'
import { LeaveFailure } from '../employee/leave-validation.ts'
import { guardRefusal, lockSourceWeeks } from '../employee/leave-writes.ts'
import { taskIdentity } from '../employee/task-validation.ts'
import { requestEmailPass } from '../email/worker.ts'
import { recordManagerLeaveEvent } from '../notifications/events.ts'
import type { ManagerLeaveRecipient } from '../notifications/events.ts'
import { coverEvidence, displayLabel, eligibleOfficer, hasIncomingCommitment, remainingGap, selectedOfficer } from './leave-scope.ts'
import { effective, managerPrincipal } from './scope.ts'
import type { Tx } from './scope.ts'

const invalid = (fields?: Record<string, string>) => new LeaveFailure('INVALID_INPUT', 400, fields)
const changed = () => new LeaveFailure('LEAVE_CHANGED', 409)
const conflict = () => new LeaveFailure('RELIEF_CHANGED', 409)
const repair = () => new LeaveFailure('LEAVE_REPAIR_REQUIRED', 409)
const notFound = () => new LeaveFailure('NOT_FOUND', 404)
const unavailable = () => new AuthFailure('SERVICE_UNAVAILABLE', 503)
class DayChanged extends Error {}
type Event = Parameters<typeof recordManagerLeaveEvent>[2]
type Principal = Awaited<ReturnType<typeof managerPrincipal>>
type Officer = NonNullable<ReturnType<typeof eligibleOfficer>>

function fields(body: unknown, keys: string[]) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== keys.length || keys.some((key) => !Object.hasOwn(body, key))) throw invalid()
  return body as Record<string, unknown>
}
export function managerLeaveInput(kind: ManagerLeaveOperation['kind'], leave: unknown, body: unknown): ManagerLeaveOperation {
  if (kind === 'MANAGER_CREATE') {
    const input = fields(body, ['startsOn', 'expectedReturnOn', 'reliefManagerId'])
    const draft = { startsOn: String(input.startsOn ?? ''), expectedReturnOn: String(input.expectedReturnOn ?? ''), reliefManagerId: taskIdentity(input.reliefManagerId) }
    const errors = leaveDraftErrors(draft)
    if (typeof input.startsOn !== 'string' || typeof input.expectedReturnOn !== 'string' || Object.keys(errors).length) throw invalid(errors)
    return { kind, draft }
  }
  const leaveId = taskIdentity(leave)
  if (kind === 'RELIEF_END') return { kind, leaveId, expectedReliefId: taskIdentity(fields(body, ['expectedReliefId']).expectedReliefId) }
  if (kind === 'RELIEF_REPLACE') {
    const input = fields(body, ['expectedReliefId', 'reliefManagerId', 'startsOn', 'endsOn'])
    const draft = { startsOn: String(input.startsOn ?? ''), endsOn: String(input.endsOn ?? ''), reliefManagerId: taskIdentity(input.reliefManagerId) }
    const errors = coverDraftErrors(draft)
    if (typeof input.startsOn !== 'string' || typeof input.endsOn !== 'string' || Object.keys(errors).length) throw invalid(errors)
    return { kind, leaveId, expectedReliefId: input.expectedReliefId === null ? null : taskIdentity(input.expectedReliefId), draft }
  }
  fields(body, [])
  return { kind, leaveId }
}

function receipt(value: Prisma.JsonValue, requestId: string, leaveId: string, operation: ManagerLeaveOperation['kind']): ManagerLeaveResult {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 1 || value.requestId !== requestId
    || value.leaveId !== leaveId || value.operation !== operation || value.replayed !== false || typeof value.changed !== 'boolean'
    || typeof value.appliedAt !== 'string' || !Number.isFinite(Date.parse(value.appliedAt))
    || (value.coverId !== null && typeof value.coverId !== 'string') || (value.actualReturnOn !== null && typeof value.actualReturnOn !== 'string')
    || !Array.isArray(value.endedCoverIds) || value.endedCoverIds.length > 1 || value.endedCoverIds.some((id) => typeof id !== 'string')
    || !Array.isArray(value.notificationWarnings) || value.notificationWarnings.some((warning) => typeof warning !== 'string' || !Object.hasOwn(managerLeaveWarnings, warning))) throw unavailable()
  return { version: 1, operation, requestId, leaveId, appliedAt: value.appliedAt, changed: value.changed, replayed: true, coverId: value.coverId,
    actualReturnOn: value.actualReturnOn, endedCoverIds: value.endedCoverIds as string[], notificationWarnings: value.notificationWarnings as ManagerLeaveWarning[] }
}

async function lockSources(tx: Tx, principal: Principal, start: Date, end: Date, old: ReliefAssignment | null, officerId: string | null) {
  const { userId, at, businessId } = principal
  const recipients = await tx.user.findMany({ where: { accountStatus: 'ACTIVE', assignments: { some: {
    ...effective(at), OR: [{ role: 'BUSINESS_DIRECTOR', businessId }, { role: 'HR_ADMIN' }],
  } } }, select: { id: true } })
  const incoming = await tx.reliefAssignment.findMany({ where: { reliefManagerId: userId, startsOn: { lt: end }, endsOn: { gt: start } },
    select: { coveredManagerId: true, leave: { select: { startsOn: true, expectedReturnOn: true } } } })
  const users = [...new Set([userId, ...recipients.map(({ id }) => id), ...incoming.map(({ coveredManagerId }) => coveredManagerId),
    ...(old ? [old.reliefManagerId] : []), ...(officerId ? [officerId] : [])])]
  const ids = Prisma.join(users)
  await tx.$queryRaw`SELECT id FROM "User" WHERE id IN (${ids}) ORDER BY id FOR SHARE`
  await tx.$queryRaw`SELECT id FROM "EmploymentAssignment" WHERE "userId" IN (${ids}) ORDER BY id FOR SHARE`
  await tx.$queryRaw`SELECT b.id FROM "Business" b WHERE EXISTS (SELECT FROM "EmploymentAssignment" a
    WHERE a."businessId"=b.id AND a."userId" IN (${ids}) AND (a."effectiveTo" IS NULL OR a."effectiveTo">${at})) ORDER BY b.id FOR SHARE`
  await tx.$queryRaw`SELECT id FROM "LeaveRecord" WHERE "userId" IN (${ids}) ORDER BY id FOR UPDATE`
  await tx.$queryRaw`SELECT id FROM "AuthUser" WHERE id IN (${ids}) ORDER BY id FOR SHARE`
  const first = new Date(Math.min(start.getTime(), ...incoming.map(({ leave }) => leave.startsOn.getTime())))
  const last = new Date(Math.max(end.getTime(), ...incoming.map(({ leave }) => leave.expectedReturnOn.getTime())))
  await lockSourceWeeks(tx, first, last)
  await tx.$queryRaw`SELECT id FROM "ReliefAssignment" WHERE "coveredManagerId"=${userId} OR "reliefManagerId"=${userId} ORDER BY id FOR UPDATE`
  return recipients.map(({ id }) => id)
}

async function publishEvent(tx: Tx, authority: Principal, recipients: string[], leave: LeaveRecord, cover: ReliefAssignment | null,
  officer: Officer | null, event: Event, at: Date, warnings: Set<ManagerLeaveWarning>) {
  const { userId, businessId, staff } = authority
  const basis = { version: 1 as const, sourceUserId: userId }
  const targets = new Map<string, ManagerLeaveRecipient['basis']>([[userId, { ...basis, relationship: 'MANAGER_LEAVE_OWNER' }]])
  let director = false, hr = false
  const ids = [...new Set([...recipients, ...(cover ? [cover.reliefManagerId] : [])])]
  const people = await tx.user.findMany({ where: { id: { in: ids }, accountStatus: 'ACTIVE' }, select: {
    id: true, name: true, assignments: { where: effective(at), take: 2 },
  }, orderBy: { id: 'asc' } })
  let officerName = cover ? coverEvidence(cover, leave, at).officerName : null
  let foundOfficer = false
  for (const person of people) {
    if (person.assignments.length !== 1) continue
    const assignment = person.assignments[0]
    if (cover && person.id === cover.reliefManagerId && assignment.role === 'LINE_MANAGER') {
      foundOfficer = true
      officerName ??= displayLabel(person.name)
      targets.set(person.id, { ...basis, relationship: 'RELIEF_OFFICER', reliefAssignmentId: cover.id, recipientAssignmentId: assignment.id })
    }
    if (assignment.role === 'BUSINESS_DIRECTOR' && assignment.businessId === businessId) {
      director = true
      if (!targets.has(person.id)) targets.set(person.id, { ...basis, relationship: 'BUSINESS_DIRECTOR', sourceAssignmentId: staff.assignment.id,
        recipientAssignmentId: assignment.id, businessId })
    }
    if (assignment.role === 'HR_ADMIN') {
      hr = true
      if (!targets.has(person.id)) targets.set(person.id, { ...basis, relationship: 'HR', recipientAssignmentId: assignment.id })
    }
  }
  if (!director) warnings.add('DIRECTOR_UNAVAILABLE')
  if (!hr) warnings.add('HR_UNAVAILABLE')
  if (cover && !foundOfficer) {
    if (officer) throw new LeaveFailure('RELIEF_UNAVAILABLE', 409)
    warnings.add('OFFICER_UNAVAILABLE')
  }
  if (officer && !officer.loginReady) warnings.add('OFFICER_NOT_PROVISIONED')
  const arrangement = cover ? { ...cover, name: officerName ?? 'Name not recorded' } : null
  for (const [id, target] of [...targets].sort(([a], [b]) => a.localeCompare(b))) {
    await recordManagerLeaveEvent(tx, { id, basis: target }, event, leave, arrangement, displayLabel(staff.person.name), at)
  }
}

function leaveSnapshot(authority: Principal, businessName: string) {
  return { version: 1, userId: authority.userId, displayName: displayLabel(authority.staff.person.name), role: 'LINE_MANAGER',
    businessId: authority.businessId, businessName: displayLabel(businessName) }
}

async function grant(tx: Tx, owner: Principal, leave: LeaveRecord, officer: Officer, start: Date, end: Date, at: Date) {
  return tx.reliefAssignment.create({ data: { leaveId: leave.id, coveredManagerId: owner.userId, reliefManagerId: officer.id, startsOn: start, endsOn: end, createdAt: at,
    contextSnapshot: { version: 1, coveredManagerId: owner.userId, coveredDisplayName: displayLabel(owner.staff.person.name), reliefManagerId: officer.id,
      reliefDisplayName: officer.name, reliefRole: 'LINE_MANAGER', reliefBusinessId: officer.businessId, reliefBusinessName: officer.business },
  } })
}

export async function mutateManagerLeave(db: PrismaClient, actor: Actor, requestId: string, operation: ManagerLeaveOperation) {
  const command = managerLeaveRequest(operation)
  const hash = createHash('sha256').update(JSON.stringify({ operation: operation.kind, ...command })).digest('hex')
  try {
    const result = await withKnownRollbackRetry(db, async (tx): Promise<ManagerLeaveResult> => {
      await lockOwner(tx, actor, 'notification')
      const initial = await managerPrincipal(tx, actor)
      const userId = initial.userId
      const previous = await tx.leaveMutationReceipt.findUnique({ where: { userId_requestId: { userId, requestId } } })
      if (previous) {
        if (previous.operation !== operation.kind || previous.requestHash !== hash) throw new LeaveFailure('IDEMPOTENCY_CONFLICT', 409)
        return receipt(previous.result, requestId, previous.leaveId, operation.kind)
      }
      const creating = operation.kind === 'MANAGER_CREATE'
      let leave = creating ? null : await tx.leaveRecord.findUnique({ where: { id_userId: { id: operation.leaveId, userId } } })
      if (!creating && !leave) throw notFound()
      const start = creating ? day(operation.draft.startsOn) : leave!.startsOn
      const end = creating ? day(operation.draft.expectedReturnOn) : leave!.expectedReturnOn
      const initialRows = leave ? await tx.reliefAssignment.findMany({ where: { leaveId: leave.id, coveredManagerId: userId, endedAt: null }, take: 2 }) : []
      if (initialRows.length > 1) throw repair()
      const officerId = 'draft' in operation ? operation.draft.reliefManagerId : null
      const recipients = await lockSources(tx, initial, start, end, initialRows[0] ?? null, officerId)
      const authority = await managerPrincipal(tx, actor)
      const { at } = authority
      const today = watCalendarDay(at)
      if (authority.staff.assignment.id !== initial.staff.assignment.id) throw new AuthFailure('FORBIDDEN', 403)
      if (leave) leave = await tx.leaveRecord.findUnique({ where: { id_userId: { id: leave.id, userId } } })
      if (!creating && !leave) throw notFound()
      const rows = leave ? await tx.reliefAssignment.findMany({ where: { leaveId: leave.id, coveredManagerId: userId, endedAt: null }, take: 2 }) : []
      if (rows.length > 1) throw repair()
      const old = rows[0] ?? null
      if (old?.id !== initialRows[0]?.id) throw conflict()
      const current = await currentLeave(tx, userId, at)
      if (current.state === 'REPAIR_REQUIRED') throw repair()
      const terminal = operation.kind === 'MANAGER_CANCEL' || operation.kind === 'MANAGER_RETURN'
      if (terminal && leave && (operation.kind === 'MANAGER_CANCEL' ? !!leave.actualReturnOn : !!leave.cancelledAt)) throw changed()
      const noChange = terminal && leave && (operation.kind === 'MANAGER_CANCEL' ? !!leave.cancelledAt : !!leave.actualReturnOn)
      if (creating && !current.canCreate) throw new LeaveFailure('LEAVE_CONFLICT', 409)
      if (!creating && !noChange && current.current?.id !== leave?.id) throw changed()
      if (terminal && !noChange && (operation.kind === 'MANAGER_CANCEL' ? !current.current?.canCancel : !current.current?.canReturn)) throw changed()
      if ('expectedReliefId' in operation && operation.expectedReliefId !== (old?.id ?? null)) throw conflict()
      let officer: Officer | null = null
      let coverStart = start, coverEnd = end
      if (creating) {
        const errors = leaveDraftErrors(operation.draft, current.today, current.bounds.latestStartOn)
        if (Object.keys(errors).length) throw invalid(errors)
        if (await hasIncomingCommitment(tx, userId, start, end, at)) throw new LeaveFailure('INCOMING_COVER', 409)
      }
      if (operation.kind === 'RELIEF_REPLACE') {
        const earliest = start > today ? start : today
        const errors = coverDraftErrors(operation.draft, isoDay(earliest), isoDay(end))
        if (Object.keys(errors).length) throw invalid(errors)
        coverStart = day(operation.draft.startsOn)
        coverEnd = day(operation.draft.endsOn)
      }
      if (officerId) {
        officer = eligibleOfficer(await selectedOfficer(tx, officerId, at, coverStart, coverEnd), userId, at, coverStart, coverEnd)
        if (!officer) throw new LeaveFailure('RELIEF_UNAVAILABLE', 409)
      }
      const sameCover = operation.kind === 'RELIEF_REPLACE' && officer?.id === old?.reliefManagerId
        && coverStart.getTime() === old?.startsOn.getTime() && coverEnd.getTime() === old?.endsOn.getTime()
      const modified = !noChange && !sameCover
      const warnings = new Set<ManagerLeaveWarning>()
      let cover: ReliefAssignment | null = old
      let ended: ReliefAssignment | null = null
      const before = leave ? { leaveId: leave.id, coverId: old?.id ?? null, actualReturnOn: leave.actualReturnOn?.toISOString() ?? null } : undefined
      if (modified) {
        if (creating) {
          const business = await tx.business.findUnique({ where: { id: authority.businessId }, select: { name: true } })
          if (!business) throw unavailable()
          leave = await tx.leaveRecord.create({ data: { userId, startsOn: start, expectedReturnOn: end, createdAt: at, contextSnapshot: leaveSnapshot(authority, business.name) } })
        }
        if (!leave) throw unavailable()
        if (old) ended = await tx.reliefAssignment.update({ where: { id: old.id }, data: { endedAt: at, endedById: userId } })
        if (terminal) leave = await tx.leaveRecord.update({ where: { id: leave.id }, data: operation.kind === 'MANAGER_CANCEL'
          ? { cancelledAt: at, cancelledById: userId } : { actualReturnOn: today } })
        cover = officer ? await grant(tx, authority, leave, officer, coverStart, coverEnd, at) : null
        if (creating) await publishEvent(tx, authority, recipients, leave, cover, officer, 'LEAVE_RECORDED', at, warnings)
        else if (terminal) await publishEvent(tx, authority, recipients, leave, ended, null,
          operation.kind === 'MANAGER_CANCEL' ? 'LEAVE_CANCELLED' : 'LEAVE_RETURNED', at, warnings)
        else {
          if (ended) await publishEvent(tx, authority, recipients, leave, ended, null, 'RELIEF_ENDED', at, warnings)
          if (cover) await publishEvent(tx, authority, recipients, leave, cover, officer, 'RELIEF_ASSIGNED', at, warnings)
        }
      }
      if (!leave) throw unavailable()
      if (!terminal && remainingGap(leave, cover, at, !!officer)) warnings.add('COVER_GAP')
      if (sameCover && officer && !officer.loginReady) warnings.add('OFFICER_NOT_PROVISIONED')
      const result: ManagerLeaveResult = { version: 1, operation: operation.kind, requestId, leaveId: leave.id, appliedAt: at.toISOString(),
        changed: modified, replayed: false, coverId: terminal ? null : cover?.id ?? null, endedCoverIds: ended ? [ended.id] : [],
        actualReturnOn: leave.actualReturnOn ? isoDay(leave.actualReturnOn) : null, notificationWarnings: [...warnings] }
      if (modified) await tx.auditEvent.create({ data: { actorId: userId, action: operation.kind, targetType: 'LeaveRecord', targetId: leave.id, createdAt: at,
        before, after: { ...result, leaveSnapshot: leave.contextSnapshot ?? null, coverSnapshot: cover?.contextSnapshot ?? null } } })
      await tx.leaveMutationReceipt.create({ data: { userId, leaveId: leave.id, requestId, operation: operation.kind, requestHash: hash, result, createdAt: at } })
      const final = await managerPrincipal(tx, actor)
      if (final.staff.assignment.id !== authority.staff.assignment.id) throw new AuthFailure('FORBIDDEN', 403)
      if (officer && !eligibleOfficer(await selectedOfficer(tx, officer.id, final.at, coverStart, coverEnd), userId, final.at, coverStart, coverEnd)) {
        throw new LeaveFailure('RELIEF_UNAVAILABLE', 409)
      }
      const latest = await databaseClock(tx)
      if (isoDay(watCalendarDay(latest)) !== current.today) throw new DayChanged()
      if (latest >= new Date(actor.context.session.expiresAt)) throw new AuthFailure('SESSION_REQUIRED', 401)
      return result
    }, (error) => error instanceof DayChanged)
    if (result.changed && !result.replayed) requestEmailPass()
    return result
  } catch (error) {
    if (databaseErrorCode(error) === '23514' && guardRefusal(error)) throw new LeaveFailure('HISTORY_PROTECTED', 423)
    if (error instanceof DayChanged) throw unavailable()
    throw error
  }
}
