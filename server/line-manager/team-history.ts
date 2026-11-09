import type { Prisma, PrismaClient } from '../../src/generated/prisma/client.ts'
import type { TeamTaskDetail } from '../../src/features/line-manager/dashboard-view.ts'
import type { TeamHistory, TeamHistoryRow, TeamPeople, TeamPerson, TeamWeek, TeamWeekTask } from '../../src/features/line-manager/team-history-contracts.ts'
import type { Actor } from '../auth/owner-write.ts'
import { isoDay } from '../data-model/calendar.ts'
import { EmployeeFailure, monday } from '../employee/calendar.ts'
import { pageOffset } from '../employee/reads.ts'
import { teamHistoryQuery, teamWeekQuery } from './query.ts'
import { actorLeave, clock, readBounds, slice } from './reads.ts'
import { rate, reporting, roster } from './reporting.ts'
import { managerPrincipal } from './scope.ts'
import type { Tx } from './scope.ts'

const unavailable = () => new EmployeeFailure('SERVICE_UNAVAILABLE', 503)
const notFound = () => new EmployeeFailure('NOT_FOUND', 404)
const normalize = (label: string) => label.trim().toLowerCase()
const byName = (a: TeamPerson, b: TeamPerson) => normalize(a.label).localeCompare(normalize(b.label)) || a.id.localeCompare(b.id)
const matches = ({ label, unit }: TeamPerson, search: string) => normalize(label).includes(search) || normalize(unit).includes(search)
const option = (member: { id: string; name: string; unitName: string }): TeamPerson => ({ id: member.id, label: member.name, unit: member.unitName })

async function setup(tx: Tx, actor: Actor) {
  const principal = await managerPrincipal(tx, actor)
  const settings = await tx.trackerSettings.findUnique({ where: { id: 'workforce-group' } })
  if (!settings) throw unavailable()
  return { principal: { ...principal, name: principal.staff.person.name?.trim() || 'Staff member' }, settings }
}

function responseClock(actor: Actor, at: Date, weeks: { freezesAt?: Date }[], extra: Date[] = []) {
  return clock(at, actor.context.session.expiresAt, [...weeks.flatMap(({ freezesAt }) => freezesAt ? [freezesAt] : []), ...extra])
}

export async function readTeamHistory(db: PrismaClient, actor: Actor, url: string): Promise<TeamHistory> {
  return db.$transaction(async (tx) => {
    const { principal, settings } = await setup(tx, actor)
    const { at } = principal
    const query = teamHistoryQuery(url, at, false)
    const weeks = [...(await reporting(tx, query.included, query.current, principal, settings, true)).values()]
    const unavailableWeeks: string[] = [], notOpenWeeks: string[] = [], outsideCoverageWeeks: string[] = []
    const rows: TeamHistoryRow[] = []
    let expected = 0, submitted = 0, approved = 0, eligible = 0, personWeeks = 0
    let selectedPerson: TeamPerson | null = null
    for (const week of weeks.toReversed()) {
      const date = isoDay(week.start)
      if (week.kind === 'UNAVAILABLE') unavailableWeeks.push(date)
      if (week.kind === 'NOT_OPEN') notOpenWeeks.push(date)
      if (week.kind === 'OUTSIDE_COVERAGE') outsideCoverageWeeks.push(date)
      for (const member of week.members.values()) {
        const person = option(member)
        if (person.id === query.personId && !selectedPerson) selectedPerson = person
        const counts = week.counts.get(member.id)
        const tasks = counts?.tasks ?? 0
        const participation = member.days > 0 ? (tasks ? 'SUBMITTED' : 'NOT_SUBMITTED') : member.fullLeave ? 'ON_LEAVE' : 'NOT_EXPECTED'
        if ((query.personId && person.id !== query.personId) || !matches(person, query.search)
          || (query.participation !== 'ALL' && query.participation !== participation)) continue
        personWeeks++
        if (member.days > 0) {
          expected++
          if (tasks) submitted++
        }
        approved += counts?.approved ?? 0
        eligible += counts?.eligible ?? 0
        rows.push({ ...person, week: date, tasks, participation,
          completion: member.days > 0 && week.kind !== 'UNAVAILABLE' ? rate(counts?.approved ?? 0, counts?.eligible ?? 0) : null })
      }
      for (const member of week.pending.values()) {
        const person = option(member)
        if (query.participation === 'ALL' && (!query.personId || person.id === query.personId) && matches(person, query.search)) {
          rows.push({ ...person, week: date, participation: null, tasks: null, completion: null })
        }
      }
    }
    rows.sort((a, b) => b.week.localeCompare(a.week) || byName(a, b))
    const reliable = unavailableWeeks.length === 0 && (weeks.length === 0 || weeks.some(({ kind }) => kind === 'CURRENT' || kind === 'FROZEN'))
    return { ...responseClock(actor, at, weeks), selection: query.selection, includedWeeks: query.included.map(isoDay),
      rows: slice(rows, query.page), selectedPerson, availability: { unavailableWeeks, notOpenWeeks, outsideCoverageWeeks },
      summary: reliable ? { personWeeks, submission: rate(submitted, expected), completion: rate(approved, eligible) } : null }
  }, readBounds)
}

