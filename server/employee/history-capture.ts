import type { PrismaClient } from '../../src/generated/prisma/client.ts'
import { databaseErrorCode } from '../db.ts'
import { isoDay } from '../data-model/calendar.ts'
import { monday } from './calendar.ts'
import { ensureWeek } from './write-context.ts'
import { assignmentForWeek } from '../data-model/calendar.ts'
import { databaseClock, historyEvidence, historySources, protection, snapshotContext } from './history-evidence.ts'
import type { HistoryCode, HistoryTx } from './history-evidence.ts'

export type CaptureResult = { code: HistoryCode; changed: boolean; week?: string; userId?: string }
function retryable(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const code = 'code' in error ? error.code : null
  return code === 'P2002' || code === 'P2034' || ['40P01', '40001'].includes(databaseErrorCode(error) ?? '')
}
export async function captureTransaction<T>(db: PrismaClient, work: (tx: HistoryTx) => Promise<T>) {
  for (let attempt = 0; ; attempt++) {
    try { return await db.$transaction(work, { isolationLevel: 'ReadCommitted', maxWait: 5000, timeout: 15000 }) }
    catch (error) { if (attempt < 2 && retryable(error)) continue; throw error }
  }
}
export async function initializeHistory(db: PrismaClient): Promise<CaptureResult> {
  const before = await db.trackerSettings.findUnique({ where: { id: 'workforce-group' } })
  if (!before) return { code: 'SETTINGS_UNAVAILABLE', changed: false }
  if (before.trackingStartsOn) return { code: 'ALREADY_CAPTURED', changed: false }
  const ensured = await captureTransaction(db, async (tx) => {
    await tx.$queryRaw`SELECT id FROM "TrackerSettings" WHERE id='workforce-group' FOR SHARE`
    const at = await databaseClock(tx), start = monday(at)
    await ensureWeek(tx, start)
    return isoDay(start)
  })
  return captureTransaction(db, async (tx) => {
    await tx.$queryRaw`SELECT id FROM "TrackerSettings" WHERE id='workforce-group' FOR UPDATE`
    const proof = await protection(tx)
    if (!proof.settings || !proof.guards) return { code: 'PROTECTION_UNAVAILABLE', changed: false }
    if (proof.settings.trackingStartsOn) return { code: proof.valid ? 'ALREADY_CAPTURED' : 'PROTECTION_UNAVAILABLE', changed: false }
    const at = await databaseClock(tx), start = monday(at)
    if (isoDay(start) !== ensured) return { code: 'RETRY_LATER', changed: false }
    const existing = await tx.auditEvent.count({ where: { action: 'HISTORY_TRACKING_STARTED', targetType: 'TrackerSettings', targetId: 'workforce-group' } })
    if (existing) return { code: 'PROTECTION_UNAVAILABLE', changed: false }
    await tx.trackerSettings.update({ where: { id: 'workforce-group' }, data: { trackingStartsOn: start } })
    await tx.auditEvent.create({ data: { action: 'HISTORY_TRACKING_STARTED', targetType: 'TrackerSettings', targetId: 'workforce-group', createdAt: at,
      after: { version: 1, trackingStartsOn: isoDay(start), historicalProtectionVersion: 1 } } })
    return { code: 'CAPTURED', changed: true, week: isoDay(start) }
  })
}
export async function capturePerson(db: PrismaClient, weekId: string, userId: string): Promise<CaptureResult> {
  return captureTransaction(db, async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${userId} FOR UPDATE`
    await tx.$queryRaw`SELECT id FROM "EmploymentAssignment" WHERE "userId"=${userId} ORDER BY id FOR SHARE`
    await tx.$queryRaw`SELECT id FROM "LeaveRecord" WHERE "userId"=${userId} ORDER BY id FOR SHARE`
    const week = await tx.workWeek.findUnique({ where: { id: weekId } })
    if (!week) return { code: 'NOT_FOUND', changed: false, userId }
    const first = await historySources(tx, userId, weekId)
    if (!first.person) return { code: 'NOT_FOUND', changed: false, userId }
    const chosen = assignmentForWeek(first.person.assignments, week.startsOn, week.freezesAt, await databaseClock(tx))
    if (chosen?.businessId) await tx.$queryRaw`SELECT id FROM "Business" WHERE id=${chosen.businessId} FOR SHARE`
    if (chosen?.unitId) await tx.$queryRaw`SELECT id FROM "Unit" WHERE id=${chosen.unitId} FOR SHARE`
    if (chosen?.managerId) await tx.$queryRaw`SELECT id FROM "User" WHERE id=${chosen.managerId} FOR SHARE`
    await tx.$queryRaw`SELECT id FROM "TrackerSettings" WHERE id='workforce-group' FOR SHARE`
    await tx.$queryRaw`SELECT id FROM "WorkWeek" WHERE id=${weekId} FOR SHARE`
    await tx.$queryRaw`SELECT id FROM "WeeklyTracker" WHERE "userId"=${userId} AND "weekId"=${weekId} FOR UPDATE`
    const at = await databaseClock(tx)
    const sources = await historySources(tx, userId, weekId), proof = await protection(tx)
    const evidence = historyEvidence(sources, week, proof, at)
    const result = { userId, week: isoDay(week.startsOn) }
    if (week.freezesAt > at) return { ...result, code: 'NOT_FROZEN', changed: false }
    if (evidence.state === 'AVAILABLE') return { ...result, code: 'ALREADY_CAPTURED', changed: false }
    if (evidence.code !== 'CAPTURE_PENDING' || !evidence.context || !evidence.assignmentId || evidence.days === undefined) return { ...result, code: evidence.code, changed: false }
    const capturedAt = await databaseClock(tx)
    const data = { assignmentId: evidence.assignmentId, contextSnapshot: { ...evidence.context }, expectedWorkingDaysSnapshot: evidence.days, snapshotAt: capturedAt }
    const tracker = await tx.weeklyTracker.upsert({ where: { userId_weekId: { userId, weekId } }, create: { userId, weekId, ...data, createdAt: capturedAt }, update: data })
    await tx.auditEvent.create({ data: { action: 'TRACKER_SNAPSHOT_CAPTURED', targetType: 'WeeklyTracker', targetId: tracker.id, createdAt: capturedAt,
      after: { week: result.week, assignmentId: evidence.assignmentId, expectedDays: evidence.days, referenceAt: new Date(week.freezesAt.getTime() - 1).toISOString(), capturedAt: capturedAt.toISOString() } } })
    return { ...result, code: 'CAPTURED', changed: true }
  })
}
export async function completeRoster(db: PrismaClient, weekId: string, apply = true): Promise<CaptureResult> {
  try {
    return await captureTransaction(db, async (tx) => {
      await tx.$executeRaw`SET LOCAL lock_timeout='500ms'`
      await tx.$executeRaw`LOCK TABLE "EmploymentAssignment" IN SHARE MODE`
      await tx.$queryRaw`SELECT id FROM "WorkWeek" WHERE id=${weekId} FOR UPDATE`
      const week = await tx.workWeek.findUnique({ where: { id: weekId } })
      if (!week) return { code: 'NOT_FOUND', changed: false }
      const result = { week: isoDay(week.startsOn) }
      if (week.rosterCapturedAt) return { ...result, code: 'ROSTER_COMPLETE', changed: false }
      const at = await databaseClock(tx)
      if (week.freezesAt > at) return { ...result, code: 'NOT_FROZEN', changed: false }
      const proof = await protection(tx)
      if (!proof.valid || !proof.startedAt) return { ...result, code: 'PROTECTION_UNAVAILABLE', changed: false }
      if (week.freezesAt < proof.startedAt) return { ...result, code: 'HISTORICAL_FACTS_UNAVAILABLE', changed: false }
      const required = await tx.employmentAssignment.findMany({ where: { effectiveFrom: { lt: week.freezesAt }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: new Date(week.startsOn.getTime() - 3600000) } }] }, distinct: ['userId'], select: { userId: true } })
      const rows = await tx.weeklyTracker.findMany({ where: { weekId } })
      const ids = new Set(required.map((row) => row.userId))
      if (rows.some((row) => !ids.has(row.userId))) return { ...result, code: 'INVALID_SNAPSHOT', changed: false }
      const byUser = new Map(rows.map((row) => [row.userId, row]))
      for (const id of ids) {
        const row = byUser.get(id)
        if (!row?.snapshotAt) return { ...result, code: 'CAPTURE_PENDING', changed: false }
        if (!snapshotContext(row.contextSnapshot, id) || row.snapshotAt < week.freezesAt || !Number.isInteger(row.expectedWorkingDaysSnapshot) || row.expectedWorkingDaysSnapshot! < 0 || row.expectedWorkingDaysSnapshot! > 5) return { ...result, code: 'INVALID_SNAPSHOT', changed: false }
      }
      const completedAt = await databaseClock(tx)
      if (!apply) return { ...result, code: 'CAPTURE_PENDING', changed: false }
      await tx.workWeek.update({ where: { id: weekId }, data: { rosterCapturedAt: completedAt } })
      await tx.auditEvent.create({ data: { action: 'WEEK_ROSTER_CAPTURED', targetType: 'WorkWeek', targetId: weekId, createdAt: completedAt, after: { week: result.week, count: ids.size, rosterCapturedAt: completedAt.toISOString() } } })
      return { ...result, code: 'ROSTER_COMPLETE', changed: true }
    })
  } catch (error) {
    if (databaseErrorCode(error) === '55P03') return { code: 'RETRY_LATER', changed: false }
    throw error
  }
}
