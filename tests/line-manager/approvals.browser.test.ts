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
import { isoDay } from '../../server/data-model/calendar.ts'
import { createDatabase } from '../../server/db.ts'
import { managerFixtures } from '../helpers/manager-dashboard-fixtures.ts'

for (const [mode, port] of [['development', 3025], ['production', 3026]] as const) {
  test(`reviews exact requests and recovers a lost decision response in ${mode}`, { timeout: 150000 }, async () => {
    const base = `http://127.0.0.1:${port}`
    const target = authTestDatabase(process.env.TEST_DATABASE_URL, process.env.DATABASE_URL)
    const db = createDatabase(target)
    const env = { ...process.env, DATABASE_URL: target, DATABASE_URL_UNPOOLED: target, HOST: '127.0.0.1', PORT: String(port),
      BETTER_AUTH_URL: base, TELEMETRY_MODE: 'off', EMAIL_MODE: 'off' }
    const fixture = await managerFixtures(db, readAuthConfig(env))
    const extra = await db.$transaction(async (tx) => {
      const source = await tx.weeklyTask.findUniqueOrThrow({ where: { id: fixture.blockerId } })
      const series = await tx.taskSeries.create({ data: { ownerId: fixture.ownerId } })
      const title = `Second browser completion ${fixture.prefix}`
      const task = await tx.weeklyTask.create({ data: { title, activity: 'Review this submitted evidence.', ownerId: fixture.ownerId,
        seriesId: series.id, trackerId: source.trackerId, startsOn: source.startsOn, endsOn: source.endsOn, status: 'AWAITING_APPROVAL' } })
      return tx.approvalRequest.create({ data: { weeklyTaskId: task.id, submittedById: fixture.ownerId, submissionAssignmentId: fixture.ownerAssignmentId,
        assignedManagerId: fixture.managerId, attemptNumber: 1, submissionSnapshot: { version: 1, title, activity: task.activity, ownerId: fixture.ownerId,
          ownerDisplayName: fixture.ownerName, startsOn: isoDay(task.startsOn), endsOn: isoDay(task.endsOn), weekStartsOn: fixture.week, status: 'AWAITING_APPROVAL' } } })
    })
    const output = `.local/verification/feature19/${mode}`
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
      for (let attempt = 0; session.status() === 503 && attempt < 2; attempt++) { await setTimeout(1000); session = await signIn() }
      assert.equal(session.status(), 200, diagnostics)
      const page = await context.newPage()
      await page.goto(`${base}/line-manager/approvals`)
      const opener = page.getByRole('button', { name: `Review ${fixture.ownerName}` })
      await opener.waitFor()
      assert.equal(await page.getByLabel('Workweek').inputValue(), '')
      await page.screenshot({ path: `${output}/awaiting.png`, fullPage: true })
      await opener.focus()
      await page.keyboard.press('Enter')
      const group = page.getByRole('dialog', { name: `Review · ${fixture.ownerName}` })
      await group.getByRole('button', { name: 'Approve all (2)' }).waitFor()
      const request = group.locator('section').filter({ has: page.getByRole('heading', { name: 'Work ready for review' }) })
      await request.getByRole('button', { name: 'View task' }).click()
      const drawer = page.getByRole('dialog', { name: 'Task details' })
      await drawer.getByRole('heading', { name: 'Work ready for review' }).waitFor()
      assert.equal(await page.locator('dialog[open]').count(), 1)
      await drawer.getByRole('textbox', { name: 'Reply' }).fill('Thank you for preparing this evidence.')
      await drawer.getByRole('button', { name: 'Post reply' }).click()
      await drawer.getByText('Thank you for preparing this evidence.', { exact: true }).waitFor()
      await page.keyboard.press('Escape')
      await group.waitFor()
      assert.equal(await request.getByRole('button', { name: 'View task' }).evaluate((node) => node === document.activeElement), true)
      await request.getByRole('button', { name: 'Decline' }).click()
      const decline = page.getByRole('dialog', { name: 'Why are you declining this completion?' })
      await decline.getByRole('button', { name: 'Send decline' }).click()
      await decline.getByText('Enter a reason of 10 to 2,000 characters.').waitFor()
      assert.equal(await decline.getByRole('textbox', { name: 'Reason' }).evaluate((node) => node === document.activeElement), true)
      await decline.screenshot({ path: `${output}/decline-validation.png` })
      const keys: string[] = []
      await page.route(`**/api/line-manager/approvals/requests/${fixture.requestId}/decline`, async (route) => {
        keys.push(route.request().headers()['idempotency-key'])
        const result = await route.fetch()
        if (keys.length === 1 && result.ok()) await route.abort('failed')
        else await route.fulfill({ response: result })
      })
      const reason = 'Please include the signed validation report.'
      await decline.getByRole('textbox', { name: 'Reason' }).fill(reason)
      await decline.getByRole('button', { name: 'Send decline' }).click()
      await decline.getByRole('button', { name: 'Retry', exact: true }).click()
      await group.getByRole('button', { name: 'Approve all (1)' }).waitFor()
      assert.equal(keys.length, 2)
      assert.equal(keys[0], keys[1])
      const decision = await db.approvalDecision.findUniqueOrThrow({ where: { requestId: fixture.requestId } })
      assert.equal(decision.reason, reason)
      await group.getByRole('button', { name: 'Approve all (1)' }).click()
      const empty = page.getByRole('dialog', { name: 'Review completions' })
      await empty.getByText('All completions reviewed or no longer available.').waitFor()
      assert.equal(await db.approvalDecision.count({ where: { requestId: extra.id, decision: 'APPROVE' } }), 1)
      await empty.getByRole('button', { name: 'Close', exact: true }).click()
      await page.getByRole('button', { name: /^Declined/ }).click()
      await page.getByRole('table', { name: 'Declined attempts' }).getByText(reason, { exact: true }).waitFor()
      await page.getByRole('button', { name: /^Blockers/ }).click()
      await page.getByRole('table', { name: 'Blocked tasks' }).getByText(fixture.blockerTitle).waitFor()
      await page.setViewportSize({ width: 320, height: 900 })
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
      const scan = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
      assert.deepEqual(scan.violations.map(({ id, nodes }) => [id, nodes.map(({ target }) => target)]), [])
      await page.screenshot({ path: `${output}/blockers-320.png`, fullPage: true })
      await context.request.post(`${base}/api/auth/sign-out`, { headers: { origin: base }, data: {} })
    } finally {
      await browser?.close()
      if (app.exitCode === null && app.signalCode === null) { app.kill('SIGTERM'); await exited }
      await db.$disconnect()
    }
  })
}
