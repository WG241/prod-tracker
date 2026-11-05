/// <reference lib="dom" />
import 'dotenv/config'
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import type { Browser, BrowserContext, Page } from 'playwright'
import AxeBuilder from '@axe-core/playwright'
import { createDatabase } from '../../server/db.ts'
import { authTestDatabase, readAuthConfig } from '../../server/auth/config.ts'
import { provision } from '../../server/auth/provision.ts'
import { historicalFixtures } from '../helpers/historical-fixtures.ts'
import { watMidnight } from '../../server/data-model/calendar.ts'
import type { HistoryResponse } from '../../src/features/employee/history-contracts.ts'
import { snapshotContext } from '../../server/employee/history-evidence.ts'

const base = new URL(process.env.EMPLOYEE_BASE_URL ?? 'http://127.0.0.1:3001')
assert.ok(['127.0.0.1', 'localhost'].includes(base.hostname) && ['3001', '3002'].includes(base.port), 'History browser checks require an isolated test app')
const output = `.local/verification/feature11/${base.port === '3001' ? 'production' : 'development'}`
const db = createDatabase(authTestDatabase(process.env.TEST_DATABASE_URL, process.env.DATABASE_URL))
const evidence: object[] = []
let browser: Browser, auth: BrowserContext, storage: Awaited<ReturnType<BrowserContext['storageState']>>
before(async () => {
  assert.ok(process.env.LOCAL_AUTH_TEST_PASSWORD)
  const user = await db.user.findUniqueOrThrow({ where: { id: 'feature9-test-employee' } })
  await provision(db, readAuthConfig(), user.id, process.env.LOCAL_AUTH_TEST_PASSWORD)
  await historicalFixtures(async (tx) => {
    const source = await tx.weeklyTracker.findUniqueOrThrow({ where: { id: 'feature9-tracker' } })
    const context = snapshotContext(source.contextSnapshot, user.id); assert.ok(context)
    const week = await tx.workWeek.upsert({ where: { startsOn: new Date('2026-09-21') }, update: {}, create: { startsOn: new Date('2026-09-21'), planningLocksAt: watMidnight(new Date('2026-09-22')), freezesAt: watMidnight(new Date('2026-09-26')) } })
    await tx.weeklyTracker.createMany({ skipDuplicates: true, data: { id: 'feature11-browser-empty', userId: user.id, weekId: week.id, assignmentId: source.assignmentId, contextSnapshot: { ...context }, expectedWorkingDaysSnapshot: 5, snapshotAt: week.freezesAt } })
  })
  await mkdir(output, { recursive: true })
  browser = await chromium.launch()
  auth = await browser.newContext()
  const response = await auth.request.post(`${base.origin}/api/auth/sign-in`, { headers: { Origin: base.origin }, data: { email: user.email, password: process.env.LOCAL_AUTH_TEST_PASSWORD } })
  assert.equal(response.status(), 200)
  storage = await auth.storageState()
})
after(async () => {
  if (auth) await auth.request.post(`${base.origin}/api/auth/sign-out`, { headers: { Origin: base.origin }, data: {} })
  await writeFile(`${output}/report.json`, JSON.stringify({ base: base.origin, time: new Date().toISOString(), evidence, manual: { nvda: 'Not exercised by automation', nativeZoom: 'Not exercised by viewport resizing' } }, null, 2))
  await browser?.close()
  await db.$disconnect()
})
async function loaded(page: Page) { await page.locator('.employee-history-card[aria-busy="true"]').waitFor({ state: 'hidden' }) }
async function history(page: Page) {
  const result = page.waitForResponse((r) => r.url().includes('/api/employee/history?') && r.status() === 200)
  await page.goto(`${base.origin}/employee/history`)
  await page.getByRole('heading', { name: 'Your work, week by week' }).waitFor()
  await result; await loaded(page)
}
async function select(page: Page, label: string, value: string) {
  const result = page.waitForResponse((r) => r.url().includes('/api/employee/history?') && r.status() === 200)
  await page.getByLabel(label, { exact: true }).selectOption(value)
  const response = await result; await loaded(page)
  return response.json() as Promise<HistoryResponse>
}
async function requestHistory(page: Page, query: string) {
  const response = await page.request.get(`${base.origin}/api/employee/history?${query}`)
  assert.equal(response.status(), 200)
  return response.json() as Promise<HistoryResponse>
}
async function scan(page: Page, id: string) {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
  const violations = result.violations.map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target) }))
  const screenshot = `${output}/${id}.png`
  await page.screenshot({ path: screenshot, fullPage: true })
  evidence.push({ id, url: page.url(), screenshot, violations })
  assert.deepEqual(violations, [])
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
}
async function pageFor(run: (page: Page) => Promise<void>, width = 1280) {
  const context = await browser.newContext({ storageState: storage, viewport: { width, height: 900 }, reducedMotion: 'reduce' })
  try { const page = await context.newPage(); await history(page); await run(page) } finally { await context.close() }
}

