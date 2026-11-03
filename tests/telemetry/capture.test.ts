import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import express from 'express'
import { roleRoutes, routeContext } from '../../src/features/auth/contracts.ts'
import type { SessionContext } from '../../src/features/auth/contracts.ts'
import { LocalTelemetryWriter } from '../../server/telemetry/writer.ts'
import { committedEvents, errorCapture } from '../../server/telemetry/service.ts'
import { telemetryErrors } from '../../server/telemetry/errors.ts'
import { browserOrigin } from '../../server/telemetry/config.ts'
import { MemoryLimits, registerTelemetry, SeenIds } from '../../server/telemetry/router.ts'
import { inspect, summarize } from '../../server/telemetry/reader.ts'
import { encodeRecord } from '../../server/telemetry/records.ts'
import type { TelemetryRecord } from '../../server/telemetry/records.ts'
import { privateStorage } from '../../server/telemetry/private-storage.ts'

const inventory = new Set(['server/telemetry/errors.ts'])
async function setup(t: { after: (fn: () => Promise<void>) => void }, development = true) {
  const root = await mkdtemp(join(tmpdir(), 'prod-tracker-capture-'))
  const directory = join(root, '.local/telemetry')
  const writer = new LocalTelemetryWriter({ root, directory, environment: 'test', inventory })
  const telemetry = { writer, capture: errorCapture(writer, 'test', inventory), enabled: true, environment: 'test' as const, inventory }
  const app = express()
  app.use(privateStorage)
  const server = createServer(app)
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const origin = `http://127.0.0.1:${address.port}`
  const oldOrigin = process.env.TELEMETRY_ORIGIN; const oldAuth = process.env.BETTER_AUTH_URL
  process.env.TELEMETRY_ORIGIN = origin; process.env.BETTER_AUTH_URL = origin
  const api = express.Router()
  // Resolver fixtures test projection only, never substitute for real login evidence.
  const fixtureContext: SessionContext = { user: { id: 'PRIVATE_CANARY', email: 'PRIVATE_CANARY', name: 'PRIVATE_CANARY' },
    role: 'EMPLOYEE', businessId: null, unitId: null, session: { expiresAt: new Date().toISOString() }, ...routeContext('EMPLOYEE') }
  registerTelemetry(api, telemetry, { host: '127.0.0.1', port: address.port, development }, async (request) => {
    if (request.get('x-test-context') === 'unavailable') throw new Error('PRIVATE_CANARY')
    return { context: request.get('x-test-context') === 'employee' ? fixtureContext : null, headers: new Headers({ 'set-cookie': 'test-renewal=fixture; HttpOnly' }) }
  })
  if (oldOrigin === undefined) delete process.env.TELEMETRY_ORIGIN; else process.env.TELEMETRY_ORIGIN = oldOrigin
  if (oldAuth === undefined) delete process.env.BETTER_AUTH_URL; else process.env.BETTER_AUTH_URL = oldAuth
  app.use('/api', api)
  app.get('/failure', () => { throw new Error('PRIVATE_CANARY') })
  app.get('/partial', (_request, response) => { response.write('safe-prefix'); throw new Error('PRIVATE_CANARY') })
  app.use((_request, response) => response.status(404).json({ error: 'Not found' }))
  app.use(telemetryErrors(telemetry.capture))
  t.after(async () => {
    server.closeAllConnections()
    await new Promise<void>((done) => server.close(() => done()))
    await writer.shutdown()
    assert.ok(resolve(root).startsWith(join(resolve(tmpdir()), 'prod-tracker-capture-')))
    await rm(root, { recursive: true, force: true })
  })
  const post = (path: string, body: object, headers: Record<string, string> = {}) => fetch(origin + path, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })
  return { directory, writer, origin, post }
}

