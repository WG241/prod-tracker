import { randomUUID } from 'node:crypto'
import type { PrismaClient } from '../../src/generated/prisma/client.ts'
import { databaseErrorCode } from '../db.ts'
import { isoDay, shiftDay, watCalendarDay, watMidnight } from '../data-model/calendar.ts'
import { captureTransaction } from './history-capture.ts'
import { databaseClock, historyEvidence, historySources, protection, snapshotContext } from './history-evidence.ts'
import type { HistoryCode, SnapshotContext } from './history-evidence.ts'

export type HistorySnapshotResult = { code: HistoryCode; changed: boolean; week?: string }

class SnapshotFailure extends Error {
  readonly code: HistoryCode
  constructor(code: HistoryCode) { super(code); this.code = code }
}

function validExistingSnapshot(value: { contextSnapshot: Parameters<typeof snapshotContext>[0]; snapshotAt: Date | null; expectedWorkingDaysSnapshot: number | null }, userId: string, freeze: Date) {
  const context = snapshotContext(value.contextSnapshot, userId)
  const days = value.expectedWorkingDaysSnapshot
  return context && value.snapshotAt && value.snapshotAt >= freeze && days !== null && Number.isInteger(days) && days >= 0 && days <= 5
    ? { context, days }
    : null
}

