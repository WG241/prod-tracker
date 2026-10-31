import 'dotenv/config'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import type { ErrorRequestHandler } from 'express'
import type { ViteDevServer } from 'vite'
import { readConfig } from './config.ts'
import { createDatabase } from './db.ts'
import { registerHealth } from './health.ts'
import { registerDataProof } from './data-proof/router.ts'
import { readAuthConfig } from './auth/config.ts'
import { createAuth } from './auth/provider.ts'
import { createAuthService } from './auth/service.ts'
import { registerAuth, registerNavigation } from './auth/router.ts'

async function main() {
  const config = readConfig()
  const authConfig = readAuthConfig()
  const prisma = createDatabase(config.connectionString)
  const authService = createAuthService(prisma, createAuth(prisma, authConfig))
  const app = express()
  const server = createServer(app)
  app.disable('x-powered-by')
  // Off by default. Only enable after a hosting-specific trusted proxy decision.
  if (config.trustProxy !== false) app.set('trust proxy', config.trustProxy)

  const api = express.Router()
  registerHealth(api, prisma)
  registerDataProof(api, prisma, config)
  registerAuth(api, prisma, authService, authConfig)
  api.use((_request, response) => response.status(404).json({ error: 'Not found' }))
  app.use('/api', api)
  registerNavigation(app, authService, config.development)

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

  const handleError: ErrorRequestHandler = (_error, _request, response, _next) => {
    console.error('request_failed')
    if (!response.headersSent) response.status(500).json({ error: 'Internal server error' })
    else response.end()
  }
  app.use(handleError)

  let stopping = false
  const shutdown = async () => {
    if (stopping) return
    stopping = true
    const deadline = setTimeout(() => process.exit(1), 10000).unref()
    const httpClosed = new Promise<void>((done) => server.close(() => done()))
    await vite?.close()
    await httpClosed
    await prisma.$disconnect()
    clearTimeout(deadline)
  }
  process.once('SIGINT', () => void shutdown())
  process.once('SIGTERM', () => void shutdown())
  server.once('error', () => {
    console.error('server_listen_failed')
    void shutdown().then(() => { process.exitCode = 1 })
  })
  server.listen(config.port, config.host, () => {
    console.info(`Workforce app ready at http://${config.host}:${config.port}`)
  })
}

main().catch((error: unknown) => {
  const message = error instanceof Error && /^(DATABASE_URL|PORT|BETTER_AUTH_SECRET|BETTER_AUTH_URL) must/.test(error.message)
    ? error.message
    : 'Server startup failed'
  console.error(message)
  process.exitCode = 1
})
