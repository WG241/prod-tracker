import type { PrismaClient } from '../../src/generated/prisma/client.ts'
import type { CoverHistory, LeaveHistoryItem, ManagerLeave, ManagerLeaveHistory, ReliefCandidates } from '../../src/features/line-manager/leave-contracts.ts'
import { coverDraftErrors } from '../../src/features/line-manager/leave-contracts.ts'
import type { Actor } from '../auth/owner-write.ts'
import { isoDay, watCalendarDay, watMidnight } from '../data-model/calendar.ts'
import { EmployeeFailure, parseDay } from '../employee/calendar.ts'
import { currentLeave } from '../employee/leave-state.ts'
import { pageOffset } from '../employee/reads.ts'
import { coverEvidence, eligibleOfficer, leaveLabels, officerSelect, remainingGap, selectedOfficer } from './leave-scope.ts'
import { page, selectors } from './query.ts'
import { clock, readBounds, slice } from './reads.ts'
import { effective, managerPrincipal } from './scope.ts'

const unavailable = () => new EmployeeFailure('SERVICE_UNAVAILABLE', 503)
const notFound = () => new EmployeeFailure('NOT_FOUND', 404)
const historyOrder = [{ startsOn: 'desc' as const }, { id: 'desc' as const }]

export function readManagerLeave(db: PrismaClient, actor: Actor, url: string): Promise<ManagerLeave> {
  selectors(url, [])
  return db.$transaction(async (tx) => {
    const { userId, at } = await managerPrincipal(tx, actor)
    const base = await currentLeave(tx, userId, at)
    const transitions = [new Date(base.nextChangeAt)]
    const common = { ...base, cover: null, coverState: 'Uncovered' as const, coverGap: false, canEditCover: false, canEndCover: false }
    if (!base.current) return { ...common, ...clock(at, actor.context.session.expiresAt, transitions),
      coverState: base.state === 'REPAIR_REQUIRED' ? 'Repair required' : 'Uncovered' }
    const leave = await tx.leaveRecord.findUnique({ where: { id_userId: { id: base.current.id, userId } }, include: {
      relief: { where: { endedAt: null }, take: 2 },
    } })
    if (!leave) throw unavailable()
    if (leave.relief.length > 1) return { ...common, ...clock(at, actor.context.session.expiresAt, transitions), state: 'REPAIR_REQUIRED',
      reason: 'LEAVE_REPAIR_REQUIRED', coverState: 'Repair required', current: { ...base.current, canCancel: false, canReturn: false } }
    const row = leave.relief[0]
    const officer = row ? eligibleOfficer(await selectedOfficer(tx, row.reliefManagerId, at, row.startsOn, row.endsOn),
      userId, at, row.startsOn, row.endsOn) : null
    const cover = row ? coverEvidence(row, leave, at, officer) : null
    if (row) transitions.push(watMidnight(row.startsOn), watMidnight(row.endsOn))
    return { ...common, ...clock(at, actor.context.session.expiresAt, transitions), cover, coverState: cover?.state ?? 'Uncovered',
      coverGap: remainingGap(leave, row ?? null, at, !!officer), canEditCover: true, canEndCover: !!row }
  }, readBounds)
}

