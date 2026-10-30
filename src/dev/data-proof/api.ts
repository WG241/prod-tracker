export type ProofTask = { id: string; title: string; activity: string; status: string; startsOn: string; endsOn: string }
export type ProofComment = { id: string; weeklyTaskId: string; body: string; createdAt: string; author: { id: string; name: string } }
export type ProofPage<T> = { items: T[]; page: number; pageSize: number; hasMore: boolean }
export type TaskPage = ProofPage<ProofTask> & { actor: { id: string; name: string }; week: { id: string; startsOn: string } }
export type SavedReply = { comment: ProofComment; replayed: boolean }

export class ProofRequestError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code }
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid proof response')
  return value as Record<string, unknown>
}
function text(value: unknown) {
  if (typeof value !== 'string') throw new Error('Invalid proof response')
  return value
}
function person(value: unknown) {
  const row = object(value)
  return { id: text(row.id), name: text(row.name) }
}
function task(value: unknown): ProofTask {
  const row = object(value)
  return { id: text(row.id), title: text(row.title), activity: text(row.activity), status: text(row.status), startsOn: text(row.startsOn), endsOn: text(row.endsOn) }
}
function comment(value: unknown): ProofComment {
  const row = object(value)
  return { id: text(row.id), weeklyTaskId: text(row.weeklyTaskId), body: text(row.body), createdAt: text(row.createdAt), author: person(row.author) }
}
function page<T>(value: unknown, parse: (row: unknown) => T): ProofPage<T> {
  const row = object(value)
  if (!Array.isArray(row.items) || row.items.length > 20 || typeof row.page !== 'number' || !Number.isInteger(row.page) || row.page < 1 || row.page > 10000 || row.pageSize !== 20 || typeof row.hasMore !== 'boolean') throw new Error('Invalid proof response')
  return { items: row.items.map(parse), page: row.page, pageSize: 20, hasMore: row.hasMore }
}
function taskPage(value: unknown): TaskPage {
  const row = object(value)
  const week = object(row.week)
  return { ...page(row, task), actor: person(row.actor), week: { id: text(week.id), startsOn: text(week.startsOn) } }
}

async function request<T>(path: string, decode: (value: unknown) => T, options?: RequestInit) {
  try {
    const deadline = AbortSignal.timeout(12000)
    const signal = options?.signal ? AbortSignal.any([options.signal, deadline]) : deadline
    const response = await fetch(`/api/dev/data-proof${path}`, { ...options, signal, cache: 'no-store' })
    const value: unknown = await response.json()
    if (!response.ok) {
      const error = object(object(value).error)
      throw new ProofRequestError(response.status, text(error.code), text(error.message))
    }
    return decode(value)
  } catch (error: unknown) {
    if (error instanceof ProofRequestError) throw error
    throw new ProofRequestError(0, 'UNCONFIRMED', 'The local app could not confirm this request.')
  }
}

export const loadTasks = (pageNumber: number, signal: AbortSignal) => request(`/tasks?page=${pageNumber}`, taskPage, { signal })
export const loadComments = (taskId: string, pageNumber: number, signal: AbortSignal) => request(`/tasks/${encodeURIComponent(taskId)}/comments?page=${pageNumber}`, (value) => page(value, comment), { signal })
export const postReply = (taskId: string, submissionId: string, body: string, signal: AbortSignal) => request(`/tasks/${encodeURIComponent(taskId)}/comments`, (value): SavedReply => {
  const row = object(value)
  if (typeof row.replayed !== 'boolean') throw new Error('Invalid proof response')
  const saved = comment(row.comment)
  if (saved.id !== `proof-comment-${submissionId}` || saved.weeklyTaskId !== taskId || saved.body !== body) throw new Error('Invalid proof response')
  return { comment: saved, replayed: row.replayed }
}, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ submissionId, body }), signal })
