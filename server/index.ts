import 'dotenv/config'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import type { ViteDevServer } from 'vite'
import { readConfig } from './config.ts'
import { createDatabase } from './db.ts'
import { registerHealth } from './health.ts'
import { registerDataProof } from './data-proof/router.ts'
import { readAuthConfig } from './auth/config.ts'
import { createAuth } from './auth/provider.ts'
import { createAuthService } from './auth/service.ts'
import { registerAuth, registerNavigation } from './auth/router.ts'
import { registerAccountProfile } from './account/router.ts'
import { registerNotifications } from './notifications/router.ts'
import { apiErrorHandler, fatalGuard } from './errors.ts'
import { privateStorage } from './private-storage.ts'
import { registerEmployee } from './employee/router.ts'
import { startHistoryCloser } from './employee/history-worker.ts'
import { startEmailWorker } from './email/worker.ts'
import { registerLineManager } from './line-manager/router.ts'

fatalGuard()

async function main() {
  const config = readConfig()
  const authConfig = readAuthConfig()
  const prisma = createDatabase(config.connectionString)
  const authService = createAuthService(prisma, createAuth(prisma, authConfig))
  const app = express()
  const server = createServer(app)
  app.disable('x-powered-by')
  app.use(privateStorage)
  // Off by default. Only enable after a hosting-specific trusted proxy decision.
  if (config.trustProxy !== false) app.set('trust proxy', config.trustProxy)

  const api = express.Router()
  registerHealth(api, prisma)
  registerDataProof(api, prisma, config)
  registerAuth(api, prisma, authService, authConfig)
  registerAccountProfile(api, prisma, authService, authConfig)
  registerNotifications(api, prisma, authService, authConfig)
  registerEmployee(api, prisma, authService, authConfig)
  registerLineManager(api, prisma, authService, authConfig)
  api.use((_request, response) => response.status(404).json({ error: 'Not found' }))
  app.use('/api', api)
  registerNavigation(app, authService, config.development)

  let vite: ViteDevServer | undefined
  if (config.development) {
    const { createServer: createViteServer } = await import('vite')
    vite = await createViteServer({
      server: { middlewareMode: true, ws: { server } },
      appType: 'spa',
    })
    app.use(vite.middlewares)
  } else {
    const browserBuild = fileURLToPath(new URL('../../dist/', import.meta.url))
    app.use(express.static(browserBuild, { index: false }))
    app.get('/{*path}', (request, response, next) => {
      if (!request.accepts('html') || /\.[^/]+$/.test(request.path)) return next()
      if (!response.hasHeader('Cache-Control')) response.setHeader('Cache-Control', 'no-cache')
      response.sendFile(resolve(browserBuild, 'index.html'))
    })
    app.use((_request, response) => response.status(404).json({ error: 'Not found' }))
  }

  app.use(apiErrorHandler())
  const stopHistory = startHistoryCloser(prisma)
  const stopEmail = startEmailWorker(prisma)

  let stopping = false
  const shutdown = async () => {
    if (stopping) return
    stopping = true
    const deadline = setTimeout(() => process.exit(1), 15000).unref()
    const historyStopped = stopHistory()
    const emailStopped = stopEmail()
    const httpClosed = new Promise<void>((done) => server.close(() => done()))
    await vite?.close()
    await httpClosed
    await historyStopped
    await emailStopped
    await prisma.$disconnect()
    clearTimeout(deadline)
  }
  process.once('SIGINT', () => void shutdown())
  process.once('SIGTERM', () => void shutdown())
  server.once('error', (error) => {
    console.error('Server startup failed', error)
    void shutdown().then(() => { process.exitCode = 1 })
  })
  server.listen(config.port, config.host, () => {
    console.info(`Workforce app ready at http://${config.host}:${config.port}`)
  })
}

main().catch((error: unknown) => {
  console.error('Server startup failed', error)
  process.exitCode = 1
})