export async function closeHistoryWeek(db: PrismaClient, weekId: string): Promise<HistorySnapshotResult> {
  try {
    return await captureTransaction(db, async (tx) => {
      await tx.$executeRaw`SET LOCAL lock_timeout='500ms'`
      await tx.$executeRaw`LOCK TABLE "EmploymentAssignment" IN SHARE MODE`
      await tx.$queryRaw`SELECT id FROM "WorkWeek" WHERE id=${weekId} FOR UPDATE`
      const week = await tx.workWeek.findUnique({ where: { id: weekId }, include: { historySnapshot: { select: { id: true } } } })
      if (!week) return { code: 'NOT_FOUND', changed: false }
      const result = { week: isoDay(week.startsOn) }
      if (week.historySnapshot) return { ...result, code: 'ALREADY_CAPTURED', changed: false }
      const at = await databaseClock(tx)
      if (week.freezesAt > at) return { ...result, code: 'NOT_FROZEN', changed: false }
      const proof = await protection(tx)
      if (!proof.valid || !proof.startedAt) return { ...result, code: 'PROTECTION_UNAVAILABLE', changed: false }
      if (week.freezesAt < proof.startedAt) return { ...result, code: 'HISTORICAL_FACTS_UNAVAILABLE', changed: false }

      const required = await tx.employmentAssignment.findMany({
        where: { effectiveFrom: { lt: week.freezesAt }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: new Date(week.startsOn.getTime() - 3600000) } }] },
        distinct: ['userId'], select: { userId: true }, orderBy: { userId: 'asc' },
      })
      const requiredIds = new Set(required.map((row) => row.userId))
      const existingTrackers = await tx.weeklyTracker.findMany({ where: { weekId }, select: { userId: true } })
      if (existingTrackers.some((row) => !requiredIds.has(row.userId))) throw new SnapshotFailure('INVALID_SNAPSHOT')
      const plans: { userId: string; assignmentId: string; context: SnapshotContext; days: number; trackerId: string; existing: boolean }[] = []

      for (const { userId } of required) {
        await tx.$queryRaw`SELECT id FROM "User" WHERE id=${userId} FOR UPDATE`
        await tx.$queryRaw`SELECT id FROM "EmploymentAssignment" WHERE "userId"=${userId} ORDER BY id FOR SHARE`
        await tx.$queryRaw`SELECT id FROM "LeaveRecord" WHERE "userId"=${userId} ORDER BY id FOR SHARE`
        const sources = await historySources(tx, userId, weekId)
        if (!sources.person) throw new SnapshotFailure('INVALID_SOURCE')
        const existing = sources.tracker ? validExistingSnapshot(sources.tracker, userId, week.freezesAt) : null
        const evidence = historyEvidence(sources, week, proof, at)
        const frozen: { context: SnapshotContext; days: number } | null = existing ?? (evidence.code === 'CAPTURE_PENDING' && evidence.context && evidence.assignmentId && evidence.days !== undefined
          ? { context: evidence.context, days: evidence.days }
          : null)
        if (!frozen) throw new SnapshotFailure(evidence.code)
        plans.push({ userId, assignmentId: existing ? sources.tracker!.assignmentId : evidence.assignmentId!, context: frozen.context, days: frozen.days, trackerId: sources.tracker?.id ?? '', existing: !!existing })
      }

      const capturedAt = await databaseClock(tx)
      const publishedAt = week.rosterCapturedAt ?? capturedAt
      for (const plan of plans) {
        if (plan.existing) continue
        const tracker = await tx.weeklyTracker.upsert({
          where: { userId_weekId: { userId: plan.userId, weekId } },
          create: { userId: plan.userId, weekId, assignmentId: plan.assignmentId, contextSnapshot: plan.context, expectedWorkingDaysSnapshot: plan.days, snapshotAt: capturedAt, createdAt: capturedAt },
          update: { assignmentId: plan.assignmentId, contextSnapshot: plan.context, expectedWorkingDaysSnapshot: plan.days, snapshotAt: capturedAt },
        })
        plan.trackerId = tracker.id
        await tx.auditEvent.create({ data: { action: 'TRACKER_SNAPSHOT_CAPTURED', targetType: 'WeeklyTracker', targetId: tracker.id, createdAt: capturedAt,
          after: { week: result.week, assignmentId: plan.assignmentId, expectedDays: plan.days, referenceAt: new Date(week.freezesAt.getTime() - 1).toISOString(), capturedAt: capturedAt.toISOString() } } })
      }

      const trackerIds = plans.map((plan) => plan.trackerId)
      const tasks = await tx.weeklyTask.findMany({
        where: { trackerId: { in: trackerIds }, deletedAt: null },
        orderBy: [{ trackerId: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        include: {
          comments: {
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            include: { author: { select: { name: true } } },
          },
          approvals: {
            orderBy: { attemptNumber: 'asc' },
            include: {
              decision: {
                include: { actor: { select: { name: true } }, principal: { select: { name: true } } },
              },
            },
          },
        },
      })
      const historyWeekId = randomUUID()
      await tx.historyWeekSnapshot.create({ data: { id: historyWeekId, weekId, startsOn: week.startsOn, freezesAt: week.freezesAt, capturedAt: publishedAt } })
      await tx.historyPersonSnapshot.createMany({ data: plans.map((plan) => ({ id: randomUUID(), historyWeekId, userId: plan.userId, assignmentId: plan.assignmentId, contextSnapshot: plan.context, expectedWorkingDaysSnapshot: plan.days, snapshotAt: publishedAt })) })
      const ownerNames = new Map(plans.map((plan) => [plan.userId, plan.context.displayName]))
      if (tasks.length) {
        await tx.historyTaskSnapshot.createMany({ data: tasks.map((task) => ({ id: task.id, historyWeekId, ownerId: task.ownerId, ownerName: ownerNames.get(task.ownerId) ?? 'Staff member', title: task.title, activity: task.activity, startsOn: task.startsOn, endsOn: task.endsOn, status: task.status, blockerReason: task.blockerReason, carryRequested: task.carryRequested, carriedFrom: !!task.carriedFromId, revision: task.revision, createdAt: task.createdAt })) })
        const comments = tasks.flatMap((task) => task.comments.map((comment) => ({ id: comment.id, taskSnapshotId: task.id, body: comment.body, authorName: comment.author.name?.trim() || 'Staff member', createdAt: comment.createdAt })))
        const reviews = tasks.flatMap((task) => task.approvals.map((request) => ({ id: request.id, taskSnapshotId: task.id, attemptNumber: request.attemptNumber, state: request.state, submittedAt: request.submittedAt, decision: request.decision?.decision ?? null, method: request.decision?.method ?? null, reason: request.decision?.reason ?? null, decidedAt: request.decision?.decidedAt ?? null, reviewerName: request.decision?.method === 'AUTOMATIC' ? 'System' : request.decision?.actor?.name?.trim() || null, coveredManagerName: request.decision?.principal?.name?.trim() || null })))
        if (comments.length) await tx.historyCommentSnapshot.createMany({ data: comments })
        if (reviews.length) await tx.historyReviewSnapshot.createMany({ data: reviews })
      }
      if (!week.rosterCapturedAt) await tx.workWeek.update({ where: { id: weekId }, data: { rosterCapturedAt: publishedAt } })
      await tx.auditEvent.create({ data: { action: 'HISTORY_SNAPSHOT_PUBLISHED', targetType: 'HistoryWeekSnapshot', targetId: historyWeekId, createdAt: publishedAt,
        after: { week: result.week, people: plans.length, tasks: tasks.length, capturedAt: publishedAt.toISOString() } } })
      return { ...result, code: 'CAPTURED', changed: true }
    })
  } catch (error) {
    if (error instanceof SnapshotFailure) return { code: error.code, changed: false }
    if (databaseErrorCode(error) === '55P03') return { code: 'RETRY_LATER', changed: false }
    throw error
  }
}

export async function closeDueHistory(db: PrismaClient) {
  const due = await db.workWeek.findMany({ where: { freezesAt: { lte: new Date() }, historySnapshot: null }, orderBy: { startsOn: 'asc' }, select: { id: true } })
  const results: HistorySnapshotResult[] = []
  for (const week of due) results.push(await closeHistoryWeek(db, week.id))
  return results
}

export function nextSaturdayClose(at: Date) {
  const calendarDay = watCalendarDay(at)
  const monday = shiftDay(calendarDay, -((calendarDay.getUTCDay() + 6) % 7))
  let saturday = watMidnight(shiftDay(monday, 5))
  if (saturday <= at) saturday = new Date(saturday.getTime() + 7 * 86400000)
  return saturday
}
