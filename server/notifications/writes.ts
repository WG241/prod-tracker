import { createHash } from 'node:crypto'
import type { Prisma, PrismaClient } from '../../src/generated/prisma/client.ts'
import type { BatchReadResult, ReadCommand, ReadResult, SingleReadResult } from '../../src/features/notifications/contracts.ts'
import { AccountFailure } from '../account/validation.ts'
import { AuthFailure } from '../auth/errors.ts'
import { lockOwner, owner, withKnownRollbackRetry } from '../auth/owner-write.ts'
import type { Actor } from '../auth/owner-write.ts'
import { availableUnread } from './reads.ts'
import { resolveTarget } from './targets.ts'

const notFound = () => new AccountFailure('NOT_FOUND', 404, 'This notification is unavailable.')
const unavailable = () => new AuthFailure('SERVICE_UNAVAILABLE', 503)

function validDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function receipt(value: Prisma.JsonValue, requestId: string, command: ReadCommand) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 1 || value.requestId !== requestId
    || value.operation !== command.operation || !validDate(value.appliedAt) || typeof value.changed !== 'boolean') throw unavailable()
  const common = { version: 1 as const, requestId, appliedAt: value.appliedAt, changed: value.changed, replayed: true }
  if (command.operation === 'NOTIFICATION_READ') {
    if (value.notificationId !== command.notificationId || !validDate(value.readAt)
      || (value.changed && value.readAt !== value.appliedAt)) throw unavailable()
    return { ...common, ...command, readAt: value.readAt } satisfies SingleReadResult['result']
  }
  const count = value.changedCount
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0 || value.changed !== (count > 0)) throw unavailable()
  return { ...common, ...command, changedCount: count } satisfies BatchReadResult['result']
}

export function markRead(db: PrismaClient, actor: Actor, requestId: string, command: ReadCommand): Promise<ReadResult> {
  const { operation } = command
  const id = command.operation === 'NOTIFICATION_READ' ? command.notificationId : null
  const requestHash = createHash('sha256').update(JSON.stringify(command)).digest('hex')
  return withKnownRollbackRetry(db, async (tx) => {
    await lockOwner(tx, actor, 'notification')
    const { userId, at } = await owner(tx, actor)
    const where = availableUnread(userId, at)
    const previous = await tx.sharedMutationReceipt.findUnique({ where: { userId_requestId: { userId, requestId } } })
    if (previous && (previous.operation !== operation || previous.requestHash !== requestHash || previous.targetNotificationId !== id)) {
      throw new AccountFailure('KEY_CONFLICT', 409, 'This request was already used for a different change.')
    }
    const stored = previous ? receipt(previous.result, requestId, command) : null
    const common = { version: 1 as const, requestId, appliedAt: at.toISOString(), replayed: false }
    if (id !== null) {
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Notification" WHERE id=${id} AND "recipientId"=${userId} AND "createdAt"<=${at} FOR UPDATE`
      if (!locked.length) throw notFound()
      const row = await tx.notification.findUniqueOrThrow({ where: { id_recipientId: { id, recipientId: userId } } })
      const target = await resolveTarget(tx, actor.context, row, at)
      if (stored && stored.operation !== 'NOTIFICATION_READ') throw unavailable()
      const result = stored ?? { ...common, operation: 'NOTIFICATION_READ', notificationId: id,
        changed: row.readAt === null, readAt: (row.readAt ?? at).toISOString() } satisfies SingleReadResult['result']
      if (!stored) {
        if (result.changed) await tx.notification.update({ where: { id_recipientId: { id, recipientId: userId } }, data: { readAt: at } })
        await tx.sharedMutationReceipt.create({ data: { userId, requestId, operation, requestHash, result, targetNotificationId: id, createdAt: at } })
      }
      return { result, unreadCount: await tx.notification.count({ where }), target }
    }
    if (stored && stored.operation !== 'NOTIFICATIONS_READ_ALL') throw unavailable()
    let result = stored
    if (!result) {
      await tx.$queryRaw`SELECT id FROM "Notification" WHERE "recipientId"=${userId} AND "readAt" IS NULL AND "createdAt"<=${at} ORDER BY id FOR UPDATE`
      const { count } = await tx.notification.updateMany({ where, data: { readAt: at } })
      result = { ...common, operation: 'NOTIFICATIONS_READ_ALL', changed: count > 0, changedCount: count }
      await tx.sharedMutationReceipt.create({ data: { userId, requestId, operation, requestHash, result, createdAt: at } })
    }
    return { result, unreadCount: await tx.notification.count({ where }) }
  })
}
