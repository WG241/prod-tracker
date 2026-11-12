import { randomUUID } from 'node:crypto'
import type { EmailDelivery, Notification, Prisma, PrismaClient } from '../../src/generated/prisma/client.ts'
import { databaseClock } from '../db.ts'
import { retryKnownRollback } from '../auth/owner-write.ts'
import type { ActiveEmailConfig, EmailConfig } from './config.ts'
import { destinationFor, readEmailConfig } from './config.ts'
import { composeMessage, payloadHash } from './message.ts'
import { lockRecipientPolicy, recipientRefusal, storedBasis } from './policy.ts'
import type { SendOutcome } from './resend.ts'

type Tx = Prisma.TransactionClient
type Delivery = EmailDelivery & { notification: Notification }
const bounds = { isolationLevel: 'ReadCommitted', maxWait: 5000, timeout: 10000 } as const
const hour = 3600000
const delay = [30000, 120000, 600000, hour]
const maximumAttempts = 5
const leaseMs = 120000

function ageDeadline(row: Delivery) {
  return row.enqueuedAt!.getTime() + (row.notification.kind === 'PASSWORD_CHANGED' ? 7 * 24 : 24) * hour
}

function retryDeadline(row: Delivery) {
  return Math.min(ageDeadline(row), row.firstAttemptAt ? row.firstAttemptAt.getTime() + 23 * hour : Infinity)
}

function messageFor(row: Delivery, config: ActiveEmailConfig) {
  const message = composeMessage(config, row.recipientEmail, row.notification)
  if (!message || row.transportMode !== config.mode || row.transportRevision !== config.revision
    || row.provider !== (config.mode === 'preview' ? 'preview' : 'resend')
    || row.providerKey !== (config.mode === 'preview' ? null : `workforce/email/v1/${row.id}`)
    || row.payloadHash !== payloadHash(message)) return null
  const saved = row.messageSnapshot
  if (!saved || typeof saved !== 'object' || Array.isArray(saved) || Object.keys(saved).length !== Object.keys(message).length
    || Object.entries(message).some(([field, value]) => saved[field] !== value)) return null
  return message
}

async function eligibility(tx: Tx, row: Delivery, config: Exclude<EmailConfig, { mode: 'off' }>) {
  const basis = storedBasis(row.recipientBasis)
  if (basis) await lockRecipientPolicy(tx, row.notification, basis)
  const at = await databaseClock(tx)
  if (!basis) return { at, reason: 'BASIS_INVALID' } as const
  if (at.getTime() >= ageDeadline(row)) return { at, reason: 'EXPIRED' } as const
  if (at.getTime() >= retryDeadline(row) || row.attemptCount >= maximumAttempts) return { at, reason: 'RETRY_EXHAUSTED' } as const
  if (config.mode === 'invalid') return { at, reason: 'MAIL_CONFIGURATION_INVALID' } as const
  if (!destinationFor(config, row.recipientEmail)) return { at, reason: 'DOMAIN_NOT_ALLOWED' } as const
  const message = messageFor(row, config)
  if (!message) return { at, reason: 'TRANSPORT_CHANGED' } as const
  const refusal = await recipientRefusal(tx, row.notification, basis, row.recipientEmail, at)
  return refusal ? { at, reason: refusal } : { at, message, config }
}

const clearLease = { leaseToken: null, leaseExpiresAt: null }
export type MailDiagnostic = 'EMAIL_DELIVERY_FAILED' | 'EMAIL_CONFIGURATION_INVALID'

function failureDiagnostic(state: string, reason: string, security: boolean): MailDiagnostic | undefined {
  if (reason === 'MAIL_CONFIGURATION_INVALID') return 'EMAIL_CONFIGURATION_INVALID'
  if (state === 'FAILED' || state === 'UNCERTAIN' || reason === 'PROVIDER_RETRY' || reason === 'ACCEPTANCE_UNKNOWN'
    || (security && reason === 'EXPIRED')) return 'EMAIL_DELIVERY_FAILED'
}