test('browser ingestion validates privacy, origin, body size and method without touching a database', async (t) => {
  const { post, origin, writer, directory } = await setup(t)
  const report = { id: randomUUID(), code: 'BROWSER_ERROR', locationKey: 'app' }
  assert.equal((await post('/api/telemetry/error', report)).status, 204)
  assert.equal((await post('/api/telemetry/error', report)).status, 204)
  for (const change of [{ role: 'HR_ADMIN' }, { synthetic: true }, { message: 'PRIVATE_CANARY' }, { source: 'process' }, { code: 'PROCESS_FATAL' }, { id: 'PRIVATE_CANARY' }]) assert.equal((await post('/api/telemetry/error', { ...report, ...change })).status, 400)
  assert.equal((await post('/api/telemetry/error', report, { Origin: 'null' })).status, 403)
  assert.equal((await post('/api/telemetry/error', report, { Origin: 'https://elsewhere.example' })).status, 403)
  assert.equal((await post('/api/telemetry/error', report, { 'sec-fetch-site': 'cross-site' })).status, 403)
  assert.equal((await post('/api/telemetry/error', report, { 'Content-Type': 'text/plain' })).status, 415)
  assert.equal((await post('/api/telemetry/error', { ...report, padding: 'PRIVATE_CANARY'.repeat(1000) })).status, 413)
  assert.equal((await fetch(origin + '/api/telemetry/error')).status, 405)
  assert.equal((await post('/api/telemetry/unknown', report)).status, 404)
  assert.equal((await post('/api/telemetry/error?private=1', report)).status, 400)
  assert.equal((await post('/api/telemetry/error', { ...report, id: randomUUID(), frames: [{ file: 'src/PRIVATE_CANARY.ts', line: 1 }] })).status, 204)
  await writer.flush()
  const result = await inspect(directory, inventory, { kind: 'error' })
  assert.equal(result.records.length, 2)
  assert.equal(JSON.stringify(result).includes('PRIVATE_CANARY'), false)
})

test('view adapter rejects forged context and forwards renewal cookies while recording only the resolved role', async (t) => {
  const { post, writer, directory } = await setup(t)
  const body = { id: randomUUID(), pageKey: 'employee/home' }
  assert.equal((await post('/api/telemetry/view', body)).status, 401)
  assert.equal((await post('/api/telemetry/view', body, { 'x-test-context': 'unavailable' })).status, 503)
  assert.equal((await post('/api/telemetry/view', { ...body, role: 'EMPLOYEE' }, { 'x-test-context': 'employee' })).status, 400)
  assert.equal((await post('/api/telemetry/view', { ...body, pageKey: 'hr/dashboard' }, { 'x-test-context': 'employee' })).status, 403)
  const response = await post('/api/telemetry/view', body, { 'x-test-context': 'employee' })
  assert.equal(response.status, 204)
  assert.ok(response.headers.getSetCookie().some((cookie) => cookie.startsWith('test-renewal=')))
  await post('/api/telemetry/view', body, { 'x-test-context': 'employee' })
  await writer.flush()
  const result = await inspect(directory, inventory, { kind: 'product' })
  assert.equal(result.records.length, 1)
  assert.equal(JSON.stringify(result).includes('PRIVATE_CANARY'), false)
})

test('all role page permissions agree with the existing route contract', async () => {
  const { roleCanView } = await import('../../server/telemetry/records.ts')
  for (const role of Object.keys(roleRoutes) as (keyof typeof roleRoutes)[]) {
    assert.ok(roleCanView(role, 'profile'))
    for (const route of routeContext(role).navigation) assert.ok(roleCanView(role, route.path.slice(1)))
  }
})

test('per socket limits ignore caller forwarded addresses and stop excess requests', async (t) => {
  const { post } = await setup(t)
  for (let index = 0; index < 30; index++) assert.equal((await post('/api/telemetry/error', { id: randomUUID(), code: 'BROWSER_ERROR', locationKey: 'app' }, { 'x-forwarded-for': String(index) })).status, 204)
  const response = await post('/api/telemetry/error', { id: randomUUID(), code: 'BROWSER_ERROR', locationKey: 'app' }, { 'x-forwarded-for': 'different' })
  assert.equal(response.status, 429)
  assert.equal(response.headers.get('retry-after'), '60')
})

test('limiter capacity and duplicate cache expire with a controlled clock', () => {
  const limiter = new MemoryLimits(2)
  assert.ok(limiter.take('a', 1, 0)); assert.equal(limiter.take('a', 1, 0), false)
  assert.ok(limiter.take('b', 1, 0)); assert.equal(limiter.take('c', 1, 0), false)
  assert.ok(limiter.take('c', 1, 60_001))
  const seen = new SeenIds(); const id = randomUUID()
  assert.ok(seen.accept(id, 0)); assert.equal(seen.accept(id.toUpperCase(), 1), false)
  assert.ok(seen.accept(id, 600_001))
})

test('Express failures remain sanitized both before and after response headers', async (t) => {
  const { origin, writer, directory } = await setup(t)
  const response = await fetch(origin + '/failure')
  assert.equal(response.status, 500)
  assert.deepEqual(await response.json(), { error: 'Internal server error' })
  await assert.rejects(async () => { const partial = await fetch(origin + '/partial'); await partial.text() })
  await writer.flush()
  const result = await inspect(directory, inventory, { kind: 'error' })
  assert.equal(result.records.length, 2)
  assert.equal(result.records.filter((record) => record.kind === 'error' && record.httpStatus === 500).length, 1)
  assert.equal(JSON.stringify(result).includes('PRIVATE_CANARY'), false)
})

