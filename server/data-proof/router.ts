import express from 'express'
import type { ErrorRequestHandler, Request, Router } from 'express'
import { Prisma } from '../../src/generated/prisma/client.ts'
import type { PrismaClient } from '../../src/generated/prisma/client.ts'
import { normalizeProofText, normalizeSubmissionId } from '../../src/features/data-proof/validation.ts'
import { proofAvailable, proofRequestAllowed } from './access.ts'

const actorId = 'person-ada-okafor'
const weekId = 'week-2026-10-26'
const trackerId = 'tracker-ada-okafor-2026-10-26'
const sampleDate = '2026-10-26'
export const proofTaskIds = ['task-2026-10-19-ada-okafor-prepare-next-month-s-hiring-plan-carry'] as const
const pageSize = 20
const transactionOptions = { maxWait: 5000, timeout: 5000 }

const failures = {
  INVALID_INPUT: [400, 'Check the request and reply. Use 1 to 500 characters.'],
  FORBIDDEN_ORIGIN: [403, 'This proof requires a request from the local app.'],
  TASK_NOT_FOUND: [404, 'The sample task is not available.'],
  NOT_FOUND: [404, 'This proof resource was not found.'],
  METHOD_NOT_ALLOWED: [405, 'This method is not available.'],
  SUBMISSION_CONFLICT: [409, 'This submission identity has already been used for a different reply.'],
  PAYLOAD_TOO_LARGE: [413, 'The reply request is too large.'],
  UNSUPPORTED_MEDIA_TYPE: [415, 'Send the reply as UTF-8 JSON.'],
  FIXTURES_UNAVAILABLE: [503, 'Sample data is unavailable. Run migrations and seed commands.'],
  DATABASE_UNAVAILABLE: [503, 'The database is unavailable. Try again after it recovers.'],
  INTERNAL_ERROR: [500, 'The proof request could not be completed.'],
} as const

class ProofError extends Error {
  readonly code: keyof typeof failures
  constructor(code: keyof typeof failures) { super(code); this.code = code }
}

function readPage(request: Request) {
  const query = new URL(request.originalUrl, 'http://localhost').searchParams
  const keys = Array.from(query.keys())
  if (keys.some((key) => key !== 'page') || query.getAll('page').length > 1) throw new ProofError('INVALID_INPUT')
  const value = query.get('page') ?? '1'
  if (!/^[1-9][0-9]*$/.test(value) || Number(value) > 10000) throw new ProofError('INVALID_INPUT')
  return Number(value)
}

function readTaskId(request: Request) {
  const value = request.params.taskId
  if (typeof value !== 'string' || !/^[A-Za-z0-9-]{1,300}$/.test(value)) throw new ProofError('INVALID_INPUT')
  if (!proofTaskIds.some((id) => id === value)) throw new ProofError('TASK_NOT_FOUND')
  return value
}

const commentSelect = {
  id: true, weeklyTaskId: true, body: true, createdAt: true,
  author: { select: { id: true, name: true } },
} satisfies Prisma.TaskCommentSelect

type CommentRow = Prisma.TaskCommentGetPayload<{ select: typeof commentSelect }>
const commentOutput = (row: CommentRow) => ({ ...row, createdAt: row.createdAt.toISOString(), author: { id: row.author.id, name: row.author.name ?? 'Unknown author' } })

async function requireContext(tx: Prisma.TransactionClient) {
  const actor = await tx.user.findUnique({ where: { id: actorId }, select: { id: true, name: true, accountStatus: true } })
  const week = await tx.workWeek.findUnique({ where: { id: weekId }, select: { id: true, startsOn: true } })
  const tracker = await tx.weeklyTracker.findUnique({ where: { id: trackerId }, select: { userId: true, weekId: true } })
  if (!actor || actor.accountStatus !== 'ACTIVE' || !week || week.startsOn.toISOString().slice(0, 10) !== sampleDate || tracker?.userId !== actorId || tracker.weekId !== weekId) throw new ProofError('FIXTURES_UNAVAILABLE')
  return { actor: { id: actor.id, name: actor.name ?? 'Unknown author' }, week: { id: week.id, startsOn: sampleDate } }
}

const taskScope = {
  id: { in: [...proofTaskIds] }, ownerId: actorId, trackerId, deletedAt: null,
  tracker: { userId: actorId, weekId, week: { startsOn: new Date(`${sampleDate}T00:00:00.000Z`) } },
} satisfies Prisma.WeeklyTaskWhereInput

async function requireTask(tx: Prisma.TransactionClient, id: string) {
  await requireContext(tx)
  if (!await tx.weeklyTask.findFirst({ where: { ...taskScope, id }, select: { id: true } })) throw new ProofError('TASK_NOT_FOUND')
}

function input(value: unknown) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new ProofError('INVALID_INPUT')
  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
  const submissionId = normalizeSubmissionId(record.submissionId)
  const body = normalizeProofText(record.body)
  if (keys.length !== 2 || keys.some((key) => key !== 'submissionId' && key !== 'body') || !submissionId || body === null) throw new ProofError('INVALID_INPUT')
  return { submissionId, body }
}

