import type { PrismaClient } from '../../src/generated/prisma/client.ts'
import type { BlockerRow, ReviewAttempt, ReviewDetail, ReviewList, ReviewPeople, ReviewPerson, ReviewRow, ReviewSummary } from '../../src/features/line-manager/approvals-contracts.ts'
import { approvalTabs } from '../../src/features/line-manager/approvals-contracts.ts'
import type { ApprovalTab } from '../../src/features/line-manager/approvals-contracts.ts'
import type { Actor } from '../auth/owner-write.ts'
import { isoDay, shiftDay } from '../data-model/calendar.ts'
import { EmployeeFailure, monday } from '../employee/calendar.ts'
import { pageOffset } from '../employee/reads.ts'
import { taskIdentity } from '../employee/task-validation.ts'
import { page, period, selectors } from './query.ts'
import { clock, readBounds, slice } from './reads.ts'
import { roster, scopedTasks } from './reporting.ts'
import { groupPending, pendingReviews } from './review-queue.ts'
import { exactReview, pendingAuthority, reviewInclude, reviewerScope, submittedWork } from './review-scope.ts'
import type { ReviewSource } from './review-scope.ts'
import { managerPrincipal } from './scope.ts'
import type { Tx } from './scope.ts'

const periodKeys = ['week', 'from', 'to'] as const
const notFound = () => new EmployeeFailure('NOT_FOUND', 404)
const unavailable = () => new EmployeeFailure('SERVICE_UNAVAILABLE', 503)
const invalid = () => new EmployeeFailure('INVALID_INPUT', 400)

function selection(url: string, at: Date, kind: 'list' | 'people' | 'review') {
  const keys = kind === 'list' ? ['tab', 'personId'] : kind === 'people' ? ['tab', 'search'] : []
  const query = selectors(url, [...periodKeys, ...keys, 'page'])
  const selected = periodKeys.some((key) => query.has(key)) ? period(query, at) : null
  const tab = query.get('tab') ?? 'AWAITING'
  if (!approvalTabs.some((value) => value === tab)) throw invalid()
  const search = query.get('search') ?? ''
  if (search.length > 120 || search.includes('\0')) throw invalid()
  return { tab: tab as ApprovalTab, selection: selected?.selection ?? null,
    included: selected ? new Set(selected.included.map(isoDay)) : null,
    personId: query.has('personId') ? taskIdentity(query.get('personId')) : null,
    search: search.trim().toLowerCase(), page: page(query, 'page') }
}

async function setup(tx: Tx, actor: Actor) {
  const principal = await managerPrincipal(tx, actor)
  const scope = await reviewerScope(tx, principal.userId, principal.at)
  const settings = await tx.trackerSettings.findUnique({ where: { id: 'workforce-group' } })
  if (!settings) throw unavailable()
  return { principal: { ...principal, name: principal.staff.person.name?.trim() || 'Staff member' }, scope, settings }
}

const attempt = (row: ReviewSource, submitted: NonNullable<ReturnType<typeof submittedWork>>, unit: string, note: ReviewAttempt['note'] = null): ReviewAttempt =>
  ({ ...submitted, requestId: row.id, taskId: row.task.id, revision: row.task.revision, submittedAt: row.submittedAt.toISOString(), unit, note })

const decision = (row: ReviewSource) => row.decision && ({
  kind: row.decision.decision, reason: row.decision.reason, decidedAt: row.decision.decidedAt.toISOString(),
  actor: row.decision.method === 'AUTOMATIC' ? 'System' : row.decision.actor?.name?.trim() || 'Staff member', method: row.decision.method,
  coveredManager: row.decision.principal?.name?.trim() || null,
})

