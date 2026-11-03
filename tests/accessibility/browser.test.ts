/// <reference lib="dom" />
import 'dotenv/config'
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { chromium } from 'playwright'
import type { Browser, Page } from 'playwright'
import AxeBuilder from '@axe-core/playwright'
import axe from 'axe-core'
import { accessibilityConfig } from './config.ts'
import { developmentSurfaces, plannedSurfaces, productionSurfaces, roles } from './surfaces.ts'
import type { Surface } from './surfaces.ts'
import { contrastRatio } from './contrast.ts'

const settings = accessibilityConfig()
const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
const evidence: object[] = []
let browser: Browser
const output = `.local/verification/feature7/${settings.target}`
const spacing = '* {line-height:1.5 !important;letter-spacing:.12em !important;word-spacing:.16em !important} p {margin-block-end:2em !important}'

before(async () => {
  await mkdir(output, { recursive: true })
  const supported = new Set(axe.getRules().flatMap((rule) => rule.tags))
  for (const tag of tags) assert(supported.has(tag), `Installed axe must support ${tag}`)
  try { browser = await chromium.launch() }
  catch { throw new Error('Chromium unavailable. Run npm run test:a11y:install once, then retry.') }
  const response = await fetch(`${settings.base}/api/health`, { signal: AbortSignal.timeout(15000) })
  assert(response.status === 200 || response.status === 503, 'Start the real app before running accessibility tests')
})

after(async () => {
  const require = createRequire(import.meta.url)
  const report = JSON.stringify({
    date: new Date().toISOString(), target: settings.target, base: settings.base,
    versions: { playwright: require('playwright/package.json').version, axe: axe.version, chromium: browser?.version() },
    tags, selectedTests: process.execArgv.filter((arg) => /^--test-(?:name|skip)-pattern/.test(arg)), observations: evidence, plannedSurfaces,
    manual: { nvda: 'not tested by automation', realBrowserZoom: 'not tested by automation', incompleteRules: 'require manual review' },
  }, null, 2)
  await writeFile(`${output}/report-${new Date().toISOString().replaceAll(/[:.]/g, '-')}.json`, report)
  await writeFile(`${output}/report.json`, report)
  await browser?.close()
})

async function pageFor(run: (page: Page) => Promise<void>, width = 1280) {
  const context = await browser.newContext({ viewport: { width, height: 900 } })
  try { await run(await context.newPage()) }
  finally { await context.close() }
}

async function scan(page: Page, id: string) {
  const result = await new AxeBuilder({ page }).withTags(tags).analyze()
  const summarize = (items: typeof result.violations) => items.map((rule) => ({ id: rule.id, impact: rule.impact, targets: rule.nodes.map((node) => node.target) }))
  evidence.push({ id, url: page.url(), viewport: page.viewportSize(), violations: summarize(result.violations), incomplete: summarize(result.incomplete) })
  assert.deepEqual(summarize(result.violations), [], `${id}: all applicable A/AA violations fail regardless of impact`)
  if (id === 'components' || id === 'sign-in:desktop') {
    const advisory = await new AxeBuilder({ page }).withTags(['best-practice']).analyze()
    evidence.push({ id: `${id}:advisory`, advisory: summarize(advisory.violations), incomplete: summarize(advisory.incomplete) })
  }
}

async function assertControls(page: Page, entry: Surface) {
  for (const name of entry.expected) {
    assert(await page.getByRole('button', { name, exact: true }).isVisible(), `${entry.id}: missing required control ${name}`)
  }
}

