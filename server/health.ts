import type { Router } from 'express'
import type { PrismaClient } from '../src/generated/prisma/client.ts'
import type { Capture } from './telemetry/service.ts'

export function registerHealth(router: Router, prisma: PrismaClient, capture: Capture = () => {}) {
  router.get('/health', async (_request, response) => {
    response.setHeader('Cache-Control', 'no-store')
    try {
      await prisma.user.findFirst({ select: { id: true } })
      response.json({ status: 'ok', database: 'connected' })
    } catch (error) {
      capture('DATABASE_UNAVAILABLE', 'database', 'health', error, 503)
      response.status(503).json({ status: 'unavailable', database: 'unavailable' })
    }
  })
}
