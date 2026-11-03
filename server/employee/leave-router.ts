import express from 'express'
import type { ErrorRequestHandler, Router } from 'express'
import type { PrismaClient } from '../../src/generated/prisma/client.ts'
import type { AuthConfig } from '../auth/config.ts'
import type { AuthService } from '../auth/service.ts'
import type { Capture } from '../telemetry/service.ts'
import { providerHeaders } from '../auth/service.ts'
import { forwardCookies } from '../auth/router.ts'
import { AuthFailure } from '../auth/errors.ts'
import { clientIp, reserve, throttleKey } from '../auth/throttle.ts'
import { EmployeeFailure } from './calendar.ts'
import { employeePrincipal } from './reads.ts'
import { currentLeave } from './leave-state.ts'
import { parseLeaveOperation, LeaveFailure } from './leave-validation.ts'
import { mutateLeave } from './leave-writes.ts'

export function registerLeave(api: Router, db: PrismaClient, service: AuthService, config: AuthConfig, capture: Capture) {
  const router = express.Router()
  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store')
    const origin = req.get('origin'), site = req.get('sec-fetch-site')
    if ((origin && origin !== config.origin) || (site && site !== 'same-origin' && site !== 'none') || (req.method !== 'GET' && (origin !== config.origin || site === 'none'))) return next(new EmployeeFailure('FORBIDDEN', 403))
    if (req.originalUrl.includes('?') || !['GET', 'POST'].includes(req.method) || req.get('if-match')) return next(new LeaveFailure('INVALID_INPUT', 400))
    if (req.method === 'GET' && (req.get('transfer-encoding') || Number(req.get('content-length') ?? 0) > 0)) return next(new LeaveFailure('INVALID_INPUT', 400))
    if (req.method === 'POST' && !req.is('application/json')) return res.status(415).json({ error: { code: 'INVALID_INPUT', message: 'Send leave fields as JSON.' } })
    next()
  })
  router.use(express.json({ strict: true, limit: '32kb' }))
  router.all(['/', '/:leaveId/:action'], async (req, res, next) => {
    try {
      const auth = await service.current(providerHeaders(req.headers)); forwardCookies(res, auth.headers)
      if (!auth.context || !auth.internalSessionId) throw new EmployeeFailure('SESSION_REQUIRED', 401)
      if (auth.context.role !== 'EMPLOYEE') throw new EmployeeFailure('FORBIDDEN', 403)
      if (req.method === 'GET' && !req.params.leaveId) {
        const at = new Date()
        res.json(await db.$transaction(async (tx) => { await employeePrincipal(tx, auth.context!, at); return currentLeave(tx, auth.context!.user.id, at) }, { isolationLevel: 'RepeatableRead', maxWait: 5000, timeout: 15000 }))
        return
      }
      if (req.method !== 'POST') throw new LeaveFailure('INVALID_INPUT', 400)
      await reserve(db, throttleKey(config.secret, 'leave-write-ip', clientIp(req)), 300, 60)
      await reserve(db, throttleKey(config.secret, 'leave-write-user', auth.context.user.id), 60, 60)
      const kind = !req.params.leaveId ? 'CREATE' : req.params.action === 'cancel' ? 'CANCEL' : req.params.action === 'return' ? 'RETURN' : null
      if (!kind) throw new LeaveFailure('INVALID_INPUT', 400)
      const key = req.get('idempotency-key')
      if (!key || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key) || Array.isArray(req.params.leaveId)) throw new LeaveFailure('INVALID_INPUT', 400)
      const operation = parseLeaveOperation(kind, req.params.leaveId, req.body)
      res.json(await mutateLeave(db, auth.context, auth.internalSessionId, key, operation))
    } catch (error) { next(error) }
  })
  router.use((_req, _res, next) => next(new LeaveFailure('INVALID_INPUT', 400)))
  const errors: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    const typed = error instanceof LeaveFailure || error instanceof EmployeeFailure || error instanceof AuthFailure
    const status = typed ? error.status : error && typeof error === 'object' && 'status' in error && error.status === 413 ? 413 : error instanceof SyntaxError ? 400 : 503
    if (status >= 500) capture('API_UNAVAILABLE', 'api', 'api', error, status)
    if (error instanceof AuthFailure && error.retryAfter) res.setHeader('Retry-After', error.retryAfter)
    res.status(status).json({ error: { code: typed ? error.code : status < 500 ? 'INVALID_INPUT' : 'SERVICE_UNAVAILABLE', message: typed ? error.message : status === 413 ? 'The leave request is too large.' : status < 500 ? 'Check the leave fields and try again.' : 'The service is unavailable. Please try again.', ...(error instanceof LeaveFailure && error.fields ? { fields: error.fields } : {}) } })
  }
  router.use(errors)
  api.use('/employee/leave', router)
}
