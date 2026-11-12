import type { PrismaClient } from '../../src/generated/prisma/client.ts'
import type { Actor } from '../auth/owner-write.ts'
import type { Page } from '../../src/features/employee/contracts.ts'
import type { DashboardActivity, DashboardResponse } from '../../src/features/line-manager/dashboard-view.ts'
import { isoDay, shiftDay, watCalendarDay } from '../data-model/calendar.ts'
import { EmployeeFailure, monday, nextChange } from '../employee/calendar.ts'
import { currentLeave } from '../employee/leave-state.ts'
import { pageOffset } from '../employee/reads.ts'
import { readableMessage } from '../notifications/events.ts'
import { dashboardQuery } from './query.ts'
import { overlapsWorkweek, reporting, reportingMetrics, scopedTasks, trendPoint } from './reporting.ts'
import { pendingReviewGroups } from './review-queue.ts'
import { managerPrincipal, reminderEligibility, reminderKey } from './scope.ts'
import type { Tx } from './scope.ts'

export const readBounds = { isolationLevel: 'RepeatableRead', maxWait: 5000, timeout: 20000 } as const
const chronological = [{ startsOn: 'asc' as const }, { createdAt: 'asc' as const }, { id: 'asc' as const }]

export function clock(at: Date, expiresAt: string, transitions: Date[]) {
  const midnight = new Date(shiftDay(watCalendarDay(at), 1).getTime() - 3600000)
  return { asOf: at.toISOString(), timezone: 'Africa/Lagos' as const, currentWeekStart: isoDay(monday(at)),
    nextChangeAt: nextChange(at, [midnight, new Date(expiresAt), ...transitions]) }
}

export function slice<T>(items: T[], page: number): Page<T> {
  const start = pageOffset(page, items.length)
  return { items: start === null ? [] : items.slice(start, start + 25), page, pageSize: 25, total: items.length }
}

export async function actorLeave(tx: Tx, id: string, at: Date) {
  const leave = await currentLeave(tx, id, at)
  return { paused: leave.state === 'ON_LEAVE' || leave.state === 'REPAIR_REQUIRED', transition: new Date(leave.nextChangeAt) }
}

