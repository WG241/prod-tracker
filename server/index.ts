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
import { createAuthService, providerHeaders } from './auth/service.ts'
import { registerAuth, registerNavigation } from './auth/router.ts'
import { committedEvents, createTelemetry } from './telemetry/service.ts'
import { fatalGuard, telemetryErrors } from './telemetry/errors.ts'
import { registerTelemetry } from './telemetry/router.ts'
import { privateStorage } from './telemetry/private-storage.ts'
import { registerEmployee } from './employee/router.ts'
import { startHistoryWorker } from './employee/history-worker.ts'

const telemetry = createTelemetry()
fatalGuard(telemetry.enabled)

async function main() {
  const config = readConfig()
  const authConfig = readAuthConfig()
  const prisma = createDatabase(config.connectionString, telemetry.capture)
  const authService = createAuthService(prisma, createAuth(prisma, authConfig))
  const app = express()
  const server = createServer(app)
  app.disable('x-powered-by')
  app.use(privateStorage)
  // Off by default. Only enable after a hosting-specific trusted proxy decision.
  if (config.trustProxy !== false) app.set('trust proxy', config.trustProxy)

  const api = express.Router()
  registerHealth(api, prisma, telemetry.capture)
  registerTelemetry(api, telemetry, config, (request) => authService.current(providerHeaders(request.headers)))
  registerDataProof(api, prisma, config)
  registerAuth(api, prisma, authService, authConfig, telemetry.capture)
  registerEmployee(api, prisma, authService, authConfig, telemetry.capture, (at) => { if (telemetry.environment) committedEvents((record) => telemetry.writer.offer(record), telemetry.environment).submitted({ newlyApplied: true, submittedAt: new Date(at), role: 'EMPLOYEE', method: 'HUMAN' }) })
  api.use((_request, response) => response.status(404).json({ error: 'Not found' }))
  app.use('/api', api)
  registerNavigation(app, authService, config.development, telemetry.capture)

  let vite: ViteDevServer | undefined
  if (config.development) {
    const { createServer: createViteServer } = await import('vite')
    vite = await createViteServer({
      server: { middlewareMode: true, hmr: { server } },
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

  app.use(telemetryErrors(telemetry.capture))
  const stopHistory = startHistoryWorker(prisma, telemetry.capture)

  let stopping = false
  const shutdown = async () => {
    if (stopping) return
    stopping = true
    const deadline = setTimeout(() => process.exit(1), 10000).unref()
    const historyStopped = stopHistory()
    const httpClosed = new Promise<void>((done) => server.close(() => done()))
    await vite?.close()
    await httpClosed
    await historyStopped
    await prisma.$disconnect()
    await telemetry.writer.shutdown()
    clearTimeout(deadline)
  }
  process.once('SIGINT', () => void shutdown())
  process.once('SIGTERM', () => void shutdown())
  server.once('error', (error) => {
    telemetry.capture('STARTUP_FAILURE', 'startup', 'startup', error)
    void shutdown().then(() => { process.exitCode = 1 })
  })
  server.listen(config.port, config.host, () => {
    console.info(`Workforce app ready at http://${config.host}:${config.port}`)
  })
}

main().catch((error: unknown) => {
  telemetry.capture('STARTUP_FAILURE', 'startup', 'startup', error)
  console.error('Server startup failed')
  void telemetry.writer.shutdown()
  process.exitCode = 1
})
