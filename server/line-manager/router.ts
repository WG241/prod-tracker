import express from 'express'
import type { ErrorRequestHandler, Request, RequestHandler, Response, Router } from 'express'
import type { PrismaClient } from '../../src/generated/prisma/client.ts'
import type { ManagerCommand } from '../../src/features/line-manager/dashboard-view.ts'
import type { AuthConfig } from '../auth/config.ts'
import { AuthFailure } from '../auth/errors.ts'
import { forwardCookies } from '../auth/router.ts'
import type { AuthService } from '../auth/service.ts'
import { providerHeaders } from '../auth/service.ts'
import { clientIp, reserve, throttleKey } from '../auth/throttle.ts'
import { EmployeeFailure, readQuery } from '../employee/calendar.ts'
import { LeaveFailure } from '../employee/leave-validation.ts'
import { requestEmailPass } from '../email/worker.ts'
import { readOwnHome, readTaskDetail } from '../employee/reads.ts'
import { registerTaskWrites } from '../employee/write-router.ts'
import { parseOperation, requestIdentity, taskIdentity, TaskFailure } from '../employee/task-validation.ts'
import { detailPage, managerWeek, selectors } from './query.ts'
import { readBounds, readDashboard } from './reads.ts'
import { readApprovalPeople, readApprovals, readReviewDetail, readReviewPerson, reviewSummary } from './approval-reads.ts'
import { approvalInput, mutateApproval } from './approval-writes.ts'
import { readTeamHistory, readTeamPeople, readTeamTask, readTeamWeek } from './team-history.ts'
import { ManagerFailure, mutateDashboard } from './writes.ts'
import { managerPrincipal } from './scope.ts'
import { readCoverHistory, readManagerLeave, readManagerLeaveHistory, readReliefCandidates } from './leave-reads.ts'
import { managerLeaveInput, mutateManagerLeave } from './leave-writes.ts'
import type { ManagerLeaveOperation } from '../../src/features/line-manager/leave-contracts.ts'

const badRequest = () => new EmployeeFailure('INVALID_INPUT', 400)

function reminderInput(body: unknown): ManagerCommand {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 2 || !('employeeId' in body) || !('week' in body) || typeof body.week !== 'string') throw badRequest()
  managerWeek(body.week)
  return { operation: 'LM_REMIND', employeeId: taskIdentity(body.employeeId), week: body.week }
}

