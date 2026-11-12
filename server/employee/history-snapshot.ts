import { randomUUID } from 'node:crypto'
import type { PrismaClient } from '../../src/generated/prisma/client.ts'
import { databaseErrorCode } from '../db.ts'
import { isoDay, shiftDay, watCalendarDay, watMidnight } from '../data-model/calendar.ts'
import { captureTransaction } from './history-capture.ts'
import { databaseClock, historyEvidence, historyPeople, protection } from './history-evidence.ts'
import type { HistoryCode, SnapshotContext } from './history-evidence.ts'

export type HistorySnapshotResult = { code: HistoryCode; changed: boolean; week?: string }

class SnapshotFailure extends Error {
  readonly code: HistoryCode
  constructor(code: HistoryCode) { super(code); this.code = code }
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
      const lockedPeople = JSON.stringify([...requiredIds])
      await tx.$queryRaw`SELECT id FROM "User" WHERE id IN (SELECT jsonb_array_elements_text(${lockedPeople}::jsonb)) ORDER BY id FOR UPDATE`
      await tx.$queryRaw`SELECT id FROM "LeaveRecord" WHERE "userId" IN (SELECT jsonb_array_elements_text(${lockedPeople}::jsonb)) ORDER BY id FOR SHARE`
      const existingTrackers = await tx.weeklyTracker.findMany({ where: { weekId } })
      if (existingTrackers.some((row) => !requiredIds.has(row.userId))) throw new SnapshotFailure('INVALID_SNAPSHOT')
      const trackers = new Map(existingTrackers.map((row) => [row.userId, row]))
      const people = new Map((await historyPeople(tx, [...requiredIds])).map((person) => [person.id, person]))
      const plans: { userId: string; assignmentId: string; context: SnapshotContext; days: number; trackerId: string; existing: boolean }[] = []

      for (const { userId } of required) {
        const person = people.get(userId)
        if (!person) throw new SnapshotFailure('INVALID_SOURCE')
        const tracker = trackers.get(userId) ?? null
        const evidence = historyEvidence({ person, tracker }, week, proof, at)
        if (!['ALREADY_CAPTURED', 'CAPTURE_PENDING'].includes(evidence.code) || !evidence.assignmentId || !evidence.context || evidence.days === undefined) {
          throw new SnapshotFailure(evidence.code)
        }
        plans.push({ userId, assignmentId: evidence.assignmentId, context: evidence.context, days: evidence.days,
          trackerId: tracker?.id ?? randomUUID(), existing: evidence.code === 'ALREADY_CAPTURED' })
      }

      const capturedAt = await databaseClock(tx)
      const publishedAt = week.rosterCapturedAt ?? capturedAt
      const pending = plans.filter(({ existing }) => !existing)
      if (pending.length) {
        // The owner and week locks keep the tracker identity stable through publication.
        const changed = await tx.$executeRaw`
          INSERT INTO "WeeklyTracker" (id, "userId", "weekId", "assignmentId", "contextSnapshot", "expectedWorkingDaysSnapshot", "snapshotAt", "createdAt", "updatedAt")
          SELECT p."trackerId", p."userId", ${weekId}, p."assignmentId", p.context, p.days, ${capturedAt}, ${capturedAt}, ${capturedAt}
          FROM jsonb_to_recordset(${JSON.stringify(pending)}::jsonb)
            AS p("trackerId" text, "userId" text, "assignmentId" text, context jsonb, days integer)
          ON CONFLICT ("userId", "weekId") DO UPDATE SET
            "assignmentId" = EXCLUDED."assignmentId", "contextSnapshot" = EXCLUDED."contextSnapshot",
            "expectedWorkingDaysSnapshot" = EXCLUDED."expectedWorkingDaysSnapshot", "snapshotAt" = EXCLUDED."snapshotAt",
            "updatedAt" = EXCLUDED."updatedAt"
          WHERE "WeeklyTracker".id = EXCLUDED.id AND "WeeklyTracker"."snapshotAt" IS NULL
        `
        if (changed !== pending.length) throw new SnapshotFailure('RETRY_LATER')
        const referenceAt = new Date(week.freezesAt.getTime() - 1).toISOString()
        await tx.auditEvent.createMany({ data: pending.map((plan) => ({
          action: 'TRACKER_SNAPSHOT_CAPTURED', targetType: 'WeeklyTracker', targetId: plan.trackerId, createdAt: capturedAt,
          after: { week: result.week, assignmentId: plan.assignmentId, expectedDays: plan.days, referenceAt, capturedAt: capturedAt.toISOString() },
        })) })
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

export async function closeDueHistory(db: PrismaClient, protectedSince: Date) {
  const due = await db.workWeek.findMany({ where: { freezesAt: { gte: protectedSince, lte: new Date() }, historySnapshot: null },
    orderBy: { startsOn: 'asc' }, select: { id: true, startsOn: true } })
  const results: HistorySnapshotResult[] = []
  for (const week of due) {
    try { results.push(await closeHistoryWeek(db, week.id)) }
    catch { results.push({ week: isoDay(week.startsOn), code: 'SERVICE_UNAVAILABLE', changed: false }) }
  }
  return results
}

export function nextSaturdayClose(at: Date) {
  const calendarDay = watCalendarDay(at)
  const monday = shiftDay(calendarDay, -((calendarDay.getUTCDay() + 6) % 7))
  let saturday = watMidnight(shiftDay(monday, 5))
  if (saturday <= at) saturday = new Date(saturday.getTime() + 7 * 86400000)
  return saturday
}
