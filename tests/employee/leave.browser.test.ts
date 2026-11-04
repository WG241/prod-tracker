/// <reference lib="dom" />
import 'dotenv/config'
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import type { Browser, BrowserContext, Page } from 'playwright'
import AxeBuilder from '@axe-core/playwright'
import { createDatabase } from '../../server/db.ts'
import { authTestDatabase, readAuthConfig } from '../../server/auth/config.ts'
import { provision } from '../../server/auth/provision.ts'
import { historicalFixtures } from '../helpers/historical-fixtures.ts'
import { isoDay, shiftDay, watCalendarDay } from '../../server/data-model/calendar.ts'
import type { LeaveResult } from '../../src/features/employee/leave-contracts.ts'

const base = new URL(process.env.EMPLOYEE_BASE_URL ?? 'http://127.0.0.1:3001')
assert.ok(['127.0.0.1', 'localhost'].includes(base.hostname) && ['3001', '3002'].includes(base.port), 'Leave browser checks require an isolated test app')
const output = `.local/verification/feature12/${base.port === '3001' ? 'production' : 'development'}`
const db = createDatabase(authTestDatabase(process.env.TEST_DATABASE_URL, process.env.DATABASE_URL))
const evidence: object[] = []
let browser: Browser
const date = (days: number) => isoDay(shiftDay(watCalendarDay(new Date()), days))
before(async () => { await mkdir(output, { recursive: true }); browser = await chromium.launch() })
after(async () => { await writeFile(`${output}/report.json`, JSON.stringify({ base: base.origin, time: new Date().toISOString(), evidence, manual: { nvda: 'Not exercised by automation', nativeZoom: 'Not exercised by viewport resizing' } }, null, 2)); await browser?.close(); await db.$disconnect() })
async function pageFor(run: (page: Page, context: BrowserContext, id: string) => Promise<void>, width = 1280) {
  const id = `f12-browser-${randomUUID()}`
  const source = await db.employmentAssignment.findFirstOrThrow({ where: { userId: 'person-ada-okafor', effectiveTo: null } })
  await historicalFixtures(async (tx) => {
    await tx.user.create({ data: { id, email: `${id}@example.invalid`, name: 'Leave Browser Employee', accountStatus: 'ACTIVE' } })
    await tx.employmentAssignment.create({ data: { userId: id, role: 'EMPLOYEE', businessId: source.businessId, unitId: source.unitId, managerId: source.managerId, effectiveFrom: new Date('2020-01-01') } })
  })
  assert.ok(process.env.LOCAL_AUTH_TEST_PASSWORD)
  await provision(db, readAuthConfig(), id, process.env.LOCAL_AUTH_TEST_PASSWORD)
  const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' })
  try {
    const login = await context.request.post(`${base.origin}/api/auth/sign-in`, { headers: { Origin: base.origin }, data: { email: `${id}@example.invalid`, password: process.env.LOCAL_AUTH_TEST_PASSWORD } })
    assert.equal(login.status(), 200)
    const page = await context.newPage()
    await leave(page)
    await run(page, context, id)
  } finally { await context.request.post(`${base.origin}/api/auth/sign-out`, { headers: { Origin: base.origin }, data: {} }); await context.close() }
}
async function leave(page: Page) {
  const response = page.waitForResponse((r) => r.url() === `${base.origin}/api/employee/leave` && r.request().method() === 'GET' && r.status() === 200)
  await page.goto(`${base.origin}/employee/leave`)
  await response
  await page.getByRole('button', { name: 'Confirm leave' }).waitFor()
}
async function fill(page: Page, start = 1, end = 8) { await page.getByLabel('Start date', { exact: true }).fill(date(start)); await page.getByLabel('Expected return date', { exact: true }).fill(date(end)) }
async function action(page: Page, name: string) {
  const saved = page.waitForResponse((r) => r.url().includes('/api/employee/leave') && r.request().method() === 'POST' && r.status() === 200)
  await page.getByRole('button', { name, exact: true }).click()
  return (await saved).json() as Promise<LeaveResult>
}
async function scan(page: Page, id: string) {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
  const violations = result.violations.map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target) }))
  const screenshot = `${output}/${id}.png`; await page.screenshot({ path: screenshot, fullPage: true })
  evidence.push({ id, url: page.url(), screenshot, violations })
  assert.deepEqual(violations, [])
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
}

