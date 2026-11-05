import type { Router } from 'express'
import type { PrismaClient } from '../../src/generated/prisma/client.ts'
import type { AuthConfig } from '../auth/config.ts'
import type { AuthService } from '../auth/service.ts'
import { providerHeaders } from '../auth/service.ts'
import { forwardCookies } from '../auth/router.ts'
import { EmployeeFailure, readQuery } from './calendar.ts'
import { readDetail, readHome } from './reads.ts'
import { registerTaskWrites } from './write-router.ts'
import { historyQuery, readHistory } from './history-reads.ts'
import { registerLeave } from './leave-router.ts'

export function registerEmployee(api: Router, db: PrismaClient, service: AuthService, config: AuthConfig) {
  registerTaskWrites(api, db, service, config)
  registerLeave(api, db, service, config)
  api.all(['/employee/home', '/employee/history', '/employee/tasks/:taskId'], async (request, response) => {
    response.setHeader('Cache-Control', 'no-store')
    try {
      const asOf = new Date()
      const origin = request.get('origin'), site = request.get('sec-fetch-site')
      if ((origin && origin !== config.origin) || (site && site !== 'same-origin' && site !== 'none')) throw new EmployeeFailure('FORBIDDEN', 403)
      if (request.method !== 'GET' || request.get('transfer-encoding') || Number(request.get('content-length') ?? 0) > 0) throw new EmployeeFailure('INVALID_INPUT', 400)
      const result = await service.current(providerHeaders(request.headers))
      forwardCookies(response, result.headers)
      if (!result.context) throw new EmployeeFailure('SESSION_REQUIRED', 401)
      if (result.context.role !== 'EMPLOYEE') throw new EmployeeFailure('FORBIDDEN', 403)
      if (request.path === '/employee/history') { response.json(await readHistory(db, result.context, historyQuery(request.originalUrl), asOf)); return }
      const taskId = request.params.taskId
      const query = readQuery(request.originalUrl, taskId !== undefined, asOf)
      if (taskId !== undefined && (typeof taskId !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(taskId))) throw new EmployeeFailure('INVALID_INPUT', 400)
      response.json(taskId === undefined ? await readHome(db, result.context, query, asOf) : await readDetail(db, result.context, taskId, query, asOf))
    } catch (error) {
      const failure = error instanceof EmployeeFailure ? error : new EmployeeFailure('SERVICE_UNAVAILABLE', 503)
      if (failure.status === 503) console.error('Employee read failure', error)
      response.status(failure.status).json({ error: { code: failure.code, message: failure.message } })
    }
  })
}
