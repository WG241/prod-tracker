import { Prisma } from '../../src/generated/prisma/client.ts'
import type { DecisionKind, PrismaClient } from '../../src/generated/prisma/client.ts'
import type { BlockerRow, ReviewAttempt, ReviewDetail, ReviewList, ReviewPeople, ReviewPerson, ReviewRow, ReviewSummary } from '../../src/features/line-manager/approvals-contracts.ts'
import { approvalTabs } from '../../src/features/line-manager/approvals-contracts.ts'
import type { ApprovalTab } from '../../src/features/line-manager/approvals-contracts.ts'
import type { Actor } from '../auth/owner-write.ts'
import { isoDay, shiftDay } from '../data-model/calendar.ts'
import { EmployeeFailure, monday } from '../employee/calendar.ts'
import { pageOffset } from '../employee/reads.ts'
import { taskIdentity } from '../employee/task-validation.ts'
import { decisionCounts, decisionPage, decisionPeople, decisionScope, decisionWeeks } from './approval-history.ts'
import { page, period, selectors } from './query.ts'
import { clock, readBounds, slice } from './reads.ts'
import { roster, scopedTasks } from './reporting.ts'
import { groupPending, pendingCounts, pendingReviews } from './review-queue.ts'
import { decisionReadiness, exactReview, pendingAuthority, reviewInclude, reviewerScope, submittedWork } from './review-scope.ts'
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

async function pageNotes(tx: Tx, ids: string[]) {
  if (!ids.length) return new Map<string, ReviewAttempt['note']>()
  const notes = await tx.$queryRaw<{ id: string; body: string; createdAt: Date }[]>`
    SELECT r.id, latest.body, latest."createdAt" FROM "ApprovalRequest" r
    CROSS JOIN LATERAL (
      SELECT c.body, c."createdAt" FROM "TaskComment" c
      WHERE c."weeklyTaskId" = r."weeklyTaskId" AND c."authorId" = r."submittedById" AND c."createdAt" <= r."submittedAt"
      ORDER BY c."createdAt" DESC, c.id DESC LIMIT 1
    ) latest WHERE r.id IN (${Prisma.join(ids)})
  `
  return new Map(notes.map(({ id, body, createdAt }) => [id, { body, createdAt: createdAt.toISOString() }]))
}

type Query = ReturnType<typeof selection>
type Setup = Awaited<ReturnType<typeof setup>>

const includesWeek = (query: Query, week: string) => !query.included || query.included.has(week)
const historyKind = (tab: ApprovalTab): DecisionKind | null => tab === 'APPROVED' ? 'APPROVE' : tab === 'DECLINED' ? 'DECLINE' : null

async function pendingList(tx: Tx, { principal: { at }, scope, settings }: Setup, query: Query) {
  const pending = await pendingReviews(tx, scope)
  const selectedPending = pending.filter(({ row, week }) => includesWeek(query, week) && (!query.personId || row.submittedById === query.personId))
  const pendingWeeks = pending.filter(({ authority }) => authority.state === 'ALLOWED').map(({ week }) => week)
  const transitions = selectedPending.map(({ row }) => shiftDay(row.submittedAt, Math.floor((at.getTime() - row.submittedAt.getTime()) / 86400000) + 1))
  return { ...groupPending(selectedPending, at, settings.overdueApprovalDays), pendingWeeks, transitions }
}

async function liveWeek(tx: Tx, { principal, settings }: Setup, query: Query, current: Date) {
  const currentDay = isoDay(current)
  if (!includesWeek(query, currentDay)) return undefined
  // A frozen current week is covered by recorded decision membership.
  const stored = await tx.workWeek.findUnique({ where: { startsOn: current }, select: { freezesAt: true } })
  if (stored && stored.freezesAt <= principal.at) return undefined
  const weeks = await roster(tx, [current], current, principal, settings, { personId: query.personId ?? undefined })
  const week = weeks.get(currentDay)
  return week?.kind === 'CURRENT' ? week : undefined
}

type LiveWeek = Awaited<ReturnType<typeof liveWeek>>

