/// <reference lib="dom" />
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright'
import AxeBuilder from '@axe-core/playwright'

const configured = process.env.TELEMETRY_BROWSER_URL
const production = process.env.TELEMETRY_BROWSER_TARGET === 'production'
const off = process.env.TELEMETRY_BROWSER_TARGET === 'off'
let origin = ''
if (configured) {
  const url = new URL(configured)
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash || url.protocol !== 'http:') throw new Error('Telemetry browser tests require a loopback HTTP origin')
  origin = url.origin
}

test('real app render recovery is private, focused, accessible and reloads normally', { skip: !configured || off }, async () => {
  const browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 320, height: 800 } })
  try {
    const page = await context.newPage()
    const consoleOutput: string[] = []
    page.on('console', (message) => consoleOutput.push(message.text()))
    page.on('pageerror', (error) => consoleOutput.push(error.message))
    const reports: object[] = []
    page.on('request', (request) => { if (request.url() === `${origin}/api/telemetry/error` && request.method() === 'POST') reports.push(request.postDataJSON() as object) })
    // Controlled browser fixture: fail a real AuthApp render, with no shipped fault route.
    await page.addInitScript(() => {
      window.URLSearchParams = class extends URLSearchParams {
        constructor() { super(); throw new Error('PRIVATE_CANARY_RENDER') }
      }
    })
    const captured = page.waitForResponse((response) => response.url() === `${origin}/api/telemetry/error` && response.request().method() === 'POST' && response.status() === 204).catch(() => null)
    await page.goto(`${origin}/sign-in`, { waitUntil: 'domcontentloaded' })
    const heading = page.getByRole('heading', { name: 'Something went wrong', exact: true })
    await heading.waitFor()
    assert.ok(await captured, 'Expected a handled render report')
    assert.ok(await heading.evaluate((element) => element === document.activeElement))
    assert.equal(await page.getByText('Reload to try again.', { exact: true }).count(), 1)
    assert.equal((await page.locator('body').innerText()).includes('PRIVATE_CANARY'), false)
    assert.equal(consoleOutput.join('\n').includes('PRIVATE_CANARY'), false)
    assert.equal(JSON.stringify(reports).includes('PRIVATE_CANARY'), false)
    assert.ok(reports.some((report) => 'code' in report && report.code === 'RENDER_ERROR'))
    for (const report of reports) assert.deepEqual(Object.keys(report).sort(), ['code', 'id', 'locationKey'])
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false)
    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
    assert.deepEqual(axe.violations.map((violation) => violation.id), [])
    const evidence = join('.local/verification/feature8', production ? 'production' : 'development')
    await mkdir(evidence, { recursive: true })
    await page.screenshot({ path: join(evidence, 'recovery-mobile.png') })
    await page.keyboard.press('Tab')
    assert.ok(await page.getByRole('button', { name: 'Reload', exact: true }).evaluate((element) => element === document.activeElement))
    const reload = page.waitForRequest((request) => request.isNavigationRequest() && request.url() === `${origin}/sign-in`)
    await page.keyboard.press('Enter')
    await reload
  } finally { await context.close(); await browser.close() }
})

test('actual development preview reports render, timer and rejection exercises without emitting role visits', { skip: !configured || production || off }, async () => {
  const browser = await chromium.launch()
  const context = await browser.newContext()
  try {
    const page = await context.newPage()
    const viewed: string[] = []
    let leaked = false
    page.on('console', (message) => { if (message.text().includes('PRIVATE_CANARY')) leaked = true })
    page.on('pageerror', (error) => { if (error.message.includes('PRIVATE_CANARY')) leaked = true })
    page.on('websocket', (socket) => socket.on('framesent', (frame) => { if (String(frame.payload).includes('PRIVATE_CANARY')) leaked = true }))
    page.on('request', (request) => { if (request.url().endsWith('/api/telemetry/view')) viewed.push(request.url()) })
    const ready = page.waitForResponse((response) => response.url().endsWith('/api/telemetry/error') && response.request().method() === 'HEAD')
    await page.goto(`${origin}/__ui`, { waitUntil: 'domcontentloaded' })
    await ready
    const initial = page.getByRole('button', { name: 'Exercise browser error', exact: true })
    await initial.waitFor()
    const canary = page.waitForResponse((response) => response.url().endsWith('/api/telemetry/error') && response.request().method() === 'POST' && response.status() === 204)
    await page.evaluate(() => { window.setTimeout(() => { throw new Error('PRIVATE_CANARY_TIMER') }, 0) })
    await canary
    assert.equal(leaked, false)
    for (const [button, code] of [['Exercise browser error', 'BROWSER_ERROR'], ['Exercise unhandled rejection', 'UNHANDLED_REJECTION'], ['Exercise render recovery', 'RENDER_ERROR']]) {
      const report = page.waitForResponse((response) => {
        if (!response.url().endsWith('/api/telemetry/error') || response.request().method() !== 'POST') return false
        const body = response.request().postDataJSON() as { code?: string }
        return body.code === code && response.status() === 204
      })
      await page.getByRole('button', { name: button, exact: true }).click()
      await report
    }
    await page.getByRole('heading', { name: 'Something went wrong', exact: true }).waitFor()
    assert.deepEqual(viewed, [])
  } finally { await context.close(); await browser.close() }
})

test('off mode leaves recovery available without mounting browser collectors or posting records', { skip: !configured || !off }, async () => {
  const browser = await chromium.launch()
  const context = await browser.newContext()
  try {
    const page = await context.newPage()
    const posts: string[] = []
    page.on('request', (request) => { if (request.method() === 'POST' && request.url().includes('/api/telemetry/')) posts.push(request.url()) })
    await page.addInitScript(() => { window.URLSearchParams = class extends URLSearchParams { constructor() { super(); throw new Error('PRIVATE_CANARY_OFF') } } })
    const absent = page.waitForResponse((response) => response.url().endsWith('/api/telemetry/error') && response.request().method() === 'HEAD')
    await page.goto(`${origin}/sign-in`, { waitUntil: 'domcontentloaded' })
    await page.getByRole('heading', { name: 'Something went wrong', exact: true }).waitFor()
    assert.equal((await absent).status(), 404)
    await page.keyboard.press('Tab')
    assert.ok(await page.getByRole('button', { name: 'Reload', exact: true }).evaluate((element) => element === document.activeElement))
    assert.deepEqual(posts, [])
  } finally { await context.close(); await browser.close() }
})
