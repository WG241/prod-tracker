import type { LeaveRecord, Prisma, TrackerSettings, WorkWeek } from '../../src/generated/prisma/client.ts'
import type { DashboardMetrics } from '../../src/features/line-manager/dashboard-view.ts'
import { activeAt, assignmentForWeek, expectedWorkingDays, isoDay, referenceForWeek, shiftDay } from '../data-model/calendar.ts'
import { weekProjection } from '../employee/calendar.ts'
import { historyEvidence, historyPeople, protection, snapshotContext } from '../employee/history-evidence.ts'
import type { SnapshotContext } from '../employee/history-evidence.ts'
import { employeeAssignment, employeeSelect, teamWhere } from './scope.ts'
import type { TeamEmployee, Tx } from './scope.ts'

type Member = { id: string; name: string; unitName: string; managerName: string; businessName: string; department: string | null;
  days: number; fullLeave: boolean; employee?: NonNullable<ReturnType<typeof currentMember>>['employee'] }
type PendingMember = Pick<Member, 'id' | 'name' | 'unitName'>
type Week = { start: Date; stored: WorkWeek | null; kind: 'CURRENT' | 'FROZEN' | 'UNAVAILABLE' | 'NOT_OPEN' | 'OUTSIDE_COVERAGE';
  members: Map<string, Member>; pending: Map<string, PendingMember>; freezesAt?: Date }
type Counts = { tasks: number; approved: number; eligible: number }
export type ReportingWeek = Week & { submitted: Set<string>; approved: number; eligible: number; inProgress: number; counts: Map<string, Counts> }

function fullLeave(leaves: LeaveRecord[], start: Date, freeze: Date, at: Date) {
  const reference = referenceForWeek(freeze, at)
  return [0, 1, 2, 3, 4].every((offset) => {
    const day = shiftDay(start, offset)
    return leaves.some((leave) => leave.createdAt <= reference && (!leave.cancelledAt || leave.cancelledAt > reference)
      && leave.startsOn <= day && (leave.actualReturnOn ?? leave.expectedReturnOn) > day)
  })
}

function recordedMember(context: SnapshotContext, days: number): Member {
  return { id: context.userId, name: context.displayName, unitName: context.unitName!, managerName: context.managerName!,
    businessName: context.businessName!, department: context.departmentLabel, days, fullLeave: false }
}

function currentMember(person: TeamEmployee, manager: { userId: string; businessId: string; at: Date; name: string }, start: Date, freeze: Date) {
  const assignment = employeeAssignment(person, manager.userId, manager.businessId, manager.at)
  if (!assignment) return null
  const days = expectedWorkingDays(person, person.assignments, person.leaves, start, freeze, manager.at)
  return { id: person.id, name: person.name?.trim() || 'Staff member', unitName: assignment.unit?.name ?? '', managerName: manager.name,
    businessName: assignment.business?.name ?? '', department: assignment.departmentLabel, days,
    fullLeave: days === 0 && fullLeave(person.leaves, start, freeze, manager.at), employee: { person, assignment } }
}