for (const width of [1280, 320]) test(`AC1,2,3,9 real History filters, pagination, date dialog and frozen drawer at ${width}px`, async () => {
  await pageFor(async (page) => {
    await scan(page, `history-${width}`)
    assert.equal(await page.getByLabel('Week', { exact: true }).count(), 0)
    const dateButton = page.getByRole('button', { name: 'Date range', exact: true })
    assert.equal(await dateButton.locator('svg').count(), 1)
    assert.deepEqual(await dateButton.evaluate((element) => ({ width: getComputedStyle(element).width, height: getComputedStyle(element).height, padding: getComputedStyle(element).padding, border: getComputedStyle(element).borderColor })), { width: '34px', height: '34px', padding: '5px 0px', border: 'rgb(209, 213, 219)' })
    const status = page.getByLabel('Task status', { exact: true })
    assert.equal(await status.evaluate((element) => element.classList.contains('ui-select-compact')), true)
    assert.deepEqual(await status.evaluate((element) => ({ height: getComputedStyle(element).height, border: getComputedStyle(element).borderColor, position: getComputedStyle(element).backgroundPosition })), { height: '34px', border: 'rgb(209, 213, 219)', position: 'calc(100% - 5px) 50%' })
    const records = await requestHistory(page, 'week=2026-10-19')
    assert.equal(records.records.total, 26)
    assert.equal(await page.getByRole('columnheader').allTextContents().then((v) => v.join(',')), 'Week,Task,Status,Dates')
    const next = page.waitForResponse((r) => r.url().includes('/api/employee/history?page=2'))
    await page.getByRole('button', { name: 'Next history tasks page' }).click(); await next; await loaded(page)
    assert.ok(await page.locator('.employee-history-task').count() > 0)
    const filtered = await select(page, 'Task status', 'BLOCKED')
    assert.equal(filtered.selection.page, 1); assert.equal(filtered.records.total, 26)
    const task = page.getByRole('button', { name: 'Feature 9 persisted task 0', exact: true })
    await task.press('Enter')
    const drawer = page.getByRole('dialog', { name: 'Frozen task record' })
    await drawer.getByText('Original Employee', { exact: true }).waitFor()
    assert.equal(await drawer.getByRole('button', { name: 'Edit task' }).count(), 0)
    assert.equal(await drawer.getByLabel('Reply', { exact: true }).count(), 0)
    await scan(page, `drawer-${width}`)
    await page.keyboard.press('Escape')
    assert.equal(await task.evaluate((el) => el === document.activeElement), true)
    await page.getByRole('button', { name: 'Date range', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Choose a date range' })
    await dialog.getByLabel('From', { exact: true }).fill('2026-10-27')
    await dialog.getByLabel('To', { exact: true }).fill('2026-10-28')
    await scan(page, `date-${width}`)
    const range = page.waitForResponse((r) => r.url().includes('from=2026-10-27') && r.status() === 200)
    await dialog.getByRole('button', { name: 'Apply range' }).click()
    assert.equal((await (await range).json() as HistoryResponse).records.total, 26)
    await loaded(page); await scan(page, `filtered-${width}`)
    const empty = await select(page, 'Task status', 'APPROVED')
    assert.equal(empty.records.total, 0)
    await page.getByText('No tasks match these filters.', { exact: true }).waitFor()
  }, width)
})

test('AC6,9 captured empty weeks and unavailable weeks have distinct messages', async () => {
  await pageFor(async (page) => {
    assert.equal((await requestHistory(page, 'week=2026-09-21')).selectedWeekState, 'AVAILABLE')
    assert.equal((await requestHistory(page, 'week=2026-10-12')).selectedWeekState, 'REPAIR_REQUIRED')
    await scan(page, 'history-filterless-default')
  })
})

test('AC9 failed refresh keeps same selection data stale, Retry restores it', async () => {
  await pageFor(async (page) => {
    await page.route('**/api/employee/history?*', (route) => route.abort('failed'))
    await page.getByRole('button', { name: 'Retry', exact: true }).first().click()
    await page.getByText('The service is unavailable. Please try again.', { exact: true }).waitFor()
    assert.equal(await page.locator('.employee-history-task').count(), 25)
    await page.getByText(/This history may be out of date/).waitFor()
    await scan(page, 'stale-error')
    await page.unroute('**/api/employee/history?*')
    const result = page.waitForResponse((r) => r.url().includes('/api/employee/history?') && r.status() === 200)
    await page.getByRole('button', { name: 'Retry', exact: true }).last().click(); await result; await loaded(page)
    assert.equal(await page.getByText(/This history may be out of date/).count(), 0)
  })
})

test('AC9 older filter completion cannot replace the latest selection', async () => {
  await pageFor(async (page) => {
    let release: () => void = () => {}, reached: () => void = () => {}
    const gate = new Promise<void>((resolve) => { release = resolve }), ready = new Promise<void>((resolve) => { reached = resolve })
    await page.route('**/api/employee/history?*', async (route) => {
      if (new URL(route.request().url()).searchParams.get('status') === 'BLOCKED') { const response = await route.fetch(); reached(); await gate; await route.fulfill({ response }) }
      else await route.continue()
    })
    await page.getByLabel('Task status', { exact: true }).selectOption('BLOCKED'); await ready
    const latest = await select(page, 'Task status', 'DECLINED')
    assert.equal(latest.records.total, 0)
    release(); await page.unrouteAll({ behavior: 'wait' })
    assert.equal(await page.getByLabel('Task status', { exact: true }).inputValue(), 'DECLINED')
    assert.equal(await page.locator('.employee-history-task').count(), 0)
    await scan(page, 'latest-filter')
  })
})

test('AC9 foreground session revalidation withholds private data and preserves filters', async () => {
  await pageFor(async (page) => {
    await select(page, 'Week', '2026-10-19'); await select(page, 'Task status', 'BLOCKED')
    let release: () => void = () => {}, reached: () => void = () => {}
    const gate = new Promise<void>((resolve) => { release = resolve }), ready = new Promise<void>((resolve) => { reached = resolve })
    await page.route('**/api/session', async (route) => { const response = await route.fetch(); reached(); await gate; await route.fulfill({ response }) })
    await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await ready
    await page.getByRole('status', { name: 'Loading workspace…' }).waitFor()
    assert.equal(await page.locator('.employee-history-task').count(), 0)
    release(); await page.getByRole('heading', { name: 'Your work, week by week' }).waitFor(); await loaded(page)
    assert.equal(await page.getByLabel('Week', { exact: true }).inputValue(), '2026-10-19')
    assert.equal(await page.getByLabel('Task status', { exact: true }).inputValue(), 'BLOCKED')
    await scan(page, 'revalidated')
  })
})