test('development samples are explicitly synthetic and absent in production', async (t) => {
  const development = await setup(t)
  assert.equal((await development.post('/api/dev/telemetry-probe', { scenario: 'product-sample' })).status, 204)
  assert.equal((await development.post('/api/dev/telemetry-probe', { scenario: 'api-error' })).status, 500)
  await development.writer.flush()
  assert.deepEqual((await summarize(development.directory, inventory)).products, {})
  assert.equal((await inspect(development.directory, inventory, { includeSynthetic: true, kind: 'product' })).records.length, 1)
  const production = await setup(t, false)
  assert.equal((await production.post('/api/dev/telemetry-probe', { scenario: 'product-sample' })).status, 404)
})

test('post commit contracts classify the freeze boundary, omit replays, and contain no business ids', () => {
  const records: TelemetryRecord[] = []
  const emit = committedEvents((record) => { assert.ok(encodeRecord(record, inventory)); records.push(record as TelemetryRecord); return true }, 'test')
  const originalFreezesAt = new Date('2026-11-03T16:00:00.000Z')
  const decision = { newlyApplied: true, role: 'LINE_MANAGER' as const, method: 'HUMAN' as const, originalFreezesAt, decidedAt: originalFreezesAt }
  assert.ok(emit.approved(decision))
  assert.ok(emit.approved({ ...decision, decidedAt: new Date(originalFreezesAt.getTime() - 1) }))
  assert.ok(emit.approved({ ...decision, method: 'AUTOMATIC' }))
  assert.equal(emit.approved({ ...decision, newlyApplied: false }), false)
  assert.equal(emit.submitted({ newlyApplied: false, role: 'EMPLOYEE', method: 'HUMAN', submittedAt: originalFreezesAt }), false)
  assert.ok(emit.submitted({ newlyApplied: true, role: 'EMPLOYEE', method: 'HUMAN', submittedAt: originalFreezesAt }))
  assert.deepEqual(records.map((record) => record.kind === 'product' ? record.timing : undefined), ['LATE', 'ON_TIME', 'LATE', undefined])
  assert.equal(JSON.stringify(records).includes('userId'), false)
})

test('origin selection never trusts request hosts or contradictory configuration', () => {
  assert.equal(browserOrigin('127.0.0.1', 5173, {}), 'http://127.0.0.1:5173')
  assert.equal(browserOrigin('0.0.0.0', 3000, {}), null)
  assert.equal(browserOrigin('127.0.0.1', 5173, { TELEMETRY_ORIGIN: 'https://one.example', BETTER_AUTH_URL: 'https://two.example' }), null)
  for (const TELEMETRY_ORIGIN of ['https://user:password@host', 'https://host/private', 'https://host?token=private', 'null']) assert.equal(browserOrigin('127.0.0.1', 5173, { TELEMETRY_ORIGIN }), null)
})

test('private storage URLs never reach browser asset or filesystem serving', async (t) => {
  const { origin } = await setup(t)
  for (const path of ['/.local/telemetry/errors-20261102-1.jsonl', '/@fs/C:/project/.local/telemetry/events-20261102-1.jsonl?raw', '/%2elocal/telemetry/test.jsonl', '/%252elocal/telemetry/test.jsonl']) {
    const response = await fetch(origin + path)
    assert.equal(response.status, 404)
    assert.deepEqual(await response.json(), { error: 'Not found' })
  }
})

test('fatal guards suppress default exception and rejection logging and exit unsuccessfully', async () => {
  const exec = promisify(execFile)
  for (const trigger of ['throw new Error("PRIVATE_CANARY")', 'Promise.reject(new Error("PRIVATE_CANARY"))']) {
    let output = ''
    try { await exec(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `import {fatalGuard} from './server/telemetry/errors.ts'; fatalGuard(true); ${trigger}`], { timeout: 5000 })
      assert.fail('Fatal child must fail')
    } catch (error) {
      assert.ok(error && typeof error === 'object' && 'code' in error && error.code === 1 && 'stderr' in error)
      output = String(error.stderr)
    }
    assert.equal(output.includes('PRIVATE_CANARY'), false)
    assert.equal(output.trim().split('\n').length, 1)
    assert.deepEqual(JSON.parse(output), { code: 'PROCESS_FATAL', source: 'process' })
  }
})