export async function readDashboard(db: PrismaClient, actor: Actor, url: string): Promise<DashboardResponse> {
  return db.$transaction(async (tx) => {
    const principal = await managerPrincipal(tx, actor)
    const { userId, at, businessId, staff } = principal
    const query = dashboardQuery(url, at)
    const settings = await tx.trackerSettings.findUnique({ where: { id: 'workforce-group' } })
    if (!settings) throw new EmployeeFailure('SERVICE_UNAVAILABLE', 503)
    const name = staff.person.name?.trim() || 'Staff member'
    const dates = [...new Map([...query.included, ...query.trend].map((date) => [isoDay(date), date])).values()]
    const weeks = await reporting(tx, dates, query.current, { at, userId, businessId, name }, settings)
    const included = query.included.map((date) => weeks.get(isoDay(date))!)
    const includedWeeks = query.included.map(isoDay)
    const queue = await pendingReviewGroups(tx, userId, businessId, at, settings.overdueApprovalDays)
    const { groups, routingUnavailableCount } = queue.select(new Set(includedWeeks))
    const leave = await actorLeave(tx, userId, at)
    const transitions = [leave.transition, ...queue.transitions]
    const missingRows = included.flatMap((week) => [...week.members.values()]
      .filter((person) => person.days > 0 && !week.submitted.has(person.id))
      .map((person) => ({ person, week })))
      .sort((a, b) => a.person.name.trim().toLowerCase().localeCompare(b.person.name.trim().toLowerCase()) || a.person.id.localeCompare(b.person.id) || a.week.start.getTime() - b.week.start.getTime())
    const missingPage = slice(missingRows, query.missingPage)
    const missing: DashboardResponse['missing'] = { ...missingPage, items: [] }
    const selectedCurrent = included.find((week) => week.kind === 'CURRENT')
    const unlocks = selectedCurrent?.stored ? await tx.planningUnlock.findMany({ where: { weekId: selectedCurrent.stored.id } }) : []
    const currentMissing = missingPage.items.filter(({ week }) => week.kind === 'CURRENT')
    const previous = currentMissing.length ? await tx.notification.findMany({ where: { kind: 'WORK_REMINDER',
      recipientId: { in: currentMissing.map(({ person }) => person.id) },
      deduplicationKey: { in: currentMissing.map(({ person, week }) => reminderKey(person.id, week.start, at)) },
    }, select: { recipientId: true, deduplicationKey: true } }) : []
    const remindedKeys = new Map(previous.map(({ recipientId, deduplicationKey }) => [recipientId, deduplicationKey]))
    for (const { person, week } of missingPage.items) {
      const canCheck = week.kind === 'CURRENT' && !!person.employee
      const eligibility = canCheck ? await reminderEligibility(tx, person.employee!, week.start, week.stored, settings, at, false, unlocks) : null
      if (eligibility) transitions.push(...eligibility.transitions)
      const reminded = canCheck && remindedKeys.get(person.id) === reminderKey(person.id, week.start, at)
      missing.items.push({ employeeId: person.id, employeeName: person.name, unitName: person.unitName, managerName: person.managerName,
        week: isoDay(week.start), canRemind: !!eligibility?.allowed && !leave.paused && !reminded, reminded })
    }
    if (selectedCurrent) {
      if (selectedCurrent.freezesAt) transitions.push(selectedCurrent.freezesAt)
      if (selectedCurrent.stored) transitions.push(selectedCurrent.stored.planningLocksAt)
    }
    const taskWhere = scopedTasks(included)
    const blockedWhere = { ...taskWhere, status: 'BLOCKED' as const }
    const blockedCount = await tx.weeklyTask.count({ where: blockedWhere })
    const offset = pageOffset(query.blockedPage, blockedCount)
    const blockedRows = offset === null ? [] : await tx.weeklyTask.findMany({ where: blockedWhere, orderBy: chronological, skip: offset, take: 25,
      select: { id: true, ownerId: true, title: true, blockerReason: true, tracker: { select: { week: { select: { startsOn: true } } } } } })
    const blocked = blockedRows.map((row) => {
      const week = isoDay(row.tracker.week.startsOn)
      const scope = weeks.get(week)!
      return { id: row.id, title: row.title, ownerName: scope.members.get(row.ownerId)!.name, reason: row.blockerReason ?? '', week,
        current: scope.kind === 'CURRENT' }
    })

    const decisions = await tx.approvalDecision.findMany({ where: { decidedAt: { lte: at }, request: { task: taskWhere } },
      select: { id: true, decision: true, decidedAt: true, request: { select: { submissionSnapshot: true, submittedById: true } } } })
    const timeline: { event: DashboardActivity; at: Date }[] = []
    for (const decision of decisions) {
      const saved = decision.request.submissionSnapshot
      if (!saved || typeof saved !== 'object' || Array.isArray(saved) || saved.version !== 1 || saved.ownerId !== decision.request.submittedById
        || typeof saved.title !== 'string' || typeof saved.ownerDisplayName !== 'string' || !readableMessage(saved.title, saved.ownerDisplayName)) continue
      timeline.push({ event: { id: `decision:${decision.id}`, kind: 'decision', summary: `${saved.title} for ${saved.ownerDisplayName} was ${decision.decision === 'APPROVE' ? 'approved' : 'declined'}.` }, at: decision.decidedAt })
    }
    const employeeIds = [...new Set(included.flatMap((week) => [...week.members.keys()]))]
    const notices = await tx.notification.findMany({ where: { recipientId: userId, kind: { in: ['LEAVE_RECORDED', 'LEAVE_CANCELLED', 'LEAVE_RETURNED'] },
      createdAt: { lte: at }, leave: { userId: { in: employeeIds } } }, include: { leave: true } })
    for (const notice of notices) {
      const record = notice.leave
      if (!record || !readableMessage(notice.title, notice.body) || !included.some((week) => week.members.has(record.userId)
        && overlapsWorkweek(record.startsOn, record.actualReturnOn ?? record.expectedReturnOn, week.start))) continue
      timeline.push({ event: { id: `leave:${notice.id}`, kind: 'leave', summary: notice.body }, at: notice.createdAt })
    }
    const activity = slice(timeline.sort((a, b) => b.at.getTime() - a.at.getTime() || b.event.id.localeCompare(a.event.id)).map(({ event }) => event), query.activityPage)
    const unavailableWeeks = included.filter((week) => week.kind === 'UNAVAILABLE').map((week) => isoDay(week.start))
    const notOpenWeeks = included.filter((week) => week.kind === 'NOT_OPEN').map((week) => isoDay(week.start))
    const messages = [
      unavailableWeeks.length ? 'Some historical totals are unavailable. Available records are shown below.' : '',
      notOpenWeeks.length ? 'Future workweeks have not opened yet.' : '',
      routingUnavailableCount ? 'Some pending work needs routing review. Contact HR.' : '',
    ].filter(Boolean)
    const awaiting = routingUnavailableCount || (included.length > 0 && notOpenWeeks.length === included.length) ? null : groups.length
    return {
      ...clock(at, actor.context.session.expiresAt, transitions), selection: query.selection, includedWeeks,
      metrics: reportingMetrics(included, awaiting), trend: query.trend.map((date) => trendPoint(weeks.get(isoDay(date))!)),
      availability: { unavailableWeeks, notOpenWeeks, routingUnavailableCount }, availabilityMessage: messages.join(' ') || undefined,
      approvals: slice(groups, query.approvalPage), missing,
      blocked: { items: blocked, page: query.blockedPage, pageSize: 25, total: blockedCount }, activity, approvalBadge: queue.badge,
    }
  }, readBounds)
}
