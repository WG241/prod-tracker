import 'dotenv/config'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { link, mkdtemp, readFile, rmdir, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout } from 'node:timers/promises'
import { after, test } from 'node:test'
import type { PrismaClient } from '../../src/generated/prisma/client.ts'
import { authTestDatabase } from '../../server/auth/config.ts'
import { createDatabase } from '../../server/db.ts'
import { readEmailConfig } from '../../server/email/config.ts'
import { composeMessage, payloadHash } from '../../server/email/message.ts'
import { persistPreview } from '../../server/email/preview.ts'
import { claimEmail, retryFailedEmail, settleEmail, stillDispatchable } from '../../server/email/queue.ts'
import { sendResend } from '../../server/email/resend.ts'
import { startEmailWorker } from '../../server/email/worker.ts'
import { recordLeaveEvent, recordPasswordChanged } from '../../server/notifications/events.ts'

const db = createDatabase(authTestDatabase(process.env.TEST_DATABASE_URL, process.env.DATABASE_URL))
const previewEnv = { EMAIL_MODE: 'preview', EMAIL_FROM: 'notices@example.invalid', BETTER_AUTH_URL: 'http://127.0.0.1:3001' }
const preview = readEmailConfig(previewEnv)
const externalEnv = { EMAIL_MODE: 'catch-all', EMAIL_FROM: 'notifications@workforcegroup.com', EMAIL_CATCH_ALL_TO: 'delivered@resend.dev',
  EMAIL_TRANSPORT_REVISION: 'test-revision', RESEND_API_KEY: 're_test_key_for_injected_transport', BETTER_AUTH_URL: previewEnv.BETTER_AUTH_URL }
const catchAll = readEmailConfig(externalEnv)
assert.equal(preview.mode, 'preview')
assert.equal(catchAll.mode, 'catch-all')
const people: string[] = []
after(async () => {
  await db.user.updateMany({ where: { id: { in: people } }, data: { accountStatus: 'INACTIVE', deactivatedAt: new Date() } })
  await db.$disconnect()
})

async function owner() {
  const id = `email-test-${randomUUID()}`
  const person = await db.user.create({ data: { id, name: 'Email verification', email: `${id}@example.invalid`, accountStatus: 'ACTIVE', emailRemindersEnabled: false } })
  people.push(id)
  return person
}

function withMailEnv<T>(values: Record<string, string>, action: () => Promise<T>) {
  const before = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]))
  Object.assign(process.env, values)
  return action().finally(() => {
    for (const [key, value] of Object.entries(before)) if (value === undefined) delete process.env[key]; else process.env[key] = value
  })
}

test('safe mode boundaries, exact text and Catch-all envelope (AC-2,3)', async () => {
  assert.deepEqual(readEmailConfig({}), { mode: 'off' })
  const live = { ...externalEnv, EMAIL_MODE: 'live', EMAIL_LIVE_ENABLED: 'true', EMAIL_LIVE_ALLOWED_DOMAINS: 'workforcegroup.com', NODE_ENV: 'production', BETTER_AUTH_URL: 'https://workforcegroup.com' }
  assert.equal(readEmailConfig(live).mode, 'invalid')
  assert.equal(readEmailConfig({ ...live, EMAIL_CATCH_ALL_TO: '', BETTER_AUTH_URL: 'https://127.0.0.1' }).mode, 'invalid')
  assert.equal(readEmailConfig({ ...live, EMAIL_CATCH_ALL_TO: '', EMAIL_LIVE_ALLOWED_DOMAINS: '*' }).mode, 'invalid')
  assert.equal(readEmailConfig({ ...live, EMAIL_CATCH_ALL_TO: '' }).mode, 'live')
  const message = composeMessage(catchAll, 'logical@example.invalid', { title: 'Notice', body: 'Exact text' })!
  assert.equal(message.text, `Notice\n\nExact text\n\nOpen Workforce: ${previewEnv.BETTER_AUTH_URL}/\n`)
  assert.equal(message.to, 'delivered@resend.dev')
  assert.equal(composeMessage(catchAll, 'logical@example.invalid', { title: 'Bad\r\nHeader', body: 'Text' }), null)
  let sent = false
  const outcome = await sendResend(catchAll.apiKey, 'workforce/email/v1/fixture', message, async (url, init) => {
    sent = true
    assert.equal(url, 'https://api.resend.com/emails')
    assert.deepEqual(JSON.parse(String(init?.body)), { from: `Workforce <${externalEnv.EMAIL_FROM}>`, to: ['delivered@resend.dev'], subject: message.subject, text: message.text })
    assert.equal(new Headers(init?.headers).get('idempotency-key'), 'workforce/email/v1/fixture')
    return Response.json({ id: 'provider-fixture' })
  })
  assert.equal(sent, true)
  assert.deepEqual(outcome, { kind: 'accepted', id: 'provider-fixture' })
  assert.deepEqual(await sendResend(catchAll.apiKey, 'key', message, async () => { throw new Error('timeout') }), { kind: 'unknown', code: 'ACCEPTANCE_UNKNOWN' })
  assert.deepEqual(await sendResend(catchAll.apiKey, 'key', message, async () => new Response(null, { status: 429, headers: { 'retry-after': '90' } })), { kind: 'retry', code: 'PROVIDER_RETRY', delayMs: 90000 })
})

