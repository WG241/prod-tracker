import type { ErrorRequestHandler } from 'express'

export function apiErrorHandler(): ErrorRequestHandler {
  return (_error: unknown, _request, response, _next) => {
    if (response.headersSent) response.destroy()
    else response.status(500).json({ error: 'Internal server error' })
  }
}

export function fatalGuard() {
  let fatal = false
  const terminate = () => {
    if (fatal) return
    fatal = true
    // No raw exception, default Node logger, async I/O or new database work.
    process.exit(1)
  }
  process.on('uncaughtException', terminate)
  process.on('unhandledRejection', terminate)
}
