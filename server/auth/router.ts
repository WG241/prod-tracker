import express from 'express'
import type { ErrorRequestHandler, Request, Response, Router } from 'express'
import type { PrismaClient } from '../../src/generated/prisma/client.ts'
import { roleRoutes, validPassword, wellFormed } from '../../src/features/auth/contracts.ts'
import type { AuthConfig } from './config.ts'
import { AuthFailure, messages } from './errors.ts'
import type { AuthService } from './service.ts'
import { providerHeaders } from './service.ts'
import { checkEmail, clientIp, recordFailure, reserve, throttleKey } from './throttle.ts'

export function forwardCookies(response: Response, headers: Headers) {
  // Append each cookie separately. Passing the getSetCookie() array to append can
  // collapse multiple Set-Cookie values and drop renewal or expiry headers (AC-3).
  for (const cookie of headers.getSetCookie()) response.append('Set-Cookie', cookie)
}

function originAllowed(request: Request, config: AuthConfig, mutation: boolean) {
  const origin = request.get('origin')
  const site = request.get('sec-fetch-site')
  return (!mutation || origin === config.origin) && (!origin || origin === config.origin)
    && (!site || site === 'same-origin' || (!mutation && site === 'none'))
}

function fail(response: Response, error: unknown) {
  const failure = error instanceof AuthFailure ? error : new AuthFailure('SERVICE_UNAVAILABLE', 503)
  if (!(error instanceof AuthFailure)) console.error('auth_request_failed')
  if (failure.retryAfter) response.setHeader('Retry-After', failure.retryAfter)
  return response.status(failure.status).json({ error: { code: failure.code, message: failure.message } })
}

export function registerAuth(api: Router, db: PrismaClient, service: AuthService, config: AuthConfig) {
  const authRouter = express.Router()
  authRouter.use((request, response, next) => {
    response.setHeader('Cache-Control', 'no-store')
    try {
      const expectedMethod = request.path === '/session' ? 'GET' : 'POST'
      if (request.method !== expectedMethod || request.originalUrl.includes('?')) throw new AuthFailure('INVALID_INPUT', 400)
      if (expectedMethod === 'GET' && (request.get('transfer-encoding') || Number(request.get('content-length') ?? 0) > 0)) throw new AuthFailure('INVALID_INPUT', 400)
      if (!originAllowed(request, config, expectedMethod === 'POST')) throw new AuthFailure('FORBIDDEN', 403)
      if (expectedMethod === 'POST' && !request.is('application/json')) {
        return response.status(415).json({ error: { code: 'INVALID_INPUT', message: messages.INVALID_INPUT } })
      }
      next()
    } catch (error) { fail(response, error) }
  })
  authRouter.use(express.json({ limit: '8kb', strict: true }))
  authRouter.all('/auth/sign-in', async (request, response) => {
    try {
      const body: unknown = request.body
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AuthFailure('INVALID_INPUT', 400)
      const fields = body as Record<string, unknown>
      if (Object.keys(fields).length !== 2 || typeof fields.email !== 'string' || !validPassword(fields.password)) throw new AuthFailure('INVALID_INPUT', 400)
      const email = fields.email.trim().toLowerCase()
      if (!email || email.length > 254 || !wellFormed(email) || email.includes('\0')) throw new AuthFailure('INVALID_INPUT', 400)
      const ip = clientIp(request)
      await reserve(db, throttleKey(config.secret, 'ip', ip), 100, 900)
      const key = throttleKey(config.secret, 'email', email)
      await checkEmail(db, key)
      let result
      try { result = await service.signIn(email, fields.password, providerHeaders(request.headers), key) }
      catch (error) {
        if (error instanceof AuthFailure && error.code === 'INVALID_CREDENTIALS') await recordFailure(db, key)
        throw error
      }
      forwardCookies(response, result.headers)
      response.json(result.context)
    } catch (error) { fail(response, error) }
  })
  authRouter.all(['/session', '/auth/sign-out'], async (request, response) => {
    try {
      if (request.path !== '/session' && (!request.body || typeof request.body !== 'object' || Array.isArray(request.body) || Object.keys(request.body as object).length)) throw new AuthFailure('INVALID_INPUT', 400)
      await reserve(db, throttleKey(config.secret, 'auth-ip', clientIp(request)), 100, 10)
      const headers = providerHeaders(request.headers)
      if (request.path === '/session') {
        const result = await service.current(headers)
        forwardCookies(response, result.headers)
        if (!result.context) throw new AuthFailure('SESSION_REQUIRED', 401)
        response.json(result.context)
      } else {
        forwardCookies(response, await service.signOut(headers))
        response.status(204).end()
      }
    } catch (error) { fail(response, error) }
  })
  const parserError: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
    const status = typeof error === 'object' && error && 'status' in error ? error.status : 400
    response.status(status === 413 ? 413 : 400).json({ error: { code: 'INVALID_INPUT', message: messages.INVALID_INPUT } })
  }
  authRouter.use(parserError)
  // Exact wrapper paths only. The provider's general HTTP handler is never mounted.
  api.use((request, response, next) => {
    if (['/auth/sign-in', '/auth/sign-out', '/session'].includes(request.path)) return authRouter(request, response, next)
    next()
  })
}

export function registerNavigation(app: express.Express, service: AuthService, development: boolean) {
  app.use(async (request, response, next) => {
    const documentRequest = request.get('accept')?.split(',').some((part) => part.trim().startsWith('text/html'))
    if (!['GET', 'HEAD'].includes(request.method) || !documentRequest || /\.[^/]+$/.test(request.path)) return next()
    if (development && ['/__ui', '/__data-proof'].includes(request.path)) return next()
    // Vite's HTML middleware also writes cache headers. Auth documents retain
    // this policy through downstream development and production serving.
    const setHeader = response.setHeader.bind(response)
    response.setHeader = (name, value) => setHeader(name, name.toLowerCase() === 'cache-control' ? 'no-store' : value)
    response.setHeader('Cache-Control', 'no-store')
    try {
      const result = await service.current(providerHeaders(request.headers))
      forwardCookies(response, result.headers)
      const context = result.context
      if (!context) {
        if (request.path === '/sign-in') return next()
        return response.redirect(303, '/sign-in')
      }
      if (request.path === '/profile' || context.navigation.some((item) => item.path === request.path)) return next()
      const rolePrefix = roleRoutes[context.role].prefix
      const notice = request.path.startsWith(`${rolePrefix}/`) ? '?notice=page-unavailable'
        : Object.values(roleRoutes).some((role) => role.prefix !== rolePrefix && (request.path === role.prefix || request.path.startsWith(`${role.prefix}/`))) ? '?notice=access-denied' : ''
      response.redirect(303, context.landingPath + notice)
    } catch (error) {
      if (error instanceof AuthFailure && error.status === 403) return fail(response, error)
      // Serve only the SPA's neutral retry presentation, never a role shell.
      response.status(503)
      // Vite sends HTML with status200. Keep the guard's failure status when
      // downstream serving writes the final response, without a second UI.
      response.writeHead = new Proxy(response.writeHead, {
        apply(writeHead, receiver, args: unknown[]) {
          return Reflect.apply(writeHead, receiver, [503, ...args.slice(1)])
        },
      })
      next()
    }
  })
}