export function readManagerLeaveHistory(db: PrismaClient, actor: Actor, url: string): Promise<ManagerLeaveHistory> {
  const requested = page(selectors(url, ['page']), 'page')
  return db.$transaction(async (tx) => {
    const { userId, at } = await managerPrincipal(tx, actor)
    const today = watCalendarDay(at)
    const where = { userId, OR: [{ cancelledAt: { lte: at } }, { actualReturnOn: { lte: today } }, { expectedReturnOn: { lte: today } }] }
    const total = await tx.leaveRecord.count({ where })
    const skip = pageOffset(requested, total)
    const rows = skip === null ? [] : await tx.leaveRecord.findMany({ where, orderBy: historyOrder, skip, take: 25,
      include: { relief: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1 }, _count: { select: { relief: true } } } })
    const items: LeaveHistoryItem[] = rows.map((leave) => {
      const cancelled = !!leave.cancelledAt && leave.cancelledAt <= at
      const end = leave.actualReturnOn ?? leave.expectedReturnOn
      return { id: leave.id, ...leaveLabels(leave), startsOn: isoDay(leave.startsOn), expectedReturnOn: isoDay(leave.expectedReturnOn),
        returnedOn: cancelled ? null : isoDay(end), days: cancelled ? 0 : Math.max(0, (end.getTime() - leave.startsOn.getTime()) / 86400000),
        state: cancelled ? 'Cancelled' : end < leave.expectedReturnOn ? 'Returned early' : 'Completed',
        coverCount: leave._count.relief, lastCover: leave.relief[0] ? coverEvidence(leave.relief[0], leave, at) : null }
    })
    return { ...clock(at, actor.context.session.expiresAt, []), periods: { items, page: requested, pageSize: 25, total } }
  }, readBounds)
}

export function readCoverHistory(db: PrismaClient, actor: Actor, url: string, leaveId: string): Promise<CoverHistory> {
  const requested = page(selectors(url, ['page']), 'page')
  return db.$transaction(async (tx) => {
    const { userId, at } = await managerPrincipal(tx, actor)
    const leave = await tx.leaveRecord.findUnique({ where: { id_userId: { id: leaveId, userId } } })
    if (!leave) throw notFound()
    const where = { leaveId, coveredManagerId: userId }
    const total = await tx.reliefAssignment.count({ where })
    const skip = pageOffset(requested, total)
    const rows = skip === null ? [] : await tx.reliefAssignment.findMany({ where, orderBy: historyOrder, skip, take: 25 })
    return { ...clock(at, actor.context.session.expiresAt, []), arrangements: { items: rows.map((row) => coverEvidence(row, leave, at)), page: requested, pageSize: 25, total } }
  }, readBounds)
}

export function readReliefCandidates(db: PrismaClient, actor: Actor, url: string): Promise<ReliefCandidates> {
  const query = selectors(url, ['startsOn', 'endsOn', 'search', 'page'])
  const startsOn = query.get('startsOn') ?? '', endsOn = query.get('endsOn') ?? '', search = query.get('search') ?? ''
  const requested = page(query, 'page')
  if (search.length > 120 || search.includes('\0') || Object.keys(coverDraftErrors({ startsOn, endsOn })).length) throw new EmployeeFailure('INVALID_INPUT', 400)
  const start = parseDay(startsOn), end = parseDay(endsOn)
  return db.$transaction(async (tx) => {
    const { userId, at } = await managerPrincipal(tx, actor)
    if (start < watCalendarDay(at)) throw new EmployeeFailure('INVALID_INPUT', 400)
    const needle = search.trim().toLowerCase()
    const role = { ...effective(at), role: 'LINE_MANAGER' as const }
    const contains = { contains: needle.replace(/[\\%_]/g, '\\$&'), mode: 'insensitive' as const }
    const rows = await tx.user.findMany({ where: { id: { not: userId }, accountStatus: 'ACTIVE',
      assignments: { some: role },
      ...(needle && /^[\x20-\x7e]+$/.test(needle) && !'staff member'.includes(needle) ? { OR: [
        { name: contains }, { assignments: { some: { ...role, business: { name: contains } } } },
      ] } : {}),
    }, select: officerSelect(at, start, end) })
    const candidates = rows.flatMap((row) => {
      const officer = eligibleOfficer(row, userId, at, start, end)
      return officer && [officer.name, officer.business].some((label) => label.toLowerCase().includes(needle))
        ? [{ id: officer.id, name: officer.name, business: officer.business }] : []
    }).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    return { ...clock(at, actor.context.session.expiresAt, []), candidates: slice(candidates, requested) }
  }, readBounds)
}
