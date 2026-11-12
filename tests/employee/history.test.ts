import 'dotenv/config'
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import express from 'express'
import type { PrismaClient } from '../../src/generated/prisma/client.ts'
import { createDatabase } from '../../server/db.ts'
import { authTestDatabase, readAuthConfig } from '../../server/auth/config.ts'
import { createAuth } from '../../server/auth/provider.ts'
import { createAuthService } from '../../server/auth/service.ts'
import { provision } from '../../server/auth/provision.ts'
import { staffContext, safeContext } from '../../server/auth/context.ts'
import { capturePerson, completeRoster, initializeHistory } from '../../server/employee/history-capture.ts'
import { databaseClock, historySources, protection, historyEvidence, snapshotContext } from '../../server/employee/history-evidence.ts'
import { historyQuery, readHistory } from '../../server/employee/history-reads.ts'
import { historyCursor, historyPass, historyScope } from '../../server/employee/history-worker.ts'
import { closeHistoryWeek } from '../../server/employee/history-snapshot.ts'
import { registerEmployee } from '../../server/employee/router.ts'
import { isoDay, shiftDay, watMidnight } from '../../server/data-model/calendar.ts'
import { historicalFixtures } from '../helpers/historical-fixtures.ts'

const db = createDatabase(authTestDatabase(process.env.TEST_DATABASE_URL, process.env.DATABASE_URL))
const config = readAuthConfig(), service = createAuthService(db, createAuth(db, config))
const prefix = `f11-${randomUUID()}`, ids = ['partial', 'full', 'inactive', 'rollback', 'unsafe'].map((v) => `${prefix}-${v}`)
const server = createServer()
let weekId = '', parent = new Date('2026-08-03'), freeze: Date, base = '', cookie = '', managerCookie = ''
let assignmentId = '', leaveId = '', fullLeaveId = '', taskId = '', childTaskId = ''
const at = new Date('2025-01-01T00:00:00Z')
before(async () => {
  assert.ok(['CAPTURED', 'ALREADY_CAPTURED'].includes((await initializeHistory(db)).code))
  const known = new Set((await db.workWeek.findMany({ select: { startsOn: true } })).map((w) => isoDay(w.startsOn)))
  while ([-14, 0, 7].some((offset) => known.has(isoDay(shiftDay(parent, offset))))) parent = shiftDay(parent, -28)
  const source = await db.employmentAssignment.findFirstOrThrow({ where: { userId: 'person-ada-okafor', effectiveTo: null } })
  await historicalFixtures(async (tx) => {
    for (const [index, id] of ids.entries()) {
      await tx.user.create({ data: { id, email: `${id}@example.invalid`, name: `Recorded ${index}`, createdAt: at, updatedAt: at, accountStatus: index === 2 ? 'INACTIVE' : 'ACTIVE', deactivatedAt: index === 2 ? new Date(parent.getTime() - 86400000) : null } })
      const assignment = await tx.employmentAssignment.create({ data: { userId: id, role: 'EMPLOYEE', businessId: source.businessId, unitId: source.unitId, managerId: source.managerId, effectiveFrom: at, createdAt: at } })
      if (index === 0) assignmentId = assignment.id
    }
    leaveId = (await tx.leaveRecord.create({ data: { userId: ids[0], startsOn: parent, expectedReturnOn: shiftDay(parent, 3), createdAt: at } })).id
    fullLeaveId = (await tx.leaveRecord.create({ data: { userId: ids[1], startsOn: parent, expectedReturnOn: shiftDay(parent, 5), createdAt: at } })).id
    freeze = new Date((await databaseClock(tx)).getTime() + 800)
    weekId = (await tx.workWeek.create({ data: { startsOn: parent, planningLocksAt: watMidnight(shiftDay(parent, 1)), freezesAt: freeze } })).id
  })
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, freeze.getTime() - Date.now() + 20)))
})
after(async () => {
  if (base) await new Promise<void>((resolve) => server.close(() => resolve()))
  if (cookie) await service.signOut(new Headers({ cookie }))
  if (managerCookie) await service.signOut(new Headers({ cookie: managerCookie }))
  await db.$disconnect()
})