async function note(tx: Tx, row: ReviewSource) {
  const found = await tx.taskComment.findFirst({ where: { weeklyTaskId: row.task.id, authorId: row.submittedById, createdAt: { lte: row.submittedAt } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { body: true, createdAt: true } })
  return found ? { body: found.body, createdAt: found.createdAt.toISOString() } : null
}

async function listData(tx: Tx, actor: Actor, url: string, people: boolean) {
  const { principal, scope, settings } = await setup(tx, actor)
  const { at } = principal
  const query = selection(url, at, people ? 'people' : 'list')
  const current = monday(at), currentDay = isoDay(current)
  const pending = await pendingReviews(tx, scope)
  const selected = (week: string) => !query.included || query.included.has(week)
  const selectedPending = pending.filter(({ row, week }) => selected(week) && (!query.personId || row.submittedById === query.personId))
  const { groups, routingUnavailableCount } = groupPending(selectedPending, at, settings.overdueApprovalDays)
  const dates = (await tx.workWeek.findMany({ where: { startsOn: { lte: current } }, orderBy: { startsOn: 'asc' }, select: { startsOn: true } }))
    .map(({ startsOn }) => startsOn).filter((date) => selected(isoDay(date)))
  if (selected(currentDay) && !dates.some((date) => isoDay(date) === currentDay)) dates.push(current)
  const weeks = await roster(tx, dates, current, principal, settings)
  const { deletedAt: _deletedAt, ...scoped } = scopedTasks([...weeks.values()])
  const tasks = query.personId ? { AND: [scoped, { ownerId: query.personId }] } : scoped
  const decided = await tx.approvalRequest.findMany({ where: {
    state: 'DECIDED', decision: { method: 'HUMAN', decidedAt: { lte: at } }, task: tasks,
  }, include: reviewInclude(at), orderBy: [{ decision: { decidedAt: 'desc' } }, { decision: { id: 'desc' } }] })
  const approved: ReviewRow[] = [], declined: ReviewRow[] = []
  for (const row of decided) {
    const submitted = submittedWork(row), outcome = decision(row)
    if (!submitted || !outcome) continue
    const member = weeks.get(submitted.week)?.members.get(submitted.ownerId)
    if (!member) continue
    const result = { ...attempt(row, submitted, member.unitName), decision: outcome }
    if (outcome.kind === 'APPROVE') approved.push(result)
    else declined.push(result)
  }
  const currentWeek = weeks.get(currentDay)
  const blockerScope = scopedTasks(currentWeek?.kind === 'CURRENT' ? [currentWeek] : [])
  const blockerTasks = await tx.weeklyTask.findMany({ where: { AND: [blockerScope, { status: 'BLOCKED', ownerId: query.personId ?? undefined }] },
    orderBy: [{ startsOn: 'asc' }, { id: 'asc' }] })
  const blockers: BlockerRow[] = blockerTasks.flatMap((task) => {
    const member = currentWeek?.members.get(task.ownerId)
    return member ? [{ taskId: task.id, ownerId: task.ownerId, ownerName: member.name, unit: member.unitName, title: task.title,
      activity: task.activity, startsOn: isoDay(task.startsOn), reason: task.blockerReason ?? '', carried: task.carryRequested || !!task.carriedFromId }] : []
  })
  const pendingWeeks = pending.filter(({ authority }) => authority.state === 'ALLOWED').map(({ week }) => week)
  const transitions = [...scope.transitions, ...selectedPending.map(({ row }) => shiftDay(row.submittedAt, Math.floor((at.getTime() - row.submittedAt.getTime()) / 86400000) + 1))]
  if (currentWeek?.freezesAt) transitions.push(currentWeek.freezesAt)
  return { query, groups, approved, declined, blockers, routingUnavailableCount, pendingWeeks, scope,
    clock: clock(at, actor.context.session.expiresAt, transitions) }
}

export async function readApprovals(db: PrismaClient, actor: Actor, url: string): Promise<ReviewList> {
  return db.$transaction(async (tx) => {
    const data = await listData(tx, actor, url, false)
    const { query, groups, approved, declined, blockers, routingUnavailableCount } = data
    return { ...data.clock, selection: query.selection, weeks: [...new Set(data.pendingWeeks)].sort().reverse(), routingUnavailableCount,
      workPaused: data.scope.paused, counts: { AWAITING: groups.length, APPROVED: approved.length, DECLINED: declined.length, BLOCKERS: blockers.length },
      groups: slice(groups, query.page), decisions: slice(query.tab === 'DECLINED' ? declined : approved, query.page), blockers: slice(blockers, query.page) }
  }, readBounds)
}

export async function readApprovalPeople(db: PrismaClient, actor: Actor, url: string): Promise<ReviewPeople> {
  return db.$transaction(async (tx) => {
    const { query, groups, approved, declined, blockers, clock: timestamp } = await listData(tx, actor, url, true)
    const rows = query.tab === 'AWAITING' ? groups.map((row) => ({ id: row.employeeId, label: row.employeeName, unit: row.unitName }))
      : (query.tab === 'APPROVED' ? approved : query.tab === 'DECLINED' ? declined : blockers)
        .map((row) => ({ id: row.ownerId, label: row.ownerName, unit: row.unit }))
    const people = new Map<string, typeof rows[number]>()
    for (const row of rows) {
      if (!people.has(row.id) && [row.label, row.unit].some((value) => value.toLowerCase().includes(query.search))) people.set(row.id, row)
    }
    return { ...timestamp, people: slice([...people.values()].sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id)), query.page) }
  }, readBounds)
}