export function registerDataProof(api: Router, prisma: PrismaClient, config: { development: boolean; host: string; port: number; connectionString: string }) {
  if (!proofAvailable(config)) return
  const router = express.Router()
  router.use((request, response, next) => {
    response.setHeader('Cache-Control', 'no-store')
    if (!proofRequestAllowed(request, config.port)) return next(new ProofError('FORBIDDEN_ORIGIN'))
    next()
  })

  router.get('/tasks', async (request, response) => {
    const page = readPage(request)
    const result = await prisma.$transaction(async (tx) => {
      const context = await requireContext(tx)
      const rows = await tx.weeklyTask.findMany({ where: taskScope, select: { id: true, title: true, activity: true, status: true, startsOn: true, endsOn: true }, orderBy: [{ startsOn: 'asc' }, { id: 'asc' }], skip: (page - 1) * pageSize, take: pageSize + 1 })
      return { ...context, items: rows.slice(0, pageSize).map((row) => ({ ...row, startsOn: row.startsOn.toISOString().slice(0, 10), endsOn: row.endsOn.toISOString().slice(0, 10) })), page, pageSize, hasMore: rows.length > pageSize }
    }, transactionOptions)
    response.json(result)
  })

  router.get('/tasks/:taskId/comments', async (request, response) => {
    const page = readPage(request)
    const taskId = readTaskId(request)
    const rows = await prisma.$transaction(async (tx) => {
      await requireTask(tx, taskId)
      return tx.taskComment.findMany({ where: { weeklyTaskId: taskId }, select: commentSelect, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * pageSize, take: pageSize + 1 })
    }, transactionOptions)
    response.json({ items: rows.slice(0, pageSize).map(commentOutput), page, pageSize, hasMore: rows.length > pageSize })
  })

  router.post('/tasks/:taskId/comments', (request, _response, next) => {
    if (!request.is('application/json')) return next(new ProofError('UNSUPPORTED_MEDIA_TYPE'))
    next()
  }, express.json({ limit: '16kb', strict: false }), async (request, response) => {
    readPage(request)
    if (new URL(request.originalUrl, 'http://localhost').search) throw new ProofError('INVALID_INPUT')
    const taskId = readTaskId(request)
    const { submissionId, body } = input(request.body as unknown)
    const id = `proof-comment-${submissionId}`
    try {
      const comment = await prisma.$transaction(async (tx) => {
        await requireTask(tx, taskId)
        return tx.taskComment.create({ data: { id, weeklyTaskId: taskId, authorId: actorId, body }, select: commentSelect })
      }, transactionOptions)
      response.status(201).json({ comment: commentOutput(comment), replayed: false })
    } catch (error: unknown) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error
      // The failed unique insert's transaction has ended. Revalidate in a new one.
      const existing = await prisma.$transaction(async (tx) => {
        await requireTask(tx, taskId)
        return tx.taskComment.findUnique({ where: { id }, select: commentSelect })
      }, transactionOptions)
      if (!existing || existing.weeklyTaskId !== taskId || existing.author.id !== actorId || existing.body !== body) throw new ProofError('SUBMISSION_CONFLICT')
      response.json({ comment: commentOutput(existing), replayed: true })
    }
  })

  router.all('/tasks', (_request, response, next) => { response.setHeader('Allow', 'GET, HEAD'); next(new ProofError('METHOD_NOT_ALLOWED')) })
  router.all('/tasks/:taskId/comments', (_request, response, next) => { response.setHeader('Allow', 'GET, HEAD, POST'); next(new ProofError('METHOD_NOT_ALLOWED')) })
  router.use((_request, _response, next) => next(new ProofError('NOT_FOUND')))
  const handleError: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
    let code: keyof typeof failures = 'INTERNAL_ERROR'
    if (error instanceof ProofError) code = error.code
    else if (typeof error === 'object' && error !== null && 'type' in error && typeof error.type === 'string') {
      code = error.type === 'entity.too.large' ? 'PAYLOAD_TOO_LARGE' : error.type === 'entity.parse.failed' ? 'INVALID_INPUT' : error.type === 'charset.unsupported' || error.type === 'encoding.unsupported' ? 'UNSUPPORTED_MEDIA_TYPE' : 'INVALID_INPUT'
    } else if (error instanceof URIError) code = 'INVALID_INPUT'
    else if (error instanceof Prisma.PrismaClientKnownRequestError) code = ['P2021', 'P2022'].includes(error.code) ? 'FIXTURES_UNAVAILABLE' : 'DATABASE_UNAVAILABLE'
    else if (error instanceof Prisma.PrismaClientInitializationError || error instanceof Prisma.PrismaClientUnknownRequestError || error instanceof Prisma.PrismaClientRustPanicError) code = 'DATABASE_UNAVAILABLE'
    if (failures[code][0] >= 500) console.error(`data_proof_${code.toLowerCase()}`)
    response.status(failures[code][0]).json({ error: { code, message: failures[code][1] } })
  }
  router.use(handleError)
  api.use('/dev/data-proof', router)
}