export async function readTeamPeople(db: PrismaClient, actor: Actor, url: string): Promise<TeamPeople> {
  return db.$transaction(async (tx) => {
    const { principal, settings } = await setup(tx, actor)
    const query = teamHistoryQuery(url, principal.at, true)
    const weeks = [...(await roster(tx, query.included, query.current, principal, settings)).values()]
    const people = new Map<string, TeamPerson>()
    for (const week of weeks.toReversed()) {
      for (const member of week.members.values()) {
        const person = option(member)
        if (!people.has(person.id) && matches(person, query.search)) people.set(person.id, person)
      }
    }
    return { ...responseClock(actor, principal.at, weeks), people: slice([...people.values()].sort(byName), query.page) }
  }, readBounds)
}

async function scopedWeek(tx: Tx, principal: Parameters<typeof roster>[3], settings: Awaited<ReturnType<typeof setup>>['settings'], start: Date, personId: string) {
  const date = isoDay(start)
  const week = (await roster(tx, [start], monday(principal.at), principal, settings, { history: true, personId })).get(date)!
  const member = week.members.get(personId)
  if (!member) {
    if (week.pending.has(personId)) throw unavailable()
    throw notFound()
  }
  const frozen = week.kind !== 'CURRENT'
  const archive = frozen && week.stored ? await tx.historyWeekSnapshot.findUnique({
    where: { weekId: week.stored.id }, select: { id: true },
  }) : null
  const person = { ...option(member), manager: member.managerName, business: member.businessName, department: member.department }
  return { week, member, person, frozen, archive }
}

export async function teamTaskTarget(tx: Tx, principal: Parameters<typeof roster>[3], taskId: string) {
  const task = await tx.weeklyTask.findFirst({ where: { id: taskId, deletedAt: null }, include: { tracker: { include: { week: true } } } })
  const settings = await tx.trackerSettings.findUnique({ where: { id: 'workforce-group' } })
  if (!task || task.ownerId !== task.tracker.userId || !settings) return null
  try {
    const start = task.tracker.week.startsOn
    const { frozen, archive } = await scopedWeek(tx, principal, settings, start, task.ownerId)
    if (!frozen && task.tracker.snapshotAt) return null
    if (archive && !await tx.historyTaskSnapshot.findFirst({ where: { id: taskId, historyWeekId: archive.id, ownerId: task.ownerId }, select: { id: true } })) return null
    return { kind: 'TEAM_TASK' as const, taskId, week: isoDay(start) }
  } catch (error) {
    if (error instanceof EmployeeFailure) return null
    throw error
  }
}

const taskInclude = { approvals: { take: 1, orderBy: { attemptNumber: 'desc' }, include: { decision: true } } } satisfies Prisma.WeeklyTaskInclude
type TaskWithReview = Prisma.WeeklyTaskGetPayload<{ include: typeof taskInclude }>
type TaskContent = Pick<TaskWithReview, 'title' | 'activity' | 'startsOn' | 'endsOn' | 'blockerReason' | 'carryRequested'>
  & ({ carriedFrom: boolean } | { carriedFromId: string | null })
const chronological = [{ startsOn: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }] satisfies Prisma.WeeklyTaskOrderByWithRelationInput[]
const conversationOrder = [{ createdAt: 'asc' }, { id: 'asc' }] as const

function projectTask(task: TaskWithReview, source: TaskContent): TeamWeekTask {
  return { id: task.id, title: source.title, activity: source.activity, status: task.status,
    startsOn: isoDay(source.startsOn), endsOn: isoDay(source.endsOn),
    carryRequested: source.carryRequested, carriedFrom: 'carriedFrom' in source ? source.carriedFrom : !!source.carriedFromId,
    reason: task.status === 'DECLINED' ? task.approvals[0]?.decision?.reason ?? null : source.blockerReason }
}

