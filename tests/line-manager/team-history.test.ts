import 'dotenv/config'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, test } from 'node:test'
import express from 'express'
import { authTestDatabase, readAuthConfig } from '../../server/auth/config.ts'
import { provision } from '../../server/auth/provision.ts'
import { createAuth } from '../../server/auth/provider.ts'
import { createAuthService } from '../../server/auth/service.ts'
import { day, isoDay, shiftDay, watMidnight } from '../../server/data-model/calendar.ts'
import { createDatabase, databaseClock } from '../../server/db.ts'
import { registerLineManager } from '../../server/line-manager/router.ts'
import type { TeamTaskDetail } from '../../src/features/line-manager/dashboard-view.ts'
import type { TeamHistory, TeamPeople, TeamWeek } from '../../src/features/line-manager/team-history-contracts.ts'
import { managerFixtures } from '../helpers/manager-dashboard-fixtures.ts'
import { frozenTeamFixture } from '../helpers/team-history-fixtures.ts'
import { historicalFixtures } from '../helpers/historical-fixtures.ts'

const db = createDatabase(authTestDatabase(process.env.TEST_DATABASE_URL, process.env.DATABASE_URL))
const config = readAuthConfig()
const service = createAuthService(db, createAuth(db, config))
const app = express()
const server = createServer(app)
let fixture: Awaited<ReturnType<typeof managerFixtures>>
let frozen: Awaited<ReturnType<typeof frozenTeamFixture>>
let base = '', manager = '', otherManager = '', employee = ''

async function login(email: string) {
  const result = await service.signIn(email, fixture.password, new Headers({ origin: config.origin }))
  return result.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ')
}

