import 'dotenv/config'
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import express from 'express'
import { createDatabase } from '../../server/db.ts'
import { authTestDatabase, readAuthConfig } from '../../server/auth/config.ts'
import { createAuth } from '../../server/auth/provider.ts'
import { createAuthService } from '../../server/auth/service.ts'
import { provision } from '../../server/auth/provision.ts'
import { staffContext, safeContext } from '../../server/auth/context.ts'
import { registerEmployee } from '../../server/employee/router.ts'
import { readDetail, readHome } from '../../server/employee/reads.ts'
import { readQuery } from '../../server/employee/calendar.ts'
import { isoDay, shiftDay, watCalendarDay, watMidnight } from '../../server/data-model/calendar.ts'
import type { DetailResponse, HomeResponse } from '../../src/features/employee/contracts.ts'
import { historicalFixtures } from '../helpers/historical-fixtures.ts'

const db = createDatabase(authTestDatabase(process.env.TEST_DATABASE_URL, process.env.DATABASE_URL))
const config = readAuthConfig()
const service = createAuthService(db, createAuth(db, config))
const id = 'feature9-test-employee'
const otherRoleId = 'person-tunde-bakare'
const password = process.env.LOCAL_AUTH_TEST_PASSWORD
assert.ok(password, 'LOCAL_AUTH_TEST_PASSWORD is required')
const server = createServer()
let base = '', cookie = '', managerCookie = ''
const now = new Date()
const taskId = (n: number) => `feature9-task-${String(n).padStart(2, '0')}`

