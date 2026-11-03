import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, readFile, rm, writeFile, readdir, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Writable } from 'node:stream'
import type { createWriteStream } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { baseRecord, encodeRecord, validRecord } from '../../server/telemetry/records.ts'
import { LocalTelemetryWriter } from '../../server/telemetry/writer.ts'
import { calendarBoundary, inspect, summarize } from '../../server/telemetry/reader.ts'
import { prepareDirectory, segments } from '../../server/telemetry/files.ts'
import { loadInventory, sanitizeFrames } from '../../server/telemetry/inventory.ts'
import { telemetryConfig } from '../../server/telemetry/config.ts'

const inventory = new Set(['src/main.tsx', 'server/index.ts'])
const at = new Date('2026-11-02T12:00:00.000Z')
function error() { return { ...baseRecord('test', false, at), kind: 'error' as const, code: 'API_INTERNAL_ERROR' as const, source: 'api' as const, locationKey: 'api' } }
function product() { return { ...baseRecord('test', false, at), kind: 'product' as const, name: 'task_approved' as const, occurredAt: at.toISOString(), role: 'LINE_MANAGER' as const, method: 'HUMAN' as const, timing: 'LATE' as const } }
async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await mkdtemp(join(tmpdir(), 'prod-tracker-telemetry-'))
  const directory = join(root, '.local/telemetry')
  const writers: LocalTelemetryWriter[] = []
  t.after(async () => {
    for (const writer of writers) await writer.shutdown()
    assert.ok(resolve(root).startsWith(join(resolve(tmpdir()), 'prod-tracker-telemetry-')))
    await rm(root, { recursive: true, force: true })
  })
  return { root, directory, writer(options: Partial<ConstructorParameters<typeof LocalTelemetryWriter>[0]> = {}) {
    const writer = new LocalTelemetryWriter({ root, directory, environment: 'test', inventory, now: () => at, stderr: { write: () => true, once() { return this } }, ...options })
    writers.push(writer)
    return writer
  } }
}

test('closed record schemas reject identities, arbitrary metadata and invalid event combinations', () => {
  assert.ok(validRecord(error(), inventory))
  assert.ok(validRecord(product(), inventory))
  for (const field of ['userId', 'taskId', 'approvalId', 'email', 'name', 'message', 'stack', 'body', 'cookie', 'ip', 'userAgent']) {
    assert.equal(encodeRecord({ ...error(), [field]: 'PRIVATE_CANARY' }, inventory), null)
  }
  for (const change of [{ id: 'person-id' }, { source: 'PRIVATE_CANARY' }, { locationKey: '/api/task/123?secret=true' }, { observedAt: 'yesterday' }, { httpStatus: 401 }, { version: 2 }]) assert.equal(validRecord({ ...error(), ...change }, inventory), false)
  for (const change of [{ role: 'EMPLOYEE' }, { pageKey: 'profile' }, { timing: 'overdue' }, { method: 'DECLINE' }, { occurredAt: '2026-02-30T00:00:00.000Z' }]) assert.equal(validRecord({ ...product(), ...change }, inventory), false)
  assert.equal(validRecord({ ...product(), name: 'workspace_viewed', method: undefined, timing: undefined, pageKey: 'employee/home' }, inventory), false)
  assert.equal(validRecord({ ...product(), name: 'workspace_viewed', method: undefined, timing: undefined, pageKey: 'line-manager/dashboard' }, inventory), true)
  assert.equal(validRecord({ ...product(), name: 'task_submitted', role: 'EMPLOYEE', method: 'AUTOMATIC', timing: undefined }, inventory), false)
})

test('frames keep only inventory identifiers and numeric positions, never raw stack text', () => {
  const frames = sanitizeFrames('Error: PRIVATE_CANARY\n    at secretFunction (C:/Users/private/repo/src/main.tsx?token=PRIVATE_CANARY:12:3)\n    at hi (https://host/PRIVATE_CANARY.ts:10:4)\n    at name (https://host/server/index.ts:24:9)', inventory)
  assert.deepEqual(frames, [{ file: 'src/main.tsx', line: 12, column: 3 }, { file: 'server/index.ts', line: 24, column: 9 }])
  assert.equal(JSON.stringify(frames).includes('PRIVATE_CANARY'), false)
  assert.equal(validRecord({ ...error(), frames: [{ file: 'src/PRIVATE_CANARY.ts', line: 1 }] }, inventory), false)
  assert.equal(validRecord({ ...error(), frames: [{ file: 'src/main.tsx', line: 0 }] }, inventory), false)
  assert.equal(validRecord({ ...error(), frames: Array(11).fill({ file: 'src/main.tsx', line: 1 }) }, inventory), false)
})

test('source inventory excludes generated clients and links', async (t) => {
  const { root } = await fixture(t)
  await mkdir(join(root, 'src/generated'), { recursive: true })
  await writeFile(join(root, 'src/main.tsx'), '')
  await writeFile(join(root, 'src/generated/secret.ts'), '')
  assert.deepEqual([...await loadInventory(root)], ['src/main.tsx'])
})

