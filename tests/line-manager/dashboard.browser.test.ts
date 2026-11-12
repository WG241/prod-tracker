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

for (const [mode, port] of [['development', 3016], ['production', 3017]] as const) {
  test(`authenticated dashboard and lost response recovery in ${mode}`, { timeout: 120000 }, async () => {
    const base = `http://127.0.0.1:${port}`
    const target = authTestDatabase(process.env.TEST_DATABASE_URL, process.env.DATABASE_URL)
    const db = createDatabase(target)
    const env = { ...process.env, DATABASE_URL: target, DATABASE_URL_UNPOOLED: target, HOST: '127.0.0.1', PORT: String(port),
      BETTER_AUTH_URL: base, TELEMETRY_MODE: 'off', EMAIL_MODE: 'off' }
    const fixture = await managerFixtures(db, readAuthConfig(env), { olderPending: true })
    const output = `.local/verification/feature16/${mode}`
    await mkdir(output, { recursive: true })
    const app = spawn(process.execPath, mode === 'development' ? ['--import', 'tsx', 'server/index.ts', '--dev'] : ['dist-server/server/index.js'],
      { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const exited = once(app, 'exit')
    let diagnostics = ''
    app.stderr.on('data', (chunk: Buffer) => { diagnostics = (diagnostics + chunk.toString()).slice(-4000) })
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
      await page.goto(`${base}/line-manager/dashboard`)
      await page.getByRole('heading', { name: 'Your team, in focus' }).waitFor()
      await page.getByText(fixture.missingName, { exact: true }).waitFor()
      assert.equal(await page.getByText('Development preview with sample data.', { exact: false }).count(), 0)
      assert.equal(await page.getByText('25%', { exact: true }).first().isVisible(), true)
      assert.equal(await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Approvals 1', exact: true }).isVisible(), true)
      const disclosure = page.getByText('View chart data', { exact: true })
      await disclosure.focus()
      await page.keyboard.press('Enter')
      assert.equal(await page.getByRole('table', { name: 'Weekly team trend data' }).locator('tbody tr').count(), 6)
      const scan = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
      assert.deepEqual(scan.violations.map(({ id, nodes }) => ({ id, targets: nodes.map(({ target }) => target) })), [])
      await page.evaluate(() => window.scrollTo(0, 0))
      await page.screenshot({ path: `${output}/dashboard.png`, fullPage: true })

      const reminder = page.getByRole('button', { name: `Remind ${fixture.missingName}` })
      await reminder.click()
      await page.getByRole('button', { name: `Reminder sent to ${fixture.missingName}` }).waitFor()
      assert.equal(await db.notification.count({ where: { recipientId: fixture.missingId, kind: 'WORK_REMINDER' } }), 1)

      const opener = page.getByRole('button', { name: `Comment on ${fixture.blockerTitle}` })
      await opener.focus()
      await page.keyboard.press('Enter')
      const drawer = page.getByRole('dialog', { name: 'Task details' })
      const reply = drawer.getByRole('textbox', { name: 'Reply' })
      await reply.waitFor()
      await drawer.getByRole('button', { name: 'Post reply' }).click()
      assert.equal(await reply.evaluate((field) => field === document.activeElement), true)
      const keys: string[] = []
      await page.route('**/api/line-manager/team-tasks/*/comments', async (route) => {
        keys.push(route.request().headers()['idempotency-key'])
        const response = await route.fetch()
        if (keys.length === 1 && response.ok()) await route.abort('failed')
        else await route.fulfill({ response })
      })
      const message = 'Please confirm the handover for the client.'
      await reply.fill(message)
      await drawer.getByRole('button', { name: 'Post reply' }).click()
      await drawer.getByRole('button', { name: 'Retry', exact: true }).waitFor()
      assert.equal(await reply.getAttribute('readonly'), '')
      await page.keyboard.press('Escape')
      assert.equal(await opener.evaluate((button) => button === document.activeElement), true)
      await opener.click()
      await drawer.getByRole('button', { name: 'Retry', exact: true }).click()
      await drawer.getByText('Comment posted.', { exact: true }).waitFor()
      await drawer.getByText(message, { exact: true }).waitFor()
      assert.equal(keys.length, 2)
      assert.equal(keys[0], keys[1])
      assert.equal(await db.taskComment.count({ where: { weeklyTaskId: fixture.blockerId, authorId: fixture.managerId } }), 1)
      await drawer.screenshot({ path: `${output}/comment.png` })
      await page.keyboard.press('Escape')

      await page.setViewportSize({ width: 320, height: 900 })
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
      const approvalsTable = page.getByRole('region', { name: 'Employees awaiting approval' })
      assert.equal(await approvalsTable.getAttribute('tabindex'), '0')
      await page.screenshot({ path: `${output}/mobile.png`, fullPage: true })
      const reviewOpener = page.getByRole('button', { name: `Review work for ${fixture.ownerName}` })
      await reviewOpener.click()
      const review = page.getByRole('dialog', { name: `Review · ${fixture.ownerName}` })
      await review.getByRole('heading', { name: 'Work ready for review', exact: true }).waitFor()
      assert.equal(await review.getByRole('heading', { name: 'Older pending submission' }).count(), 0)
      assert.equal(await review.getByRole('button', { name: 'Approve all (1)' }).isEnabled(), true)
      assert.equal(new URL(page.url()).pathname, '/line-manager/dashboard')
      await review.getByRole('button', { name: 'Close', exact: true }).click()
      assert.equal(await reviewOpener.evaluate((node) => node === document.activeElement), true)
      await page.getByRole('button', { name: 'View approvals' }).click()
      await page.getByRole('button', { name: `Review ${fixture.ownerName}`, exact: true }).click()
      await review.getByText('This task can be reviewed once its frozen week is available.').waitFor()
      await review.getByRole('heading', { name: 'Older pending submission' }).waitFor()
      assert.equal(await review.getByRole('button', { name: 'Approve all (1)' }).isEnabled(), true)
      await context.request.post(`${base}/api/auth/sign-out`, { headers: { origin: base }, data: {} })
    } finally {
      await browser?.close()
      if (app.exitCode === null && app.signalCode === null) { app.kill('SIGTERM'); await exited }
      await db.$disconnect()
    }
  })
}