export function claimEmail(db: PrismaClient, config: Exclude<EmailConfig, { mode: 'off' }>) {
  return retryKnownRollback(() => db.$transaction(async (tx) => {
    const [pick] = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "EmailDelivery" WHERE "enqueuedAt" IS NOT NULL AND "messageSnapshot" IS NOT NULL
      AND ((state = 'QUEUED' AND "scheduledAt" <= clock_timestamp()) OR (state = 'SENDING' AND "leaseExpiresAt" <= clock_timestamp()))
      ORDER BY "scheduledAt", id LIMIT 1 FOR UPDATE SKIP LOCKED
    `
    if (!pick) return null
    let row = await tx.emailDelivery.findUniqueOrThrow({ where: { id: pick.id }, include: { notification: true } })
    if (row.state === 'SENDING') {
      const at = await databaseClock(tx)
      row = await tx.emailDelivery.update({ where: { id: pick.id }, data: {
        ...clearLease, state: 'QUEUED', scheduledAt: at,
        firstUncertainAt: row.firstUncertainAt ?? (row.provider === 'resend' ? at : null),
      }, include: { notification: true } })
    }
    const decision = await eligibility(tx, row, config)
    if (!decision.message) {
      const state = row.firstUncertainAt ? 'UNCERTAIN' : ['RETRY_EXHAUSTED', 'BASIS_INVALID', 'MAIL_CONFIGURATION_INVALID'].includes(decision.reason) ? 'FAILED' : 'SUPPRESSED'
      await tx.emailDelivery.update({ where: { id: row.id }, data: { state, failureCode: decision.reason } })
      return { diagnostic: failureDiagnostic(state, decision.reason, row.notification.kind === 'PASSWORD_CHANGED') }
    }
    const { at, message } = decision
    const leaseToken = randomUUID()
    row = await tx.emailDelivery.update({ where: { id: row.id }, data: {
      state: 'SENDING', leaseToken, leaseExpiresAt: new Date(at.getTime() + leaseMs), attemptCount: { increment: 1 }, lastAttemptAt: at,
      firstAttemptAt: row.firstAttemptAt ?? (config.mode === 'preview' ? null : at),
    }, include: { notification: true } })
    return { claim: { row, message, config: decision.config, leaseToken } }
  }, bounds))
}

export type Claim = NonNullable<NonNullable<Awaited<ReturnType<typeof claimEmail>>>['claim']>

export function dispatchConfigurationMatches({ row, config }: Claim) {
  const current = readEmailConfig()
  return current.mode !== 'off' && current.mode !== 'invalid' && !!messageFor(row, current)
    && (config.mode === 'preview' || (current.mode !== 'preview' && config.apiKey === current.apiKey))
}

export async function stillDispatchable(db: PrismaClient, { row, leaseToken }: Claim) {
  const [allowed] = await db.$queryRaw<{ ok: boolean }[]>`
    SELECT EXISTS (SELECT FROM "EmailDelivery" WHERE id=${row.id} AND state='SENDING' AND "leaseToken"=${leaseToken}::uuid
      AND "leaseExpiresAt">clock_timestamp() AND ${new Date(retryDeadline(row))}>clock_timestamp()) AS ok
  `
  return allowed.ok
}

export function settleEmail(db: PrismaClient, { row, leaseToken }: Claim, outcome: SendOutcome) {
  return db.$transaction(async (tx) => {
    const [owned] = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "EmailDelivery" WHERE id=${row.id} AND state='SENDING' AND "leaseToken"=${leaseToken}::uuid FOR UPDATE
    `
    if (!owned) return
    const at = await databaseClock(tx)
    const uncertainty = row.firstUncertainAt ?? (outcome.kind === 'unknown' ? at : null)
    let data: Prisma.EmailDeliveryUpdateManyMutationInput
    if (outcome.kind === 'accepted') data = { state: 'SENT', sentAt: at, providerMessageId: outcome.id, failureCode: null }
    else if (outcome.kind === 'previewed') data = { state: 'PREVIEWED', failureCode: null }
    else {
      const deferred = outcome.kind === 'retry' || outcome.kind === 'unknown'
      const scheduledAt = new Date(at.getTime() + Math.max(delay[row.attemptCount - 1] ?? 0, outcome.kind === 'retry' ? outcome.delayMs : 0))
      const canRetry = deferred && row.attemptCount < maximumAttempts && scheduledAt.getTime() < retryDeadline(row)
      data = canRetry ? { state: 'QUEUED', scheduledAt, failureCode: outcome.code, firstUncertainAt: uncertainty }
        : { state: uncertainty ? 'UNCERTAIN' : 'FAILED', failureCode: deferred ? 'RETRY_EXHAUSTED' : outcome.code, firstUncertainAt: uncertainty }
    }
    const changed = await tx.emailDelivery.updateMany({ where: { id: row.id, state: 'SENDING', leaseToken, leaseExpiresAt: { gt: at } }, data: { ...data, ...clearLease } })
    if (changed.count && typeof data.state === 'string' && typeof data.failureCode === 'string') return failureDiagnostic(data.state, data.failureCode, false)
  }, bounds)
}

export function retryFailedEmail(db: PrismaClient, id: string, config: EmailConfig, apply: boolean) {
  if (config.mode === 'off' || config.mode === 'invalid') return Promise.resolve(false)
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "EmailDelivery" WHERE id=${id} FOR UPDATE`
    const row = await tx.emailDelivery.findUnique({ where: { id }, include: { notification: true } })
    if (!row || row.state !== 'FAILED' || row.firstUncertainAt || !row.enqueuedAt || row.failureCode !== 'PREVIEW_WRITE_FAILED') return false
    const decision = await eligibility(tx, row, config)
    if (!decision.message) return false
    const key = `email-retry:${row.id}:${row.attemptCount}`
    if (await tx.auditEvent.findUnique({ where: { id: key }, select: { id: true } })) return false
    if (!apply) return true
    await tx.emailDelivery.update({ where: { id }, data: { state: 'QUEUED', scheduledAt: decision.at, failureCode: null } })
    await tx.auditEvent.create({ data: { id: key, action: 'EMAIL_RETRY_QUEUED', targetType: 'EmailDelivery', targetId: row.id,
      after: { attemptCount: row.attemptCount }, createdAt: decision.at } })
    return true
  }, bounds)
}