test('readers retain historical error categories when an old bundle location is no longer known', async (t) => {
  const { root, directory } = await fixture(t)
  await prepareDirectory(root, directory, true)
  await writeFile(join(directory, 'errors-20261102-1.jsonl'), `${JSON.stringify({ ...error(), frames: [{ file: 'dist/assets/previous-build.js', line: 12 }] })}\n`)
  const result = await inspect(directory, inventory)
  assert.equal(result.malformed, 0)
  assert.equal(result.records.length, 1)
  assert.equal(result.records[0].kind, 'error')
  assert.deepEqual('frames' in result.records[0] ? result.records[0].frames : undefined, [])
})

test('writer separates streams, persists valid lines and rejects private input before serialization', async (t) => {
  const { directory, writer } = await fixture(t)
  const sink = writer()
  const failure = error(); const approval = product()
  assert.equal(sink.offer(failure), true)
  assert.equal(sink.offer(approval), true)
  assert.equal(sink.offer({ ...failure, email: 'PRIVATE_CANARY' }), false)
  assert.equal(await sink.flush(), true)
  const files = await segments(directory)
  assert.ok(files.some((file) => file.family === 'errors'))
  assert.ok(files.some((file) => file.family === 'events'))
  const output = (await Promise.all(files.map((file) => readFile(file.path, 'utf8')))).join('')
  assert.equal(output.includes('PRIVATE_CANARY'), false)
  assert.equal(sink.counters.invalid, 1)
  assert.equal(sink.counters.written, 2)
  assert.equal((await summarize(directory, inventory)).matched, 3)
})

test('restart chooses a new segment and readers expose partial trailing lines', async (t) => {
  const { directory, writer } = await fixture(t)
  const first = writer()
  first.offer(error()); await first.shutdown()
  const files = await segments(directory)
  const path = files.find((file) => file.family === 'errors')!.path
  const original = await readFile(path, 'utf8')
  await writeFile(path, `${original}{"message":"PRIVATE_CANARY`)
  const second = writer()
  second.offer(error()); await second.shutdown()
  assert.ok((await segments(directory)).some((file) => file.number === 2))
  const result = await inspect(directory, inventory)
  assert.equal(result.incomplete, 1)
  assert.equal(JSON.stringify(result).includes('PRIVATE_CANARY'), false)
})

test('daily and size rotation, retention and total cap preserve unrelated files', async (t) => {
  const { root, directory, writer } = await fixture(t)
  await prepareDirectory(root, directory, true)
  await writeFile(join(directory, 'errors-20260901-1.jsonl'), 'old')
  await writeFile(join(directory, 'events-20261101-1.jsonl'), 'x'.repeat(1000))
  await writeFile(join(directory, 'keep.txt'), 'unrelated')
  await writeFile(join(directory, 'errors-20260230-1.jsonl'), 'invalid date')
  let time = at
  const sink = writer({ now: () => time, limits: { segmentBytes: 900, totalBytes: 1800 } })
  for (let index = 0; index < 5; index++) { sink.offer(error()); await sink.flush() }
  assert.ok((await segments(directory)).length >= 2)
  assert.ok((await segments(directory)).reduce((sum, file) => sum + file.size, 0) <= 1800)
  time = new Date('2026-12-04T00:00:00.000Z')
  sink.offer({ ...error(), observedAt: time.toISOString() }); await sink.flush()
  assert.ok((await segments(directory)).every((file) => file.day === '2026-12-04'))
  assert.equal(await readFile(join(directory, 'keep.txt'), 'utf8'), 'unrelated')
  assert.equal(await readFile(join(directory, 'errors-20260230-1.jsonl'), 'utf8'), 'invalid date')
})

test('queue remains bounded under backpressure and shutdown has a fixed deadline', async (t) => {
  const { writer } = await fixture(t)
  let release: (() => void) | undefined
  const blocked = new Writable({ highWaterMark: 1, write(_chunk, _encoding, done) { release = done } })
  const sink = writer({ openStream: (() => blocked) as unknown as typeof createWriteStream })
  for (let index = 0; index < 400; index++) sink.offer(error())
  assert.equal(sink.counters.queueDepth, 256)
  assert.equal(sink.counters.dropped, 144)
  const start = Date.now()
  assert.equal(await sink.shutdown(40), false)
  assert.ok(Date.now() - start < 500)
  assert.equal(sink.counters.queueDepth, 0)
  assert.equal(sink.counters.dropped, 400)
  release?.()
})

test('backpressure preserves the order of accepted records without concurrent stream writes', async (t) => {
  const { writer } = await fixture(t)
  const ids: string[] = []; const written: string[] = []
  let inFlight = 0; let maximum = 0
  const stream = new Writable({ highWaterMark: 1, write(chunk: Buffer, _encoding, done) {
    inFlight++; maximum = Math.max(maximum, inFlight)
    const record = JSON.parse(chunk.toString('utf8')) as { kind: string; id: string }
    if (record.kind === 'error') written.push(record.id)
    setImmediate(() => { inFlight--; done() })
  } })
  const sink = writer({ openStream: (() => stream) as unknown as typeof createWriteStream })
  for (let index = 0; index < 10; index++) { const record = error(); ids.push(record.id); sink.offer(record) }
  assert.equal(await sink.flush(), true)
  assert.deepEqual(written, ids)
  assert.equal(maximum, 1)
})

