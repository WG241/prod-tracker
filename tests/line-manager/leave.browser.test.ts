/// <reference lib="dom" />
import 'dotenv/config'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir } from 'node:fs/promises'
import { test } from 'node:test'
import { setTimeout } from 'node:timers/promises'
import AxeBuilder from '@axe-core/playwright'
import { chromium } from 'playwright'
import { authTestDatabase, readAuthConfig } from '../../server/auth/config.ts'
import { provision } from '../../server/auth/provision.ts'
import { createAuth } from '../../server/auth/provider.ts'
import { createAuthService } from '../../server/auth/service.ts'
import { isoDay, shiftDay } from '../../server/data-model/calendar.ts'
import { createDatabase } from '../../server/db.ts'
import { managerFixtures } from '../helpers/manager-dashboard-fixtures.ts'

for (const [mode, port] of [['development', 3040], ['production', 3041]] as const) {
  test(`arranges, replaces and ends leave cover in ${mode}`, { timeout: 210000 }, async () => {
    const base = `http://127.0.0.1:${port}`
    const target = authTestDatabase(process.env.TEST_DATABASE_URL, process.env.DATABASE_URL)
    assert.equal(new URL(target).hostname, '127.0.0.1', 'Run leave browser fixtures on isolated local PostgreSQL')
    const db = createDatabase(target)
    const env = { ...process.env, DATABASE_URL: target, DATABASE_URL_UNPOOLED: target, HOST: '127.0.0.1', PORT: String(port),
      BETTER_AUTH_URL: base, TELEMETRY_MODE: 'off', EMAIL_MODE: 'off' }
    const config = readAuthConfig(env)
    const fixture = await managerFixtures(db, config)
    await provision(db, config, fixture.otherManagerId, fixture.password)
    const service = createAuthService(db, createAuth(db, config))
    const session = await service.signIn(fixture.email, fixture.password, new Headers({ origin: base }))
    const cookies = session.headers.getSetCookie().map((line) => {
      const value = line.split(';', 1)[0]
      const split = value.indexOf('=')
      return { url: base, name: value.slice(0, split), value: value.slice(split + 1) }
    })
    assert.ok(cookies.length > 0)
    const output = `.local/verification/feature20/${mode}`
    await mkdir(output, { recursive: true })
    const app = spawn(process.execPath, mode === 'development' ? ['--import', 'tsx', 'server/index.ts', '--dev'] : ['dist-server/server/index.js'],
      { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const exited = once(app, 'exit')
    let diagnostics = ''
    app.stderr.on('data', (chunk: Buffer) => { diagnostics = (diagnostics + chunk.toString()).slice(-3000) })
    const ready = new Promise<void>((resolve, reject) => {
      app.stdout.on('data', (chunk: Buffer) => { if (chunk.toString().includes('Workforce app ready')) resolve() })
      app.once('error', reject)
      app.once('exit', (code) => reject(new Error(`App exited before readiness (${code}). ${diagnostics}`)))
    })
    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
    try {
      await ready
      browser = await chromium.launch({ executablePath: process.env.MANAGER_BROWSER_EXECUTABLE, args: ['--disable-gpu'] })
      const context = await browser.newContext({ viewport: { width: 1440, height: 960 } })
      await context.addCookies(cookies)
      const page = await context.newPage()
      const failures: string[] = []
      page.on('pageerror', (error) => failures.push(error.message))
      page.on('requestfailed', (request) => failures.push(`${new URL(request.url()).pathname}: ${request.failure()?.errorText}`))
      page.on('response', (response) => {
        if (response.status() >= 400) failures.push(`${new URL(response.url()).pathname}: ${response.status()}`)
      })
      try {
        const navigate = () => page.goto(`${base}/line-manager/leave`, { waitUntil: 'commit', timeout: 90000 })
        let navigation = await navigate()
        // Background history capture and cold Vite start can briefly contend for local PostgreSQL.
        for (let attempt = 0; navigation?.status() === 503 && attempt < 3; attempt++) {
          await setTimeout(1500)
          navigation = await navigate()
        }
        assert.ok(navigation?.ok())
        await page.getByRole('heading', { name: 'Leave & cover' }).waitFor({ timeout: 90000 })
      } catch (error) {
        throw new Error(`Leave page did not become ready. ${failures.slice(-8).join(' ')} ${diagnostics}`, { cause: error })
      }
      const start = page.getByLabel('Start date', { exact: true })
      const end = page.getByLabel('Expected return date', { exact: true })
      const search = page.getByRole('searchbox', { name: 'Search relief officers' })
      const officer = page.getByLabel('Relief officer', { exact: true })
      const confirm = page.getByRole('button', { name: 'Confirm leave' })
      const retryLeave = page.getByRole('button', { name: 'Retry leave', exact: true })
      for (let attempt = 0; attempt < 3; attempt++) {
        await confirm.or(retryLeave).first().waitFor()
        if (await confirm.isVisible()) break
        await setTimeout(1000)
        await retryLeave.click()
      }
      await confirm.waitFor()
      const startsOn = isoDay(shiftDay(fixture.today, 1))
      const returnsOn = isoDay(shiftDay(fixture.today, 4))
      await start.fill(startsOn)
      await end.fill(startsOn)
      await confirm.focus()
      await page.keyboard.press('Enter')
      await page.getByText('Choose a return date 1 to 366 days after the start date.').waitFor()
      assert.equal(await end.evaluate((node) => node === document.activeElement), true)
      assert.equal(await end.getAttribute('aria-invalid'), 'true')
      await end.fill(returnsOn)
      assert.equal(await end.getAttribute('aria-invalid'), null)
      await search.fill(fixture.managerName)
      await page.getByText('No eligible officers match this search.').waitFor()
      await search.fill(`Other Manager ${fixture.prefix}`)
      await officer.locator(`option[value="${fixture.otherManagerId}"]`).waitFor({ state: 'attached' })
      await officer.selectOption(fixture.otherManagerId)
      assert.equal(await officer.getAttribute('aria-invalid'), null)
      await page.screenshot({ path: `${output}/leave-form.png`, fullPage: true })

      const receipts: string[] = []
      await page.route('**/api/line-manager/leave', async (route) => {
        if (route.request().method() !== 'POST') return route.continue()
        receipts.push(route.request().headers()['idempotency-key'])
        const response = await route.fetch()
        if (receipts.length === 1 && response.ok()) await route.abort('failed')
        else await route.fulfill({ response })
      })
      await confirm.focus()
      await page.keyboard.press('Enter')
      await page.getByRole('main').getByText('The result could not be confirmed. Retry to check this same change.').waitFor()
      assert.equal(await start.inputValue(), startsOn)
      assert.equal(await officer.inputValue(), fixture.otherManagerId)
      await page.getByRole('button', { name: 'Retry', exact: true }).click()
      await page.getByRole('heading', { name: 'Your leave dates' }).waitFor()
      assert.equal(receipts.length, 2)
      assert.equal(receipts[0], receipts[1])
      const leave = await db.leaveRecord.findFirstOrThrow({ where: { userId: fixture.managerId } })
      assert.equal(await db.leaveRecord.count({ where: { userId: fixture.managerId } }), 1)
      assert.equal(await db.reliefAssignment.count({ where: { leaveId: leave.id, reliefManagerId: fixture.otherManagerId } }), 1)
      assert.equal(await db.leaveMutationReceipt.count({ where: { leaveId: leave.id, operation: 'MANAGER_CREATE' } }), 1)
      await page.screenshot({ path: `${output}/scheduled-cover.png`, fullPage: true })

      const edit = page.getByRole('button', { name: 'Edit cover' })
      const prepareReplacement = async () => {
        await edit.click({ trial: true })
        await edit.focus()
        await page.keyboard.press('Enter')
        const shorter = page.getByLabel('Cover ends', { exact: true })
        assert.equal(await shorter.inputValue(), returnsOn)
        assert.equal(await page.getByLabel('Cover starts', { exact: true }).evaluate((node) => node === document.activeElement), true)
        await shorter.fill(isoDay(shiftDay(fixture.today, 3)))
        await page.getByRole('searchbox', { name: 'Search relief officers' }).fill(`Other Manager ${fixture.prefix}`)
        await officer.locator(`option[value="${fixture.otherManagerId}"]`).waitFor({ state: 'attached' })
        await officer.selectOption(fixture.otherManagerId)
      }
      const saveCover = page.getByRole('button', { name: 'Save cover' })
      await prepareReplacement()
      const replacePath = `/api/line-manager/leave/${leave.id}/cover`
      await page.route(`**${replacePath}`, async (route) => {
        const response = await route.fetch({ postData: { ...route.request().postDataJSON(), expectedReliefId: null } })
        await route.fulfill({ response })
      }, { times: 1 })
      const stale = page.waitForResponse((response) => new URL(response.url()).pathname === replacePath)
      await saveCover.click()
      const rejected = await stale
      assert.equal(rejected.status(), 409)
      assert.equal((await rejected.json()).error.code, 'RELIEF_CHANGED')
      await page.getByRole('main').getByText('The cover arrangement changed. Reload the latest leave before saving.').waitFor()
      assert.equal(await db.reliefAssignment.count({ where: { leaveId: leave.id } }), 1)
      await page.getByRole('button', { name: 'Reload latest' }).click()
      await prepareReplacement()
      await saveCover.click()
      const cover = page.locator('.manager-cover-card')
      await cover.getByText('Some remaining leave dates are uncovered. Arrange cover or contact HR.', { exact: true }).waitFor()
      await cover.locator('.manager-previous-cover').getByText(/· Ended$/).waitFor()
      assert.equal(await db.reliefAssignment.count({ where: { leaveId: leave.id, endedAt: { not: null } } }), 1)

      const endCover = page.getByRole('button', { name: 'End cover', exact: true })
      await endCover.focus()
      await page.keyboard.press('Enter')
      const endDialog = page.getByRole('dialog', { name: 'End relief cover?' })
      await endDialog.getByText(/Review access ends immediately/).waitFor()
      await page.keyboard.press('Escape')
      assert.equal(await endCover.evaluate((node) => node === document.activeElement), true)
      await page.keyboard.press('Enter')
      await endDialog.getByRole('button', { name: 'End cover', exact: true }).click()
      await page.getByRole('button', { name: 'Arrange cover', exact: true }).waitFor()
      assert.equal(await db.reliefAssignment.count({ where: { leaveId: leave.id, endedAt: null } }), 0)
      await page.getByRole('button', { name: 'Cancel leave', exact: true }).click()
      const history = page.getByRole('table', { name: 'Leave history' })
      const cancelled = history.getByRole('row').filter({ hasText: fixture.managerName })
      await cancelled.getByText('Cancelled', { exact: true }).waitFor()
      const previous = cancelled.getByRole('button', { name: /Previous cover for leave starting/ })
      await previous.focus()
      await page.keyboard.press('Enter')
      const previousDialog = page.getByRole('dialog', { name: 'Previous cover' })
      await previousDialog.getByText(/· Ended$/).first().waitFor()
      assert.equal(await previousDialog.getByText(/· Ended$/).count(), 2)
      assert.equal(await previousDialog.getByText(`Other Manager ${fixture.prefix}`, { exact: true }).count(), 2)
      await previousDialog.screenshot({ path: `${output}/previous-cover.png` })
      await page.keyboard.press('Escape')
      assert.equal(await previous.evaluate((node) => node === document.activeElement), true)
      await page.setViewportSize({ width: 320, height: 900 })
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
      const scan = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
      assert.deepEqual(scan.violations.map(({ id, nodes }) => [id, nodes.map(({ target }) => target)]), [])
      await page.screenshot({ path: `${output}/leave-history-320.png`, fullPage: true })
      await context.request.post(`${base}/api/auth/sign-out`, { headers: { origin: base }, data: {} })
    } finally {
      if (app.exitCode === null && app.signalCode === null) app.kill('SIGTERM')
      await Promise.all([browser?.close(), exited, db.$disconnect()])
    }
  })
}
