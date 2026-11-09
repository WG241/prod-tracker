import type { PrismaClient } from '../../src/generated/prisma/client.ts'
import { databaseErrorCode } from '../db.ts'
import { day, isoDay, shiftDay, watMidnight } from '../data-model/calendar.ts'
import { monday, parseDay, weekProjection } from './calendar.ts'
import { ensureWeek } from './write-context.ts'
import { capturePerson, captureTransaction, completeRoster, initializeHistory } from './history-capture.ts'
import type { CaptureResult } from './history-capture.ts'
import { databaseClock, historyEvidence, historySources, protection } from './history-evidence.ts'
import { closeDueHistory, nextSaturdayClose } from './history-snapshot.ts'

export type HistoryCursor = { coverage: string | null; person: { week: string; userId: string } | null; completion: string | null; phase: number; retry: Map<string, number> }
export function historyCursor(): HistoryCursor { return { coverage: null, person: null, completion: null, phase: 0, retry: new Map() } }
export type HistoryScope = { week?: string; userId?: string }
export type HistoryReport = { persons: { captured: number; already: number; pending: number; repair: number }; weeks: { ensured: number; complete: number; pending: number; repair: number }; results: CaptureResult[]; remaining: boolean; infrastructureFailure: boolean }
export type HistoryDiagnostic = (code: string, source?: string, locationKey?: string, error?: unknown) => void
const logDiagnostic: HistoryDiagnostic = (code, _source, _locationKey, error) => { if (error === undefined) console.error(code); else console.error(code, error) }
export function historyScope(args: string[]) {
  const scope: HistoryScope = {}, seen = new Set<string>()
  let apply = false
  for (let i = 0; i < args.length; i++) {
    const key = args[i]
    if (!['--week', '--user-id', '--apply'].includes(key) || seen.has(key)) throw new Error('Invalid history arguments')
    seen.add(key)
    if (key === '--apply') { apply = true; continue }
    const value = args[++i]
    if (!value) throw new Error('Missing history selector')
    if (key === '--week') { if (parseDay(value).getUTCDay() !== 1) throw new Error('Expected a Monday'); scope.week = value }
    else { if (!/^[A-Za-z0-9_-]{1,160}$/.test(value)) throw new Error('Invalid person selector'); scope.userId = value }
  }
  if (scope.userId && !scope.week) throw new Error('A person selector requires a week')
  return { scope, apply }
}
async function ensureCoverage(db: PrismaClient, start: string, apply: boolean): Promise<CaptureResult> {
  return captureTransaction(db, async (tx) => {
    await tx.$queryRaw`SELECT id FROM "TrackerSettings" WHERE id='workforce-group' FOR SHARE`
    const at = await databaseClock(tx), known = await tx.workWeek.findUnique({ where: { startsOn: day(start) } })
    if (known) return { week: start, code: 'ALREADY_CAPTURED', changed: false }
    const proof = await protection(tx), date = day(start), freeze = watMidnight(shiftDay(date, 5))
    if (!proof.settings?.trackingStartsOn) return { week: start, code: 'PROTECTION_UNAVAILABLE', changed: false }
    if (date < proof.settings.trackingStartsOn || date > monday(at)) return { week: start, code: 'OUTSIDE_COVERAGE', changed: false }
    try { weekProjection(date, null, proof.settings, [], at, false) } catch { return { week: start, code: 'SETTINGS_UNAVAILABLE', changed: false } }
    if (proof.settings.updatedAt > freeze) return { week: start, code: 'MISSING_HISTORICAL_SCHEDULE', changed: false }
    if (!apply) return { week: start, code: 'CAPTURE_PENDING', changed: false }
    await ensureWeek(tx, date)
    return { week: start, code: 'CAPTURED', changed: true }
  })
}
async function diagnosePerson(db: PrismaClient, weekId: string, userId: string): Promise<CaptureResult> {
  return db.$transaction(async (tx) => {
    const week = await tx.workWeek.findUnique({ where: { id: weekId } })
    if (!week) return { userId, code: 'NOT_FOUND', changed: false }
    const at = await databaseClock(tx)
    if (week.freezesAt > at) return { userId, week: isoDay(week.startsOn), code: 'NOT_FROZEN', changed: false }
    const sources = await historySources(tx, userId, weekId)
    if (!sources.person) return { userId, week: isoDay(week.startsOn), code: 'NOT_FOUND', changed: false }
    const evidence = historyEvidence(sources, week, await protection(tx), at)
    return { userId, week: isoDay(week.startsOn), code: evidence.code, changed: false }
  }, { isolationLevel: 'RepeatableRead', maxWait: 5000, timeout: 15000 })
}
async function nextPerson(db: PrismaClient, cursor: HistoryCursor['person'], scope: HistoryScope) {
  const after = cursor?.week ? day(cursor.week) : day('0001-01-01')
  return (await db.$queryRaw<{ weekId: string; week: Date; userId: string }[]>`
    WITH candidates AS (
      SELECT w.id AS "weekId",w."startsOn" AS week,a."userId" FROM "WorkWeek" w JOIN "EmploymentAssignment" a
        ON a."effectiveFrom"<w."freezesAt" AND (a."effectiveTo" IS NULL OR a."effectiveTo">w."startsOn"::timestamp AT TIME ZONE 'Africa/Lagos')
      WHERE w."freezesAt"<=clock_timestamp()
      UNION SELECT w.id,w."startsOn",r."userId" FROM "WorkWeek" w JOIN "WeeklyTracker" r ON r."weekId"=w.id WHERE w."freezesAt"<=clock_timestamp()
    ) SELECT c.* FROM candidates c LEFT JOIN "WeeklyTracker" t ON t."weekId"=c."weekId" AND t."userId"=c."userId"
    WHERE t."snapshotAt" IS NULL AND (c.week>${after}::date OR (c.week=${after}::date AND c."userId">${cursor?.userId ?? ''}))
      AND (${scope.week ?? null}::date IS NULL OR c.week=${scope.week ?? null}::date)
      AND (${scope.userId ?? null}::text IS NULL OR c."userId"=${scope.userId ?? null})
    ORDER BY c.week,c."userId" LIMIT 1`)[0] ?? null
}
export async function historyPass(db: PrismaClient, cursor: HistoryCursor, apply: boolean, scope: HistoryScope = {}, stopping: () => boolean = () => false, capture: HistoryDiagnostic = logDiagnostic): Promise<HistoryReport> {
  const report: HistoryReport = { persons: { captured: 0, already: 0, pending: 0, repair: 0 }, weeks: { ensured: 0, complete: 0, pending: 0, repair: 0 }, results: [], remaining: false, infrastructureFailure: false }
  const deadline = Date.now() + 20000
  let stopPass = false
  function record(result: CaptureResult, kind: 'person' | 'coverage' | 'completion') {
    report.results.push(result)
    const ok = ['CAPTURED', 'ALREADY_CAPTURED', 'ROSTER_COMPLETE'].includes(result.code)
    if (kind === 'person') { if (result.code === 'CAPTURED') report.persons.captured++; else if (result.code === 'ALREADY_CAPTURED') report.persons.already++; else if (['CAPTURE_PENDING', 'RETRY_LATER', 'SERVICE_UNAVAILABLE'].includes(result.code)) report.persons.pending++; else report.persons.repair++ }
    else if (kind === 'coverage' && result.changed) report.weeks.ensured++
    else if (result.code === 'ROSTER_COMPLETE') report.weeks.complete++
    else if (!ok) { if (['CAPTURE_PENDING', 'RETRY_LATER', 'SERVICE_UNAVAILABLE'].includes(result.code)) report.weeks.pending++; else report.weeks.repair++ }
    if (!ok) report.remaining = true
  }
  async function attempt(key: string, kind: 'person' | 'coverage' | 'completion', run: () => Promise<CaptureResult>) {
    if (!scope.week && (cursor.retry.get(key) ?? 0) > Date.now()) return
    try {
      const result = await run(); record(result, kind)
      if (!['CAPTURED', 'ALREADY_CAPTURED', 'ROSTER_COMPLETE', 'CAPTURE_PENDING', 'RETRY_LATER', 'NOT_FROZEN'].includes(result.code)) capture('HISTORY_CAPTURE_FAILED', 'background', 'history-capture')
      if (!['CAPTURED', 'ALREADY_CAPTURED', 'ROSTER_COMPLETE', 'CAPTURE_PENDING'].includes(result.code)) cursor.retry.set(key, Date.now() + 300000)
      else cursor.retry.delete(key)
    } catch (error) {
      report.infrastructureFailure = true; report.remaining = true
      cursor.retry.set(key, Date.now() + 300000)
      const code = databaseErrorCode(error) ?? ''
      stopPass = /^(08|53|57|P10)/.test(code) || ['P2024', 'P2028', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN'].includes(code)
      capture('HISTORY_CAPTURE_FAILED', 'background', 'history-capture', error)
      record({ code: 'SERVICE_UNAVAILABLE', changed: false }, kind)
    }
  }
  if (apply) {
    try { const initialized = await initializeHistory(db); if (!['CAPTURED', 'ALREADY_CAPTURED'].includes(initialized.code)) { record(initialized, 'coverage'); return report } }
    catch (error) { capture('HISTORY_CAPTURE_FAILED', 'background', 'history-capture', error); report.infrastructureFailure = true; report.remaining = true; return report }
  }
  const proof = await db.$transaction((tx) => protection(tx))
  if (scope.week) {
    const ensured = await ensureCoverage(db, scope.week, apply)
    if (!['CAPTURED', 'ALREADY_CAPTURED'].includes(ensured.code)) { record(ensured, 'coverage'); return report }
    const week = await db.workWeek.findUnique({ where: { startsOn: day(scope.week) } })
    if (!week) { record(ensured, 'coverage'); return report }
    if (scope.userId) {
      await attempt(`person:${week.id}:${scope.userId}`, 'person', () => apply ? capturePerson(db, week.id, scope.userId!) : diagnosePerson(db, week.id, scope.userId!))
      return report
    }
  }
  const admitted = [0, 0, 0], limits = [10, 50, 5], done = [false, false, false]
  if (scope.week) done[0] = true
  let phase = cursor.phase++ % 3
  while (Date.now() < deadline && !stopping() && !done.every(Boolean) && !stopPass) {
    const current = phase++ % 3
    if (done[current]) continue
    if (scope.week && current === 2 && !done[1]) continue
    if (admitted[current] >= limits[current]) { done[current] = true; continue }
    admitted[current]++
    if (current === 0) {
      const baseline = proof.settings?.trackingStartsOn
      if (!baseline) { done[0] = true; continue }
      const next = cursor.coverage ? shiftDay(day(cursor.coverage), 7) : baseline
      if (next > monday(new Date())) { cursor.coverage = null; done[0] = true; continue }
      cursor.coverage = isoDay(next)
      await attempt(`coverage:${cursor.coverage}`, 'coverage', () => ensureCoverage(db, cursor.coverage!, apply))
    } else if (current === 1) {
      const target = await nextPerson(db, cursor.person, scope)
      if (!target) { cursor.person = null; done[1] = true; continue }
      cursor.person = { week: isoDay(target.week), userId: target.userId }
      await attempt(`person:${target.weekId}:${target.userId}`, 'person', () => apply ? capturePerson(db, target.weekId, target.userId) : diagnosePerson(db, target.weekId, target.userId))
    } else {
      const target = await db.workWeek.findFirst({ where: { freezesAt: { lte: new Date() }, rosterCapturedAt: null, ...(scope.week ? { startsOn: day(scope.week) } : cursor.completion ? { startsOn: { gt: day(cursor.completion) } } : {}) }, orderBy: { startsOn: 'asc' } })
      if (!target) { cursor.completion = null; done[2] = true; continue }
      cursor.completion = isoDay(target.startsOn)
      await attempt(`completion:${target.id}`, 'completion', () => completeRoster(db, target.id, apply))
      if (scope.week) done[2] = true
    }
  }
  if (await db.workWeek.count({ where: { freezesAt: { lte: new Date() }, rosterCapturedAt: null, ...(scope.week ? { startsOn: day(scope.week) } : {}) } })) report.remaining = true
  if (!scope.week) {
    if (!proof.settings?.trackingStartsOn) report.remaining = true
    else {
      const gap = await db.$queryRaw<{ missing: boolean }[]>`SELECT EXISTS (SELECT 1 FROM generate_series(${proof.settings.trackingStartsOn}::timestamp,date_trunc('week',clock_timestamp() AT TIME ZONE 'Africa/Lagos'),interval '7 days') d WHERE NOT EXISTS (SELECT 1 FROM "WorkWeek" w WHERE w."startsOn"=d::date)) AS missing`
      if (gap[0].missing) report.remaining = true
    }
  }
  if (scope.week && (await db.workWeek.findUnique({ where: { startsOn: day(scope.week) } }))?.rosterCapturedAt) report.remaining = false
  return report
}
export function startHistoryCloser(db: PrismaClient) {
  let stopped = false, active: Promise<unknown> | null = null, timer: NodeJS.Timeout | null = null
  const schedule = (retry: boolean) => {
    if (stopped) return
    const untilClose = Math.max(1000, nextSaturdayClose(new Date()).getTime() - Date.now())
    timer = setTimeout(run, retry ? Math.min(untilClose, 60_000) : untilClose).unref()
  }
  const run = () => {
    if (stopped || active) return
    let retry = false
    active = initializeHistory(db).then(async (initialized) => {
      if (!['CAPTURED', 'ALREADY_CAPTURED'].includes(initialized.code)) {
        retry = initialized.code === 'RETRY_LATER'
        logDiagnostic('HISTORY_CLOSE_FAILED', 'background', 'history-snapshot', initialized.code)
        return
      }
      const results = await closeDueHistory(db)
      retry = results.some(({ code }) => code === 'RETRY_LATER')
    }).catch((error: unknown) => {
      retry = true
      logDiagnostic('HISTORY_CLOSE_FAILED', 'background', 'history-snapshot', error)
    }).finally(() => { active = null; schedule(retry) })
  }
  run()
  return async () => { stopped = true; if (timer) clearTimeout(timer); await active }
}