test('outbox is atomic, Off records suppression, and existing messages are never filled in (AC-1,2,10)', async () => {
  const person = await owner(), at = new Date(), key = randomUUID()
  const event = () => db.$transaction((tx) => recordPasswordChanged(tx, person.id, key, at))
  const id = await withMailEnv({ EMAIL_MODE: 'off' }, event)
  assert.equal(await withMailEnv(previewEnv, event), id)
  const outbox = await db.emailDelivery.findUniqueOrThrow({ where: { notificationId: id } })
  assert.equal(outbox.state, 'SUPPRESSED')
  assert.equal(outbox.failureCode, 'MAIL_DISABLED')
  assert.equal(outbox.messageSnapshot, null)
  const broken = db.$extends({ query: { emailDelivery: { async create() { throw new Error('injected outbox failure') } } } }) as unknown as PrismaClient
  const before = await db.notification.count({ where: { recipientId: person.id } })
  await assert.rejects(broken.$transaction((tx) => recordPasswordChanged(tx, person.id, randomUUID(), at)))
  assert.equal(await db.notification.count({ where: { recipientId: person.id } }), before)
  const legacy = await db.notification.create({ data: { recipientId: person.id, kind: 'PASSWORD_CHANGED', title: 'Historical', body: 'History', deduplicationKey: randomUUID() } })
  assert.equal(await db.emailDelivery.findUnique({ where: { notificationId: legacy.id } }), null)
})

test('Preview claims once, preserves exact text, and only records Previewed after persistence (AC-3,4,6,7,8)', async () => {
  const person = await owner()
  const notificationId = await withMailEnv(previewEnv, () => db.$transaction((tx) => recordPasswordChanged(tx, person.id, randomUUID(), new Date())))
  const [left, right] = await Promise.all([claimEmail(db, preview), claimEmail(db, preview)])
  const claims = [left?.claim, right?.claim].filter((value) => !!value)
  assert.equal(claims.length, 1)
  const claim = claims[0]!
  assert.equal(claim.row.notificationId, notificationId)
  assert.equal(await stillDispatchable(db, claim), true)
  assert.equal(claim.row.sentAt, null)
  const root = await mkdtemp(join(tmpdir(), 'workforce-mail-'))
  const directory = join(root, '.local', 'email-preview')
  const artifact = join(directory, `${claim.row.id}.json`)
  const staging = join(directory, `${claim.row.id}.${randomUUID()}.tmp`)
  try {
    await persistPreview(claim.row.id, claim.message, root)
    await link(artifact, staging)
    await persistPreview(claim.row.id, claim.message, root)
    await assert.rejects(readFile(staging), { code: 'ENOENT' })
    const content = JSON.parse(await readFile(artifact, 'utf8'))
    assert.deepEqual(content, claim.message)
    await assert.rejects(persistPreview(claim.row.id, { ...claim.message, text: 'Different' }, root))
    await settleEmail(db, { ...claim, leaseToken: randomUUID() }, { kind: 'previewed' })
    assert.equal((await db.emailDelivery.findUniqueOrThrow({ where: { id: claim.row.id } })).state, 'SENDING')
    await settleEmail(db, claim, { kind: 'previewed' })
    const row = await db.emailDelivery.findUniqueOrThrow({ where: { id: claim.row.id } })
    assert.equal(row.state, 'PREVIEWED')
    assert.equal(row.sentAt, null)
    assert.equal(await retryFailedEmail(db, row.id, preview, true), false)
  } finally {
    await unlink(staging).catch(() => {})
    await unlink(artifact).catch(() => {})
    await rmdir(directory).catch(() => {})
    await rmdir(join(root, '.local')).catch(() => {})
    await rmdir(root).catch(() => {})
  }
})

test('the persisted workflow preference controls leave mail without changing its in app notification (AC-1,4)', async () => {
  const person = await owner()
  const recipient = { id: person.id, basis: { version: 1, relationship: 'OWNER', sourceUserId: person.id } } as const
  const startsOn = new Date(`${new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)}T00:00:00.000Z`)
  const expectedReturnOn = new Date(startsOn.getTime() + 2 * 86400000)
  const record = () => withMailEnv(previewEnv, () => db.$transaction(async (tx) => {
    const row = await tx.leaveRecord.create({ data: { userId: person.id, startsOn, expectedReturnOn } })
    return recordLeaveEvent(tx, recipient, 'RECORDED', row, person.name ?? 'Staff member', new Date())
  }))
  const suppressedId = await record()
  const suppressed = await db.emailDelivery.findUniqueOrThrow({ where: { notificationId: suppressedId } })
  assert.equal(suppressed.state, 'SUPPRESSED')
  assert.equal(suppressed.failureCode, 'PREFERENCE_DISABLED')
  assert.equal((await db.notification.findUniqueOrThrow({ where: { id: suppressedId } })).readAt, null)
  await db.leaveRecord.updateMany({ where: { userId: person.id }, data: { cancelledAt: new Date(), cancelledById: person.id } })
  await db.notificationPreference.create({ data: { userId: person.id, emailRemindersEnabled: true } })
  const allowedId = await record()
  assert.equal((await db.emailDelivery.findUniqueOrThrow({ where: { notificationId: allowedId } })).state, 'QUEUED')
  await db.notificationPreference.update({ where: { userId: person.id }, data: { emailRemindersEnabled: false } })
  const result = await claimEmail(db, preview)
  assert.ok(result)
  assert.equal(result.claim, undefined)
  assert.equal((await db.emailDelivery.findUniqueOrThrow({ where: { notificationId: allowedId } })).failureCode, 'PREFERENCE_DISABLED')
})