export async function roster(tx: Tx, dates: Date[], current: Date, manager: { userId: string; businessId: string; at: Date; name: string }, settings: TrackerSettings, { history = false, personId }: { history?: boolean; personId?: string } = {}) {
  const stored = await tx.workWeek.findMany({ where: { startsOn: { in: dates } }, orderBy: { startsOn: 'asc' } })
  const byDate = new Map(stored.map((week) => [isoDay(week.startsOn), week]))
  const weeks = new Map<string, Week>()
  const frozen: WorkWeek[] = []
  for (const start of dates) {
    const date = isoDay(start)
    const row = byDate.get(date) ?? null
    const members = new Map<string, Member>()
    const pending = new Map<string, PendingMember>()
    if (start > current) { weeks.set(date, { start, stored: row, kind: 'NOT_OPEN', members, pending }); continue }
    if (!row && start < current) {
      const kind = history && settings.trackingStartsOn && start < settings.trackingStartsOn ? 'OUTSIDE_COVERAGE' : 'UNAVAILABLE'
      weeks.set(date, { start, stored: null, kind, members, pending })
      continue
    }
    const freezesAt = row?.freezesAt ?? new Date(weekProjection(start, null, settings, [], manager.at, false).state.freezesAt)
    if (row && freezesAt <= manager.at) frozen.push(row)
    const kind = freezesAt > manager.at && date === isoDay(current) ? 'CURRENT' : 'UNAVAILABLE'
    weeks.set(date, { start, stored: row, kind, members, pending, freezesAt })
  }
  const live = weeks.get(isoDay(current))
  if (live?.kind === 'CURRENT' && live.freezesAt) {
    const people = await tx.user.findMany({ where: { id: personId, ...teamWhere(manager.userId, manager.businessId, manager.at) }, select: employeeSelect(manager.at, current) })
    for (const person of people) {
      const member = currentMember(person, manager, current, live.freezesAt)
      if (member) live.members.set(member.id, member)
    }
  }
  if (!frozen.length) return weeks

  const first = frozen[0].startsOn, lastFreeze = new Date(Math.max(...frozen.map((week) => week.freezesAt.getTime())))
  const assignmentWindow = { effectiveFrom: { lt: lastFreeze }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: new Date(first.getTime() - 3600000) } }] }
  const candidates = await tx.user.findMany({
    where: { id: personId, assignments: { some: { ...assignmentWindow, role: 'EMPLOYEE', managerId: manager.userId } } },
    select: { id: true, accountStatus: true, createdAt: true, deactivatedAt: true, assignments: { where: assignmentWindow } },
  })
  const trackers = await tx.weeklyTracker.findMany({ where: { userId: personId, weekId: { in: frozen.map(({ id }) => id) }, OR: [
    { assignment: { role: 'EMPLOYEE', managerId: manager.userId } },
    { contextSnapshot: { path: ['managerId'], equals: manager.userId } },
    { userId: { in: candidates.map(({ id }) => id) } },
  ] }, include: { assignment: { select: { managerId: true, role: true } } } })
  const byWeek = new Map<string, typeof trackers>()
  for (const tracker of trackers) {
    const entries = byWeek.get(tracker.weekId) ?? []
    entries.push(tracker)
    byWeek.set(tracker.weekId, entries)
  }
  let proof: Awaited<ReturnType<typeof protection>> | undefined
  let sources: Map<string, Awaited<ReturnType<typeof historyPeople>>[number]> | undefined
  for (const row of frozen) {
    const week = weeks.get(isoDay(row.startsOn))!
    const required = new Set(candidates.filter((person) => {
      const assignment = assignmentForWeek(person.assignments, row.startsOn, row.freezesAt, manager.at)
      return assignment?.role === 'EMPLOYEE' && assignment.managerId === manager.userId && activeAt(person, new Date(row.freezesAt.getTime() - 1))
    }).map(({ id }) => id))
    let reliable = !!row.rosterCapturedAt && row.rosterCapturedAt >= row.freezesAt
    const weekTrackers = byWeek.get(row.id) ?? []
    for (const tracker of weekTrackers) {
      const context = snapshotContext(tracker.contextSnapshot, tracker.userId)
      const days = tracker.expectedWorkingDaysSnapshot
      const valid = context && tracker.snapshotAt && tracker.snapshotAt >= row.freezesAt && days !== null && Number.isInteger(days) && days >= 0 && days <= 5
      if (valid && context.role === 'EMPLOYEE' && context.managerId === manager.userId) {
        required.delete(tracker.userId)
        if (context.accountStatus === 'ACTIVE') week.members.set(tracker.userId, recordedMember(context, days))
      } else if (!valid && (tracker.assignment.role === 'EMPLOYEE' && tracker.assignment.managerId === manager.userId
        || required.has(tracker.userId) || (!!tracker.contextSnapshot && typeof tracker.contextSnapshot === 'object'
          && !Array.isArray(tracker.contextSnapshot) && tracker.contextSnapshot.managerId === manager.userId))) reliable = false
      else if (valid) required.delete(tracker.userId)
    }
    if (history && required.size && !proof) proof = await protection(tx)
    if (proof?.valid && proof.startedAt && proof.settings?.trackingStartsOn
      && row.startsOn >= proof.settings.trackingStartsOn && row.freezesAt >= proof.startedAt && required.size) {
      sources ??= new Map((await historyPeople(tx, candidates.map(({ id }) => id))).map((person) => [person.id, person]))
      const byOwner = new Map(weekTrackers.map((tracker) => [tracker.userId, tracker]))
      for (const userId of required) {
        const evidence = historyEvidence({ person: sources.get(userId) ?? null, tracker: byOwner.get(userId) ?? null }, row, proof, manager.at)
        const context = evidence.context
        if (evidence.code === 'CAPTURE_PENDING' && context?.managerId === manager.userId && context.role === 'EMPLOYEE'
          && context.accountStatus === 'ACTIVE') week.pending.set(userId, { id: userId, name: context.displayName, unitName: context.unitName! })
      }
    }
    week.kind = reliable && required.size === 0 ? 'FROZEN' : 'UNAVAILABLE'
  }
  if (history) {
    const ids = [...new Set(frozen.flatMap((row) => [...weeks.get(isoDay(row.startsOn))!.members.values()].filter(({ days }) => days === 0).map(({ id }) => id)))]
    const leaves = new Map<string, LeaveRecord[]>()
    if (ids.length) {
      const last = frozen.at(-1)!
      for (const leave of await tx.leaveRecord.findMany({ where: { userId: { in: ids }, startsOn: { lt: shiftDay(last.startsOn, 5) },
        OR: [{ actualReturnOn: { gt: first } }, { actualReturnOn: null, expectedReturnOn: { gt: first } }] } })) {
        const existing = leaves.get(leave.userId)
        if (existing) existing.push(leave)
        else leaves.set(leave.userId, [leave])
      }
    }
    for (const row of frozen) {
      for (const member of weeks.get(isoDay(row.startsOn))!.members.values()) {
        if (member.days === 0) member.fullLeave = fullLeave(leaves.get(member.id) ?? [], row.startsOn, row.freezesAt, manager.at)
      }
    }
  }
  return weeks
}

