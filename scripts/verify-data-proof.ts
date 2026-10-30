import 'dotenv/config'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createServer, request as httpRequest } from 'node:http'
import express from 'express'
import { readConfig } from '../server/config.ts'
import { createDatabase } from '../server/db.ts'
import { localProofConnection, proofAvailable } from '../server/data-proof/access.ts'
import { proofTaskIds, registerDataProof } from '../server/data-proof/router.ts'
import { normalizeProofText } from '../src/features/data-proof/validation.ts'
import type { Prisma, PrismaClient } from '../src/generated/prisma/client.ts'

const config = readConfig()
assert(localProofConnection(config.connectionString), 'Only a strictly local database is allowed')
const prisma = createDatabase(config.connectionString)
const taskId = proofTaskIds[0]
const path = `/api/dev/data-proof/tasks/${taskId}/comments`
let assertions = 0
const check = (value: unknown, explanation: string) => { assert(value, explanation); assertions++ }

async function service(client: PrismaClient, overrides: Partial<{ development: boolean; host: string; connectionString: string }> = {}) {
  const localConfig = { ...config, development: true, host: '127.0.0.1', port: 0, ...overrides }
  const app = express()
  const api = express.Router()
  registerDataProof(api, client, localConfig)
  api.use((_request, response) => response.status(404).json({ error: 'Not found' }))
  app.use('/api', api)
  const server = createServer(app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert(address && typeof address !== 'string')
  localConfig.port = address.port
  const origin = `http://127.0.0.1:${address.port}`
  return { origin, close: () => new Promise<void>((resolve, reject) => { server.close((error) => error ? reject(error) : resolve()); server.closeAllConnections() }) }
}

type Result = { status: number; value: Record<string, unknown>; headers: Headers }
async function read(origin: string, resource: string, options?: RequestInit): Promise<Result> {
  // fetch can discard a supplied Host. Use a real HTTP request for Host probes.
  if (new Headers(options?.headers).has('Host')) {
    return new Promise((resolve, reject) => {
      const request = httpRequest(`${origin}${resource}`, { method: options?.method ?? 'GET', headers: Object.fromEntries(new Headers(options?.headers).entries()) }, (response) => {
        let body = ''
        response.setEncoding('utf8')
        response.on('data', (part: string) => { body += part })
        response.on('end', () => resolve({ status: response.statusCode ?? 0, value: JSON.parse(body) as Record<string, unknown>, headers: new Headers(Object.entries(response.headers).flatMap(([key, value]) => typeof value === 'string' ? [[key, value]] : [])) }))
      })
      request.on('error', reject)
      request.end(typeof options?.body === 'string' ? options.body : undefined)
    })
  }
  const response = await fetch(`${origin}${resource}`, options)
  const value = await response.json() as Record<string, unknown>
  check(response.headers.get('cache-control') === 'no-store' || response.status === 404, 'Proof responses disable caching')
  return { status: response.status, value, headers: response.headers }
}
const code = (result: Result) => (result.value.error as { code?: string } | undefined)?.code
function post(origin: string, body: unknown, headers: Record<string, string> = {}, resource = path) {
  return read(origin, resource, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })
}

