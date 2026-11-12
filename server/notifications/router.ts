import express from 'express'
import type { ErrorRequestHandler, RequestHandler, Router } from 'express'
import type { PrismaClient } from '../../src/generated/prisma/client.ts'
import { AccountFailure, accountRequestId } from '../account/validation.ts'
import type { AuthConfig } from '../auth/config.ts'
import { AuthFailure } from '../auth/errors.ts'
import { forwardCookies } from '../auth/router.ts'
import { providerHeaders } from '../auth/service.ts'
import type { AuthService } from '../auth/service.ts'
import { reserve, throttleKey } from '../auth/throttle.ts'
import { readUnread } from './reads.ts'
import { markRead } from './writes.ts'

const invalid = () => new AccountFailure('INVALID_INPUT', 400, 'The notification request is invalid.')

function pageSelector(url: string) {
  const query = new URL(url, 'http://localhost').searchParams
  if ([...query.keys()].some((name) => name !== 'page') || query.getAll('page').length > 1) return null
  const raw = query.get('page') ?? '1'
  const page = Number(raw)
  return /^[1-9]\d*$/.test(raw) && Number.isSafeInteger(page) ? page : null
}

export function registerNotifications(api: Router, db: PrismaClient, service: AuthService, config: AuthConfig) {
  const router = express.Router({ caseSensitive: true, strict: true })
  const validate = (write: boolean): RequestHandler => (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store')
    const origin = req.get('origin'), site = req.get('sec-fetch-site')
    if ((origin && origin !== config.origin) || (write && origin !== config.origin)
      || (site && site !== 'same-origin' && (site !== 'none' || write))) throw new AuthFailure('FORBIDDEN', 403)
    if (req.method !== (write ? 'POST' : 'GET') || req.get('if-match') !== undefined
      || ((write || req.path === '/summary') && req.originalUrl.includes('?'))
      || (!write && (req.get('transfer-encoding') !== undefined || Number(req.get('content-length') ?? 0) !== 0))) throw invalid()
    if (write && req.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
      throw new AccountFailure('INVALID_INPUT', 415, 'Send the notification request as JSON.')
    }
    next()
  }
  const mutate: RequestHandler = async (req, res) => {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).length) throw invalid()
    const key = accountRequestId(req.get('idempotency-key'))
    const notificationId = req.params.id
    if (notificationId !== undefined && (typeof notificationId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(notificationId))) throw invalid()
    const session = await service.current(providerHeaders(req.headers))
    forwardCookies(res, session.headers)
    if (!session.context || !session.internalSessionId) throw new AuthFailure('SESSION_REQUIRED', 401)
    await reserve(db, throttleKey(config.secret, 'notification-write-ip', req.socket.remoteAddress ?? 'unknown'), 300, 60)
    await reserve(db, throttleKey(config.secret, 'notification-write-user', session.context.user.id), 60, 60)
    res.json(await markRead(db, { context: session.context, sessionId: session.internalSessionId }, key, notificationId === undefined
      ? { operation: 'NOTIFICATIONS_READ_ALL' }
      : { operation: 'NOTIFICATION_READ', notificationId }))
  }
  const json = express.json({
    strict: true, limit: '8kb',
    // Express parses an empty JSON body as {}, but this command requires an object on the wire.
    verify: (_req, _res, body) => { if (body.length === 0) throw invalid() },
  })
  router.all('/read-all', validate(true), json, mutate)
  router.all('/:id/read', validate(true), json, mutate)
  router.all(['/', '/summary'], validate(false), async (req, res) => {
    const summary = req.path === '/summary'
    const page = summary ? null : pageSelector(req.originalUrl)
    if (!summary && page === null) throw invalid()
    const session = await service.current(providerHeaders(req.headers))
    forwardCookies(res, session.headers)
    if (!session.context || !session.internalSessionId) throw new AuthFailure('SESSION_REQUIRED', 401)
    res.json(await readUnread(db, session.context, session.internalSessionId, page))
  })
  const errors: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    const status = error && typeof error === 'object' && 'status' in error ? error.status : null
    const failure = error instanceof AccountFailure || error instanceof AuthFailure ? error
      : status === 413 ? new AccountFailure('INVALID_INPUT', 413, 'The notification request is too large.')
      : status === 415 ? new AccountFailure('INVALID_INPUT', 415, 'Send the notification request as JSON.')
      : status === 400 || error instanceof URIError ? invalid() : new AuthFailure('SERVICE_UNAVAILABLE', 503)
    if (failure.status >= 500) console.error('NOTIFICATION_REQUEST_FAILED')
    if (failure instanceof AuthFailure && failure.retryAfter) res.setHeader('Retry-After', failure.retryAfter)
    res.setHeader('Cache-Control', 'no-store')
    res.status(failure.status).json({ error: { code: failure.code, message: failure.message } })
  }
  router.use(errors)
  api.use('/notifications', router)
}