export function registerLineManager(api: Router, db: PrismaClient, service: AuthService, config: AuthConfig) {
  registerTaskWrites(api, db, service, config, 'LINE_MANAGER')
  const router = express.Router({ strict: true, caseSensitive: true })
  const validate = (write: boolean): RequestHandler => (request, response, next) => {
    response.setHeader('Cache-Control', 'no-store')
    const origin = request.get('origin'), site = request.get('sec-fetch-site')
    if ((origin && origin !== config.origin) || (write && origin !== config.origin)
      || (site && site !== 'same-origin' && (write || site !== 'none'))) throw new AuthFailure('FORBIDDEN', 403)
    if (request.method !== (write ? 'POST' : 'GET') || request.get('if-match') !== undefined
      || (write && request.originalUrl.includes('?'))
      || (!write && (request.get('transfer-encoding') !== undefined || Number(request.get('content-length') ?? 0) !== 0))) throw badRequest()
    if (write && request.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
      response.status(415).json({ error: { code: 'INVALID_INPUT', message: 'Send the request as JSON.' } })
      return
    }
    next()
  }

  async function authenticated(request: Request, response: Response) {
    const session = await service.current(providerHeaders(request.headers))
    forwardCookies(response, session.headers)
    if (!session.context || !session.internalSessionId) throw new AuthFailure('SESSION_REQUIRED', 401)
    if (session.context.role !== 'LINE_MANAGER') throw new AuthFailure('FORBIDDEN', 403)
    return { context: session.context, sessionId: session.internalSessionId }
  }

  const json = express.json({ limit: '32kb', strict: true, verify: (_req, _res, body) => { if (!body.length) throw badRequest() } })
  const write: RequestHandler = async (request, response) => {
    const actor = await authenticated(request, response)
    const requestId = requestIdentity(request.get('idempotency-key'))
    let command: ManagerCommand
    if (request.path === '/reminders') command = reminderInput(request.body)
    else {
      const input = parseOperation('COMMENT', request.params.taskId, request.body, undefined)
      if (input.kind !== 'COMMENT') throw badRequest()
      command = { operation: 'LM_TASK_COMMENT', taskId: input.taskId, body: input.body }
    }
    await reserve(db, throttleKey(config.secret, 'manager-write-ip', request.socket.remoteAddress ?? 'unknown'), 300, 60)
    await reserve(db, throttleKey(config.secret, 'manager-write-user', actor.context.user.id), 60, 60)
    response.json(await mutateDashboard(db, actor, requestId, command))
  }

  router.all('/dashboard', validate(false), async (request, response) => {
    response.json(await readDashboard(db, await authenticated(request, response), request.originalUrl))
  })
  router.all(['/my-tasks', '/my-tasks/:taskId'], validate(false), async (request, response) => {
    const actor = await authenticated(request, response)
    const id = request.params.taskId === undefined ? null : taskIdentity(request.params.taskId)
    const result = await db.$transaction(async (tx) => {
      const { at } = await managerPrincipal(tx, actor)
      const query = readQuery(request.originalUrl, id !== null, at)
      return id === null ? readOwnHome(tx, actor.context, query, at, 'LINE_MANAGER')
        : readTaskDetail(tx, actor.context, id, query, at, 'LINE_MANAGER')
    }, { isolationLevel: 'RepeatableRead', maxWait: 5000, timeout: 15000 })
    response.json(result)
  })
  router.all('/team-tasks/:taskId', validate(false), async (request, response) => {
    response.json(await readTeamTask(db, await authenticated(request, response), taskIdentity(request.params.taskId), detailPage(request.originalUrl)))
  })
  router.all('/team-history', validate(false), async (request, response) => {
    response.json(await readTeamHistory(db, await authenticated(request, response), request.originalUrl))
  })
  router.all('/team-history/people', validate(false), async (request, response) => {
    response.json(await readTeamPeople(db, await authenticated(request, response), request.originalUrl))
  })
  router.all('/team-history/:personId/weeks/:week', validate(false), async (request, response) => {
    const actor = await authenticated(request, response)
    const week = request.params.week
    if (typeof week !== 'string') throw badRequest()
    response.json(await readTeamWeek(db, actor, taskIdentity(request.params.personId), managerWeek(week), request.originalUrl))
  })
  router.all(['/reminders', '/team-tasks/:taskId/comments'], validate(true), json, write)
  router.all('/leave/history', validate(false), async (request, response) => {
    response.json(await readManagerLeaveHistory(db, await authenticated(request, response), request.originalUrl))
  })
  router.all('/leave/relief-candidates', validate(false), async (request, response) => {
    response.json(await readReliefCandidates(db, await authenticated(request, response), request.originalUrl))
  })
  router.all('/leave/:leaveId/cover-history', validate(false), async (request, response) => {
    response.json(await readCoverHistory(db, await authenticated(request, response), request.originalUrl, taskIdentity(request.params.leaveId)))
  })
  function managerLeaveWrite(kind: ManagerLeaveOperation['kind']): RequestHandler {
    return async (request, response) => {
      const actor = await authenticated(request, response)
      await reserve(db, throttleKey(config.secret, 'leave-write-ip', clientIp(request)), 300, 60)
      await reserve(db, throttleKey(config.secret, 'leave-write-user', actor.context.user.id), 60, 60)
      const key = requestIdentity(request.get('idempotency-key'))
      const operation = managerLeaveInput(kind, request.params.leaveId, request.body)
      response.json(await mutateManagerLeave(db, actor, key, operation))
    }
  }
  router.all('/leave', (request, response, next) => validate(request.method === 'POST')(request, response, next),
    async (request, response, next) => {
      if (request.method === 'POST') { next(); return }
      response.json(await readManagerLeave(db, await authenticated(request, response), request.originalUrl))
    }, json, managerLeaveWrite('MANAGER_CREATE'))
  router.all('/leave/:leaveId/cancel', validate(true), json, managerLeaveWrite('MANAGER_CANCEL'))
  router.all('/leave/:leaveId/return', validate(true), json, managerLeaveWrite('MANAGER_RETURN'))
  router.all('/leave/:leaveId/cover', validate(true), json, managerLeaveWrite('RELIEF_REPLACE'))
  router.all('/leave/:leaveId/cover/end', validate(true), json, managerLeaveWrite('RELIEF_END'))
  router.all('/approvals', validate(false), async (request, response) => {
    response.json(await readApprovals(db, await authenticated(request, response), request.originalUrl))
  })
  router.all('/approvals/people', validate(false), async (request, response) => {
    response.json(await readApprovalPeople(db, await authenticated(request, response), request.originalUrl))
  })
  router.all('/approvals/summary', validate(false), async (request, response) => {
    const actor = await authenticated(request, response)
    selectors(request.originalUrl, [])
    response.json(await db.$transaction((tx) => reviewSummary(tx, actor), readBounds))
  })
  router.all('/approvals/people/:personId/pending', validate(false), async (request, response) => {
    response.json(await readReviewPerson(db, await authenticated(request, response), request.originalUrl, taskIdentity(request.params.personId)))
  })
  router.all('/approvals/requests/:requestId', validate(false), async (request, response) => {
    response.json(await readReviewDetail(db, await authenticated(request, response), taskIdentity(request.params.requestId), detailPage(request.originalUrl)))
  })
  router.all(['/approvals/approve-batch', '/approvals/requests/:requestId/:action'], validate(true), json, async (request, response) => {
    const actor = await authenticated(request, response)
    const action = request.path === '/approvals/approve-batch' ? 'batch' : request.params.action
    if (action !== 'approve' && action !== 'decline' && action !== 'comments' && action !== 'batch') throw badRequest()
    if (action === 'batch' && request.path !== '/approvals/approve-batch') throw badRequest()
    const requestId = requestIdentity(request.get('idempotency-key'))
    const command = approvalInput(action, request.params.requestId, request.body)
    await reserve(db, throttleKey(config.secret, 'manager-write-ip', request.socket.remoteAddress ?? 'unknown'), 300, 60)
    await reserve(db, throttleKey(config.secret, 'manager-write-user', actor.context.user.id), 60, 60)
    const result = await mutateApproval(db, actor, requestId, command)
    if (!result.replayed) requestEmailPass()
    const summary = await db.$transaction((tx) => reviewSummary(tx, actor), readBounds).catch(() => null)
    response.json({ ...result, summary })
  })
  const errors: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
    const status = error && typeof error === 'object' && 'status' in error ? error.status : null
    const failure = error instanceof AuthFailure || error instanceof ManagerFailure || error instanceof EmployeeFailure || error instanceof TaskFailure || error instanceof LeaveFailure
      ? error : status === 400 || error instanceof URIError ? badRequest() : new AuthFailure('SERVICE_UNAVAILABLE', 503)
    if (status === 413 || status === 415) {
      response.status(status).json({ error: { code: 'INVALID_INPUT', message: status === 413 ? 'The request is too large.' : 'Send the request as JSON.' } })
      return
    }
    if (failure.status >= 500) console.error('LINE_MANAGER_REQUEST_FAILED')
    if (failure instanceof AuthFailure && failure.retryAfter) response.setHeader('Retry-After', failure.retryAfter)
    response.status(failure.status).json({ error: { code: failure.code, message: failure.message,
      ...(failure instanceof TaskFailure || failure instanceof LeaveFailure ? { fields: failure.fields } : {}) } })
  }
  router.use(errors)
  api.use('/line-manager', router)
}
