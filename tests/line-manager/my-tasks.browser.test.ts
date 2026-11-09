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

for (const [mode, port] of [['development', 3019], ['production', 3020]] as const) {
  test(`manager own tasks and completion recovery in ${mode}`, { timeout: 120000 }, async () => {
    const base = `http://127.0.0.1:${port}`
    const target = authTestDatabase(process.env.TEST_DATABASE_URL, process.env.DATABASE_URL)
    const db = createDatabase(target)
    const env = { ...process.env, DATABASE_URL: target, DATABASE_URL_UNPOOLED: target, HOST: '127.0.0.1', PORT: String(port),
      BETTER_AUTH_URL: base, TELEMETRY_MODE: 'off', EMAIL_MODE: 'off' }
    const fixture = await managerFixtures(db, readAuthConfig(env))
    const week = await db.workWeek.findUniqueOrThrow({ where: { id: fixture.weekId } })
    await db.planningUnlock.create({ data: { weekId: week.id, scope: 'PERSON', userId: fixture.managerId, grantedById: 'person-kemi-adebayo',
      expiresAt: week.freezesAt, reason: 'Isolated My tasks browser verification' } })
    const output = `.local/verification/feature17/${mode}`
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
      await page.goto(`${base}/line-manager/my-tasks`)
      await page.getByText('Your tasks are auto-approved on completion and visible to leadership only.').waitFor()
      await page.getByRole('button', { name: 'Add task', exact: true }).first().click()
      const add = page.getByRole('dialog', { name: 'Add a task' })
      const title = `My browser task ${fixture.prefix}`
      await add.getByRole('textbox', { name: 'Task title' }).fill(title)
      await add.getByRole('textbox', { name: 'Activity' }).fill('Complete the manager’s weekly work.')
      await add.getByRole('button', { name: 'Save task', exact: true }).click()
      const task = page.locator('.employee-task').filter({ has: page.getByRole('heading', { name: title, exact: true }) })
      await task.waitFor()
      await page.getByRole('button', { name: 'Card', exact: true }).click()
      assert.equal(await task.isVisible(), true)
      await page.getByRole('button', { name: 'List', exact: true }).click()
      const opener = task.getByRole('button', { name: new RegExp(`^${title}`) })
      await opener.focus()
      await page.keyboard.press('Enter')
      const drawer = page.getByRole('dialog', { name: 'Task details' })
      await drawer.getByText('Leadership can view this task.', { exact: false }).waitFor()
      assert.equal(await drawer.getByText(fixture.managerName, { exact: true }).isVisible(), true)
      const requestKeys: string[] = []
      await page.route('**/api/line-manager/my-tasks/*/status', async (route) => {
        requestKeys.push(route.request().headers()['idempotency-key'])
        const response = await route.fetch()
        if (requestKeys.length === 1 && response.ok()) await route.abort('failed')
        else await route.fulfill({ response })
      })
      await drawer.getByLabel('Update status').selectOption('COMPLETED')
      const confirm = page.getByRole('dialog', { name: 'Complete this task?' })
      await confirm.getByText('This task will be auto-approved on completion.').waitFor()
      await confirm.getByRole('button', { name: 'Mark completed' }).click()
      await confirm.getByRole('button', { name: 'Retry', exact: true }).click()
      await task.getByText('Approved', { exact: true }).waitFor()
      assert.equal(requestKeys.length, 2)
      assert.equal(requestKeys[0], requestKeys[1])
      const stored = await db.weeklyTask.findFirstOrThrow({ where: { ownerId: fixture.managerId, title }, include: { approvals: { include: { decision: true } } } })
      assert.deepEqual(stored.approvals.map(({ state, decision }) => [state, decision?.method]), [['DECIDED', 'AUTOMATIC']])

      await opener.click()
      await drawer.getByText(/System.*Auto-approved/).waitFor()
      const reply = 'Record this outcome for leadership.'
      await drawer.getByRole('textbox', { name: 'Reply' }).fill(reply)
      await drawer.getByRole('button', { name: 'Post reply' }).click()
      await drawer.locator('.employee-comment').getByText(reply, { exact: true }).waitFor()
      assert.equal(await db.taskComment.count({ where: { weeklyTaskId: stored.id, authorId: fixture.managerId, body: reply } }), 1)
      await drawer.locator('.ui-dialog-body').evaluate((body) => { body.scrollTop = 0 })
      await drawer.screenshot({ path: `${output}/automatic-approval.png` })
      await page.keyboard.press('Escape')
      assert.equal(await opener.evaluate((button) => button === document.activeElement), true)
      await page.setViewportSize({ width: 320, height: 900 })
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
      const scan = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
      assert.deepEqual(scan.violations.map(({ id, nodes }) => [id, nodes.map(({ target }) => target)]), [])
      await page.screenshot({ path: `${output}/my-tasks-320.png`, fullPage: true })
      await context.request.post(`${base}/api/auth/sign-out`, { headers: { origin: base }, data: {} })
    } finally {
      await browser?.close()
      if (app.exitCode === null && app.signalCode === null) { app.kill('SIGTERM'); await exited }
      await db.$disconnect()
    }
  })
}
