import assert from 'node:assert/strict'
import { test } from 'node:test'
import { accessibilityConfig } from './config.ts'
import { AnnouncementBus } from '../../src/components/accessibility/announcementContext.ts'
import { contrastRatio } from './contrast.ts'

test('AC-6 contrast measurements use the WCAG luminance extremes and reject unmeasured alpha', () => {
  assert.equal(contrastRatio('rgb(255, 255, 255)', 'rgb(0, 0, 0)'), 21)
  assert.equal(contrastRatio('rgb(255, 255, 255)', 'rgb(255, 255, 255)'), 1)
  assert.throws(() => contrastRatio('rgba(255,255,255,0.5)', 'rgb(0, 0, 0)'))
})

test('AC-7 test settings accept only explicit loopback origins and known inventories', () => {
  assert.equal(accessibilityConfig({}).base, 'http://127.0.0.1:5173')
  for (const value of ['https://example.com', 'file:///tmp/test', 'http://127.0.0.1/a', 'http://user@localhost', 'http://localhost?x=1', 'http://localhost/#x']) assert.throws(() => accessibilityConfig({ A11Y_BASE_URL: value }))
  assert.equal(accessibilityConfig({ A11Y_BASE_URL: 'https://[::1]:5173', A11Y_TARGET: 'production' }).target, 'production')
  assert.throws(() => accessibilityConfig({ A11Y_TARGET: 'staging' }))
})

test('AC-5 queues initial modal events, deduplicates ids, discards closed scopes and clears context', () => {
  const bus = new AnnouncementBus()
  const root: string[] = []
  const modal: string[] = []
  const event = { id: 'save:1', message: 'Example complete', intent: 'status' as const }
  bus.register('root', { modal: false, ready: true, queue: [], publish: (value) => root.push(value.message), clear: () => { root.length = 0 } })
  bus.register('modal', { modal: true, ready: false, queue: [], publish: (value) => modal.push(value.message), clear: () => { modal.length = 0 } })
  bus.send(event, 'modal')
  assert.deepEqual(modal, [])
  bus.ready('modal')
  assert.deepEqual(modal, ['Example complete'])
  bus.send(event, 'modal')
  assert.equal(modal.length, 1)
  bus.remove('modal')
  bus.send({ ...event, id: 'late' }, 'modal')
  assert.deepEqual(root, [])
  bus.send({ ...event, id: 'after-close' }, 'root')
  assert.deepEqual(root, ['Example complete'])
  const oldContext = bus.getVersion()
  bus.reset()
  assert.deepEqual(root, [])
  bus.send({ ...event, id: 'obsolete-completion' }, 'root', oldContext)
  assert.deepEqual(root, [], 'A completion from the old context cannot replay')
})

test('AC-5 a Strict Mode remount can deliver an event queued before its empty host was ready', () => {
  const bus = new AnnouncementBus()
  const delivered: string[] = []
  const sink = () => ({ modal: false, ready: false, queue: [], publish: (event: { message: string }) => delivered.push(event.message), clear: () => {} })
  const event = { id: 'initial', message: 'Loading example', intent: 'status' as const }
  bus.register('root', sink())
  bus.send(event, 'root')
  bus.remove('root')
  bus.register('root', sink())
  bus.send(event, 'root')
  bus.ready('root')
  assert.deepEqual(delivered, ['Loading example'])
})
