/// <reference lib="dom" />
import 'dotenv/config'
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import type { Browser, BrowserContext, Page } from 'playwright'
import AxeBuilder from '@axe-core/playwright'
import type { HomeResponse } from '../../src/features/employee/contracts.ts'
import { createDatabase } from '../../server/db.ts'
import { authTestDatabase } from '../../server/auth/config.ts'
import { monday } from '../../server/employee/calendar.ts'
import type { MutationResult } from '../../src/features/employee/mutations.ts'

const base = process.env.EMPLOYEE_BASE_URL ?? 'http://127.0.0.1:3001'
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname))
const output = `.local/verification/feature10/${process.env.EMPLOYEE_TARGET ?? 'development'}`
let browser: Browser, context: BrowserContext, page: Page
const title = `Lifecycle browser ${randomUUID().slice(0, 8)}`
before(async () => {
  assert.ok(['3001', '3002'].includes(new URL(base).port), 'Mutating browser tests require the explicitly isolated app ports')
  const db = createDatabase(authTestDatabase(process.env.TEST_DATABASE_URL, process.env.DATABASE_URL))
  try {
    const week = await db.workWeek.findUniqueOrThrow({ where: { startsOn: monday(new Date()) } })
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id='person-ada-okafor' FOR UPDATE`
      const existing = await tx.planningUnlock.findFirst({ where: { weekId: week.id, scope: 'PERSON', userId: 'person-ada-okafor' } })
      if (!existing) await tx.planningUnlock.create({ data: { weekId: week.id, scope: 'PERSON', userId: 'person-ada-okafor', grantedById: 'person-kemi-adebayo', reason: 'Isolated browser verification', expiresAt: week.freezesAt } })
    })
  } finally { await db.$disconnect() }
  await mkdir(output, { recursive: true })
  browser = await chromium.launch()
  context = await browser.newContext({ viewport: { width: 1280, height: 1000 } })
  const response = await context.request.post(`${base}/api/auth/sign-in`, { headers: { origin: base }, data: { email: 'ada.okafor@workforcegroup.com', password: process.env.LOCAL_AUTH_TEST_PASSWORD } })
  assert.equal(response.status(), 200)
  page = await context.newPage()
  await page.goto(`${base}/employee/home`)
  await page.getByRole('button', { name: 'Add task', exact: true }).first().waitFor()
  await page.locator('.employee-week-card[aria-busy="true"]').waitFor({ state: 'hidden' })
})
after(async () => {
  await context?.request.post(`${base}/api/auth/sign-out`, { headers: { origin: base }, data: {} })
  await browser?.close()
})
async function scan(name: string) {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
  assert.deepEqual(result.violations.map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target) })), [])
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
  await page.screenshot({ path: `${output}/${name}.png`, fullPage: true })
}
async function saved(action: () => Promise<unknown>) {
  const response = page.waitForResponse((r) => r.url().includes('/api/employee/tasks') && r.request().method() !== 'GET')
  const refreshed = page.waitForResponse((r) => r.url().includes('/api/employee/home?') && r.request().method() === 'GET' && r.status() === 200)
  await action()
  const result = await response
  assert.ok(result.ok(), `${result.status()} ${await result.text()}`)
  await refreshed
  await page.locator('.employee-week-card[aria-busy="true"]').waitFor({ state: 'hidden' })
  return result.json() as Promise<MutationResult>
}
async function menu(name: string, action: string) {
  await page.getByRole('button', { name: `Actions for ${name}`, exact: true }).click()
  await page.getByRole('menuitem', { name: action, exact: true }).click()
}
test('AC1 through 7,10 real create, blocked next step, carry, conversation, completion, withdrawal and delete', async () => {
  await page.getByRole('button', { name: 'Add task', exact: true }).first().click()
  await page.getByLabel('Task title', { exact: true }).fill(title)
  await page.getByLabel('Activity', { exact: true }).fill('Persisted browser lifecycle verification')
  await scan('add-task')
  const created = await saved(() => page.getByRole('button', { name: 'Save task', exact: true }).click())
  await page.getByRole('heading', { name: title, exact: true }).waitFor()
  await menu(title, 'Edit')
  await page.getByLabel('Status', { exact: true }).selectOption('BLOCKED')
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await page.getByLabel('Reason', { exact: true }).fill('Waiting for a verification dependency')
  await scan('blocker')
  await saved(() => page.getByRole('button', { name: 'Save blocker', exact: true }).click())
  await page.getByRole('heading', { name: 'What would you like to do next?', exact: true }).waitFor()
  await saved(() => page.getByRole('button', { name: /^Carry over to next week/ }).click())
  await page.getByRole('button', { name: 'Card', exact: true }).click()
  await page.locator('.employee-task-open').filter({ hasText: title }).click()
  await page.getByLabel('Reply', { exact: true }).fill('Browser reply <script>must remain text</script>')
  await saved(() => page.getByRole('button', { name: 'Post reply', exact: true }).click())
  await page.getByText('Browser reply <script>must remain text</script>', { exact: true }).waitFor()
  await scan('drawer-comment')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await menu(title, 'Edit')
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await page.getByLabel('Reason', { exact: true }).fill('Updated blocker on an already carried task')
  await saved(() => page.getByRole('button', { name: 'Save blocker', exact: true }).click())
  await page.getByRole('heading', { name: 'What would you like to do next?', exact: true }).waitFor()
  await saved(() => page.getByRole('button', { name: /^Carry over to next week/ }).click())
  const carried = await (await context.request.get(`${base}/api/employee/tasks/${created.taskId}`)).json()
  assert.equal(carried.task.carryRequested, true, 'The next step Carry action never clears an existing carry')
  await menu(title, 'Completed')
  await scan('complete-confirmation')
  await saved(() => page.getByRole('button', { name: 'Mark completed', exact: true }).click())
  await page.locator('.employee-task').filter({ hasText: title }).getByText('Awaiting approval', { exact: true }).waitFor()
  await menu(title, 'Edit')
  assert.equal(await page.getByLabel('Status', { exact: true }).inputValue(), 'PENDING')
  await page.getByLabel('Activity', { exact: true }).fill('Revised after submission')
  await saved(() => page.getByRole('button', { name: 'Save changes', exact: true }).click())
  await page.locator('.employee-task').filter({ hasText: title }).getByText('Pending', { exact: true }).waitFor()
  await menu(title, 'Delete')
  await scan('delete-confirmation')
  await saved(() => page.getByRole('button', { name: 'Delete task', exact: true }).click())
  await page.getByRole('heading', { name: title, exact: true }).waitFor({ state: 'hidden' })
  const detail = await context.request.get(`${base}/api/employee/tasks/${created.taskId}`)
  assert.equal(detail.status(), 404)
})
test('AC8,10 close after committed response loss, reopen same intent and retry without duplicate', async () => {
  const retryTitle = title + ' retry'
  let release: () => void = () => {}, reached: () => void = () => {}
  const serverCommitted = new Promise<void>((resolve) => { reached = resolve })
  const hold = new Promise<void>((resolve) => { release = resolve })
  let first = true
  const keys: string[] = []
  await page.route('**/api/employee/tasks', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    keys.push(route.request().headers()['idempotency-key'])
    if (!first) return route.continue()
    first = false
    const response = await route.fetch()
    assert.equal(response.status(), 201)
    reached(); await hold; await route.abort('failed')
  })
  await page.getByRole('button', { name: 'Add task', exact: true }).first().click()
  await page.getByLabel('Task title', { exact: true }).fill(retryTitle)
  await page.getByLabel('Activity', { exact: true }).fill('Lost response verification')
  await page.getByRole('button', { name: 'Save task', exact: true }).click()
  await serverCommitted
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  release()
  await page.getByRole('button', { name: 'Add task', exact: true }).first().click()
  await page.getByRole('button', { name: 'Retry', exact: true }).waitFor()
  assert.equal(await page.getByLabel('Task title', { exact: true }).inputValue(), retryTitle)
  assert.equal(await page.getByLabel('Task title', { exact: true }).isEditable(), false)
  await saved(() => page.getByRole('button', { name: 'Retry', exact: true }).click())
  assert.equal(keys.length, 2); assert.equal(keys[0], keys[1])
  const home = await (await context.request.get(`${base}/api/employee/home`)).json() as HomeResponse
  assert.equal(home.tasks.items.filter((t) => t.title === retryTitle).length, 1)
  await page.unroute('**/api/employee/tasks')
  await menu(retryTitle, 'Delete')
  await saved(() => page.getByRole('button', { name: 'Delete task', exact: true }).click())
})
test('AC8,10 stale edit retains draft, explicit reload discards it, 320 pixel and keyboard checks', async () => {
  await page.getByRole('button', { name: 'Add task', exact: true }).first().click()
  await page.getByLabel('Task title', { exact: true }).fill(title + ' conflict')
  await page.getByLabel('Activity', { exact: true }).fill('Original')
  const created = await saved(() => page.getByRole('button', { name: 'Save task', exact: true }).click())
  await menu(title + ' conflict', 'Edit')
  await page.getByLabel('Activity', { exact: true }).fill('My retained draft')
  const external = await context.request.post(`${base}/api/employee/tasks/${created.taskId}/status`, { headers: { origin: base, 'idempotency-key': randomUUID(), 'if-match': '"0"' }, data: { status: 'IN_PROGRESS' } })
  assert.equal(external.status(), 200)
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await page.getByRole('button', { name: 'Reload latest', exact: true }).waitFor()
  assert.equal(await page.getByLabel('Activity', { exact: true }).inputValue(), 'My retained draft')
  await page.setViewportSize({ width: 320, height: 900 })
  await scan('conflict-320')
  await page.getByRole('button', { name: 'Reload latest', exact: true }).click()
  await page.getByRole('region', { name: 'Task record', exact: true }).getByRole('heading', { name: title + ' conflict', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.setViewportSize({ width: 1280, height: 1000 })
  await page.getByRole('button', { name: `Actions for ${title} conflict`, exact: true }).click()
  await page.getByRole('menuitem', { name: 'Edit', exact: true }).press('Escape')
  assert.equal(await page.getByRole('button', { name: `Actions for ${title} conflict`, exact: true }).evaluate((element) => element === document.activeElement), true)
  await page.getByRole('button', { name: `Actions for ${title} conflict`, exact: true }).click()
  await page.getByRole('menuitem', { name: 'Edit', exact: true }).press('Tab')
  assert.equal(await page.getByRole('menu').count(), 0)
  assert.equal(await page.evaluate(() => document.activeElement !== document.body && !document.activeElement?.closest('[role="menu"]')), true)
  await menu(title + ' conflict', 'Delete')
  await saved(() => page.getByRole('button', { name: 'Delete task', exact: true }).click())
})
test('AC7,10 deleting the final task on page two returns to a populated valid page', async () => {
  const db = createDatabase(authTestDatabase(process.env.TEST_DATABASE_URL, process.env.DATABASE_URL))
  const prefix = `pagination-${randomUUID()}`
  const ids = Array.from({ length: 26 }, (_, i) => `${prefix}-${i}`)
  try {
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id='person-ada-okafor' FOR UPDATE`
      const tracker = await tx.weeklyTracker.findFirstOrThrow({ where: { userId: 'person-ada-okafor', week: { startsOn: monday(new Date()) } }, include: { week: true } })
      const existing = await tx.weeklyTask.count({ where: { trackerId: tracker.id, deletedAt: null } })
      assert.ok(existing < 25, 'Pagination fixture expects fewer than 25 existing current tasks')
      ids.splice(26 - existing)
      await tx.taskSeries.createMany({ data: ids.map((id) => ({ id, ownerId: 'person-ada-okafor' })) })
      await tx.weeklyTask.createMany({ data: ids.map((id, i) => ({ id, seriesId: id, ownerId: 'person-ada-okafor', trackerId: tracker.id, title: `${prefix} task ${i}`, activity: 'Isolated pagination fixture', startsOn: tracker.week.startsOn, endsOn: tracker.week.startsOn })) })
    })
    await page.reload()
    await page.getByRole('button', { name: 'Next tasks page', exact: true }).click()
    await page.getByRole('navigation', { name: 'tasks pages', exact: true }).getByText('2 of 2', { exact: true }).waitFor()
    const rows = await page.locator('.employee-tasks .employee-task h3').allTextContents()
    assert.equal(rows.length, 1)
    await menu(rows[0], 'Delete')
    await saved(() => page.getByRole('button', { name: 'Delete task', exact: true }).click())
    await page.getByRole('navigation', { name: 'tasks pages', exact: true }).getByText('1 of 1', { exact: true }).waitFor()
    assert.equal(await page.locator('.employee-tasks .employee-task').count(), 25)
  } finally {
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id='person-ada-okafor' FOR UPDATE`
      await tx.weeklyTask.updateMany({ where: { id: { in: ids }, ownerId: 'person-ada-okafor', deletedAt: null }, data: { deletedAt: new Date(), revision: { increment: 1 } } })
    })
    await db.$disconnect()
  }
})