for (const width of [1280, 320]) test(`AC1,3,4,10 real leave, Scheduled cancellation and Home return at ${width}px`, async () => {
  await pageFor(async (page, _context, id) => {
    await scan(page, `form-${width}`)
    await page.getByLabel('Start date', { exact: true }).fill('')
    await page.getByRole('button', { name: 'Confirm leave' }).press('Enter')
    assert.equal(await page.getByLabel('Start date', { exact: true }).getAttribute('aria-invalid'), 'true')
    assert.equal(await page.getByLabel('Start date', { exact: true }).evaluate((el) => el === document.activeElement), true)
    await scan(page, `validation-${width}`)
    await fill(page)
    const scheduled = await action(page, 'Confirm leave')
    await page.getByText('Your tracker remains active until your leave starts.').waitFor()
    await scan(page, `scheduled-${width}`)
    await action(page, 'Cancel leave')
    await page.getByRole('button', { name: 'Confirm leave' }).waitFor()
    assert.ok((await db.leaveRecord.findUniqueOrThrow({ where: { id: scheduled.leaveId } })).cancelledAt)
    await fill(page, 0, 7); const active = await action(page, 'Confirm leave')
    await page.getByRole('button', { name: 'I’m back — end leave now' }).waitFor()
    await scan(page, `on-leave-${width}`)
    const home = page.waitForResponse((r) => r.url().includes('/api/employee/home?') && r.status() === 200)
    await page.getByRole('link', { name: 'Home', exact: true }).filter({ visible: true }).click(); await home
    await page.getByText(/Your tracker is paused/).waitFor()
    await scan(page, `home-paused-${width}`)
    await action(page, 'I’m back')
    await page.getByText(/Your tracker is paused/).waitFor({ state: 'hidden' })
    const row = await db.leaveRecord.findUniqueOrThrow({ where: { id: active.leaveId } })
    assert.equal(isoDay(row.actualReturnOn!), date(0))
    assert.equal(await db.auditEvent.count({ where: { actorId: id, action: 'LEAVE_RETURNED' } }), 1)
    await scan(page, `home-returned-${width}`)
  }, width)
})

test('AC6,10 lost create response keeps its UUID across navigation and retries once', async () => {
  await pageFor(async (page, _context, id) => {
    const keys: string[] = []
    let lose = true
    let release: () => void = () => {}, retried: () => void = () => {}
    const gate = new Promise<void>((resolve) => { release = resolve }), retryStarted = new Promise<void>((resolve) => { retried = resolve })
    await page.route('**/api/employee/leave', async (route) => {
      if (route.request().method() !== 'POST') return route.continue()
      keys.push(route.request().headers()['idempotency-key'])
      const response = await route.fetch()
      if (lose) { lose = false; await route.abort('failed') } else { retried(); await gate; await route.fulfill({ response }) }
    })
    await fill(page); await page.getByRole('button', { name: 'Confirm leave' }).click()
    await page.getByRole('main').getByText('The result could not be confirmed. Retry to check this same change.').waitFor()
    assert.equal(await page.getByRole('button', { name: 'Confirm leave' }).isDisabled(), true)
    await page.getByRole('link', { name: 'Home', exact: true }).filter({ visible: true }).click()
    await page.getByRole('button', { name: 'Retry', exact: true }).waitFor()
    const saved = page.waitForResponse((r) => r.url().includes('/api/employee/leave') && r.request().method() === 'POST' && r.status() === 200)
    await page.getByRole('button', { name: 'Retry', exact: true }).click(); await retryStarted
    const retry = page.getByRole('button', { name: 'Retry', exact: true })
    assert.equal(await retry.getAttribute('aria-busy'), 'true')
    assert.equal(await retry.evaluate((el) => el === document.activeElement), true)
    await retry.press('Enter'); assert.equal(keys.length, 2)
    release(); await saved
    await page.getByRole('main').getByText('Leave change saved.', { exact: true }).waitFor()
    assert.equal(keys.length, 2); assert.equal(keys[0], keys[1])
    assert.equal(await db.leaveRecord.count({ where: { userId: id } }), 1)
    assert.equal(await db.auditEvent.count({ where: { actorId: id, action: 'LEAVE_RECORDED' } }), 1)
    await scan(page, 'lost-response-recovered')
  })
})