async function context(userId = id) {
  const staff = await staffContext(db, userId)
  assert.ok(staff)
  return safeContext(staff, new Date(Date.now() + 60000))
}
async function request(path: string, token: string | null = cookie, headers: Record<string, string> = {}, method = 'GET') {
  return fetch(base + path, { method, headers: { ...(token ? { cookie: token } : {}), ...headers } })
}
before(async () => {
  const source = await db.employmentAssignment.findFirstOrThrow({ where: { userId: 'person-ada-okafor', effectiveTo: null } })
  const week = await db.workWeek.findUniqueOrThrow({ where: { startsOn: new Date('2026-10-19') } })
  // Stable fixtures are created together once, without rewriting old evidence.
  await historicalFixtures(async (tx) => {
    await tx.user.createMany({ skipDuplicates: true, data: { id, email: 'feature9.employee@example.invalid', name: 'Current Employee', accountStatus: 'ACTIVE' } })
    await tx.employmentAssignment.createMany({ skipDuplicates: true, data: { id: 'feature9-assignment', userId: id, role: 'EMPLOYEE', businessId: source.businessId, unitId: source.unitId, managerId: source.managerId, effectiveFrom: new Date('2020-01-01') } })
    await tx.weeklyTracker.createMany({ skipDuplicates: true, data: { id: 'feature9-tracker', userId: id, weekId: week.id, assignmentId: 'feature9-assignment', snapshotAt: week.freezesAt, expectedWorkingDaysSnapshot: 5,
      contextSnapshot: { version: 1, userId: id, displayName: 'Original Employee', accountStatus: 'ACTIVE', role: 'EMPLOYEE', businessId: source.businessId, businessName: 'Original business', unitId: source.unitId, unitName: 'Original unit', managerId: source.managerId, managerName: 'Original manager', departmentLabel: null } } })
    await tx.taskSeries.createMany({ skipDuplicates: true, data: Array.from({ length: 27 }, (_, n) => ({ id: `feature9-series-${n}`, ownerId: id })) })
    await tx.weeklyTask.createMany({ skipDuplicates: true, data: Array.from({ length: 27 }, (_, n) => ({ id: taskId(n), seriesId: `feature9-series-${n}`, trackerId: 'feature9-tracker', ownerId: id,
      title: `Feature 9 persisted task ${n}`, activity: 'Persisted activity <script>must remain text</script>', startsOn: new Date('2026-10-19'), endsOn: new Date('2026-10-29'), createdAt: new Date('2026-10-19T08:00:00Z'),
      status: 'BLOCKED' as const, blockerReason: 'Actual blocker evidence', carryRequested: true, deletedAt: n === 26 ? new Date('2026-10-20T00:00:00Z') : null })) })
    await tx.taskComment.createMany({ skipDuplicates: true, data: Array.from({ length: 26 }, (_, n) => ({ id: `feature9-comment-${String(n).padStart(2, '0')}`, weeklyTaskId: taskId(0), authorId: n % 2 ? id : otherRoleId, body: `Persisted conversation ${n}`, createdAt: new Date('2026-10-19T09:00:00Z') })) })
    await tx.planningUnlock.createMany({ skipDuplicates: true, data: [
      { id: 'feature9-unlock-person', scope: 'PERSON' as const, userId: id, hour: 14 },
      { id: 'feature9-unlock-unit', scope: 'UNIT' as const, unitId: source.unitId, hour: 15 },
      { id: 'feature9-unlock-business', scope: 'BUSINESS' as const, businessId: source.businessId, hour: 16 },
      { id: 'feature9-unlock-everyone', scope: 'EVERYONE' as const, hour: 17 },
      { id: 'feature9-unlock-other', scope: 'PERSON' as const, userId: 'person-ada-okafor', hour: 18 },
    ].map(({ hour, ...target }) => ({ ...target, weekId: week.id, grantedById: 'person-kemi-adebayo', reason: 'Feature 9 isolated test evidence', grantedAt: new Date(`2026-10-20T${hour}:00:00Z`), expiresAt: new Date(`2026-10-20T${hour + 1}:00:00Z`) })) })
    await tx.leaveRecord.createMany({ skipDuplicates: true, data: [
      { id: 'feature9-leave-a', userId: id, startsOn: new Date('2026-10-19'), expectedReturnOn: new Date('2026-10-22') },
      { id: 'feature9-leave-b', userId: id, startsOn: new Date('2026-10-21'), expectedReturnOn: new Date('2026-10-23') },
    ] })
    const today = watCalendarDay(now)
    const start = shiftDay(today, -((today.getUTCDay() + 6) % 7))
    await tx.workWeek.createMany({ skipDuplicates: true, data: { id: `feature9-current-${isoDay(start)}`, startsOn: start,
      planningLocksAt: new Date(watMidnight(shiftDay(start, 1)).getTime() + 14 * 3600000), freezesAt: watMidnight(shiftDay(start, 5)),
      manuallyLockedAt: now, lockReason: 'Feature 9 verification lock' } })
    await tx.workWeek.update({ where: { startsOn: start }, data: { manuallyLockedAt: now, lockReason: 'Feature 9 verification lock' } })
    await tx.leaveRecord.createMany({ skipDuplicates: true, data: { id: `feature9-current-leave-${isoDay(today)}`, userId: id,
      startsOn: today, expectedReturnOn: shiftDay(today, 2) } })
    // A new week preserves the earlier malformed fixture rather than rewriting frozen evidence.
    await tx.workWeek.createMany({ skipDuplicates: true, data: { startsOn: new Date('2026-09-28'), planningLocksAt: watMidnight(new Date('2026-09-29')), freezesAt: watMidnight(new Date('2026-10-03')) } })
    for (const [label, date] of [['manager-history-v2', '2026-09-28'], ['invalid-snapshot', '2026-10-12'], ['missing-snapshot', '2026-10-26']] as const) {
      const historicalWeek = await tx.workWeek.findUniqueOrThrow({ where: { startsOn: new Date(date) } })
      const fixtureId = `feature9-${label}`
      await tx.weeklyTracker.createMany({ skipDuplicates: true, data: { id: fixtureId, userId: id, weekId: historicalWeek.id, assignmentId: 'feature9-assignment',
        snapshotAt: label === 'missing-snapshot' ? null : historicalWeek.freezesAt, expectedWorkingDaysSnapshot: label === 'missing-snapshot' ? null : 5,
        contextSnapshot: { version: 1, userId: id, displayName: label === 'invalid-snapshot' ? null : 'Recorded owner', role: 'LINE_MANAGER', accountStatus: 'ACTIVE', businessId: source.businessId, businessName: 'Original business', unitId: source.unitId, unitName: 'Original unit', managerId: null, managerName: null, departmentLabel: null } } })
      await tx.taskSeries.createMany({ skipDuplicates: true, data: { id: fixtureId, ownerId: id } })
      await tx.weeklyTask.createMany({ skipDuplicates: true, data: { id: fixtureId, seriesId: fixtureId, trackerId: fixtureId, ownerId: id, title: 'Historical validation fixture', activity: 'Persisted snapshot verification', startsOn: new Date(date), endsOn: new Date(date) } })
    }
  })
  for (const userId of [id, otherRoleId, 'person-ada-okafor']) await provision(db, config, userId, password!)
  const login = async (userId: string) => {
    const person = await db.user.findUniqueOrThrow({ where: { id: userId } })
    const result = await service.signIn(person.email, password!, new Headers({ origin: config.origin }))
    return result.headers.getSetCookie().map((v) => v.split(';')[0]).join('; ')
  }
  cookie = await login(id)
  managerCookie = await login(otherRoleId)
  const app = express(), api = express.Router()
  registerEmployee(api, db, service, config)
  app.use('/api', api)
  server.on('request', app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
  if (cookie) await service.signOut(new Headers({ cookie }))
  if (managerCookie) await service.signOut(new Headers({ cookie: managerCookie }))
  await db.$disconnect()
})

test('AC-2,3,8 reads persisted owned rows with independent pages, overlap and bounded huge pages', async () => {
  const response = await request('/api/employee/home?week=2026-10-19')
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  const body = await response.json() as HomeResponse
  assert.equal(body.tasks.total, 26)
  assert.equal(body.tasks.items.length, 25)
  assert.equal(body.attention.total, 26)
  assert.equal(body.tasks.items[0].id, taskId(0))
  assert.equal(body.tasks.items[0].reason, 'Actual blocker evidence')
  assert.equal(body.tasks.items[0].status, 'BLOCKED')
  const next = await (await request('/api/employee/home?week=2026-10-19&page=2')).json() as HomeResponse
  assert.equal(next.tasks.items.length, 1)
  assert.equal(next.attention.items.length, 25)
  assert.equal(next.tasks.items[0].id, taskId(25))
  const attentionNext = await (await request('/api/employee/home?week=2026-10-19&attentionPage=2')).json() as HomeResponse
  assert.equal(attentionNext.tasks.items.length, 25)
  assert.equal(attentionNext.attention.items.length, 1)
  const range = await (await request('/api/employee/home?from=2026-10-27&to=2026-10-28')).json() as HomeResponse
  assert.equal(range.tasks.total, 26, 'Overlap includes trackers starting before the range')
  assert.equal(range.week, null)
  const huge = await (await request('/api/employee/home?week=2026-10-19&page=9007199254740991&attentionPage=9007199254740991')).json() as HomeResponse
  assert.equal(huge.tasks.total, 26)
  assert.deepEqual(huge.tasks.items, [])
  assert.deepEqual(huge.attention.items, [])
  assert.equal(JSON.stringify(body).includes('example.invalid'), false)
  assert.equal(JSON.stringify(body).includes('contextSnapshot'), false)
})

test('AC-5,8 frozen detail uses recorded owner labels and all comment authors, with comment pagination', async () => {
  const response = await request(`/api/employee/tasks/${taskId(0)}`)
  assert.equal(response.status, 200)
  const body = await response.json() as DetailResponse
  assert.equal(body.owner.name, 'Original Employee')
  assert.equal(body.owner.manager, 'Original manager')
  assert.equal(body.comments.total, 26)
  assert.equal(body.comments.items.length, 25)
  assert.equal(body.comments.items[0].author, 'Tunde Bakare')
  assert.equal(body.comments.items[1].author, 'Current Employee')
  assert.equal(body.review, null)
  const second = await (await request(`/api/employee/tasks/${taskId(0)}?commentPage=2`)).json() as DetailResponse
  assert.equal(second.comments.items.length, 1)
  const huge = await (await request(`/api/employee/tasks/${taskId(0)}?commentPage=9007199254740991`)).json() as DetailResponse
  assert.equal(huge.comments.total, 26)
  assert.deepEqual(huge.comments.items, [])
})

test('AC-7 rejects anonymous, tampered sessions, other roles, cross site requests and substituted ids', async () => {
  assert.equal((await request('/api/employee/home', null)).status, 401)
  assert.equal((await request('/api/employee/home', 'workforce.session_token=invalid')).status, 401)
  assert.equal((await request('/api/employee/home', managerCookie)).status, 403)
  assert.equal((await request('/api/employee/home', cookie, { 'Sec-Fetch-Site': 'cross-site' })).status, 403)
  assert.equal((await request('/api/employee/home', cookie, { Origin: 'https://other.example' })).status, 403)
  const other = await db.weeklyTask.findFirstOrThrow({ where: { ownerId: 'person-ada-okafor', deletedAt: null } })
  const bodies = []
  for (const task of ['missing-task', taskId(26), other.id]) {
    const response = await request('/api/employee/tasks/' + task)
    assert.equal(response.status, 404)
    bodies.push(await response.text())
  }
  assert.equal(new Set(bodies).size, 1)
  for (const query of ['userId=person-ada-okafor', 'week=2026-11-03', 'page=0', 'page=1&page=2', 'from=2026-01-01']) assert.equal((await request('/api/employee/home?' + query)).status, 400)
  assert.equal((await request('/api/employee/home', cookie, {}, 'POST')).status, 400)
})

test('AC-4,7 a missing current week is empty, settings govern it, and reads never create domain records', async () => {
  const counts = () => db.$transaction([db.workWeek.count(), db.weeklyTracker.count(), db.weeklyTask.count(), db.taskComment.count(), db.approvalRequest.count(), db.leaveRecord.count()])
  const before = await counts()
  const response = await request('/api/employee/home?week=2032-05-03')
  assert.equal(response.status, 200)
  const body = await response.json() as HomeResponse
  assert.equal(body.tasks.total, 0)
  assert.equal(body.week?.planningOpen, false)
  assert.deepEqual(await counts(), before)
})

test('AC-5 immutable review evidence is joined to the latest actual attempt and automatic approval uses System', async () => {
  const actor = await context('person-ada-okafor')
  const rows = await db.weeklyTask.findMany({ where: { ownerId: actor.user.id, deletedAt: null, approvals: { some: {} }, tracker: { snapshotAt: { not: null } } }, include: { approvals: { orderBy: { attemptNumber: 'desc' }, include: { decision: { include: { actor: true } } } } } })
  assert.ok(rows.length)
  for (const row of rows) {
    const detail = await readDetail(db, actor, row.id, readQuery('/task', true, now), now)
    const latest = row.approvals[0]
    assert.equal(detail.review?.attempt, latest.attemptNumber)
    assert.equal(detail.review?.decision?.reason ?? null, latest.decision?.reason ?? null)
    if (latest.decision) assert.equal(detail.review?.decision?.reviewer, latest.decision.method === 'AUTOMATIC' ? 'System' : latest.decision.actor?.name)
  }
})

test('AC-2 carried weekly records remain distinct, never invented or combined', async () => {
  const actor = await context('person-ada-okafor')
  const selection = readQuery('/home?from=2026-10-01&to=2026-11-01', false, now)
  const result = await readHome(db, actor, selection, now)
  const persisted = await db.weeklyTask.count({ where: { ownerId: actor.user.id, deletedAt: null, startsOn: { lte: new Date('2026-11-01') }, endsOn: { gte: new Date('2026-10-01') } } })
  assert.equal(result.tasks.total, persisted)
  assert.equal(new Set(result.tasks.items.map((t) => t.id)).size, result.tasks.items.length)
})

test('AC-4 persisted person, unit, business and Everyone unlocks match current assignment and leave stays independent', async () => {
  const actor = await context()
  for (const hour of [13, 14, 15, 16, 17, 18, 19]) {
    const asOf = new Date(`2026-10-20T${hour}:30:00Z`)
    const result = await readHome(db, actor, readQuery('/home?week=2026-10-19', false, asOf), asOf)
    assert.equal(result.week?.planningOpen, hour >= 14 && hour <= 17, `Scope at ${hour}:30`)
    assert.equal(result.week?.pausedForLeave, true)
    assert.equal(result.leave.returnsOn, '2026-10-23')
    if (hour >= 14 && hour <= 17) assert.equal(result.nextChangeAt, `2026-10-20T${hour + 1}:00:00.000Z`)
  }
})

test('AC-5 historical personal tasks retain their recorded role context, and missing or invalid evidence fails closed', async () => {
  const response = await request('/api/employee/tasks/feature9-manager-history-v2')
  assert.equal(response.status, 200)
  assert.equal(((await response.json()) as DetailResponse).owner.name, 'Recorded owner')
  for (const task of ['feature9-invalid-snapshot', 'feature9-missing-snapshot']) {
    const result = await request('/api/employee/tasks/' + task)
    assert.equal(result.status, 503)
    assert.deepEqual(await result.json(), { error: { code: 'SERVICE_UNAVAILABLE', message: 'The service is unavailable. Please try again.' } })
  }
})

test('AC-4 current manual lock and effective leave are returned as independent persisted facts', async () => {
  const response = await request('/api/employee/home')
  assert.equal(response.status, 200)
  const body = await response.json() as HomeResponse
  assert.equal(body.week?.planningOpen, false)
  assert.equal(body.week?.pausedForLeave, true)
  assert.equal(body.leave.paused, true)
  assert.equal(body.week?.manualLockReason, 'Feature 9 verification lock')
})
