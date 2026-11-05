import { authTestDatabase } from '../../server/auth/config.ts'
import { createDatabase } from '../../server/db.ts'
import type { Prisma } from '../../src/generated/prisma/client.ts'

// Setup only. DDL locks remain held until the enabled guards commit again.
// This module is never imported by application or operator runtime code.
export async function historicalFixtures<T>(arrange: (tx: Prisma.TransactionClient) => Promise<T>) {
  const db = createDatabase(authTestDatabase(process.env.TEST_DATABASE_URL, process.env.DATABASE_URL))
  try {
    return await db.$transaction(async (tx) => {
      await tx.$executeRaw`LOCK TABLE "EmploymentAssignment", "LeaveRecord" IN ACCESS EXCLUSIVE MODE`
      await tx.$executeRaw`ALTER TABLE "EmploymentAssignment" DISABLE TRIGGER history_assignment_guard`
      await tx.$executeRaw`ALTER TABLE "LeaveRecord" DISABLE TRIGGER history_leave_guard`
      const result = await arrange(tx)
      await tx.$executeRaw`ALTER TABLE "EmploymentAssignment" ENABLE TRIGGER history_assignment_guard`
      await tx.$executeRaw`ALTER TABLE "LeaveRecord" ENABLE TRIGGER history_leave_guard`
      return result
    }, { maxWait: 5000, timeout: 30000 })
  } finally { await db.$disconnect() }
}