async function taskPage(tx: Tx, where: Prisma.WeeklyTaskWhereInput, archiveId: string | undefined, personId: string, page: number) {
  const total = await tx.weeklyTask.count({ where })
  const skip = pageOffset(page, total)
  const tasks = skip === null ? [] : await tx.weeklyTask.findMany({ where, skip, take: 25, orderBy: chronological, include: taskInclude })
  const captured = new Map(archiveId && tasks.length ? (await tx.historyTaskSnapshot.findMany({
    where: { historyWeekId: archiveId, ownerId: personId, id: { in: tasks.map(({ id }) => id) } },
  })).map((task) => [task.id, task]) : [])
  const items = tasks.map((task) => {
    const saved = captured.get(task.id)
    if (archiveId && !saved) throw unavailable()
    return projectTask(task, saved ?? task)
  })
  return { total, page, pageSize: 25 as const, items }
}

export async function readTeamWeek(db: PrismaClient, actor: Actor, personId: string, start: Date, url: string): Promise<TeamWeek> {
  return db.$transaction(async (tx) => {
    const { principal, settings } = await setup(tx, actor)
    const query = teamWeekQuery(url)
    const { week, member, person, frozen, archive } = await scopedWeek(tx, principal, settings, start, personId)
    const where: Prisma.WeeklyTaskWhereInput = { ownerId: personId, deletedAt: null,
      tracker: { userId: personId, weekId: week.stored?.id ?? '' } }
    const tasks = await taskPage(tx, { ...where, status: query.status ?? undefined }, archive?.id, personId, query.page)
    const attention = await taskPage(tx, { ...where, status: { in: ['BLOCKED', 'DECLINED'] } }, archive?.id, personId, query.attentionPage)
    return { ...responseClock(actor, principal.at, [week]), week: isoDay(start), person, expectedDays: member.days, frozen, tasks, attention }
  }, readBounds)
}

async function conversation(tx: Tx, taskId: string, archived: boolean, page: number): Promise<TeamTaskDetail['comments']> {
  const where = { weeklyTaskId: taskId }, historical = { taskSnapshotId: taskId }
  const total = archived ? await tx.historyCommentSnapshot.count({ where: historical }) : await tx.taskComment.count({ where })
  const skip = pageOffset(page, total)
  const items: TeamTaskDetail['comments']['items'] = []
  if (skip !== null) {
    if (archived) {
      const rows = await tx.historyCommentSnapshot.findMany({ where: historical, skip, take: 25, orderBy: [...conversationOrder] })
      items.push(...rows.map(({ id, authorName, body, createdAt }) => ({ id, authorName, body, createdAt: createdAt.toISOString() })))
    } else {
      const rows = await tx.taskComment.findMany({ where, skip, take: 25, orderBy: [...conversationOrder], include: { author: { select: { name: true } } } })
      items.push(...rows.map(({ id, author, body, createdAt }) => ({ id, authorName: author.name?.trim() || 'Staff member', body, createdAt: createdAt.toISOString() })))
    }
  }
  return { items, page, pageSize: 25, total }
}

export async function readTeamTask(db: PrismaClient, actor: Actor, taskId: string, page: number): Promise<TeamTaskDetail> {
  return db.$transaction(async (tx) => {
    const { principal, settings } = await setup(tx, actor)
    const { at, userId } = principal
    const task = await tx.weeklyTask.findFirst({ where: { id: taskId, deletedAt: null },
      include: { ...taskInclude, tracker: { include: { week: true } } } })
    if (!task || task.ownerId !== task.tracker.userId) throw notFound()
    const start = task.tracker.week.startsOn
    const { week, member, person, frozen, archive } = await scopedWeek(tx, principal, settings, start, task.ownerId)
    if (!frozen && task.tracker.snapshotAt) throw unavailable()
    const captured = archive ? await tx.historyTaskSnapshot.findFirst({ where: { id: taskId, historyWeekId: archive.id, ownerId: task.ownerId } }) : null
    if (archive && !captured) throw unavailable()
    const leave = frozen ? null : await actorLeave(tx, userId, at)
    const request = task.approvals[0]
    return {
      ...responseClock(actor, at, [week], leave ? [leave.transition] : []), week: isoDay(start), frozen,
      task: projectTask(task, captured ?? task), ownerName: member.name, ownerId: member.id,
      owner: { business: person.business, unit: person.unit, manager: person.manager, department: person.department },
      canComment: !frozen && !leave?.paused,
      reason: frozen ? 'Read-only record' : leave?.paused ? 'Your work actions are paused while you are on leave.' : null,
      review: request ? { attempt: request.attemptNumber, state: request.state, submittedAt: request.submittedAt.toISOString(),
        decision: request.decision?.decision ?? null, reason: request.decision?.reason ?? null, decidedAt: request.decision?.decidedAt.toISOString() ?? null } : null,
      comments: await conversation(tx, taskId, !!captured, page),
    }
  }, readBounds)
}
