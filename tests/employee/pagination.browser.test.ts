/// <reference lib="dom" />
import 'dotenv/config'
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import type { Browser, BrowserContext } from 'playwright'
import AxeBuilder from '@axe-core/playwright'
import type { HomeResponse } from '../../src/features/employee/contracts.ts'

// Run only against the real app configured with TEST_DATABASE_URL and the
// stable fixtures from api.test.ts, never the ordinary development database.
const base = new URL(process.env.EMPLOYEE_PAGINATION_BASE_URL ?? 'http://127.0.0.1:3001')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname))
const output = '.local/verification/feature9/pagination'
let browser: Browser, auth: BrowserContext
let storage: Awaited<ReturnType<BrowserContext['storageState']>>
before(async () => {
  await mkdir(output, { recursive: true })
  browser = await chromium.launch()
  auth = await browser.newContext()
  const response = await auth.request.post(`${base.origin}/api/auth/sign-in`, { headers: { Origin: base.origin }, data: { email: 'feature9.employee@example.invalid', password: process.env.LOCAL_AUTH_TEST_PASSWORD } })
  assert.equal(response.status(), 200, 'Start the real app on TEST_DATABASE_URL with the Feature 9 fixtures')
  storage = await auth.storageState()
})
after(async () => {
  if (auth) await auth.request.post(`${base.origin}/api/auth/sign-out`, { headers: { Origin: base.origin }, data: {} })
  await browser?.close()
})

test('AC-3,4 the compiled API accepts the final valid Monday without overflowing its Saturday calculation', async () => {
  const response = await auth.request.get(`${base.origin}/api/employee/home?week=9999-12-27`)
  assert.equal(response.status(), 200)
  const body = await response.json() as { week: { planningOpen: boolean; freezesAt: string } }
  assert.equal(body.week.planningOpen, false)
  assert.equal(body.week.freezesAt, '9999-12-31T23:00:00.000Z')
})

for (const width of [1280, 320]) test(`AC-8 tasks, attention and comments paginate independently at ${width}px`, async () => {
  const context = await browser.newContext({ storageState: storage, viewport: { width, height: 900 } })
  try {
    const page = await context.newPage()
    const anchored = page.waitForResponse((response) => response.url().includes('/api/employee/home?week=') && response.status() === 200)
    await page.goto(`${base.origin}/employee/home`)
    const home = await (await anchored).json() as HomeResponse
    await page.locator('.employee-week-card[aria-busy="true"]').waitFor({ state: 'hidden' })
    await page.getByText(/You’re on leave until/).waitFor()
    assert.equal(await page.getByRole('button', { name: 'I’m back', exact: true }).isDisabled(), !home.leave.returnTarget, 'Feature 12 withholds return for ambiguous retained leave fixtures')
    await page.getByText('Tracker closed', { exact: true }).waitFor()
    await page.getByText('Feature 9 verification lock', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Open date range', exact: true }).click()
    await page.getByLabel('From', { exact: true }).fill('2026-10-19')
    await page.getByLabel('To', { exact: true }).fill('2026-10-23')
    await page.getByRole('button', { name: 'Apply range' }).click()
    await page.getByRole('heading', { name: 'Feature 9 persisted task 0', exact: true }).first().waitFor()
    await page.locator('.employee-week-card[aria-busy="true"]').waitFor({ state: 'hidden' })
    assert.equal(await page.locator('.employee-task-open').count(), 25)
    assert.equal(await page.locator('.employee-attention-item').count(), 25)
    await page.getByRole('button', { name: 'Next attention page', exact: true }).click()
    await page.getByRole('navigation', { name: 'attention pages' }).getByText('2 of 2').waitFor()
    assert.equal(await page.locator('.employee-attention-item').count(), 1)
    assert.equal(await page.locator('.employee-task-open').count(), 25)
    await page.getByRole('button', { name: 'Next tasks page', exact: true }).click()
    await page.getByRole('navigation', { name: 'tasks pages' }).getByText('2 of 2').waitFor()
    assert.equal(await page.locator('.employee-task-open').count(), 1)
    assert.equal(await page.locator('.employee-attention-item').count(), 1)
    await page.getByRole('button', { name: 'Previous tasks page', exact: true }).click()
    await page.getByRole('navigation', { name: 'tasks pages' }).getByText('1 of 2').waitFor()
    const opener = page.locator('.employee-task-open').first()
    await opener.click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('heading', { name: 'Manager comments' }).waitFor()
    assert.equal(await dialog.locator('.employee-comment').count(), 25)
    await dialog.getByRole('button', { name: 'Next comments page', exact: true }).click()
    await dialog.getByRole('navigation', { name: 'comments pages' }).getByText('2 of 2').waitFor()
    assert.equal(await dialog.locator('.employee-comment').count(), 1)
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
    assert.deepEqual(result.violations.map((rule) => rule.id), [])
    await page.screenshot({ path: `${output}/comments-${width}.png`, fullPage: true })
    await page.keyboard.press('Escape')
    assert.equal(await opener.evaluate((node) => node === document.activeElement), true)
    await page.getByRole('navigation', { name: 'attention pages' }).getByText('2 of 2').waitFor()
    await page.screenshot({ path: `${output}/tasks-attention-${width}.png`, fullPage: true })
  } finally { await context.close() }
})
