import type { ErrorRequestHandler } from 'express'
import type { Capture } from './service.ts'

export function telemetryErrors(capture: Capture): ErrorRequestHandler {
  return (error: unknown, request, response, _next) => {
    if (!request.path.startsWith('/api/telemetry/')) capture('API_INTERNAL_ERROR', 'api', 'api', error, response.headersSent ? undefined : 500)
    if (response.headersSent) response.destroy()
    else response.status(500).json({ error: 'Internal server error' })
  }
}
export function fatalGuard(enabled: boolean) {
  let fatal = false
  const terminate = () => {
    if (fatal) return
    fatal = true
    // No raw exception, default Node logger, async I/O or new database work.
    if (enabled) {
      try { process.stderr.write('{"code":"PROCESS_FATAL","source":"process"}\n') } catch { /* best effort */ }
    }
    process.exit(1)
  }
  process.on('uncaughtException', terminate)
  process.on('unhandledRejection', terminate)
}