test('AC2,8 exact History selectors and private operator arguments reject invalid input', () => {
  assert.equal(historyQuery(`/history?week=${isoDay(parent)}&from=${isoDay(parent)}&to=${isoDay(shiftDay(parent, 365))}&status=BLOCKED`).page, 1)
  for (const value of ['status=Completed', 'ownerId=other', 'week=2026-11-03', 'page=9007199254740992', 'page=1&page=2', 'from=2026-02-30&to=2026-03-01']) assert.throws(() => historyQuery('/history?' + value))
  assert.throws(() => historyScope(['--user-id', ids[0]]))
  assert.throws(() => historyScope(['--apply', '--override']))
  assert.equal(historyScope(['--week', isoDay(parent), '--apply']).apply, true)
})
test('AC4,7 initialization repeats without rewriting baseline or audit', async () => {
  const before = await db.trackerSettings.findUniqueOrThrow({ where: { id: 'workforce-group' } })
  const count = await db.auditEvent.count({ where: { action: 'HISTORY_TRACKING_STARTED' } })
  assert.equal((await initializeHistory(db)).changed, false)
  assert.equal((await db.trackerSettings.findUniqueOrThrow({ where: { id: before.id } })).trackingStartsOn?.getTime(), before.trackingStartsOn?.getTime())
  assert.equal(await db.auditEvent.count({ where: { action: 'HISTORY_TRACKING_STARTED' } }), count)
})