test('stderr diagnostics respect both the minute interval and terminal backpressure', async (t) => {
  const { writer } = await fixture(t)
  let time = at; let lines = 0; let drain: (() => void) | undefined
  const sink = writer({ now: () => time, stderr: { write() { lines++; return false }, once(_event, listener) { drain = listener } } })
  sink.offer({ private: 'PRIVATE_CANARY' })
  time = new Date(at.getTime() + 61_000)
  for (let index = 0; index < 100; index++) sink.offer({ private: 'PRIVATE_CANARY' })
  assert.equal(lines, 1)
  drain?.()
  sink.offer({ private: 'PRIVATE_CANARY' })
  assert.equal(lines, 2)
})

test('disk failures stay out of callers, pause retries and emit sanitized bounded diagnostics', async (t) => {
  const { writer } = await fixture(t)
  let attempts = 0; let diagnostics = ''; let time = at
  const sink = writer({ now: () => time, openStream: (() => {
    attempts++
    return new Writable({ write(_chunk, _encoding, done) { done(new Error('PRIVATE_CANARY')) } })
  }) as unknown as typeof createWriteStream,
  stderr: { write(text: string | Uint8Array) { diagnostics += String(text); return true }, once() { return this } } })
  assert.doesNotThrow(() => sink.offer(error()))
  await sink.flush(50)
  assert.equal(attempts, 1)
  assert.equal(sink.counters.writeFailures, 1)
  for (let index = 0; index < 10; index++) sink.offer(error())
  await sink.flush(20)
  assert.equal(attempts, 1)
  time = new Date(at.getTime() + 1100)
  sink.offer(error()); await sink.flush(50)
  assert.equal(attempts, 2)
  assert.equal(diagnostics.includes('PRIVATE_CANARY'), false)
  assert.equal(diagnostics.trim().split('\n').length, 1)
})

test('invalid directory cannot escape root or traverse a junction', async (t) => {
  const { root, directory } = await fixture(t)
  await assert.rejects(prepareDirectory(root, join(root, '..', 'escaped'), true))
  await mkdir(join(root, 'target'))
  await symlink(join(root, 'target'), join(root, '.local'), 'junction')
  await assert.rejects(prepareDirectory(root, directory, true))
  assert.deepEqual(await readdir(join(root, 'target')), [])
})

test('off mode runs retention without creating a new directory or files', async (t) => {
  const { root, directory, writer } = await fixture(t)
  const sink = writer({ enabled: false })
  assert.equal(sink.offer(error()), false)
  await sink.shutdown()
  assert.deepEqual(await readdir(root), [])
  await prepareDirectory(root, directory, true)
  await writeFile(join(directory, 'errors-20260101-1.jsonl'), 'expired')
  const second = writer({ enabled: false })
  await second.flush(); await second.shutdown()
  assert.deepEqual(await readdir(directory), [])
})

test('readers deduplicate ids, exclude synthetic events and filter product occurrence times in Lagos', async (t) => {
  const { root, directory } = await fixture(t)
  await prepareDirectory(root, directory, true)
  const approval = { ...product(), occurredAt: '2026-11-01T23:00:00.000Z' }
  const fake = { ...product(), id: randomUUID(), synthetic: true }
  await writeFile(join(directory, 'events-20261102-1.jsonl'), `${JSON.stringify(approval)}\n${JSON.stringify(approval)}\n${JSON.stringify(fake)}\ninvalid PRIVATE_CANARY\n${'x'.repeat(100_000)}\npartial`)
  const result = await summarize(directory, inventory, { from: calendarBoundary('2026-11-02'), to: calendarBoundary('2026-11-03') })
  assert.equal(result.matched, 1)
  assert.equal(result.duplicates, 1)
  assert.equal(result.malformed, 2)
  assert.equal(result.incomplete, 1)
  assert.equal(result.earliest, approval.occurredAt)
  assert.equal(result.products['task_approved/LINE_MANAGER/HUMAN/LATE'], 1)
  assert.equal((await summarize(directory, inventory, { includeSynthetic: true })).matched, 2)
  assert.equal((await inspect(directory, inventory, {}, 1)).records.length, 1)
  assert.equal(JSON.stringify(result).includes('PRIVATE_CANARY'), false)
  assert.throws(() => calendarBoundary('2026-02-30'))
  await assert.rejects(inspect(directory, inventory, {}, 501))
})

test('configuration rejects unsupported modes and environments without inventing a label', () => {
  assert.deepEqual(telemetryConfig({}, true), { enabled: true, valid: true, environment: 'development' })
  assert.deepEqual(telemetryConfig({ TELEMETRY_MODE: 'off' }), { enabled: false, valid: true, environment: 'production' })
  assert.deepEqual(telemetryConfig({ TELEMETRY_ENV: 'PRIVATE_CANARY' }), { enabled: false, valid: false, environment: null })
})