export async function reviewSummary(tx: Tx, actor: Actor): Promise<ReviewSummary> {
  const { principal, scope, settings } = await setup(tx, actor)
  const pending = await pendingReviews(tx, scope)
  const { groups, routingUnavailableCount } = groupPending(pending, principal.at, settings.overdueApprovalDays)
  return { ...clock(principal.at, actor.context.session.expiresAt, scope.transitions), employeeCount: groups.length,
    requestCount: groups.reduce((count, row) => count + row.taskCount, 0), routingUnavailableCount, workPaused: scope.paused }
}

export async function readReviewPerson(db: PrismaClient, actor: Actor, url: string, personId: string): Promise<ReviewPerson> {
  return db.$transaction(async (tx) => {
    const { scope, principal } = await setup(tx, actor)
    const query = selection(url, principal.at, 'review')
    const all = (await pendingReviews(tx, scope)).filter(({ row, authority, week }) => row.submittedById === personId && authority.state === 'ALLOWED'
      && (!query.included || query.included.has(week)))
    if (!all.length) throw notFound()
    const selected = slice(all, query.page)
    const items: ReviewAttempt[] = []
    for (const { row, authority } of selected.items) {
      if (authority.state === 'ALLOWED') items.push(attempt(row, authority.submitted, authority.employee.unit?.name ?? '', await note(tx, row)))
    }
    return { ...clock(principal.at, actor.context.session.expiresAt, scope.transitions), person: { id: personId, label: all[0].row.submitter.name?.trim() || 'Staff member' },
      requests: { ...selected, items }, workPaused: scope.paused }
  }, readBounds)
}

export async function readReviewDetail(db: PrismaClient, actor: Actor, id: string, commentPage: number): Promise<ReviewDetail> {
  return db.$transaction(async (tx) => {
    const { scope, principal, settings } = await setup(tx, actor)
    const { at } = principal
    const row = await exactReview(tx, id, at)
    if (!row) throw notFound()
    const week = row.task.tracker.week
    const frozen = week.freezesAt <= at
    const pending = pendingAuthority(scope, row, 'read')
    const outcome = row.state === 'DECIDED' && row.decision?.method === 'HUMAN' ? decision(row) : null
    const member = outcome && pending.state !== 'ALLOWED' ? (await roster(tx, [week.startsOn], monday(at), principal, settings, { personId: row.submittedById }))
      .get(isoDay(week.startsOn))?.members.get(row.submittedById) : null
    if (pending.state !== 'ALLOWED' && !member) {
      if (pending.state === 'UNAVAILABLE') throw unavailable()
      throw notFound()
    }
    const submitted = pending.state === 'ALLOWED' ? pending.submitted : submittedWork(row)
    if (!submitted) throw unavailable()
    const archive = frozen && week.historySnapshot ? await tx.historyTaskSnapshot.findFirst({
      where: { id: row.task.id, ownerId: row.submittedById, historyWeekId: week.historySnapshot.id }, select: { id: true },
    }) : null
    if (frozen && week.historySnapshot && !archive) throw unavailable()
    const where = { weeklyTaskId: row.task.id }, historical = { taskSnapshotId: row.task.id }
    const total = archive ? await tx.historyCommentSnapshot.count({ where: historical }) : await tx.taskComment.count({ where })
    const skip = pageOffset(commentPage, total)
    const orderBy = [{ createdAt: 'asc' as const }, { id: 'asc' as const }]
    const items = skip === null ? [] : archive
      ? (await tx.historyCommentSnapshot.findMany({ where: historical, skip, take: 25, orderBy })).map((item) => ({
        id: item.id, author: item.authorName, body: item.body, createdAt: item.createdAt.toISOString(),
      }))
      : (await tx.taskComment.findMany({ where, skip, take: 25, orderBy, include: { author: { select: { name: true } } } })).map((item) => ({
        id: item.id, author: item.author.name?.trim() || 'Staff member', body: item.body, createdAt: item.createdAt.toISOString(),
      }))
    return { ...clock(at, actor.context.session.expiresAt, [...scope.transitions, week.freezesAt]), frozen,
      attempt: attempt(row, submitted, pending.state === 'ALLOWED' ? pending.employee.unit?.name ?? '' : member!.unitName, await note(tx, row)),
      mode: pending.state !== 'ALLOWED' ? 'HISTORY' : pending.route.reliefId ? 'RELIEF' : 'PERMANENT',
      coveredManager: pending.state === 'ALLOWED' ? pending.route.managerName : member!.managerName,
      decision: outcome, workPaused: scope.paused, canDecide: pending.state === 'ALLOWED' && !scope.paused,
      canComment: (pending.state === 'ALLOWED' || !!member) && !row.task.deletedAt && !row.task.tracker.snapshotAt && !scope.paused
        && !frozen && isoDay(week.startsOn) === isoDay(monday(at)),
      comments: { items, total, page: commentPage, pageSize: 25 } }
  }, readBounds)
}