test('AC5,7 Prisma instants agree with database epochs even with a non UTC URL option', async () => {
  const url = new URL(authTestDatabase(process.env.TEST_DATABASE_URL, process.env.DATABASE_URL))
  url.searchParams.set('options', '-c timezone=Africa/Lagos')
  const alternate = createDatabase(url.href)
  try {
    const [row] = await alternate.$queryRaw<{ zone: string; at: Date; milliseconds: bigint }[]>`SELECT current_setting('TimeZone') AS zone,clock_timestamp() AS at,floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS milliseconds`
    assert.equal(row.zone, 'UTC')
    assert.ok(Math.abs(row.at.getTime() - Number(row.milliseconds)) < 10)
  } finally { await alternate.$disconnect() }
})
test('AC5,7 competing captures commit one immutable snapshot and audit, with real partial leave', async () => {
  const result = await Promise.all([capturePerson(db, weekId, ids[0]), capturePerson(db, weekId, ids[0])])
  assert.equal(result.filter((r) => r.changed).length, 1)
  const tracker = await db.weeklyTracker.findUniqueOrThrow({ where: { userId_weekId: { userId: ids[0], weekId } } })
  assert.equal(tracker.expectedWorkingDaysSnapshot, 2)
  assert.ok(tracker.snapshotAt! >= freeze)
  assert.equal(await db.auditEvent.count({ where: { action: 'TRACKER_SNAPSHOT_CAPTURED', targetId: tracker.id } }), 1)
  assert.equal((await completeRoster(db, weekId)).code, 'CAPTURE_PENDING')
  assert.equal((await db.workWeek.findUniqueOrThrow({ where: { id: weekId } })).rosterCapturedAt, null)
})
test('AC7 tracker and audit insertion failure rolls the capture unit back', async () => {
  const failing = db.$extends({ query: { auditEvent: { async create({ args, query }) { await query(args); throw new Error('Isolated capture audit failure') } } } }) as unknown as PrismaClient
  await assert.rejects(capturePerson(failing, weekId, ids[3]))
  assert.equal(await db.weeklyTracker.count({ where: { userId: ids[3], weekId } }), 0)
  assert.equal((await capturePerson(db, weekId, ids[3])).code, 'CAPTURED')
})
test('AC5,6 historical source guards reject retroactive changes but permit safe later events', async () => {
  await assert.rejects(db.employmentAssignment.update({ where: { id: assignmentId }, data: { role: 'LINE_MANAGER', managerId: null } }))
  await assert.rejects(db.employmentAssignment.delete({ where: { id: assignmentId } }))
  await assert.rejects(db.leaveRecord.create({ data: { userId: ids[0], startsOn: parent, expectedReturnOn: shiftDay(parent, 1) } }))
  await assert.rejects(db.leaveRecord.update({ where: { id: leaveId }, data: { expectedReturnOn: shiftDay(parent, 4) } }))
  await db.leaveRecord.update({ where: { id: leaveId }, data: { cancelledAt: new Date(), cancelledById: 'person-kemi-adebayo' } })
  await assert.rejects(db.leaveRecord.update({ where: { id: fullLeaveId }, data: { actualReturnOn: new Date(new Date().toISOString().slice(0, 10)) } }))
  await db.leaveRecord.update({ where: { id: fullLeaveId }, data: { actualReturnOn: shiftDay(parent, 5) } })
  await assert.rejects(db.leaveRecord.update({ where: { id: fullLeaveId }, data: { actualReturnOn: null } }))
  await db.$transaction(async (tx) => {
    const current = await tx.employmentAssignment.findUniqueOrThrow({ where: { id: assignmentId } }), now = new Date()
    await tx.employmentAssignment.update({ where: { id: current.id }, data: { effectiveTo: now } })
    await tx.employmentAssignment.create({ data: { userId: current.userId, role: current.role, businessId: current.businessId, unitId: current.unitId, managerId: current.managerId, effectiveFrom: now } })
  })
  assert.equal((await db.employmentAssignment.findUniqueOrThrow({ where: { id: assignmentId } })).role, 'EMPLOYEE')
})
test('AC3,6 existing snapshots preserve labels and days; preprotection missing records stay unavailable', async () => {
  await db.user.update({ where: { id: ids[0] }, data: { name: 'Current renamed employee' } })
  assert.equal((await capturePerson(db, weekId, ids[0])).code, 'ALREADY_CAPTURED')
  const historical = await db.workWeek.findUniqueOrThrow({ where: { startsOn: new Date('2026-10-19') } })
  assert.equal((await capturePerson(db, historical.id, ids[0])).code, 'HISTORICAL_FACTS_UNAVAILABLE')
  assert.equal((await completeRoster(db, historical.id)).code, 'HISTORICAL_FACTS_UNAVAILABLE')
  const observed = await db.$transaction(async (tx) => historyEvidence(await historySources(tx, ids[0], weekId), await tx.workWeek.findUniqueOrThrow({ where: { id: weekId } }), await protection(tx), await databaseClock(tx)))
  assert.equal(observed.context?.displayName, 'Recorded 0'); assert.equal(observed.days, 2)
})
test('AC1,2,3,6,8 real History API filters, pages, distinct carries, long task availability and frozen drawer', async () => {
  await historicalFixtures(async (tx) => {
    const tracker = await tx.weeklyTracker.findUniqueOrThrow({ where: { userId_weekId: { userId: ids[0], weekId } } })
    const source = snapshotContext(tracker.contextSnapshot, ids[0]); assert.ok(source)
    const childStart = shiftDay(parent, 7), badStart = shiftDay(parent, -14)
    const child = await tx.workWeek.create({ data: { startsOn: childStart, planningLocksAt: watMidnight(shiftDay(childStart, 1)), freezesAt: watMidnight(shiftDay(childStart, 5)) } })
    const bad = await tx.workWeek.create({ data: { startsOn: badStart, planningLocksAt: watMidnight(shiftDay(badStart, 1)), freezesAt: watMidnight(shiftDay(badStart, 5)) } })
    const childTracker = await tx.weeklyTracker.create({ data: { userId: ids[0], weekId: child.id, assignmentId, contextSnapshot: { ...source }, expectedWorkingDaysSnapshot: 5, snapshotAt: child.freezesAt } })
    const badTracker = await tx.weeklyTracker.create({ data: { userId: ids[0], weekId: bad.id, assignmentId, contextSnapshot: { ...source, displayName: null }, expectedWorkingDaysSnapshot: 5, snapshotAt: bad.freezesAt } })
    for (let i = 0; i < 28; i++) {
      const series = await tx.taskSeries.create({ data: { ownerId: ids[0] } })
      const task = await tx.weeklyTask.create({ data: { ownerId: ids[0], seriesId: series.id, trackerId: tracker.id, title: `History outcome ${i}`, activity: 'Recorded historical work', startsOn: parent, endsOn: shiftDay(parent, 18), status: i % 2 ? 'BLOCKED' : 'PENDING', blockerReason: i % 2 ? 'Historical blocker' : null } })
      if (!i) {
        taskId = task.id
        childTaskId = (await tx.weeklyTask.create({ data: { ownerId: ids[0], seriesId: series.id, trackerId: childTracker.id, carriedFromId: task.id, title: task.title, activity: task.activity, startsOn: childStart, endsOn: shiftDay(childStart, 4) } })).id
      }
    }
    const series = await tx.taskSeries.create({ data: { ownerId: ids[0] } })
    await tx.weeklyTask.create({ data: { ownerId: ids[0], seriesId: series.id, trackerId: badTracker.id, title: 'Unavailable long outcome', activity: 'Must not claim complete coverage', startsOn: badStart, endsOn: shiftDay(parent, 30) } })
  })
  assert.ok(process.env.LOCAL_AUTH_TEST_PASSWORD)
  await provision(db, config, ids[0], process.env.LOCAL_AUTH_TEST_PASSWORD)
  for (const id of [ids[0], 'person-tunde-bakare']) {
    await provision(db, config, id, process.env.LOCAL_AUTH_TEST_PASSWORD)
    const person = await db.user.findUniqueOrThrow({ where: { id } })
    const result = await service.signIn(person.email, process.env.LOCAL_AUTH_TEST_PASSWORD, new Headers({ origin: config.origin }))
    const value = result.headers.getSetCookie().map((v) => v.split(';')[0]).join('; ')
    if (id === ids[0]) cookie = value; else managerCookie = value
  }
  const app = express(), api = express.Router(); registerEmployee(api, db, service, config); app.use('/api', api); server.on('request', app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve)); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const request = (path: string, token = cookie) => fetch(base + '/api/employee/' + path, { headers: { cookie: token } })
  assert.equal((await request('history', '')).status, 401)
  assert.equal((await request('history', managerCookie)).status, 403)
  assert.equal((await request('history?ownerId=other')).status, 400)
  const response = await request('history?week=' + isoDay(parent))
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store')
  const first = await response.json(); assert.equal(first.records.total, 28); assert.equal(first.records.items.length, 25)
  assert.equal(first.records.items[0].ownerName, 'Recorded 0')
  const status = await (await request(`history?week=${isoDay(parent)}&status=BLOCKED`)).json(); assert.equal(status.records.total, 14)
  const next = await (await request(`history?week=${isoDay(parent)}&page=2`)).json(); assert.equal(next.records.items.length, 3)
  const range = await (await request(`history?from=${isoDay(shiftDay(parent, 14))}&to=${isoDay(shiftDay(parent, 20))}`)).json()
  assert.equal(range.records.total, 28); assert.ok(range.availability.repairWeeks >= 1)
  const unavailable = await (await request(`history?week=${isoDay(shiftDay(parent, -14))}&from=${isoDay(shiftDay(parent, 14))}&to=${isoDay(shiftDay(parent, 20))}&status=APPROVED`)).json()
  assert.equal(unavailable.availability.repairWeeks, 1); assert.equal(unavailable.records.total, 0)
  const all = await (await request('history')).json(); assert.ok(all.records.items.some((v: { id: string }) => v.id === childTaskId))
  const detail = await (await request('tasks/' + taskId)).json(); assert.equal(detail.frozen, true); assert.equal(detail.owner.name, 'Recorded 0'); assert.equal(detail.task.permissions.canEdit, false)
  const recorded = await db.weeklyTracker.findUniqueOrThrow({ where: { userId_weekId: { userId: ids[0], weekId } } })
  await db.$transaction(async (tx) => {
    const task = await tx.weeklyTask.findUniqueOrThrow({ where: { id: taskId } })
    const request = await tx.approvalRequest.create({ data: { weeklyTaskId: taskId, attemptNumber: 1, submittedById: ids[0], submissionAssignmentId: assignmentId, assignedManagerId: 'person-tunde-bakare', submissionSnapshot: { version: 1, title: task.title, activity: task.activity, startsOn: isoDay(task.startsOn), endsOn: isoDay(task.endsOn), ownerId: ids[0], ownerDisplayName: 'Recorded 0', weekStartsOn: isoDay(parent), status: 'AWAITING_APPROVAL' } } })
    await tx.approvalDecision.create({ data: { requestId: request.id, decision: 'APPROVE', method: 'HUMAN', actorId: 'person-tunde-bakare' } })
    await tx.approvalRequest.update({ where: { id: request.id }, data: { state: 'DECIDED' } })
    await tx.weeklyTask.update({ where: { id: taskId }, data: { status: 'APPROVED', revision: { increment: 1 } } })
  })
  const approved = await (await request(`history?week=${isoDay(parent)}&status=APPROVED`)).json()
  assert.equal(approved.records.total, 1); assert.equal(approved.records.items[0].id, taskId)
  assert.equal((await (await request('tasks/' + taskId)).json()).review.decision.kind, 'APPROVE')
  assert.deepEqual(await db.weeklyTracker.findUniqueOrThrow({ where: { id: recorded.id } }), recorded)
  const rejected = await fetch(`${base}/api/employee/tasks/${taskId}/comments`, { method: 'POST', headers: { cookie, origin: config.origin, 'content-type': 'application/json', 'idempotency-key': randomUUID() }, body: JSON.stringify({ body: 'Closed mutation' }) })
  assert.equal(rejected.status, 423)
  const staff = await staffContext(db, ids[0]); assert.ok(staff)
  const empty = await readHistory(db, safeContext(staff, new Date(Date.now() + 60000)), historyQuery('/history?week=2099-01-05'), new Date())
  assert.equal(empty.selectedWeekState, 'NOT_FROZEN')
})
test('AC5,6,7 complete roster includes all roles, inactive and zero task people, and completion repeats once', async () => {
  const required = await db.employmentAssignment.findMany({ where: { effectiveFrom: { lt: freeze }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: watMidnight(parent) } }] }, distinct: ['userId'], select: { userId: true } })
  for (const { userId } of required) {
    const result = await capturePerson(db, weekId, userId)
    assert.ok(['CAPTURED', 'ALREADY_CAPTURED'].includes(result.code), `${userId}: ${result.code}`)
  }
  const full = await db.weeklyTracker.findUniqueOrThrow({ where: { userId_weekId: { userId: ids[1], weekId } } })
  const inactive = await db.weeklyTracker.findUniqueOrThrow({ where: { userId_weekId: { userId: ids[2], weekId } } })
  assert.equal(full.expectedWorkingDaysSnapshot, 0); assert.equal(inactive.expectedWorkingDaysSnapshot, 0)
  assert.equal(await db.weeklyTask.count({ where: { trackerId: full.id } }), 0)
  let release: () => void = () => {}, reached: () => void = () => {}
  const ready = new Promise<void>((resolve) => { reached = resolve }), gate = new Promise<void>((resolve) => { release = resolve })
  const assignmentWriter = db.$transaction(async (tx) => { await tx.$executeRaw`LOCK TABLE "EmploymentAssignment" IN ROW EXCLUSIVE MODE`; reached(); await gate })
  await ready
  try { assert.equal((await completeRoster(db, weekId)).code, 'RETRY_LATER') } finally { release(); await assignmentWriter }
  const failing = db.$extends({ query: { auditEvent: { async create({ args, query }) { await query(args); throw new Error('Isolated roster audit failure') } } } }) as unknown as PrismaClient
  await assert.rejects(completeRoster(failing, weekId))
  assert.equal((await db.workWeek.findUniqueOrThrow({ where: { id: weekId } })).rosterCapturedAt, null)
  assert.equal(await db.auditEvent.count({ where: { action: 'WEEK_ROSTER_CAPTURED', targetId: weekId } }), 0)
  const result = await Promise.all([completeRoster(db, weekId), completeRoster(db, weekId)])
  assert.equal(result.filter((r) => r.changed).length, 1)
  assert.equal(await db.auditEvent.count({ where: { action: 'WEEK_ROSTER_CAPTURED', targetId: weekId } }), 1)
  assert.equal(await db.weeklyTracker.count({ where: { weekId } }), required.length)
})
test('AC7 scoped diagnostics and retry preserve evidence and do not mark unrelated rosters', async () => {
  const before = await db.auditEvent.count()
  const diagnostic = await historyPass(db, historyCursor(), false, { week: isoDay(parent), userId: ids[0] })
  assert.equal(diagnostic.remaining, false); assert.equal(diagnostic.persons.already, 1)
  assert.equal(await db.auditEvent.count(), before)
  const retry = await historyPass(db, historyCursor(), true, { week: isoDay(parent), userId: ids[0] })
  assert.equal(retry.remaining, false); assert.equal(retry.persons.already, 1)
  assert.equal(await db.auditEvent.count(), before)
})

