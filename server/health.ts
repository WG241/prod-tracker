import type { Router } from 'express'
import type { PrismaClient } from '../src/generated/prisma/client.ts'

export function registerHealth(router: Router, prisma: PrismaClient) {
  router.get('/health', async (_request, response) => {
    response.setHeader('Cache-Control', 'no-store')
    try {
      await prisma.user.findFirst({ select: { id: true } })
      response.json({ status: 'ok', database: 'connected' })
    } catch {
      console.error('database_health_unavailable')
      response.status(503).json({ status: 'unavailable', database: 'unavailable' })
    }
  })
}