test('AC10 a definite conflict retains the draft until explicit Reload latest', async () => {
  await pageFor(async (page, context) => {
    await fill(page, 3, 10)
    const other = await context.request.post(`${base.origin}/api/employee/leave`, { headers: { Origin: base.origin, 'Idempotency-Key': randomUUID() }, data: { startsOn: date(1), expectedReturnOn: date(8) } })
    assert.equal(other.status(), 200)
    await page.getByRole('button', { name: 'Confirm leave' }).click()
    await page.getByRole('button', { name: 'Reload latest' }).waitFor()
    assert.equal(await page.getByLabel('Start date', { exact: true }).inputValue(), date(3))
    await scan(page, 'conflict-retained')
    await page.getByRole('button', { name: 'Reload latest' }).click()
    await page.getByRole('button', { name: 'Cancel leave' }).waitFor()
    assert.equal(await page.getByLabel('Start date', { exact: true }).count(), 0)
  })
})

test('AC10 acknowledged saves with failed reads retry the read without another mutation', async () => {
  await pageFor(async (page, _context, id) => {
    let block = false, writes = 0
    await page.route('**/api/employee/leave', async (route) => {
      if (route.request().method() === 'GET') return block ? route.abort('failed') : route.continue()
      const response = await route.fetch(); writes++; block = true; await route.fulfill({ response })
    })
    await fill(page); await action(page, 'Confirm leave')
    await page.getByText(/Your change was saved, but the latest leave state could not be loaded/).waitFor()
    await scan(page, 'saved-read-failed')
    block = false; await page.getByRole('button', { name: 'Retry', exact: true }).click()
    await page.getByRole('button', { name: 'Cancel leave' }).waitFor()
    assert.equal(writes, 1); assert.equal(await db.leaveRecord.count({ where: { userId: id } }), 1)
  })
})

test('AC10 same actor foreground revalidation hides private content and retains draft', async () => {
  await pageFor(async (page) => {
    await fill(page, 4, 11)
    let release: () => void = () => {}, reached: () => void = () => {}
    const gate = new Promise<void>((resolve) => { release = resolve }), ready = new Promise<void>((resolve) => { reached = resolve })
    await page.route('**/api/session', async (route) => { reached(); await gate; await route.continue() })
    await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await ready
    await page.getByRole('status', { name: 'Loading workspace…' }).waitFor()
    assert.equal(await page.getByLabel('Start date', { exact: true }).count(), 0)
    release(); await page.getByRole('button', { name: 'Confirm leave' }).waitFor()
    assert.equal(await page.getByLabel('Start date', { exact: true }).inputValue(), date(4))
    assert.equal(await page.getByLabel('Expected return date', { exact: true }).inputValue(), date(11))
    await page.unroute('**/api/session')
  })
})

test('AC9 conflicting legacy periods show repair and disable Home return', async () => {
  await pageFor(async (page, _context, id) => {
    await db.leaveRecord.createMany({ data: [0, 1].map((offset) => ({ userId: id, startsOn: shiftDay(watCalendarDay(new Date()), offset), expectedReturnOn: shiftDay(watCalendarDay(new Date()), 7) })) })
    await page.reload(); await page.getByText(/Your leave periods need review/).waitFor()
    assert.equal(await page.getByRole('button', { name: 'Confirm leave' }).count(), 0)
    await scan(page, 'repair-required')
    await page.getByRole('link', { name: 'Home', exact: true }).filter({ visible: true }).click()
    await page.getByText(/Your tracker is paused/).waitFor()
    assert.equal(await page.getByRole('button', { name: 'I’m back', exact: true }).isDisabled(), true)
  })
})

test('AC5,10 notification gaps say saved and never offer a committed write retry', async () => {
  await pageFor(async (page) => {
    await page.route('**/api/employee/leave', async (route) => {
      if (route.request().method() !== 'POST') return route.continue()
      const response = await route.fetch(), result = await response.json() as LeaveResult
      await route.fulfill({ response, json: { ...result, notificationWarnings: ['MANAGER_UNAVAILABLE', 'HR_UNAVAILABLE'] } })
    })
    await fill(page); await action(page, 'Confirm leave')
    await page.getByRole('main').getByText(/Leave was saved\. Your manager notification could not be created/).waitFor()
    await page.getByRole('button', { name: 'Cancel leave' }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'Retry', exact: true }).count(), 0)
    await scan(page, 'notification-warning')
  })
})
