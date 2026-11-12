import { Prisma } from '../../src/generated/prisma/client.ts'
import type { PrismaClient, WorkWeek } from '../../src/generated/prisma/client.ts'
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

type HistoryQuery = ReturnType<typeof historyQuery>

async function historyPage(tx: Prisma.TransactionClient, userId: string, available: Map<string, SnapshotContext>, query: HistoryQuery): Promise<HistoryResponse['records']> {
  const owners = JSON.stringify(Object.fromEntries([...available].map(([id, context]) => [id, context.displayName])))
  const source = Prisma.sql`
    WITH records AS (
      SELECT saved.id, saved.title, t.status::text AS status, saved."startsOn", saved."endsOn",
             w."startsOn" AS week, saved."ownerName", saved."createdAt"
      FROM "HistoryTaskSnapshot" saved
      JOIN "HistoryWeekSnapshot" w ON w.id = saved."historyWeekId"
      JOIN "HistoryPersonSnapshot" person ON person."historyWeekId" = w.id AND person."userId" = saved."ownerId"
      JOIN "WeeklyTask" t ON t.id = saved.id AND t."ownerId" = saved."ownerId"
      JOIN "WeeklyTracker" tracker ON tracker.id = t."trackerId" AND tracker."userId" = saved."ownerId"
      WHERE saved."ownerId" = ${userId} AND t."deletedAt" IS NULL
      UNION ALL
      SELECT t.id, t.title, t.status::text, t."startsOn", t."endsOn", w."startsOn", owner.value, t."createdAt"
      FROM jsonb_each_text(${owners}::jsonb) owner
      JOIN "WeeklyTracker" tracker ON tracker.id = owner.key AND tracker."userId" = ${userId}
      JOIN "WorkWeek" w ON w.id = tracker."weekId"
      JOIN "WeeklyTask" t ON t."trackerId" = tracker.id AND t."ownerId" = tracker."userId"
      WHERE t."deletedAt" IS NULL
    )
  `
  const filters = Prisma.sql`
    WHERE TRUE
    ${query.week ? Prisma.sql`AND week = ${query.week}::date` : Prisma.empty}
    ${query.status ? Prisma.sql`AND status = ${query.status}` : Prisma.empty}
    ${query.from && query.to ? Prisma.sql`AND "startsOn" <= ${query.to}::date AND "endsOn" >= ${query.from}::date` : Prisma.empty}
  `
  const [count] = await tx.$queryRaw<{ total: bigint }[]>`${source} SELECT count(*) AS total FROM records ${filters}`
  const total = Number(count.total), skip = pageOffset(query.page, total)
  const rows = skip === null || !total ? [] : await tx.$queryRaw<{
    id: string; title: string; status: HistoryStatus; startsOn: Date; endsOn: Date; week: Date; ownerName: string
  }[]>`
    ${source} SELECT id, title, status, "startsOn", "endsOn", week, "ownerName" FROM records ${filters}
    ORDER BY week DESC, "startsOn", "createdAt", id LIMIT 25 OFFSET ${skip}
  `
  return { items: rows.map((row) => ({ ...row, startsOn: isoDay(row.startsOn), endsOn: isoDay(row.endsOn), week: isoDay(row.week) })),
    total, page: query.page, pageSize: 25 }
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
    const snapshotWeeks = await tx.historyWeekSnapshot.findMany({ where: { persons: { some: { userId } } }, select: { startsOn: true } })
    const snapshotByDate = new Set(snapshotWeeks.map((row) => isoDay(row.startsOn)))
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
    const records = await historyPage(tx, userId, available, query)
    let pendingWeeks = 0, repairWeeks = 0
    for (const candidate of candidates) {
      if (query.week && candidate.week !== query.week) continue
      if (query.from && query.to && !(candidate.week <= query.to && isoDay(shiftDay(candidate.startsOn, 4)) >= query.from) && !(candidate.trackerId && windows.get(candidate.trackerId))) continue
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
      records,
      weeks: candidates.toSorted((a, b) => b.week.localeCompare(a.week)).map(({ week, state }) => ({ week, state })), availability: { pendingWeeks, repairWeeks, captureInitialized: !!proof.settings?.trackingStartsOn }, selectedWeekState }
  }, { isolationLevel: 'RepeatableRead', maxWait: 5000, timeout: 15000 })
}
