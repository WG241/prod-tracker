import { randomUUID } from 'node:crypto'
import type { Notification, Prisma } from '../../src/generated/prisma/client.ts'
import { databaseClock } from '../db.ts'
import { canonicalMailbox, destinationFor, readEmailConfig } from './config.ts'
import { composeMessage, payloadHash } from './message.ts'
import { recipientRefusal } from './policy.ts'
import type { RecipientBasis } from './policy.ts'

export async function enqueueEmail(tx: Prisma.TransactionClient, notice: Notification, basis: RecipientBasis) {
  // The producer holds recipient and domain locks. Read fresh database time
  // independently of the business event's calendar or injected test clock.
  const person = await tx.user.findUniqueOrThrow({ where: { id: notice.recipientId }, select: { email: true } })
  const enqueuedAt = await databaseClock(tx)
  const recipientEmail = person.email.trim().toLowerCase()
  const config = readEmailConfig()
  const id = randomUUID()
  const base = { id, notificationId: notice.id, recipientEmail, recipientBasis: basis, enqueuedAt, scheduledAt: enqueuedAt }
  const create = (data: Omit<Prisma.EmailDeliveryUncheckedCreateInput, keyof typeof base>) => tx.emailDelivery.create({ data: { ...base, ...data }, select: { id: true } })
  if (config.mode === 'off') return create({ state: 'SUPPRESSED', failureCode: 'MAIL_DISABLED' })
  if (config.mode === 'invalid') return create({ state: 'FAILED', failureCode: 'MAIL_CONFIGURATION_INVALID' })
  if (!canonicalMailbox(recipientEmail)) return create({ state: 'SUPPRESSED', failureCode: 'RECIPIENT_UNAVAILABLE' })
  const refusal = await recipientRefusal(tx, notice, basis, recipientEmail, enqueuedAt)
  if (refusal || !destinationFor(config, recipientEmail)) return create({ state: 'SUPPRESSED', failureCode: refusal ?? 'DOMAIN_NOT_ALLOWED' })
  const message = composeMessage(config, recipientEmail, notice)
  if (!message) return create({ state: 'FAILED', failureCode: 'MESSAGE_INVALID' })
  const preview = config.mode === 'preview'
  return create({ state: 'QUEUED', transportMode: config.mode, provider: preview ? 'preview' : 'resend', transportRevision: config.revision,
    providerKey: preview ? null : `workforce/email/v1/${id}`, messageSnapshot: message, payloadHash: payloadHash(message) })
}
