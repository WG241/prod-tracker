import express from 'express'
import type { ErrorRequestHandler, NextFunction, Request, Response, Router } from 'express'
import type { SessionContext } from '../../src/features/auth/contracts.ts'
import { browserOrigin } from './config.ts'
import { baseRecord, keys, object, roleCanView, uuid, validFrame, pageKeys } from './records.ts'
import type { Frame } from './records.ts'
import type { Telemetry } from './service.ts'
import { viewRecord } from './service.ts'

export class MemoryLimits {
  private readonly entries = new Map<string, { expires: number; count: number }>()
  constructor(privateLimit = 4096) { this.capacity = privateLimit }
  private readonly capacity: number
  take(key: string, maximum: number, now = Date.now()) {
    for (const [id, entry] of this.entries) if (entry.expires <= now) this.entries.delete(id)
    let entry = this.entries.get(key)
    if (!entry) {
      if (this.entries.size >= this.capacity) return false
      entry = { expires: now + 60_000, count: 0 }; this.entries.set(key, entry)
    }
    if (entry.count >= maximum) return false
    entry.count++
    return true
  }
}
export class SeenIds {
  private readonly entries = new Map<string, number>()
  accept(id: string, now = Date.now()) {
    for (const [key, expires] of this.entries) if (expires <= now) this.entries.delete(key)
    const key = id.toLowerCase()
    if (this.entries.has(key)) return false
    if (this.entries.size >= 4096) this.entries.delete(this.entries.keys().next().value!)
    this.entries.set(key, now + 600_000)
    return true
  }
}
type ContextResolver = (request: Request) => Promise<{ context: SessionContext | null; headers: Headers }>
export function registerTelemetry(api: Router, telemetry: Telemetry, config: { host: string; port: number; development: boolean }, resolveContext?: ContextResolver) {
  if (!telemetry.enabled) return
  const origin = browserOrigin(config.host, config.port)
  if (!origin) { process.stderr.write('{"code":"TELEMETRY_BROWSER_DISABLED"}\n'); return }
  const errors = new MemoryLimits(); const views = new MemoryLimits(); const seen = new SeenIds()
  const router = express.Router()
  router.use((request, response, next) => {
    response.setHeader('Cache-Control', 'no-store')
    if (!['/error', '/view'].includes(request.path)) return response.status(404).json({ error: 'Not found' })
    if (request.method !== 'POST') { response.setHeader('Allow', 'POST'); return response.status(405).json({ error: 'Method not allowed' }) }
    if (request.originalUrl.includes('?')) return response.status(400).json({ error: 'Invalid input' })
    if (request.get('origin') !== origin || (request.get('sec-fetch-site') && request.get('sec-fetch-site') !== 'same-origin')) return response.status(403).json({ error: 'Forbidden' })
    if (!request.is('application/json')) return response.status(415).json({ error: 'JSON required' })
    const ip = request.socket.remoteAddress ?? 'unknown'
    if (!(request.path === '/error' ? errors : views).take(ip, request.path === '/error' ? 30 : 200)) {
      response.setHeader('Retry-After', '60'); return response.status(429).json({ error: 'Too many reports' })
    }
    next()
  })
  router.use(express.json({ limit: '8kb', strict: true }))
  router.post('/error', (request, response) => {
    const input: unknown = request.body
    const allowed = ['RENDER_ERROR', 'REACT_RECOVERABLE', 'BROWSER_ERROR', 'UNHANDLED_REJECTION', 'API_UNAVAILABLE']
    if (!object(input) || !keys(input, ['id', 'code', 'locationKey', 'frames']) || !uuid(input.id)
      || typeof input.code !== 'string' || !allowed.includes(input.code)
      || typeof input.locationKey !== 'string' || !['app', 'health', ...pageKeys].includes(input.locationKey)
      || (input.frames !== undefined && (!Array.isArray(input.frames) || input.frames.length > 10))) return response.status(400).json({ error: 'Invalid input' })
    const frames: Frame[] = Array.isArray(input.frames) ? input.frames.filter((frame): frame is Frame => validFrame(frame, telemetry.inventory)).map((frame) => ({ file: frame.file, line: frame.line, ...(frame.column === undefined ? {} : { column: frame.column }) })) : []
    if (seen.accept(input.id) && telemetry.environment) telemetry.writer.offer({ ...baseRecord(telemetry.environment), id: input.id,
      kind: 'error', code: input.code, locationKey: input.locationKey,
      source: ['RENDER_ERROR', 'REACT_RECOVERABLE'].includes(input.code) ? 'react' : 'browser', ...(frames.length ? { frames } : {}) })
    response.status(204).end()
  })
  router.post('/view', async (request, response) => {
    const input: unknown = request.body
    if (!object(input) || !keys(input, ['id', 'pageKey']) || !uuid(input.id) || typeof input.pageKey !== 'string' || !pageKeys.includes(input.pageKey)) return response.status(400).json({ error: 'Invalid input' })
    if (!resolveContext) return response.status(503).json({ error: 'Context unavailable' })
    try {
      const result = await resolveContext(request)
      for (const cookie of result.headers.getSetCookie()) response.append('Set-Cookie', cookie)
      if (!result.context) return response.status(401).json({ error: 'Sign in required' })
      if (!roleCanView(result.context.role, input.pageKey)) return response.status(403).json({ error: 'Forbidden' })
      if (seen.accept(input.id) && telemetry.environment) telemetry.writer.offer(viewRecord(telemetry.environment, input.id, result.context.role, input.pageKey))
      response.status(204).end()
    } catch { response.status(503).json({ error: 'Context unavailable' }) }
  })
  const badBody: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
    response.status(typeof error === 'object' && error !== null && 'status' in error && error.status === 413 ? 413 : 400).json({ error: 'Invalid input' })
  }
  router.use(badBody)
  api.use('/telemetry', router)
  if (config.development && ['127.0.0.1', 'localhost', '::1'].includes(config.host)) {
    api.post('/dev/telemetry-probe', (request: Request, response: Response, next: NextFunction) => {
      if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress ?? '') || request.get('origin') !== origin
        || (request.get('sec-fetch-site') && request.get('sec-fetch-site') !== 'same-origin')) return response.status(403).json({ error: 'Forbidden' })
      if (!request.is('application/json')) return response.status(415).json({ error: 'JSON required' })
      if (!errors.take(request.socket.remoteAddress ?? '', 30)) { response.setHeader('Retry-After', '60'); return response.status(429).json({ error: 'Too many reports' }) }
      next()
    }, express.json({ limit: '8kb' }), (request: Request, response: Response) => {
      const input: unknown = request.body
      if (request.originalUrl.includes('?') || !object(input) || !keys(input, ['scenario']) || typeof input.scenario !== 'string' || !['api-error', 'product-sample'].includes(input.scenario)) return response.status(400).json({ error: 'Invalid input' })
      if (input.scenario === 'api-error') {
        telemetry.capture('API_INTERNAL_ERROR', 'api', 'telemetry-probe', new Error('Controlled development exercise'), 500, true)
        return response.status(500).json({ error: 'Internal server error' })
      }
      if (telemetry.environment) telemetry.writer.offer({ ...baseRecord(telemetry.environment, true), kind: 'product', name: 'task_approved', role: 'LINE_MANAGER', method: 'HUMAN', timing: 'LATE', occurredAt: new Date().toISOString() })
      response.status(204).end()
    }, badBody)
  }
}