function blockerWhere(week: LiveWeek) {
  return { ...scopedTasks(week ? [week] : []), status: 'BLOCKED' as const }
}

function historyScope({ principal }: Setup, query: Query, current: Date, week: LiveWeek) {
  return decisionScope({ managerId: principal.userId, at: principal.at, current, included: query.included,
    personId: query.personId, currentMembers: week?.members.values() ?? [] })
}

async function decidedRows(tx: Tx, scope: ReturnType<typeof decisionScope>, kind: DecisionKind, page: number, total: number, at: Date) {
  const ids = await decisionPage(tx, scope, kind, page, total)
  if (!ids.length) return []
  const rows = await tx.approvalRequest.findMany({ where: { id: { in: ids.map(({ requestId }) => requestId) } }, include: reviewInclude(at) })
  const byId = new Map(rows.map((row) => [row.id, row]))
  return ids.flatMap(({ requestId, unit }): ReviewRow[] => {
    const row = byId.get(requestId)
    if (!row) return []
    const submitted = submittedWork(row), outcome = decision(row)
    return submitted && outcome ? [{ ...attempt(row, submitted, unit), decision: outcome }] : []
  })
}

async function blockerRows(tx: Tx, week: LiveWeek, page: number, total: number) {
  const skip = pageOffset(page, total)
  if (!week || skip === null || !total) return []
  const tasks = await tx.weeklyTask.findMany({ where: blockerWhere(week), skip, take: 25, orderBy: [{ startsOn: 'asc' }, { id: 'asc' }] })
  return tasks.map((task): BlockerRow => {
    const member = week.members.get(task.ownerId)!
    return { taskId: task.id, ownerId: task.ownerId, ownerName: member.name, unit: member.unitName, title: task.title,
      activity: task.activity, startsOn: isoDay(task.startsOn), reason: task.blockerReason ?? '', carried: task.carryRequested || !!task.carriedFromId }
  })
}

export async function readApprovals(db: PrismaClient, actor: Actor, url: string): Promise<ReviewList> {
  return db.$transaction(async (tx) => {
    const context = await setup(tx, actor)
    const { principal: { at }, scope } = context
    const query = selection(url, at, 'list')
    const current = monday(at)
    const { groups, pendingWeeks, routingUnavailableCount, transitions } = await pendingList(tx, context, query)
    const kind = historyKind(query.tab)
    const unfiltered = { ...query, included: null }
    const live = await liveWeek(tx, context, kind ? unfiltered : query, current)
    const week = includesWeek(query, isoDay(current)) ? live : undefined
    const history = historyScope(context, query, current, week)
    const decided = await decisionCounts(tx, history)
    const blockerTotal = week?.members.size ? await tx.weeklyTask.count({ where: blockerWhere(week) }) : 0
    const weeks = kind ? await decisionWeeks(tx, historyScope(context, unfiltered, current, live), kind)
      : query.tab === 'BLOCKERS' ? [isoDay(current)] : [...new Set(pendingWeeks)].sort().reverse()
    const decisionTotal = decided[query.tab === 'DECLINED' ? 'DECLINED' : 'APPROVED']
    const decisions = kind ? await decidedRows(tx, history, kind, query.page, decisionTotal, at) : []
    const blockers = query.tab === 'BLOCKERS' ? await blockerRows(tx, week, query.page, blockerTotal) : []
    return { ...clock(at, actor.context.session.expiresAt, [...scope.transitions, ...transitions, ...(week?.freezesAt ? [week.freezesAt] : [])]),
      selection: query.selection, weeks, routingUnavailableCount, workPaused: scope.paused,
      counts: { AWAITING: groups.length, ...decided, BLOCKERS: blockerTotal }, groups: slice(groups, query.page),
      decisions: { items: decisions, page: query.page, pageSize: 25, total: decisionTotal },
      blockers: { items: blockers, page: query.page, pageSize: 25, total: blockerTotal } }
  }, readBounds)
}