const surfaces = settings.target === 'development' ? [...developmentSurfaces, ...productionSurfaces] : productionSurfaces
for (const entry of surfaces) {
  test(`AC-2,4,6,7,9 ${entry.id} renders its required state without normative axe violations`, async () => {
    await pageFor(async (page) => {
      await page.setViewportSize(entry.viewport)
      if (entry.mode === 'forced-colors') await page.emulateMedia({ forcedColors: 'active' })
      if (entry.mode === 'reduced-motion') await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.goto(settings.base + entry.route, { waitUntil: 'domcontentloaded' })
      if (entry.role) await page.getByLabel('Preview role').selectOption(entry.role)
      await page.getByRole('heading', { name: entry.heading, exact: true }).waitFor()
      if (entry.mode === 'spacing') await page.addStyleTag({ content: spacing })
      if (entry.open) await page.getByRole('button', { name: entry.open, exact: true }).click()
      await assertControls(page, entry)
      await scan(page, entry.id)
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${entry.id}: no horizontal page overflow`)
      if (entry.mode || entry.open || entry.viewport.width === 320) await page.screenshot({ path: `${output}/${entry.id.replaceAll(/[^a-z0-9]/gi, '_')}.png`, fullPage: true })
    })
  })
}

test('AC-7 missing required inventory controls fail explicitly rather than silently skipping', async () => {
  await pageFor(async (page) => {
    await page.goto(settings.base + '/sign-in', { waitUntil: 'domcontentloaded' })
    await assert.rejects(() => assertControls(page, { ...productionSurfaces[0], expected: ['Missing required control'] }), /missing required control/)
  })
})

test('AC-3,5 sign in validation focuses errors without duplicating field live regions', async () => {
  await pageFor(async (page) => {
    await page.goto(settings.base + '/sign-in', { waitUntil: 'domcontentloaded' })
    const email = page.getByLabel('Work email', { exact: true })
    await email.fill('invalid')
    assert.equal(await email.getAttribute('aria-invalid'), null, 'Untouched typing does not validate')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.waitForFunction(() => document.activeElement?.getAttribute('name') === 'email')
    assert.equal(await email.getAttribute('aria-invalid'), 'true')
    const description = await email.getAttribute('aria-describedby')
    assert(description)
    assert.match(await page.locator(`[id="${description}"]`).innerText(), /valid work email/)
    assert.equal(await page.locator('[role="alert"]').innerText(), '', 'Moved focus supplies its associated error')
    await email.press('Enter')
    await page.getByRole('alert').filter({ hasText: 'Work email.' }).waitFor()
    await email.fill('ada.okafor@workforcegroup.com')
    assert.equal(await email.getAttribute('aria-invalid'), null)
    await scan(page, 'sign-in:invalid')
  })
})

test('AC-3,5 temporary sign in pending preserves Enter focus and guards repeated activation', async () => {
  await pageFor(async (page) => {
    await page.goto(settings.base + '/sign-in', { waitUntil: 'domcontentloaded' })
    await page.getByLabel('Work email', { exact: true }).fill('a11y-example@workforcegroup.com')
    const password = page.getByLabel('Password', { exact: true })
    await password.fill('Example1')
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => { release = resolve })
    let requests = 0
    await page.route('**/api/auth/sign-in', async (route) => { ++requests; await gate; await route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }) })
    await password.press('Enter')
    await page.getByRole('button', { name: 'Signing in…', exact: true }).waitFor()
    assert.equal(await password.evaluate((element) => document.activeElement === element), true)
    await password.press('Enter')
    // aria-disabled is deliberately focusable; force pointer delivery to test its real activation guard.
    await page.getByRole('button', { name: 'Signing in…', exact: true }).click({ force: true })
    assert.equal(requests, 1)
    await scan(page, 'sign-in:pending')
    const focusedBeforeFailure = await page.evaluate(() => ({ tag: document.activeElement?.tagName, id: document.activeElement?.id }))
    release()
    await page.getByRole('alert').filter({ hasText: 'The service is unavailable.' }).waitFor()
    assert.deepEqual(await page.evaluate(() => ({ tag: document.activeElement?.tagName, id: document.activeElement?.id })), focusedBeforeFailure, 'Service failure retains logical focus')
    await scan(page, 'sign-in:service-error')
  })
})

if (settings.target === 'development') {
  test('AC-6 enabled field boundaries and focus have measured contrast against their actual background', async () => {
    await pageFor(async (page) => {
      await page.goto(settings.base + '/__ui', { waitUntil: 'domcontentloaded' })
      const input = page.getByRole('textbox', { name: 'Task title', exact: true })
      const pair = await input.evaluate((element) => ({ border: getComputedStyle(element).borderColor, background: getComputedStyle(element).backgroundColor }))
      const ratio = contrastRatio(pair.border, pair.background)
      evidence.push({ id: 'contrast:field-boundary', ...pair, ratio })
      assert(ratio >= 3, 'Enabled field boundaries need at least 3:1 against the field surface')
      await input.focus()
      const focus = await input.evaluate((element) => ({ foreground: getComputedStyle(element).outlineColor, background: getComputedStyle(element).backgroundColor, width: getComputedStyle(element).outlineWidth }))
      const focusRatio = contrastRatio(focus.foreground, focus.background)
      evidence.push({ id: 'contrast:field-focus', ...focus, ratio: focusRatio })
      assert(focusRatio >= 3 && parseFloat(focus.width) >= 2)
    })
  })

  test('AC-2 all role menus retain their exact order, skip link and disclosure keyboard behavior', async () => {
    for (const person of roles) await pageFor(async (page) => {
      await page.goto(settings.base + '/__ui?view=workspace', { waitUntil: 'domcontentloaded' })
      await page.getByLabel('Preview role').selectOption(person.role)
      const nav = page.getByRole('navigation', { name: 'Main navigation', exact: true })
      assert.deepEqual(await nav.getByRole('button').allTextContents(), [...person.menus])
      await page.getByRole('link', { name: 'Skip to main content' }).focus()
      await page.keyboard.press('Enter')
      assert.equal(await page.getByRole('main').evaluate((element) => document.activeElement === element), true)
      const account = page.getByRole('button', { name: `Account for ${person.name}` })
      await account.focus(); await page.keyboard.press('Space')
      await page.getByRole('button', { name: 'Profile & account', exact: true }).waitFor()
      await page.keyboard.press('Tab')
      assert.equal(await page.getByRole('button', { name: 'Profile & account', exact: true }).evaluate((element) => document.activeElement === element), true)
      await page.keyboard.press('Escape')
      assert.equal(await account.evaluate((element) => document.activeElement === element), true)
    })
  })

  test('AC-2,4 HR More gives navigation heading precedence and responsive focus stays visible', async () => {
    await pageFor(async (page) => {
      await page.goto(settings.base + '/__ui?view=workspace', { waitUntil: 'domcontentloaded' })
      await page.getByLabel('Preview role').selectOption('HR / Admin')
      await page.getByRole('navigation', { name: 'Main navigation', exact: true }).getByRole('button', { name: 'Settings', exact: true }).focus()
      await page.setViewportSize({ width: 320, height: 800 })
      await page.waitForFunction(() => document.activeElement?.textContent === 'More')
      await page.keyboard.press('Enter')
      const dialog = page.getByRole('dialog', { name: 'More from your workspace' })
      await dialog.getByRole('button', { name: 'Settings', exact: true }).click()
      await page.waitForFunction(() => document.activeElement?.tagName === 'H1' && document.activeElement.textContent === 'Settings')
      assert.equal(await dialog.isVisible(), false)
      await page.emulateMedia({ forcedColors: 'active' })
      await page.keyboard.press('Tab')
      await page.getByRole('button', { name: 'More', exact: true }).focus()
      const focused = await page.getByRole('button', { name: 'More', exact: true }).evaluate((element) => ({ width: getComputedStyle(element).outlineWidth, offset: getComputedStyle(element).outlineOffset }))
      assert(parseFloat(focused.width) >= 2 && parseFloat(focused.offset) >= 3, 'Focus remains distinct from the selected destination in forced colors')
    })
  })

  test('AC-4 dialogs keep background inert, respect initial focus and restore or fall back', async () => {
    await pageFor(async (page) => {
      await page.goto(settings.base + '/__ui', { waitUntil: 'domcontentloaded' })
      for (const opener of ['Open dialog', 'Open long dialog', 'Open drawer', 'Open long drawer', 'Open with removed opener']) {
        await page.getByRole('button', { name: opener, exact: true }).click()
        const dialog = page.getByRole('dialog')
        assert.equal(await dialog.evaluate((element) => element.matches(':modal')), true)
        assert.equal(await page.getByRole('link', { name: 'Return to workspace preview' }).isVisible(), true)
        if (opener === 'Open long dialog') assert.equal(await page.getByRole('heading', { name: 'Activity history example' }).evaluate((element) => document.activeElement === element), true)
        for (let i = 0; i < 12; i++) {
          await page.keyboard.press(i < 6 ? 'Tab' : 'Shift+Tab')
          assert.equal(await dialog.evaluate((element) => element.contains(document.activeElement)), true, 'Active modal keeps page focus inside')
        }
        await page.keyboard.press('Escape')
        assert.equal(await dialog.isVisible(), false)
        const target = opener === 'Open with removed opener' ? page.getByRole('heading', { name: 'Component preview', exact: true }) : page.getByRole('button', { name: opener, exact: true })
        assert.equal(await target.evaluate((element) => document.activeElement === element), true)
      }
    })
  })

  test('AC-3,5 example form validates only invalid fields and keeps pending focus without false save claims', async () => {
    await pageFor(async (page) => {
      await page.goto(settings.base + '/__ui', { waitUntil: 'domcontentloaded' })
      const form = page.getByRole('form', { name: 'Example task form' })
      await form.getByRole('button', { name: 'Complete example' }).click()
      const title = form.getByLabel('Example title', { exact: true })
      await page.waitForFunction(() => document.activeElement?.getAttribute('aria-invalid') === 'true')
      await title.fill('   ')
      assert.equal(await title.getAttribute('aria-invalid'), 'true')
      await title.fill('Example task')
      await form.getByLabel('Example activity').fill('Example activity')
      await title.press('Enter')
      await form.getByRole('button', { name: 'Completing example…' }).waitFor()
      assert.equal(await title.evaluate((element) => document.activeElement === element), true)
      await page.getByRole('status').filter({ hasText: 'Example complete. No task was saved.' }).waitFor()
      await scan(page, 'example:completed')
    })
  })

  test('AC-5 root and modal events deduplicate, queue opening and disappear with their context', async () => {
    await pageFor(async (page) => {
      await page.goto(settings.base + '/__ui', { waitUntil: 'domcontentloaded' })
      await page.getByRole('button', { name: 'Root status example', exact: true }).click()
      const rootStatus = page.getByRole('status').filter({ hasText: 'Root example status.' })
      await rootStatus.waitFor()
      await page.getByRole('button', { name: 'Repeat root event', exact: true }).click()
      assert.equal(await rootStatus.count(), 1)
      await page.getByRole('button', { name: 'Change example context' }).click()
      assert.equal(await rootStatus.count(), 0)
      await page.getByRole('button', { name: 'Open with immediate announcement' }).click()
      const dialog = page.getByRole('dialog')
      await dialog.getByRole('status').filter({ hasText: 'Modal example ready.' }).waitFor()
      await dialog.getByRole('button', { name: 'Modal alert example' }).click()
      await dialog.getByRole('alert').filter({ hasText: 'Modal example error.' }).waitFor()
      await page.keyboard.press('Escape')
      assert.equal(await page.getByRole('alert').filter({ hasText: 'Modal example error.' }).count(), 0)
      await page.getByRole('button', { name: 'Open dialog', exact: true }).click()
      await dialog.getByRole('button', { name: 'Close before announcement' }).click()
      assert.equal(await page.getByRole('status').filter({ hasText: 'Discard this closed modal example.' }).count(), 0)
      await page.getByRole('button', { name: 'Open dialog', exact: true }).click()
      await dialog.getByRole('button', { name: 'Complete after closing' }).click()
      await page.getByRole('status').filter({ hasText: 'Example complete after closing. No task was saved.' }).waitFor()
      assert.equal(await dialog.isVisible(), false)
    })
  })

  test('AC-6 table scrolling is local, named and keyboard operable only when necessary', async () => {
    await pageFor(async (page) => {
      await page.goto(settings.base + '/__ui', { waitUntil: 'domcontentloaded' })
      const region = page.getByRole('region', { name: 'Fictional task records', exact: true })
      assert.equal(await region.getAttribute('tabindex'), null)
      await page.setViewportSize({ width: 320, height: 800 })
      await page.waitForFunction(() => document.querySelector('[aria-label="Fictional task records"]')?.getAttribute('tabindex') === '0')
      await region.focus(); await page.keyboard.press('ArrowRight')
      await page.waitForFunction(() => (document.querySelector('[aria-label="Fictional task records"]')?.scrollLeft ?? 0) > 0)
      assert(await region.evaluate((element) => element.scrollLeft > 0))
    })
  })
}

for (const person of roles) {
  test(`AC-2,9 real authenticated ${person.role} shell, Profile and sign out`, async () => {
    assert(process.env.LOCAL_AUTH_TEST_PASSWORD, 'Configure the private fictional fixture password before real role checks')
    await pageFor(async (page) => {
      await page.goto(settings.base + '/sign-in', { waitUntil: 'domcontentloaded' })
      await page.getByLabel('Work email', { exact: true }).fill(person.email)
      await page.getByLabel('Password', { exact: true }).fill(process.env.LOCAL_AUTH_TEST_PASSWORD!)
      const response = page.waitForResponse((value) => value.url().endsWith('/api/auth/sign-in'))
      await page.getByRole('button', { name: 'Sign in', exact: true }).click()
      assert.equal((await response).status(), 200, 'Existing fictional credentials must be accepted; no role spoof is allowed')
      await page.getByRole('heading', { name: person.role === 'Employee' ? /^Good morning,/ : person.heading, exact: person.role !== 'Employee' }).waitFor()
      await scan(page, `authenticated:${person.role}`)
      await page.getByRole('button', { name: `Account for ${person.name}` }).click()
      await page.getByRole('link', { name: 'Profile & account' }).click()
      await page.getByRole('heading', { name: 'Profile', exact: true }).waitFor()
      await page.getByRole('button', { name: `Account for ${person.name}` }).click()
      await page.getByRole('button', { name: 'Sign out', exact: true }).click()
      await page.getByRole('heading', { name: 'Welcome back', exact: true }).waitFor()
    })
  })
}

if (settings.target === 'production') test('AC-9 production omits component previews and proof APIs', async () => {
  await pageFor(async (page) => {
    for (const route of ['/__ui', '/__data-proof']) {
      await page.goto(settings.base + route, { waitUntil: 'domcontentloaded' })
      await page.getByRole('heading', { name: 'Welcome back', exact: true }).waitFor()
      assert.equal(await page.getByLabel('Preview role').count(), 0)
    }
    assert.equal((await page.request.get(settings.base + '/api/dev/data-proof/tasks?page=1')).status(), 404)
  })
})
