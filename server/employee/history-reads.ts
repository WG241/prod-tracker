import type { Prisma, PrismaClient, WorkWeek } from '../../src/generated/prisma/client.ts'
import type { SessionContext } from '../../src/features/auth/contracts.ts'
import type { HistoryAvailability, HistoryResponse, HistoryStatus } from '../../src/features/employee/history-contracts.ts'
import { taskStatuses } from '../../src/features/employee/contracts.ts'
import { day, isoDay, shiftDay, watMidnight } from '../data-model/calendar.ts'
import { EmployeeFailure, monday, parseDay, weekProjection } from './calendar.ts'
import { employeePrincipal, pageOffset } from './reads.ts'
import { historyEvidence, historySources, overlapsWeek, protection } from './history-evidence.ts'
import type { SnapshotContext } from './history-evidence.ts'

export function historyQuery(url: string) {
  const params = new URL(url, 'http://local').searchParams
  const invalid = () => { throw new EmployeeFailure('INVALID_INPUT', 400) }
  for (const key of params.keys()) if (!['week', 'status', 'from', 'to', 'page'].includes(key) || params.getAll(key).length !== 1) invalid()
  const week = params.get('week'), status = params.get('status'), from = params.get('from'), to = params.get('to'), page = params.get('page') ?? '1'
  if (week !== null && parseDay(week).getUTCDay() !== 1) invalid()
  if (status !== null && !Object.hasOwn(taskStatuses, status)) invalid()
  if ((from === null) !== (to === null)) invalid()
  if (from !== null && to !== null) { const length = (parseDay(to).getTime() - parseDay(from).getTime()) / 86400000 + 1; if (length < 1 || length > 366) invalid() }
  if (!/^[1-9]\d*$/.test(page) || !Number.isSafeInteger(Number(page))) invalid()
  return { week, status: status as HistoryStatus | null, from, to, page: Number(page) }
}
export async function readHistory(db: PrismaClient, context: SessionContext, query: ReturnType<typeof historyQuery>, at: Date): Promise<HistoryResponse> {
  return db.$transaction(async (tx) => {
    await employeePrincipal(tx, context, at)
    const userId = context.user.id, proof = await protection(tx)
    const source = await historySources(tx, userId, '')
    const weeks = await tx.workWeek.findMany({ orderBy: { startsOn: 'desc' } })
    const trackers = await tx.weeklyTracker.findMany({ where: { userId } })
    const byWeek = new Map(trackers.map((row) => [row.weekId, row]))
    const byDate = new Map<string, Pick<WorkWeek, 'id' | 'startsOn' | 'freezesAt'> & { virtual: boolean; schedule: boolean }>(weeks.map((row) => [isoDay(row.startsOn), { ...row, virtual: false, schedule: true }]))
    if (proof.settings?.trackingStartsOn) {
      for (let date = proof.settings.trackingStartsOn; date <= monday(at); date = shiftDay(date, 7)) {
        const key = isoDay(date)
        if (byDate.has(key)) continue
        const freezesAt = watMidnight(shiftDay(date, 5))
        let schedule = proof.settings.updatedAt <= freezesAt
        try { weekProjection(date, null, proof.settings, [], at, false) } catch { schedule = false }
        byDate.set(key, { id: `missing:${key}`, startsOn: date, freezesAt, virtual: true, schedule })
      }
    }
    const snapshotWeeks = await tx.historyWeekSnapshot.findMany({ where: { persons: { some: { userId } } }, select: { id: true, startsOn: true, freezesAt: true } })
    const snapshotWeekIds = snapshotWeeks.map((row) => row.id)
    const snapshotWeekStarts = snapshotWeeks.map((row) => row.startsOn)
    const snapshotByDate = new Map(snapshotWeeks.map((row) => [isoDay(row.startsOn), row]))
    const snapshotTasks = snapshotWeekIds.length ? await tx.historyTaskSnapshot.findMany({ where: { historyWeekId: { in: snapshotWeekIds }, ownerId: userId, ...(query.week ? { historyWeek: { startsOn: day(query.week) } } : {}),
      ...(query.status ? { status: query.status } : {}), ...(query.from && query.to ? { startsOn: { lte: day(query.to) }, endsOn: { gte: day(query.from) } } : {}) }, include: { historyWeek: { select: { startsOn: true } } } }) : []
    const snapshotTaskWeeks = new Set(snapshotTasks.map((row) => isoDay(row.historyWeek.startsOn)))
    const taskWindows = await tx.$queryRaw<{ trackerId: string; matches: boolean }[]>`
      SELECT t."trackerId",bool_or(${query.from === null} OR (t."startsOn"<=${query.to ? day(query.to) : at}::date AND t."endsOn">=${query.from ? day(query.from) : at}::date)) AS matches
      FROM "WeeklyTask" t JOIN "WeeklyTracker" r ON r.id=t."trackerId"
      WHERE t."ownerId"=${userId} AND r."userId"=${userId} AND t."deletedAt" IS NULL GROUP BY t."trackerId"`
    const windows = new Map(taskWindows.map((row) => [row.trackerId, row.matches]))
    const available = new Map<string, SnapshotContext>()
    const candidates: { week: string; state: HistoryAvailability; startsOn: Date; trackerId: string | null }[] = []
    for (const [key, week] of byDate) {
      if (week.freezesAt > at) continue
      if (snapshotByDate.has(key)) {
        candidates.push({ week: key, startsOn: week.startsOn, state: 'AVAILABLE', trackerId: null })
        continue
      }
      const tracker = byWeek.get(week.id) ?? null
      if (!tracker && !source.person?.assignments.some((assignment) => overlapsWeek(assignment, week))) continue
      const evidence = historyEvidence({ person: source.person, tracker }, week, proof, at)
      let state = evidence.state
      if (week.virtual && !week.schedule) state = 'REPAIR_REQUIRED'
      if (evidence.context && !['EMPLOYEE', 'LINE_MANAGER'].includes(evidence.context.role) && tracker && windows.has(tracker.id)) state = 'REPAIR_REQUIRED'
      candidates.push({ week: key, startsOn: week.startsOn, state, trackerId: tracker?.id ?? null })
      if (state === 'AVAILABLE' && tracker && evidence.context) available.set(tracker.id, evidence.context)
    }
    const legacyWeek = query.week ? { startsOn: day(query.week) } : snapshotWeekStarts.length ? { startsOn: { notIn: snapshotWeekStarts } } : undefined
    const where: Prisma.WeeklyTaskWhereInput = { ownerId: userId, deletedAt: null, trackerId: { in: [...available.keys()] }, tracker: { userId, ...(legacyWeek ? { week: legacyWeek } : {}) },
      ...(query.status ? { status: query.status } : {}), ...(query.from && query.to ? { startsOn: { lte: day(query.to) }, endsOn: { gte: day(query.from) } } : {}) }
    const rows = await tx.weeklyTask.findMany({ where, orderBy: [{ tracker: { week: { startsOn: 'desc' } } }, { startsOn: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, trackerId: true, title: true, status: true, startsOn: true, endsOn: true, createdAt: true, tracker: { select: { week: { select: { startsOn: true } } } } } })
    const records = [
      ...snapshotTasks.map((row) => ({ id: row.id, title: row.title, status: row.status, startsOn: isoDay(row.startsOn), endsOn: isoDay(row.endsOn), week: isoDay(row.historyWeek.startsOn), ownerName: row.ownerName, createdAt: row.createdAt })),
      ...rows.map((row) => ({ id: row.id, title: row.title, status: row.status, startsOn: isoDay(row.startsOn), endsOn: isoDay(row.endsOn), week: isoDay(row.tracker.week.startsOn), ownerName: available.get(row.trackerId)!.displayName, createdAt: row.createdAt })),
    ].sort((a, b) => b.week.localeCompare(a.week) || a.startsOn.localeCompare(b.startsOn) || a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
    const total = records.length, skip = pageOffset(query.page, total)
    const page = skip === null ? [] : records.slice(skip, skip + 25)
    let pendingWeeks = 0, repairWeeks = 0
    for (const candidate of candidates) {
      if (query.week && candidate.week !== query.week) continue
      if (query.from && query.to && !(candidate.week <= query.to && isoDay(shiftDay(candidate.startsOn, 4)) >= query.from) && !snapshotTaskWeeks.has(candidate.week) && !(candidate.trackerId && windows.get(candidate.trackerId))) continue
      if (candidate.state === 'PENDING') pendingWeeks++
      if (candidate.state === 'REPAIR_REQUIRED') repairWeeks++
    }
    const selected = query.week ? candidates.find((row) => row.week === query.week) : null
    const known = query.week ? byDate.get(query.week) : null
    const selectedWeekState = !query.week ? null : selected?.state ?? ((known?.freezesAt ?? watMidnight(shiftDay(day(query.week), 5))) > at ? 'NOT_FROZEN' : 'NO_RECORD')
    let next = watMidnight(shiftDay(monday(at), 5))
    if (next <= at) next = shiftDay(next, 7)
    for (const week of weeks) if (week.freezesAt > at && week.freezesAt < next) next = week.freezesAt
    return { asOf: at.toISOString(), timezone: 'Africa/Lagos', currentWeekStart: isoDay(monday(at)), nextChangeAt: next.toISOString(),
      selection: { week: query.week, status: query.status, range: query.from && query.to ? { from: query.from, to: query.to } : null, page: query.page },
      records: { items: page.map(({ createdAt: _createdAt, ...row }) => row), total, page: query.page, pageSize: 25 },
      weeks: candidates.toSorted((a, b) => b.week.localeCompare(a.week)).map(({ week, state }) => ({ week, state })), availability: { pendingWeeks, repairWeeks, captureInitialized: !!proof.settings?.trackingStartsOn }, selectedWeekState }
  }, { isolationLevel: 'RepeatableRead', maxWait: 5000, timeout: 15000 })
}