export async function readApprovalPeople(db: PrismaClient, actor: Actor, url: string): Promise<ReviewPeople> {
  return db.$transaction(async (tx) => {
    const context = await setup(tx, actor)
    const { principal: { at }, scope } = context
    const query = selection(url, at, 'people')
    let rows: ReviewPeople['people']['items']
    const transitions = [...scope.transitions]
    if (query.tab === 'AWAITING') {
      const pending = await pendingList(tx, context, query)
      rows = pending.groups.map((row) => ({ id: row.employeeId, label: row.employeeName, unit: row.unitName }))
    } else {
      const current = monday(at)
      const week = await liveWeek(tx, context, query, current)
      if (week?.freezesAt) transitions.push(week.freezesAt)
      const kind = historyKind(query.tab)
      if (kind) rows = await decisionPeople(tx, historyScope(context, query, current, week), kind)
      else if (week?.members.size) {
        const owners = await tx.weeklyTask.groupBy({ by: ['ownerId'], where: blockerWhere(week) })
        rows = owners.map(({ ownerId }) => {
          const member = week.members.get(ownerId)!
          return { id: ownerId, label: member.name, unit: member.unitName }
        })
      } else rows = []
    }
    const people = new Map<string, typeof rows[number]>()
    for (const row of rows) {
      if (!people.has(row.id) && [row.label, row.unit].some((value) => value.toLowerCase().includes(query.search))) people.set(row.id, row)
    }
    return { ...clock(at, actor.context.session.expiresAt, transitions),
      people: slice([...people.values()].sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id)), query.page) }
  }, readBounds)
}

export async function reviewSummary(tx: Tx, actor: Actor): Promise<ReviewSummary> {
  const principal = await managerPrincipal(tx, actor)
  const scope = await reviewerScope(tx, principal.userId, principal.at)
  return { ...clock(principal.at, actor.context.session.expiresAt, scope.transitions), ...await pendingCounts(tx, scope), workPaused: scope.paused }
}

export async function readReviewPerson(db: PrismaClient, actor: Actor, url: string, personId: string): Promise<ReviewPerson> {
  return db.$transaction(async (tx) => {
    const { scope, principal } = await setup(tx, actor)
    const query = selection(url, principal.at, 'review')
    const all = (await pendingReviews(tx, scope, { personId, weeks: query.included })).filter(({ authority }) => authority.state === 'ALLOWED')
    if (!all.length) throw notFound()
    const selected = slice(all, query.page)
    const items: ReviewAttempt[] = []
    const rows = selected.items.map(({ row }) => row)
    const ready = await decisionReadiness(tx, rows, principal.at)
    const notes = await pageNotes(tx, rows.map(({ id }) => id))
    for (const { row, authority } of selected.items) {
      if (authority.state === 'ALLOWED') items.push({
        ...attempt(row, authority.submitted, authority.employee.unit?.name ?? '', notes.get(row.id)),
        ...(!ready.has(row.id) ? { decisionUnavailable: 'HISTORY_UNAVAILABLE' as const } : {}),
      })
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
    const ready = pending.state === 'ALLOWED' && (await decisionReadiness(tx, [row], at)).has(row.id)
    return { ...clock(at, actor.context.session.expiresAt, [...scope.transitions, week.freezesAt]), frozen,
      attempt: { ...attempt(row, submitted, pending.state === 'ALLOWED' ? pending.employee.unit?.name ?? '' : member!.unitName, await note(tx, row)),
        ...(pending.state === 'ALLOWED' && !ready ? { decisionUnavailable: 'HISTORY_UNAVAILABLE' as const } : {}) },
      mode: pending.state !== 'ALLOWED' ? 'HISTORY' : pending.route.reliefId ? 'RELIEF' : 'PERMANENT',
      coveredManager: pending.state === 'ALLOWED' ? pending.route.managerName : member!.managerName,
      decision: outcome, workPaused: scope.paused, canDecide: ready && !scope.paused,
      canComment: (pending.state === 'ALLOWED' || !!member) && !row.task.deletedAt && !row.task.tracker.snapshotAt && !scope.paused
        && !frozen && isoDay(week.startsOn) === isoDay(monday(at)),
      comments: { items, total, page: commentPage, pageSize: 25 } }
  }, readBounds)
}