before(async () => {
  process.env.EMAIL_MODE = 'off'
  fixture = await managerFixtures(db, config)
  frozen = await frozenTeamFixture(db, fixture, false)
  await provision(db, config, fixture.otherManagerId, fixture.password)
  manager = await login(fixture.email)
  employee = await login(fixture.ownerEmail)
  const other = await db.user.findUniqueOrThrow({ where: { id: fixture.otherManagerId } })
  otherManager = await login(other.email)
  const router = express.Router()
  registerLineManager(router, db, service, config)
  app.use('/api', router)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/line-manager`
})

after(async () => {
  if (base) await new Promise<void>((resolve) => server.close(() => resolve()))
  for (const cookie of [manager, otherManager, employee]) if (cookie) await service.signOut(new Headers({ cookie }))
  await db.$disconnect()
})

const get = (path: string, cookie = manager) => fetch(base + path, { headers: { cookie } })
const rosterPath = '/team-history'
const personWeek = (id: string, week: string) => `${rosterPath}/${id}/weeks/${week}`
async function read<T>(path: string, cookie?: string) {
  const response = await get(path, cookie)
  assert.equal(response.status, 200, path)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  return await response.json() as T
}

test('defaults to the current direct team and uses real task counts and expected days', async () => {
  const current = await read<TeamHistory>(rosterPath)
  assert.deepEqual(current.selection, { kind: 'week', week: fixture.week })
  const rows = new Map(current.rows.items.map((row) => [row.id, row]))
  assert.equal(rows.get(fixture.ownerId)?.completion, 25)
  assert.equal(rows.get(fixture.ownerId)?.tasks, 6)
  assert.equal(rows.get(fixture.missingId)?.participation, 'NOT_SUBMITTED')
  assert.equal(rows.get(fixture.missingId)?.completion, 0)
  assert.equal(rows.get(fixture.leaveId)?.participation, 'ON_LEAVE')
  assert.equal(rows.get(fixture.leaveId)?.completion, null)
  assert.ok(!rows.has(fixture.outsideId) && !rows.has(fixture.managerId) && !rows.has(frozen.transfer.id))
  const owner = await read<TeamWeek>(personWeek(fixture.ownerId, fixture.week))
  assert.equal(owner.frozen, false)
  assert.equal(owner.attention.total, 2)
  assert.equal(owner.tasks.total, 6)
  const selected = await read<TeamHistory>(`${rosterPath}?search=${encodeURIComponent(fixture.missingName.toUpperCase())}&personId=${fixture.missingId}&participation=NOT_SUBMITTED`)
  assert.deepEqual(selected.rows.items.map(({ id }) => id), [fixture.missingId])
  assert.equal(selected.selectedPerson?.label, fixture.missingName)
})

test('preserves frozen scope and availability across transfer and incomplete capture', async () => {
  const old = await read<TeamHistory>(`${rosterPath}?week=${frozen.week}`)
  assert.deepEqual(old.availability.unavailableWeeks, [frozen.week])
  assert.equal(old.summary, null)
  assert.equal(old.rows.items.find(({ id }) => id === frozen.transfer.id)?.completion, null)
  assert.equal(old.rows.items.find(({ id }) => id === frozen.transfer.id)?.label, frozen.transfer.name)
  const outside = await get(personWeek(frozen.transfer.id, frozen.week), otherManager)
  const missing = await get(personWeek('no-such-person', frozen.week), otherManager)
  assert.equal(outside.status, 404)
  assert.deepEqual(await outside.json(), await missing.json())
  assert.equal((await get(`/team-tasks/${frozen.taskId}`, otherManager)).status, 404)
  assert.ok((await read<TeamHistory>(rosterPath, otherManager)).rows.items.some(({ id }) => id === frozen.transfer.id))
  const masked = await read<TeamHistory>(`${rosterPath}?week=${frozen.week}&personId=${fixture.outsideId}&participation=ON_LEAVE`)
  assert.deepEqual(masked.rows.items, [])
  assert.deepEqual(masked.availability.unavailableWeeks, [frozen.week])
  assert.equal(await db.workWeek.findUnique({ where: { id: frozen.weekId } }).then((week) => week?.rosterCapturedAt), null)
  await db.workWeek.update({ where: { id: frozen.weekId }, data: { rosterCapturedAt: await databaseClock(db) } })
  const captured = await read<TeamHistory>(`${rosterPath}?week=${frozen.week}`)
  assert.deepEqual(captured.availability.unavailableWeeks, [])
  assert.deepEqual(captured.summary, { personWeeks: 5, submission: 67, completion: 100 })
  const rows = new Map(captured.rows.items.map((row) => [row.id, row]))
  assert.deepEqual([rows.get(frozen.cancelled.id)?.participation, rows.get(frozen.cancelled.id)?.tasks, rows.get(frozen.cancelled.id)?.completion], ['SUBMITTED', 1, 0])
  assert.deepEqual([rows.get(frozen.empty.id)?.participation, rows.get(frozen.empty.id)?.tasks], ['NOT_SUBMITTED', 0])
  assert.equal(rows.get(frozen.onLeave.id)?.participation, 'ON_LEAVE')
  assert.equal(rows.get(frozen.excluded.id)?.participation, 'NOT_EXPECTED')
})

test('drills into the exact frozen week and applies a later decision to captured task text and comments', async () => {
  const week = await read<TeamWeek>(personWeek(frozen.transfer.id, frozen.week) + '?status=APPROVED')
  assert.equal(week.frozen, true)
  assert.equal(week.expectedDays, 4)
  assert.equal(week.person.manager, 'Recorded line manager')
  assert.deepEqual(week.tasks.items.map(({ id, title, activity, status }) => ({ id, title, activity, status })), [
    { id: frozen.taskId, title: frozen.title, activity: frozen.activity, status: 'APPROVED' },
  ])
  assert.equal((await read<TeamWeek>(personWeek(frozen.transfer.id, frozen.week) + '?status=AWAITING_APPROVAL')).tasks.total, 0)
  assert.equal((await read<TeamWeek>(personWeek(frozen.empty.id, frozen.week))).tasks.total, 0)
  const detail = await read<TeamTaskDetail>(`/team-tasks/${frozen.taskId}`)
  assert.equal(detail.frozen, true)
  assert.equal(detail.canComment, false)
  assert.equal(detail.review?.decision, 'APPROVE')
  assert.equal(detail.comments.items[0]?.body, frozen.comment)
  assert.equal(detail.comments.items[0]?.authorName, 'Recorded line manager')
  assert.equal(detail.task.title, frozen.title)
  const write = await fetch(`${base}/team-tasks/${frozen.taskId}/comments`, { method: 'POST', headers: {
    cookie: manager, origin: config.origin, 'content-type': 'application/json', 'idempotency-key': randomUUID(),
  }, body: JSON.stringify({ body: 'Cannot change frozen conversation' }) })
  assert.equal(write.status, 404)
  await assert.rejects(db.weeklyTask.update({ where: { id: frozen.taskId }, data: { title: 'Protected by publication' } }))
  const current = await read<TeamTaskDetail>(`/team-tasks/${fixture.blockerId}`)
  assert.equal(current.canComment, true)
})

test('uses overlapping workweeks, scoped options, bounded selectors and safe large pages', async () => {
  const range = `from=${isoDay(shiftDay(day(frozen.previousWeek), 4))}&to=${frozen.week}`
  const result = await read<TeamHistory>(`${rosterPath}?${range}`)
  assert.deepEqual(result.includedWeeks, [frozen.previousWeek, frozen.week])
  assert.deepEqual(result.rows.items.filter(({ id }) => id === frozen.cancelled.id).map(({ week, unit }) => [week, unit]),
    [[frozen.week, 'Recorded unit'], [frozen.previousWeek, 'Previous unit']])
  const people = await read<TeamPeople>(`${rosterPath}/people?${range}&search=RECORDED%20UNIT`)
  assert.equal(people.people.total, 5)
  assert.ok(people.people.items.every(({ unit }) => unit === 'Recorded unit'))
  const huge = await read<TeamHistory>(`${rosterPath}?page=9007199254740991`)
  assert.equal(huge.rows.items.length, 0)
  assert.ok(huge.rows.total > 0)
  const hugeTasks = await read<TeamWeek>(personWeek(fixture.ownerId, fixture.week) + '?page=9007199254740991')
  assert.equal(hugeTasks.tasks.total, 6)
  assert.deepEqual(hugeTasks.tasks.items, [])
  const future = isoDay(shiftDay(day(fixture.week), 7))
  assert.deepEqual((await read<TeamHistory>(`${rosterPath}?week=${future}`)).availability.notOpenWeeks, [future])
  for (const input of ['search=a&search=b', `week=${fixture.week}&from=${fixture.week}&to=${fixture.week}`, 'participation=PENDING',
    'week=2026-11-10', 'from=2026-01-01&to=2027-01-02', 'page=9007199254740992', 'search=' + 'a'.repeat(121), 'unit=hidden']) {
    assert.equal((await get(`${rosterPath}?${input}`)).status, 400, input)
  }
  assert.equal((await get(`${rosterPath}/people?personId=${fixture.ownerId}`)).status, 400)
  assert.equal((await get(personWeek(fixture.ownerId, fixture.week) + '?status=NOT_SUBMITTED')).status, 400)
  assert.equal((await get(rosterPath, '')).status, 401)
  assert.equal((await get(rosterPath, 'tampered.session=invalid')).status, 401)
  assert.equal((await get(rosterPath, employee)).status, 403)
})

test('keeps valid rows visible when a corrupt candidate has no trustworthy context', async () => {
  const hiddenName = `Untrusted current name ${fixture.prefix}`
  const id = `f18-corrupt-${fixture.tag}`
  await historicalFixtures(async (tx) => {
    const start = watMidnight(day(frozen.week))
    await tx.user.create({ data: { id, name: hiddenName, email: `${id}@example.invalid`, createdAt: start, accountStatus: 'ACTIVE' } })
    const original = await tx.employmentAssignment.findUniqueOrThrow({ where: { id: fixture.ownerAssignmentId } })
    const assignment = await tx.employmentAssignment.create({ data: { userId: id, role: 'EMPLOYEE', managerId: fixture.managerId,
      businessId: original.businessId, unitId: original.unitId, effectiveFrom: start, effectiveTo: watMidnight(day(fixture.week)) } })
    await tx.weeklyTracker.create({ data: { userId: id, weekId: frozen.weekId, assignmentId: assignment.id,
      expectedWorkingDaysSnapshot: 5, snapshotAt: await databaseClock(tx), contextSnapshot: {
        version: 1, userId: id, displayName: hiddenName, role: 'EMPLOYEE', accountStatus: 'ACTIVE',
        businessId: original.businessId, businessName: 'Recorded business', unitId: original.unitId, unitName: '',
        managerId: fixture.managerId, managerName: fixture.managerName, departmentLabel: null,
      } } })
  })
  const history = await read<TeamHistory>(`${rosterPath}?week=${frozen.week}`)
  assert.deepEqual(history.availability.unavailableWeeks, [frozen.week])
  assert.equal(history.summary, null)
  assert.equal(history.rows.total, 5)
  assert.ok(!JSON.stringify(history).includes(hiddenName))
  assert.equal((await get(personWeek(id, frozen.week))).status, 404)
  const options = await read<TeamPeople>(`${rosterPath}/people?week=${frozen.week}`)
  assert.ok(!options.people.items.some((person) => person.id === id))
})

test('dated relief grants no current roster, employee week or task access', async () => {
  await db.$transaction(async (tx) => {
    const leave = await tx.leaveRecord.create({ data: { userId: fixture.otherManagerId, startsOn: fixture.today, expectedReturnOn: shiftDay(fixture.today, 1) } })
    await tx.reliefAssignment.create({ data: { leaveId: leave.id, coveredManagerId: fixture.otherManagerId, reliefManagerId: fixture.managerId,
      startsOn: fixture.today, endsOn: shiftDay(fixture.today, 1) } })
  })
  assert.equal((await get(personWeek(fixture.outsideId, fixture.week))).status, 404)
  assert.equal((await get(`/team-tasks/${fixture.outsideTaskId}`)).status, 404)
  const people = await read<TeamPeople>(`${rosterPath}/people?search=Outside`)
  assert.equal(people.people.total, 0)
})

test('pages roster and person options separately without losing a selected employee', async () => {
  const people = Array.from({ length: 27 }, (_, index) => {
    const id = `f18-page-${fixture.tag}-${index}`
    return { id, email: `${id}@example.invalid`, name: `Roster page employee ${String(index).padStart(2, '0')}` }
  })
  await historicalFixtures(async (tx) => {
    const original = await tx.employmentAssignment.findUniqueOrThrow({ where: { id: fixture.ownerAssignmentId } })
    const effectiveFrom = watMidnight(day(fixture.week))
    await tx.user.createMany({ data: people.map((person) => ({ ...person, accountStatus: 'ACTIVE', createdAt: effectiveFrom })) })
    await tx.employmentAssignment.createMany({ data: people.map(({ id }) => ({ userId: id, role: 'EMPLOYEE', managerId: fixture.managerId,
      businessId: original.businessId, unitId: original.unitId, effectiveFrom })) })
  })
  const search = 'search=Roster%20page%20employee'
  const first = await read<TeamHistory>(`${rosterPath}?${search}`)
  const second = await read<TeamHistory>(`${rosterPath}?${search}&page=2`)
  assert.deepEqual([first.rows.items.length, second.rows.items.length, first.rows.total, second.rows.total], [25, 2, 27, 27])
  assert.deepEqual([...first.rows.items, ...second.rows.items].map(({ id }) => id), people.map(({ id }) => id))
  const optionPage = await read<TeamPeople>(`${rosterPath}/people?${search}&page=2`)
  assert.deepEqual(optionPage.people.items.map(({ id }) => id), people.slice(25).map(({ id }) => id))
  const selected = await read<TeamHistory>(`${rosterPath}?personId=${people[0].id}`)
  assert.equal(selected.selectedPerson?.label, people[0].name)
})