const running = await service(prisma)
const { origin } = running
try {
  const beforeTask = await prisma.weeklyTask.findUniqueOrThrow({ where: { id: taskId } })
  for (const suffix of ['?host=remote.invalid', '?HOSTADDR=192.0.2.1', '?%73ervice=remote']) check(!proofAvailable({ development: true, host: '127.0.0.1', connectionString: `postgresql://local/local${suffix}` }), 'Authority outside loopback is denied')
  for (const suffix of ['?host=remote.invalid', '?HOSTADDR=192.0.2.1', '?%73ervice=remote']) check(!localProofConnection(`postgresql://localhost/local${suffix}`), 'Query connection overrides are denied')
  check(localProofConnection('postgresql://localhost/local'), 'A local connection is accepted')
  check(normalizeProofText(' 😀 ') === '😀' && normalizeProofText('\ud800') === null && normalizeProofText('a\0b') === null, 'Unicode rules are shared')

  const list = await read(origin, '/api/dev/data-proof/tasks')
  check(list.status === 200 && (list.value.items as { id: string }[])[0]?.id === taskId, 'Task list is the real allowlisted carry record')
  check(JSON.stringify(list.value).includes('2026-10-26') && !JSON.stringify(list.value).includes('@'), 'Task response has sample dates and no email')
  for (const query of ['?page=0', '?page=10001', '?page=1&page=2', '?ownerId=other', '?page=1.2', '?page=1e2']) check((await read(origin, `/api/dev/data-proof/tasks${query}`)).status === 400, 'Invalid queries are denied')
  check(((await read(origin, '/api/dev/data-proof/tasks?page=10000')).value.items as unknown[]).length === 0, 'Bounded out of range task pages are empty')

  const submissionId = randomUUID()
  const body = `<b>Feature 5 proof ${submissionId}</b> 😀`
  const attempts = await Promise.all(Array.from({ length: 8 }, () => post(origin, { submissionId: submissionId.toUpperCase(), body: `  ${body}  ` })))
  check(attempts.filter((result) => result.status === 201).length === 1 && attempts.filter((result) => result.status === 200).length === 7, 'Concurrent retries insert once and replay seven times')
  const stored = await prisma.taskComment.findUniqueOrThrow({ where: { id: `proof-comment-${submissionId}` } })
  check(stored.body === body && stored.authorId === 'person-ada-okafor' && stored.weeklyTaskId === taskId, 'Persisted normalized tuple matches fixed context')
  const times = attempts.map((result) => (result.value.comment as { createdAt: string }).createdAt)
  check(times.every((time) => time === stored.createdAt.toISOString()), 'Replays retain the original event time')
  check((await post(origin, { submissionId, body: 'different' })).status === 409, 'Conflicting retry returns 409')

  const validBoundary = await post(origin, { submissionId: randomUUID(), body: '😀'.repeat(500) })
  check(validBoundary.status === 201, '500 Unicode code points are accepted')
  const beforeInvalid = await prisma.taskComment.count()
  for (const invalid of [null, [], {}, { body: '', submissionId: randomUUID() }, { body: '  ', submissionId: randomUUID() }, { body: '😀'.repeat(501), submissionId: randomUUID() }, { body: 'x\0y', submissionId: randomUUID() }, { body: '\ud800', submissionId: randomUUID() }, { body: 4, submissionId: randomUUID() }, { body: 'text', submissionId: 'bad' }, { body: 'text', submissionId: randomUUID(), authorId: 'other' }]) check((await post(origin, invalid)).status === 400, 'Invalid body inserts nothing')
  const malformed = await read(origin, path, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{' })
  check(malformed.status === 400, 'Malformed JSON is rejected')
  check((await post(origin, { submissionId: randomUUID(), body: 'text' }, { 'Content-Type': 'text/plain' })).status === 415, 'Wrong media type is rejected')
  check((await post(origin, { submissionId: randomUUID(), body: 'x'.repeat(18000) })).status === 413, 'Oversized JSON is rejected')
  check((await read(origin, path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status === 403, 'Missing Origin write is denied')
  check((await post(origin, {}, { Origin: 'https://outside.invalid' })).status === 403, 'Cross origin writes are denied')
  check((await post(origin, {}, { 'Sec-Fetch-Site': 'cross-site' })).status === 403, 'Cross site Fetch Metadata writes are denied')
  check((await read(origin, '/api/dev/data-proof/tasks', { headers: { Host: 'outside.invalid' } })).status === 403, 'Untrusted Host is denied')
  check((await read(origin, '/api/dev/data-proof/tasks', { headers: { Host: '127.0.0.1:1' } })).status === 403, 'Wrong Host port is denied')
  check((await read(origin, '/api/dev/data-proof/tasks', { headers: { Origin: 'https://outside.invalid' } })).status === 403, 'Cross origin reads are denied')
  check((await read(origin, '/api/dev/data-proof/tasks', { headers: { 'X-Forwarded-Host': 'outside.invalid', 'X-Forwarded-For': '192.0.2.1' } })).status === 200, 'Forwarded headers do not replace the actual local peer or Host')
  check((await read(origin, path.replace(taskId, 'somebody-else'))).status === 404, 'Outside scope task is not found')
  check((await read(origin, path.replace(taskId, 'bad%20identifier'))).status === 400, 'Malformed identifier is rejected')
  const unsupported = await read(origin, path, { method: 'PUT' })
  check(unsupported.status === 405 && unsupported.headers.get('allow') === 'GET, HEAD, POST', 'Known resource methods return Allow')
  const unknown = await read(origin, '/api/dev/data-proof/unknown')
  check(unknown.status === 404 && code(unknown) === 'NOT_FOUND', 'Unknown proof resource uses its documented envelope')
  check(await prisma.taskComment.count() === beforeInvalid, 'No invalid, scope or origin probe inserted a row')

  const needed = Math.max(0, 21 - await prisma.taskComment.count({ where: { weeklyTaskId: taskId } }))
  for (let index = 0; index < needed; index++) check((await post(origin, { submissionId: randomUUID(), body: `Feature 5 pagination probe ${index + 1}` })).status === 201, 'Pagination probe is persisted through HTTP')
  const first = await read(origin, `${path}?page=1`)
  const second = await read(origin, `${path}?page=2`)
  check((first.value.items as unknown[]).length === 20 && first.value.hasMore === true && (second.value.items as unknown[]).length >= 1, 'Comment pages come from a 21 row database probe')
  check((await read(origin, `${path}?page=10000`)).value.hasMore === false, 'Empty comment page has no next page')
  check(JSON.stringify(await prisma.weeklyTask.findUniqueOrThrow({ where: { id: taskId } })) === JSON.stringify(beforeTask), 'Posting leaves the task and its timestamps unchanged')

  // Exercise fixture failures on the real database in a rollback transaction.
  const rollback = new Error('rollback data proof fixture probes')
  await assert.rejects(prisma.$transaction(async (tx) => {
    const transactionClient = { $transaction: (work: (client: Prisma.TransactionClient) => Promise<unknown>) => work(tx) } as unknown as PrismaClient
    const isolated = await service(transactionClient)
    try {
      await tx.user.update({ where: { id: 'person-ada-okafor' }, data: { accountStatus: 'INACTIVE' } })
      const inactive = await read(isolated.origin, '/api/dev/data-proof/tasks')
      check(inactive.status === 503 && code(inactive) === 'FIXTURES_UNAVAILABLE', 'Inactive fixed actor fails closed')
      await tx.user.update({ where: { id: 'person-ada-okafor' }, data: { accountStatus: 'ACTIVE' } })
      await tx.weeklyTracker.update({ where: { id: 'tracker-ada-okafor-2026-10-26' }, data: { id: 'proof-temporary-tracker' } })
      check(code(await read(isolated.origin, '/api/dev/data-proof/tasks')) === 'FIXTURES_UNAVAILABLE', 'Missing fixed tracker fails closed')
      await tx.weeklyTracker.update({ where: { id: 'proof-temporary-tracker' }, data: { id: 'tracker-ada-okafor-2026-10-26' } })
      await tx.workWeek.update({ where: { id: 'week-2026-10-26' }, data: { id: 'proof-temporary-week' } })
      check(code(await read(isolated.origin, '/api/dev/data-proof/tasks')) === 'FIXTURES_UNAVAILABLE', 'Missing fixed week fails closed')
      await tx.workWeek.update({ where: { id: 'proof-temporary-week' }, data: { id: 'week-2026-10-26', startsOn: new Date('2025-10-27T00:00:00Z') } })
      check(code(await read(isolated.origin, '/api/dev/data-proof/tasks')) === 'FIXTURES_UNAVAILABLE', 'Mismatched stored week date fails closed')
      await tx.workWeek.update({ where: { id: 'week-2026-10-26' }, data: { startsOn: new Date('2026-10-26T00:00:00Z') } })
      await tx.workWeek.create({ data: { id: 'proof-other-week', startsOn: new Date('2025-10-27T00:00:00Z'), planningLocksAt: new Date('2025-10-28T13:00:00Z'), freezesAt: new Date('2025-10-31T23:00:00Z') } })
      await tx.weeklyTracker.update({ where: { id: 'tracker-ada-okafor-2026-10-26' }, data: { weekId: 'proof-other-week' } })
      check(code(await read(isolated.origin, '/api/dev/data-proof/tasks')) === 'FIXTURES_UNAVAILABLE', 'A fixed tracker assigned to another week fails closed')
      await tx.weeklyTracker.update({ where: { id: 'tracker-ada-okafor-2026-10-26' }, data: { weekId: 'week-2026-10-26' } })
      await tx.weeklyTask.update({ where: { id: taskId }, data: { deletedAt: new Date() } })
      check((await read(isolated.origin, path)).status === 404, 'Hidden allowlisted task is not found')
      const empty = await read(isolated.origin, '/api/dev/data-proof/tasks')
      check(empty.status === 200 && (empty.value.items as unknown[]).length === 0, 'Valid context with hidden task gives an empty list')
    } finally { await isolated.close() }
    throw rollback
  }, { timeout: 5000, maxWait: 5000 }), (error: unknown) => error === rollback)
  check((await prisma.user.findUniqueOrThrow({ where: { id: 'person-ada-okafor' } })).accountStatus === 'ACTIVE' && (await prisma.weeklyTask.findUniqueOrThrow({ where: { id: taskId } })).deletedAt === null, 'Fixture probes rolled back')

  for (const overrides of [{ development: false }, { host: '0.0.0.0' }, { connectionString: 'postgresql://remote.invalid/database' }, { connectionString: 'postgresql://localhost/database?HOST=remote.invalid' }]) {
    const omitted = await service(prisma, overrides)
    try {
      const result = await read(omitted.origin, '/api/dev/data-proof/tasks')
      check(result.status === 404 && result.value.error === 'Not found', 'Unsafe or production configuration omits proof routes without connecting elsewhere')
    } finally { await omitted.close() }
  }
  console.info(JSON.stringify({ assertions, persistedProofComment: stored.id, createdAt: stored.createdAt.toISOString(), retained: true }))
} finally { await running.close(); await prisma.$disconnect() }
