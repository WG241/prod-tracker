/// <reference lib="dom" />
import 'dotenv/config'
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import type { Browser, BrowserContext, Page } from 'playwright'
import AxeBuilder from '@axe-core/playwright'
import type { HomeResponse } from '../../src/features/employee/contracts.ts'

const base = new URL(process.env.EMPLOYEE_BASE_URL ?? 'http://127.0.0.1:5173')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname), 'Browser verification is loopback only')
const target = process.env.EMPLOYEE_TARGET ?? 'development'
const output = `.local/verification/feature9/${target}`
const evidence: object[] = []
let browser: Browser, authContext: BrowserContext
let storage: Awaited<ReturnType<BrowserContext['storageState']>>
const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

before(async () => {
  assert.ok(process.env.LOCAL_AUTH_TEST_PASSWORD, 'Explicit fixture password required')
  await mkdir(output, { recursive: true })
  browser = await chromium.launch()
  authContext = await browser.newContext()
  const response = await authContext.request.post(`${base.origin}/api/auth/sign-in`, { headers: { Origin: base.origin }, data: { email: 'ada.okafor@workforcegroup.com', password: process.env.LOCAL_AUTH_TEST_PASSWORD } })
  assert.equal(response.status(), 200, 'Seeded Employee sign in must succeed')
  storage = await authContext.storageState()
})
after(async () => {
  if (authContext) await authContext.request.post(`${base.origin}/api/auth/sign-out`, { headers: { Origin: base.origin }, data: {} })
  await writeFile(`${output}/report.json`, JSON.stringify({ target, base: base.origin, time: new Date().toISOString(), observations: evidence, manual: { nvda: 'Not exercised by automation', nativeZoom: 'Not exercised by viewport resizing' } }, null, 2))
  await browser?.close()
})
async function pageFor(run: (page: Page) => Promise<void>, width = 1280) {
  const context = await browser.newContext({ storageState: storage, viewport: { width, height: 900 } })
  try {
    const page = await context.newPage()
    const anchored = page.waitForResponse((response) => response.url().includes('/api/employee/home?week=') && response.status() === 200)
    await page.goto(`${base.origin}/employee/home`)
    await page.getByRole('heading', { name: /^Good morning,/ }).waitFor()
    await anchored
    await page.locator('.employee-week-card[aria-busy="true"]').waitFor({ state: 'hidden' })
    await run(page)
  } finally { await context.close() }
}
async function scan(page: Page, id: string) {
  const result = await new AxeBuilder({ page }).withTags(tags).analyze()
  const issues = result.violations.map((v) => ({ id: v.id, targets: v.nodes.map((node) => node.target) }))
  const path = `${output}/${id}.png`
  await page.screenshot({ path, fullPage: true })
  evidence.push({ id, url: page.url(), screenshot: path, violations: issues, incomplete: result.incomplete.map((v) => v.id) })
  assert.deepEqual(issues, [], `${id}: normative accessibility findings`)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${id}: no horizontal page scrolling`)
}
async function range(page: Page, from = '2026-10-19', to = '2026-10-23') {
  await page.getByRole('button', { name: 'Open date range', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('From', { exact: true }).fill(from)
  await dialog.getByLabel('To', { exact: true }).fill(to)
  const response = page.waitForResponse((r) => r.url().includes('/api/employee/home?from=') && r.status() === 200)
  await dialog.getByRole('button', { name: 'Apply range' }).click()
  await response
  await page.locator('.employee-week-card[aria-busy="true"]').waitFor({ state: 'hidden' })
}

for (const width of [1280, 320]) test(`AC-1,2,3,5,8 current, List, Card, range and drawer render at ${width}px`, async () => {
  await pageFor(async (page) => {
    assert.equal(await page.getByRole('link', { name: 'History', exact: true }).first().isVisible(), true, 'Fixed role navigation')
    await scan(page, `current-${width}`)
    await range(page)
    const open = page.locator('.employee-task-open').first()
    assert.equal(await open.isVisible(), true)
    const listTitles = await page.locator('.employee-task-open h3').allTextContents()
    await scan(page, `list-${width}`)
    await page.getByRole('button', { name: 'Card', exact: true }).click()
    assert.deepEqual(await page.locator('.employee-task-open h3').allTextContents(), listTitles)
    await scan(page, `card-${width}`)
    await open.click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('heading', { name: 'Manager comments' }).waitFor()
    assert.equal(await dialog.evaluate((node) => node.matches(':modal')), true)
    await scan(page, `drawer-${width}`)
    for (let n = 0; n < 5; n++) { await page.keyboard.press('Tab'); assert.equal(await dialog.evaluate((node) => node.contains(document.activeElement)), true) }
    await page.keyboard.press('Escape')
    assert.equal(await open.evaluate((node) => node === document.activeElement), true)
    await page.getByRole('button', { name: 'Open date range', exact: true }).click()
    await scan(page, `date-picker-${width}`)
    await page.keyboard.press('Escape')
    await range(page, '2020-01-01', '2020-01-02')
    await page.getByRole('heading', { name: 'A fresh week, a clear focus.' }).waitFor()
    await scan(page, `empty-${width}`)
  }, width)
})

test('AC-3 date errors preserve input and focus, presets use the server calendar, and cancel preserves selection', async () => {
  await pageFor(async (page) => {
    const home = await (await page.request.get(`${base.origin}/api/employee/home`)).json() as HomeResponse
    await page.getByRole('button', { name: 'Open date range', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('From', { exact: true }).fill('2026-11-03')
    await dialog.getByLabel('To', { exact: true }).fill('2026-11-02')
    await dialog.getByRole('button', { name: 'Apply range' }).click()
    await dialog.getByText('Choose an end date on or after the start date.').waitFor()
    assert.equal(await dialog.getByLabel('To', { exact: true }).inputValue(), '2026-11-02')
    assert.equal(await dialog.getByLabel('To', { exact: true }).evaluate((node) => node === document.activeElement), true)
    await dialog.getByRole('button', { name: 'This week', exact: true }).click()
    assert.equal(await dialog.getByLabel('From', { exact: true }).inputValue(), home.currentWeekStart)
    await dialog.getByRole('button', { name: 'This month', exact: true }).click()
    const month = new Date(Date.parse(home.asOf) + 3600000).toISOString().slice(0, 7)
    assert.equal(await dialog.getByLabel('From', { exact: true }).inputValue(), `${month}-01`)
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    assert.equal(await page.getByText('Custom range', { exact: true }).count(), 0)
  })
})

test('AC-6 failed selection clears old tasks, Retry reloads, and a closed drawer cannot receive a late response', async () => {
  await pageFor(async (page) => {
    await range(page)
    const firstTitle = await page.locator('.employee-task-open h3').first().innerText()
    await page.route('**/api/employee/home?*', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }))
    await page.getByRole('button', { name: 'Next week', exact: true }).click()
    await page.getByRole('button', { name: 'Retry', exact: true }).waitFor()
    assert.equal(await page.locator('.employee-task-open').count(), 0)
    assert.equal(await page.getByRole('heading', { name: firstTitle, exact: true }).count(), 0)
    await page.unroute('**/api/employee/home?*')
    await page.getByRole('button', { name: 'Retry', exact: true }).click()
    await page.locator('.employee-week-card[aria-busy="true"]').waitFor({ state: 'hidden' })
    await range(page)
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => { release = resolve })
    await page.route('**/api/employee/tasks/*', async (route) => { await gate; await route.continue().catch(() => {}) })
    await page.locator('.employee-task-open').first().click()
    await page.getByRole('dialog').locator('p').filter({ hasText: /^Loading task…$/ }).waitFor()
    await page.keyboard.press('Escape')
    release()
    assert.equal(await page.getByRole('dialog').count(), 0)
  })
})

test('AC-6 boundary refresh retains stale rows, closes planning, and failed refresh never reopens it', async () => {
  await pageFor(async (page) => {
    let calls = 0
    await page.route('**/api/employee/home?*', async (route) => {
      if (++calls > 1) return route.fulfill({ status: 503, contentType: 'application/json', body: '{}' })
      const response = await route.fetch()
      const body = await response.json() as HomeResponse
      body.nextChangeAt = new Date(Date.now() + 1500).toISOString()
      await route.fulfill({ response, json: body })
    })
    await range(page)
    const titles = await page.locator('.employee-task-open h3').allTextContents()
    await page.getByRole('button', { name: 'Retry', exact: true }).waitFor()
    assert.deepEqual(await page.locator('.employee-task-open h3').allTextContents(), titles)
    await page.getByText(/This tracker may be out of date/).waitFor()
    assert.equal(await page.getByText('Tracker open', { exact: true }).count(), 0)
    evidence.push({ id: 'boundary-failure', description: 'Actual database response with a test scheduled boundary, followed by injected HTTP 503. Retained selection rows are stale and planning is closed.' })
  })
})

test('AC-6 authorization failure clears private content and revalidates session', async () => {
  await pageFor(async (page) => {
    await range(page)
    await page.context().clearCookies()
    await page.route('**/api/employee/home?*', (route) => route.fulfill({ status: 401, contentType: 'application/json', body: '{}' }))
    await page.route('**/api/session', (route) => route.fulfill({ status: 401, contentType: 'application/json', body: '{}' }))
    await page.getByRole('button', { name: 'Next week', exact: true }).click()
    await page.getByRole('heading', { name: 'Welcome back', exact: true }).waitFor()
    assert.equal(new URL(page.url()).pathname, '/sign-in')
    assert.equal(await page.locator('.employee-task-open').count(), 0)
    evidence.push({ id: 'session-failure', description: 'Injected 401 clears the private workspace and follows the shared sign in flow.' })
  })
})

test('AC-6 a late older Home response cannot replace the new period, and foreground revalidation preserves its anchor', async () => {
  await pageFor(async (page) => {
    const initial = await page.locator('.employee-period-label').innerText()
    let release: () => void = () => {}, intercepted: () => void = () => {}
    const gate = new Promise<void>((resolve) => { release = resolve })
    const started = new Promise<void>((resolve) => { intercepted = resolve })
    let first = true
    await page.route('**/api/employee/home?*', async (route) => {
      if (!first) return route.continue()
      first = false
      intercepted()
      await gate
      await route.continue().catch(() => {})
    })
    await page.getByRole('button', { name: 'Previous week', exact: true }).click()
    await started
    const newest = page.waitForResponse((response) => response.url().includes('/api/employee/home?week=') && response.status() === 200)
    await page.getByRole('button', { name: 'Next week', exact: true }).click()
    await newest
    await page.locator('.employee-week-card[aria-busy="true"]').waitFor({ state: 'hidden' })
    release()
    assert.equal(await page.locator('.employee-period-label').innerText(), initial)
    await page.unroute('**/api/employee/home?*')
    await page.getByRole('button', { name: 'Previous week', exact: true }).click()
    await page.locator('.employee-week-card[aria-busy="true"]').waitFor({ state: 'hidden' })
    const selected = await page.locator('.employee-period-label').innerText()
    const refreshed = page.waitForResponse((response) => response.url().includes('/api/employee/home?week=') && response.status() === 200)
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await refreshed
    assert.equal(await page.locator('.employee-period-label').innerText(), selected)
    evidence.push({ id: 'selection-race-and-foreground', description: 'Delayed prior period is cancelled; a fresh session check reloads the selected week without changing its anchor.' })
  })
})
