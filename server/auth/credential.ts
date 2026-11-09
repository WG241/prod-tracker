import type { Prisma } from '../../src/generated/prisma/client.ts'

export function credentialAccount(db: Prisma.TransactionClient, userId: string) {
  return db.authAccount.findFirst({
    where: { userId, providerId: 'credential', accountId: userId, password: { not: null } },
    select: { id: true, password: true, userId: true },
  })
}
