import type { PrismaClient } from '../../src/generated/prisma/client.ts'
import type { SessionContext } from '../../src/features/auth/contracts.ts'
import type { UnreadPage, UnreadSummary } from '../../src/features/notifications/contracts.ts'
import { owner } from '../auth/owner-write.ts'
import { notificationEvent, readableMessage } from './events.ts'

const pageSize = 25
export const availableUnread = (recipientId: string, at: Date) => ({ recipientId, readAt: null, createdAt: { lte: at } })

export function readUnread(db: PrismaClient, context: SessionContext, sessionId: string, page: number | null): Promise<UnreadSummary | UnreadPage> {
  return db.$transaction(async (tx) => {
    const { userId, at: asOf } = await owner(tx, { context, sessionId })
    const where = availableUnread(userId, asOf)
    const unreadCount = await tx.notification.count({ where })
    const summary = { asOf: asOf.toISOString(), unreadCount }
    if (page === null) return summary
    const totalPages = Math.ceil(unreadCount / pageSize)
    const rows = page > totalPages ? [] : await tx.notification.findMany({
      where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * pageSize, take: pageSize,
      select: { id: true, kind: true, title: true, body: true, createdAt: true },
    })
    return {
      ...summary, page, pageSize, total: unreadCount, totalPages,
      items: rows.map((row) => {
        const valid = readableMessage(row.title, row.body)
        return {
          id: row.id, kind: row.kind, createdAt: row.createdAt.toISOString(),
          title: valid ? row.title : 'Notification unavailable',
          body: valid ? row.body : 'This message could not be displayed.',
          icon: valid ? notificationEvent(row.kind)?.icon ?? 'generic' : 'generic',
        }
      }),
    }
  }, { isolationLevel: 'RepeatableRead', maxWait: 5000, timeout: 15000 })
}
