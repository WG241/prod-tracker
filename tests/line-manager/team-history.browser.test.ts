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
import { createDatabase } from '../../server/db.ts'
import { managerFixtures } from '../helpers/manager-dashboard-fixtures.ts'
import { frozenTeamFixture } from '../helpers/team-history-fixtures.ts'

for (const [mode, port] of [['development', 3022], ['production', 3023]] as const) {
  test(`team history filters, exact week, conversation, failure and focus in ${mode}`, { timeout: 120000 }, async () => {
    const base = `http://127.0.0.1:${port}`
    const target = authTestDatabase(process.env.TEST_DATABASE_URL, process.env.DATABASE_URL)
    const db = createDatabase(target)
    const env = { ...process.env, DATABASE_URL: target, DATABASE_URL_UNPOOLED: target, HOST: '127.0.0.1', PORT: String(port),
      BETTER_AUTH_URL: base, TELEMETRY_MODE: 'off', EMAIL_MODE: 'off' }
    const fixture = await managerFixtures(db, readAuthConfig(env))
    const frozen = await frozenTeamFixture(db, fixture, false)
    const output = `.local/verification/feature18/${mode}`
    await mkdir(output, { recursive: true })
    const app = spawn(process.execPath, mode === 'development' ? ['--import', 'tsx', 'server/index.ts', '--dev'] : ['dist-server/server/index.js'],
      { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const exited = once(app, 'exit')
    let diagnostics = ''
    app.stderr.on('data', (chunk: Buffer) => { diagnostics = (diagnostics + chunk.toString()).slice(-3000) })
    const ready = new Promise<void>((resolve, reject) => {
      app.stdout.on('data', (chunk: Buffer) => { if (chunk.toString().includes('Workforce app ready')) resolve() })
      app.once('error', reject)
      app.once('exit', (code) => reject(new Error(`App exited before readiness (${code}).`)))
    })
    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
    try {
      await ready
      browser = await chromium.launch({ executablePath: process.env.MANAGER_BROWSER_EXECUTABLE })
      const context = await browser.newContext({ viewport: { width: 1440, height: 960 } })
      const signIn = () => context.request.post(`${base}/api/auth/sign-in`, {
        headers: { origin: base }, data: { email: fixture.email, password: fixture.password },
      })
      let session = await signIn()
      for (let attempt = 0; session.status() === 503 && attempt < 2; attempt++) {
        await setTimeout(1000)
        session = await signIn()
      }
      assert.equal(session.status(), 200, diagnostics)
      const page = await context.newPage()
      const pageErrors: string[] = []
      page.on('pageerror', (error) => pageErrors.push(error.message))
      await page.goto(`${base}/line-manager/team-history`)
      const table = page.getByRole('table', { name: 'Team history roster' })
      await table.getByRole('rowheader', { name: fixture.ownerName }).waitFor()
      await page.screenshot({ path: `${output}/roster.png`, fullPage: true })
      await page.getByRole('searchbox', { name: 'Search team history' }).fill(fixture.ownerName.toUpperCase())
      await page.getByLabel('Employee', { exact: true }).selectOption(fixture.ownerId)
      await page.getByLabel('Participation').selectOption('SUBMITTED')
      const opener = table.getByRole('button', { name: new RegExp(`View week for ${fixture.ownerName}`) })
      await opener.focus()
      await page.keyboard.press('Enter')
      const heading = page.getByRole('heading', { name: `${fixture.ownerName}’s week` })
      await heading.waitFor()
      assert.equal(await heading.evaluate((node) => node === document.activeElement), true)
      await page.getByLabel('Task status').selectOption('BLOCKED')
      await page.getByRole('button', { name: 'Card', exact: true }).click()
      const task = page.getByRole('button', { name: new RegExp(`^${fixture.blockerTitle}`) })
      await task.focus()
      await page.keyboard.press('Enter')
      const drawer = page.getByRole('dialog', { name: 'Task details' })
      await drawer.getByRole('heading', { name: fixture.blockerTitle }).waitFor()
      const reply = 'Confirm the current team history conversation.'
      await drawer.getByRole('textbox', { name: 'Reply' }).fill(reply)
      await drawer.getByRole('button', { name: 'Post reply' }).click()
      await drawer.getByText(reply, { exact: true }).waitFor()
      assert.equal(await db.taskComment.count({ where: { weeklyTaskId: fixture.blockerId, body: reply, authorId: fixture.managerId } }), 1)
      await page.keyboard.press('Escape')
      assert.equal(await task.evaluate((node) => node === document.activeElement), true)
      // A same actor session check withholds private content, closes the drawer, and restores drill intent.
      await task.click()
      await drawer.getByRole('heading', { name: fixture.blockerTitle }).waitFor()
      await page.evaluate(() => window.dispatchEvent(new Event('focus')))
      await drawer.waitFor({ state: 'hidden' })
      await heading.waitFor()
      assert.equal(await page.getByLabel('Task status').inputValue(), 'BLOCKED')
      await page.getByRole('button', { name: 'Back to team' }).click()
      await opener.waitFor()
      assert.equal(await opener.evaluate((node) => node === document.activeElement), true)
      assert.equal(await page.getByLabel('Employee', { exact: true }).inputValue(), fixture.ownerId)
      assert.equal(await page.getByLabel('Participation').inputValue(), 'SUBMITTED')
      assert.equal(await page.getByRole('searchbox').inputValue(), fixture.ownerName.toUpperCase())

      await page.getByLabel('Employee', { exact: true }).selectOption('')
      await page.getByRole('searchbox').fill(frozen.transfer.name)
      await page.getByRole('button', { name: 'Date range', exact: true }).click()
      const calendar = page.getByRole('dialog', { name: 'Choose a date range' })
      await calendar.getByLabel('From').fill(frozen.previousWeek)
      await calendar.getByLabel('To').fill(frozen.week)
      await calendar.getByRole('button', { name: 'Apply range' }).click()
      await table.getByRole('columnheader', { name: 'Week', exact: true }).waitFor()
      const frozenOpener = table.getByRole('button', { name: new RegExp(`View week for ${frozen.transfer.name}`) })
      await frozenOpener.waitFor()
      const unavailable = page.getByText('Some historical totals are unavailable.', { exact: false })
      await unavailable.waitFor()
      const rosterRead = /\/api\/line-manager\/team-history\?/
      await page.route(rosterRead, (route) => route.fulfill({ status: 503, body: '{}' }), { times: 1 })
      await page.getByRole('button', { name: 'Check availability' }).click()
      await page.getByText('This team history may be out of date.', { exact: false }).waitFor()
      assert.equal(await frozenOpener.isDisabled(), true)
      await page.screenshot({ path: `${output}/stale-history.png`, fullPage: true })
      await page.getByRole('button', { name: 'Retry', exact: true }).click()
      await frozenOpener.click()
      await page.getByText('Week ended. This is a frozen, read-only record.').waitFor()
      await page.getByRole('button', { name: new RegExp(`^${frozen.title}`) }).click()
      await drawer.getByText(frozen.comment, { exact: true }).waitFor()
      assert.equal(await drawer.getByRole('textbox', { name: 'Reply' }).count(), 0)
      assert.equal(await drawer.getByText('Recorded line manager', { exact: true }).count(), 2)
      await drawer.screenshot({ path: `${output}/frozen-drawer.png` })
      await page.keyboard.press('Escape')
      await page.screenshot({ path: `${output}/frozen-week.png`, fullPage: true })
      await page.getByRole('button', { name: 'Back to team' }).click()
      await frozenOpener.waitFor()
      assert.equal(await frozenOpener.evaluate((node) => node === document.activeElement), true)
      await page.setViewportSize({ width: 320, height: 900 })
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
      const scan = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
      assert.deepEqual(scan.violations.map(({ id, nodes }) => [id, nodes.map(({ target }) => target)]), [])
      await page.screenshot({ path: `${output}/roster-320.png`, fullPage: true })
      assert.deepEqual(pageErrors, [])
      await context.request.post(`${base}/api/auth/sign-out`, { headers: { origin: base }, data: {} })
    } finally {
      await browser?.close()
      if (app.exitCode === null && app.signalCode === null) { app.kill('SIGTERM'); await exited }
      await db.$disconnect()
    }
  })
}