test('expired external claim preserves the key and uncertainty through rejection (AC-5,6,7,8)', async () => {
  const person = await owner()
  const notice = await db.notification.create({ data: { recipientId: person.id, kind: 'PASSWORD_CHANGED', title: 'Password changed', body: 'Test', deduplicationKey: randomUUID() } })
  const id = randomUUID(), first = new Date(Date.now() - 180000)
  const key = `workforce/email/v1/${id}`
  const message = composeMessage(catchAll, person.email, notice)!
  const oldLease = randomUUID()
  await db.emailDelivery.create({ data: { id, notificationId: notice.id, recipientEmail: person.email,
    recipientBasis: { version: 1, relationship: 'OWNER', sourceUserId: person.id }, enqueuedAt: first, scheduledAt: first,
    messageSnapshot: message, transportMode: catchAll.mode, transportRevision: catchAll.revision, provider: 'resend', providerKey: key, payloadHash: payloadHash(message),
    firstAttemptAt: first, attemptCount: 1, lastAttemptAt: first, state: 'SENDING', leaseToken: oldLease, leaseExpiresAt: new Date(first.getTime() + 120000),
  } })
  const claim = (await claimEmail(db, catchAll))?.claim
  assert.ok(claim)
  assert.equal(claim.row.id, id)
  assert.equal(claim.row.providerKey, key)
  assert.deepEqual(claim.row.firstAttemptAt, first)
  assert.notEqual(claim.leaseToken, oldLease)
  assert.ok(claim.row.firstUncertainAt)
  await settleEmail(db, claim, { kind: 'failed', code: 'PROVIDER_REJECTED' })
  const final = await db.emailDelivery.findUniqueOrThrow({ where: { id } })
  assert.equal(final.state, 'UNCERTAIN')
  assert.deepEqual(final.firstUncertainAt, claim.row.firstUncertainAt)
  assert.equal(await retryFailedEmail(db, id, catchAll, true), false)
})

test('safe retry dry run is read only and apply records exactly one System audit (AC-9)', async () => {
  const person = await owner()
  const noticeId = await withMailEnv(previewEnv, () => db.$transaction((tx) => recordPasswordChanged(tx, person.id, randomUUID(), new Date())))
  const claim = (await claimEmail(db, preview))?.claim
  assert.equal(claim?.row.notificationId, noticeId)
  assert.ok(claim)
  assert.equal(await settleEmail(db, claim, { kind: 'failed', code: 'PREVIEW_WRITE_FAILED' }), 'EMAIL_DELIVERY_FAILED')
  assert.equal(await retryFailedEmail(db, claim.row.id, preview, false), true)
  assert.equal((await db.emailDelivery.findUniqueOrThrow({ where: { id: claim.row.id } })).state, 'FAILED')
  const results = await Promise.all([retryFailedEmail(db, claim.row.id, preview, true), retryFailedEmail(db, claim.row.id, preview, true)])
  assert.equal(results.filter(Boolean).length, 1)
  assert.equal(await db.auditEvent.count({ where: { targetType: 'EmailDelivery', targetId: claim.row.id, action: 'EMAIL_RETRY_QUEUED', actorId: null } }), 1)
  const next = (await claimEmail(db, preview))?.claim
  assert.equal(next?.row.attemptCount, 2)
  await settleEmail(db, next!, { kind: 'failed', code: 'PREVIEW_WRITE_FAILED' })
})

test('the preview worker drains more than one batch without waiting for its next poll', async () => {
  const person = await owner()
  await withMailEnv(previewEnv, async () => {
    const ids = await db.$transaction(async (tx) => {
      const queued: string[] = []
      for (let index = 0; index < 11; index++) queued.push(await recordPasswordChanged(tx, person.id, randomUUID(), new Date()))
      return queued
    })
    const deliveries = await db.emailDelivery.findMany({ where: { notificationId: { in: ids } }, select: { id: true } })
    const stop = startEmailWorker(db)
    try {
      const deadline = performance.now() + 15000
      let completed = 0
      do {
        completed = await db.emailDelivery.count({ where: { notificationId: { in: ids }, state: 'PREVIEWED' } })
        if (completed === ids.length) break
        await setTimeout(100)
      } while (performance.now() < deadline)
      assert.equal(completed, 11)
    } finally {
      await stop()
      await Promise.all(deliveries.map(({ id }) => unlink(join('.local', 'email-preview', `${id}.json`)).catch(() => {})))
    }
  })
})
