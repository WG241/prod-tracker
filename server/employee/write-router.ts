import express from 'express'
import type { ErrorRequestHandler, Response, Router } from 'express'
import type { PrismaClient } from '../../src/generated/prisma/client.ts'
import type { OwnTaskRole, TaskOperation } from '../../src/features/employee/mutations.ts'
import { ownTaskRoutes } from '../../src/features/employee/mutations.ts'
import type { AuthConfig } from '../auth/config.ts'
import type { AuthService } from '../auth/service.ts'
import { providerHeaders } from '../auth/service.ts'
import { forwardCookies } from '../auth/router.ts'
import { AuthFailure } from '../auth/errors.ts'
import { clientIp, reserve, throttleKey } from '../auth/throttle.ts'
import { EmployeeFailure } from './calendar.ts'
import { parseOperation, requestIdentity, TaskFailure } from './task-validation.ts'
import { mutateTask } from './writes.ts'

export function registerTaskWrites(api: Router, db: PrismaClient, service: AuthService, config: AuthConfig, role: OwnTaskRole = 'EMPLOYEE') {
  const router = express.Router()
  const fail = (response: Response, error: unknown) => {
    const failure = error instanceof TaskFailure || error instanceof EmployeeFailure || error instanceof AuthFailure ? error : new EmployeeFailure('SERVICE_UNAVAILABLE', 503)
    if (failure.status >= 500) console.error('OWN_TASK_WRITE_FAILED')
    if (failure instanceof AuthFailure && failure.retryAfter) response.setHeader('Retry-After', failure.retryAfter)
    response.status(failure.status).json({ error: { code: failure.code, message: failure.message, ...(failure instanceof TaskFailure && failure.fields ? { fields: failure.fields } : {}) } })
  }
  router.use((request, response, next) => {
    if (request.method === 'GET') return next('router')
    response.setHeader('Cache-Control', 'no-store')
    try {
      if (request.get('origin') !== config.origin || (request.get('sec-fetch-site') && request.get('sec-fetch-site') !== 'same-origin')) throw new EmployeeFailure('FORBIDDEN', 403)
      const methods = role === 'LINE_MANAGER' ? ['POST'] : ['POST', 'PATCH', 'DELETE']
      if (request.originalUrl.includes('?') || !methods.includes(request.method)) throw new TaskFailure('INVALID_INPUT', 400)
      if (!request.is('application/json')) return response.status(415).json({ error: { code: 'INVALID_INPUT', message: 'Send task fields as JSON.' } })
      next()
    } catch (error) { fail(response, error) }
  })
  router.use(express.json({ limit: '32kb', strict: true }))
  router.all(['/', '/:taskId', '/:taskId/:action'], async (request, response) => {
    try {
      const result = await service.current(providerHeaders(request.headers))
      forwardCookies(response, result.headers)
      if (!result.context || !result.internalSessionId) throw new EmployeeFailure('SESSION_REQUIRED', 401)
      if (result.context.role !== role) throw new EmployeeFailure('FORBIDDEN', 403)
      await reserve(db, throttleKey(config.secret, 'task-write-ip', clientIp(request)), 300, 60)
      await reserve(db, throttleKey(config.secret, 'task-write-user', result.context.user.id), 60, 60)
      const { taskId, action } = request.params
      let kind: TaskOperation['kind']
      if (!taskId && request.method === 'POST') kind = 'CREATE'
      else if (taskId && !action && request.method === 'PATCH') kind = 'EDIT'
      else if (taskId && !action && request.method === 'DELETE') kind = 'DELETE'
      else if (role === 'LINE_MANAGER' && taskId && request.method === 'POST' && action === 'edit') kind = 'EDIT'
      else if (role === 'LINE_MANAGER' && taskId && request.method === 'POST' && action === 'delete') kind = 'DELETE'
      else if (taskId && request.method === 'POST' && ['status', 'comments', 'carry'].includes(String(action))) kind = action === 'status' ? 'STATUS' : action === 'comments' ? 'COMMENT' : 'CARRY'
      else throw new TaskFailure('INVALID_INPUT', 400)
      const operation = parseOperation(kind, taskId, request.body, request.get('if-match'))
      const receipt = await mutateTask(db, result.context, result.internalSessionId, requestIdentity(request.get('idempotency-key')), operation, role)
      response.status(kind === 'CREATE' ? 201 : 200).json(receipt)
    } catch (error) { fail(response, error) }
  })
  const parseError: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
    const status = error && typeof error === 'object' && 'status' in error && error.status === 413 ? 413 : 400
    response.status(status).json({ error: { code: 'INVALID_INPUT', message: status === 413 ? 'The task request is too large.' : 'Check the task fields and try again.' } })
  }
  router.use(parseError)
  api.use(ownTaskRoutes[role].tasks.slice('/api'.length), router)
}
