import express from 'express'
import type { ErrorRequestHandler, Router } from 'express'
import type { PrismaClient } from '../../src/generated/prisma/client.ts'
import type { AuthConfig } from '../auth/config.ts'
import { AuthFailure } from '../auth/errors.ts'
import { forwardCookies } from '../auth/router.ts'
import { providerHeaders } from '../auth/service.ts'
import type { AuthService } from '../auth/service.ts'
import { reserve, throttleKey } from '../auth/throttle.ts'
import { readProfile } from './profile.ts'
import { AccountFailure, accountRequestId, invalidAccountRequest, passwordInput, preferenceInput } from './validation.ts'
import { changePassword, savePreference } from './writes.ts'

export function registerAccountProfile(api: Router, db: PrismaClient, service: AuthService, config: AuthConfig) {
  const router = express.Router({ caseSensitive: true, strict: true })
  router.use((req, res, next) => {
    if (!['/profile', '/email-preference', '/password'].includes(req.path)) return next('router')
    res.setHeader('Cache-Control', 'no-store')
    try {
      const origin = req.get('origin'), site = req.get('sec-fetch-site')
      const read = req.path === '/profile'
      if ((origin && origin !== config.origin) || (site && site !== 'same-origin' && (site !== 'none' || !read))
        || (!read && origin !== config.origin)) {
        throw new AuthFailure('FORBIDDEN', 403)
      }
      if (req.method !== (read ? 'GET' : 'POST') || req.originalUrl.includes('?') || req.get('if-match') !== undefined
        || (read && (req.get('transfer-encoding') !== undefined || Number(req.get('content-length') ?? 0) !== 0))) {
        throw invalidAccountRequest()
      }
      if (!read && !req.is('application/json')) throw new AccountFailure('INVALID_INPUT', 415, 'Send the account fields as JSON.')
      next()
    } catch (error) { next(error) }
  })
  router.use(express.json({ strict: true, limit: '8kb' }))
  router.all(['/profile', '/email-preference', '/password'], async (req, res, next) => {
    try {
      const headers = providerHeaders(req.headers)
      const session = await service.current(headers)
      forwardCookies(res, session.headers)
      if (!session.context || !session.internalSessionId) throw new AuthFailure('SESSION_REQUIRED', 401)
      const actor = { context: session.context, sessionId: session.internalSessionId }
      if (req.path === '/profile') {
        res.json(await readProfile(db, actor.context, actor.sessionId))
        return
      }
      const requestId = accountRequestId(req.get('idempotency-key'))
      const socketIp = req.socket.remoteAddress ?? 'unknown'
      if (req.path === '/email-preference') {
        const input = preferenceInput(req.body)
        await reserve(db, throttleKey(config.secret, 'account-preference-ip', socketIp), 300, 60)
        await reserve(db, throttleKey(config.secret, 'account-preference-user', actor.context.user.id), 60, 60)
        res.json(await savePreference(db, actor, requestId, input))
        return
      }
      const input = passwordInput(req.body)
      await reserve(db, throttleKey(config.secret, 'account-password-ip', socketIp), 20, 900)
      await reserve(db, throttleKey(config.secret, 'account-password-user', actor.context.user.id), 5, 900)
      const result = await changePassword(db, service, actor, requestId, input)
      try { forwardCookies(res, await service.expirePasswordChangeCookies(headers)) }
      catch { console.error('ACCOUNT_PASSWORD_EXPIRY_COOKIES_FAILED') }
      res.json(result)
    } catch (error) { next(error) }
  })
  const errors: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    const parserStatus = error && typeof error === 'object' && 'status' in error ? error.status : null
    const failure = error instanceof AuthFailure || error instanceof AccountFailure ? error
      : parserStatus === 413 ? new AccountFailure('INVALID_INPUT', 413, 'The account request is too large.')
      : parserStatus === 415 ? new AccountFailure('INVALID_INPUT', 415, 'Send the account fields as JSON.')
      : parserStatus === 400 ? invalidAccountRequest() : new AuthFailure('SERVICE_UNAVAILABLE', 503)
    if (failure.status >= 500) console.error('ACCOUNT_REQUEST_FAILED')
    if (failure instanceof AuthFailure && failure.retryAfter) res.setHeader('Retry-After', failure.retryAfter)
    res.status(failure.status).json({ error: {
      code: failure.code, message: failure.message,
      ...(failure instanceof AccountFailure && failure.fields ? { fields: failure.fields } : {}),
    } })
  }
  router.use(errors)
  api.use('/account', router)
}