test('AC5,6,7 capture rechecks the database clock and changed facts after an owner lock wait', async () => {
  let date = shiftDay(parent, -7)
  while (await db.workWeek.findUnique({ where: { startsOn: date } })) date = shiftDay(date, -7)
  const closes = new Date(Date.now() + 600)
  const week = await db.workWeek.create({ data: { startsOn: date, planningLocksAt: watMidnight(shiftDay(date, 1)), freezesAt: closes } })
  let reached: () => void = () => {}, release: () => void = () => {}
  const ready = new Promise<void>((resolve) => { reached = resolve }), gate = new Promise<void>((resolve) => { release = resolve })
  const blocker = db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${ids[4]} FOR UPDATE`
    reached(); await gate
    await tx.user.update({ where: { id: ids[4] }, data: { name: 'Changed after the freeze' } })
  })
  await ready
  const waiting = capturePerson(db, week.id, ids[4])
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, closes.getTime() - Date.now() + 30)))
  release(); await blocker
  assert.equal((await waiting).code, 'HISTORICAL_FACTS_UNAVAILABLE')
  assert.equal(await db.weeklyTracker.count({ where: { userId: ids[4], weekId: week.id } }), 0)
})

test('AC4,7 catch-up advances past repair targets and respects independent admission caps', async () => {
  const cursor = historyCursor()
  const diagnostics: string[] = []
  const first = await historyPass(db, cursor, true, {}, () => false, (code) => { diagnostics.push(code) })
  assert.equal(first.infrastructureFailure, false)
  assert.ok(first.persons.captured + first.persons.already + first.persons.pending + first.persons.repair <= 50)
  assert.ok(first.weeks.complete + first.weeks.pending + first.weeks.repair <= 15)
  assert.ok(first.persons.repair > 0); assert.equal(first.remaining, true)
  assert.ok(diagnostics.length > 0); assert.ok(diagnostics.every((code) => code === 'HISTORY_CAPTURE_FAILED'))
  const old = cursor.person && { ...cursor.person }
  const second = await historyPass(db, cursor, true)
  assert.equal(second.infrastructureFailure, false)
  assert.notDeepEqual(cursor.person, old)
  assert.equal(cursor.phase, 2)
})

test('AC6,7 a failed person audit rolls back while unrelated catch-up units still commit', async () => {
  let date = shiftDay(parent, -7)
  while (await db.workWeek.findUnique({ where: { startsOn: date } })) date = shiftDay(date, -7)
  const closes = new Date(Date.now() + 500)
  const week = await db.workWeek.create({ data: { startsOn: date, planningLocksAt: watMidnight(shiftDay(date, 1)), freezesAt: closes } })
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, closes.getTime() - Date.now() + 20)))
  let fail = true, failedId = ''
  const failing = db.$extends({ query: { auditEvent: { async create({ args, query }) {
    const row = await query(args)
    if (args.data.action === 'TRACKER_SNAPSHOT_CAPTURED' && fail) { fail = false; failedId = String(args.data.targetId); throw new Error('One capture audit failed') }
    return row
  } } } }) as unknown as PrismaClient
  const diagnostics: string[] = []
  const result = await historyPass(failing, historyCursor(), true, { week: isoDay(date) }, () => false, (code) => { diagnostics.push(code) })
  assert.equal(fail, false); assert.equal(result.infrastructureFailure, true)
  assert.ok(result.persons.captured > 0); assert.ok(result.persons.pending > 0)
  assert.deepEqual(diagnostics, ['HISTORY_CAPTURE_FAILED'])
  assert.equal(await db.weeklyTracker.count({ where: { id: failedId } }), 0)
  assert.equal(await db.auditEvent.count({ where: { targetId: failedId } }), 0)
  assert.equal((await db.workWeek.findUniqueOrThrow({ where: { id: week.id } })).rosterCapturedAt, null)
})

test('synchronous close publishes immutable week, person, task, comment and review snapshots', async () => {
  const result = await closeHistoryWeek(db, weekId)
  assert.ok(['CAPTURED', 'ALREADY_CAPTURED'].includes(result.code))
  const snapshot = await db.historyWeekSnapshot.findUniqueOrThrow({ where: { weekId }, include: { persons: true, tasks: true } })
  assert.equal(snapshot.persons.length, (await db.weeklyTracker.count({ where: { weekId } })))
  const trackerIds = (await db.weeklyTracker.findMany({ where: { weekId }, select: { id: true } })).map((row) => row.id)
  assert.equal(snapshot.tasks.length, await db.weeklyTask.count({ where: { trackerId: { in: trackerIds }, deletedAt: null } }))
  const staff = await staffContext(db, ids[0]); assert.ok(staff)
  const history = await readHistory(db, safeContext(staff, new Date(Date.now() + 60000)),
    historyQuery(`/history?week=${isoDay(parent)}&status=APPROVED`), await databaseClock(db))
  assert.equal(history.records.total, 1)
  assert.deepEqual(history.records.items.map(({ id, ownerName }) => [id, ownerName]), [[taskId, 'Recorded 0']])
  assert.equal((await closeHistoryWeek(db, weekId)).code, 'ALREADY_CAPTURED')
  await assert.rejects(db.historyTaskSnapshot.update({ where: { id: snapshot.tasks[0]?.id ?? 'missing' }, data: { title: 'rewrite' } }))
})