export function scopedTasks(weeks: Week[]): Prisma.WeeklyTaskWhereInput {
  return { deletedAt: null, OR: weeks.filter((week) => week.stored && week.members.size).map((week) => ({
    ownerId: { in: [...week.members.keys()] }, tracker: { weekId: week.stored!.id },
  })) }
}

export async function reporting(tx: Tx, dates: Date[], current: Date, manager: Parameters<typeof roster>[3], settings: TrackerSettings, history = false, personId?: string) {
  const rosters = await roster(tx, dates, current, manager, settings, { history })
  const weeks = new Map<string, ReportingWeek>()
  const byId = new Map<string, ReportingWeek>()
  for (const [date, rosterWeek] of rosters) {
    const week: ReportingWeek = { ...rosterWeek, submitted: new Set(), approved: 0, eligible: 0, inProgress: 0, counts: new Map() }
    weeks.set(date, week)
    if (week.stored) byId.set(week.stored.id, week)
  }
  const trackers = await tx.weeklyTracker.findMany({ where: { OR: [...byId].flatMap(([weekId, week]) => personId
    ? (week.members.has(personId) ? [{ weekId, userId: { in: [personId] } }] : [])
    : week.members.size ? [{ weekId, userId: { in: [...week.members.keys()] } }] : []) },
    select: { id: true, weekId: true, userId: true } })
  const trackerById = new Map(trackers.map((tracker) => [tracker.id, tracker]))
  const counts = await tx.weeklyTask.groupBy({ by: ['trackerId', 'ownerId', 'status'], where: { deletedAt: null, trackerId: { in: [...trackerById.keys()] } }, _count: { _all: true } })
  for (const row of counts) {
    const tracker = trackerById.get(row.trackerId)!
    if (row.ownerId !== tracker.userId) continue
    const week = byId.get(tracker.weekId)!
    const person = week.counts.get(row.ownerId) ?? { tasks: 0, approved: 0, eligible: 0 }
    person.tasks += row._count._all
    week.counts.set(row.ownerId, person)
    week.submitted.add(tracker.userId)
    if (row.status === 'IN_PROGRESS') week.inProgress += row._count._all
    if (week.members.get(tracker.userId)!.days <= 0 || row.status === 'CANCELLED' || row.status === 'AWAITING_APPROVAL') continue
    week.eligible += row._count._all
    person.eligible += row._count._all
    if (row.status === 'APPROVED') {
      week.approved += row._count._all
      person.approved += row._count._all
    }
  }
  return weeks
}

export const rate = (count: number, total: number) => total ? Math.round(100 * count / total) : 0
export function trendPoint(week: ReportingWeek) {
  if (week.kind !== 'CURRENT' && week.kind !== 'FROZEN') return { week: isoDay(week.start), submission: null, completion: null }
  const expected = [...week.members.values()].filter(({ days }) => days > 0)
  return { week: isoDay(week.start), submission: rate(expected.filter(({ id }) => week.submitted.has(id)).length, expected.length),
    completion: rate(week.approved, week.eligible) }
}

export function reportingMetrics(weeks: ReportingWeek[], awaiting: number | null): DashboardMetrics {
  if (weeks.some((week) => week.kind === 'UNAVAILABLE') || (weeks.length && weeks.every((week) => week.kind === 'NOT_OPEN'))) {
    return { members: null, completion: null, inProgress: null, awaiting }
  }
  return { members: new Set(weeks.flatMap((week) => [...week.members.keys()])).size,
    completion: rate(weeks.reduce((total, week) => total + week.approved, 0), weeks.reduce((total, week) => total + week.eligible, 0)),
    inProgress: weeks.reduce((total, week) => total + week.inProgress, 0), awaiting }
}

export function overlapsWorkweek(start: Date, end: Date, week: Date) {
  return start < shiftDay(week, 5) && end > week
}
