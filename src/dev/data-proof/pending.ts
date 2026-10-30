import { normalizeProofText, normalizeSubmissionId } from '../../features/data-proof/validation.ts'

export type PendingReply = { taskId: string; submissionId: string; body: string }
const storageKey = 'workforce:data-proof:pending:v1'

export function recoverPending(): { pending: PendingReply | null; storageError: string } {
  try {
    const stored = sessionStorage.getItem(storageKey)
    if (!stored) return { pending: null, storageError: '' }
    const value: unknown = JSON.parse(stored)
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid recovery data')
    const row = value as Record<string, unknown>
    if (Object.keys(row).length !== 3 || typeof row.taskId !== 'string' || !/^[A-Za-z0-9-]{1,300}$/.test(row.taskId) || typeof row.submissionId !== 'string' || typeof row.body !== 'string' || normalizeSubmissionId(row.submissionId) !== row.submissionId || normalizeProofText(row.body) !== row.body) throw new Error('Invalid recovery data')
    return { pending: { taskId: row.taskId, submissionId: row.submissionId as string, body: row.body as string }, storageError: '' }
  } catch {
    return { pending: null, storageError: 'Retry recovery data could not be read. Restore this tab’s storage before posting a reply.' }
  }
}

export function rememberPending(pending: PendingReply) {
  const stored = JSON.stringify(pending)
  sessionStorage.setItem(storageKey, stored)
  if (sessionStorage.getItem(storageKey) !== stored) throw new Error('Retry storage unavailable')
}

export function forgetPending() {
  sessionStorage.removeItem(storageKey)
  if (sessionStorage.getItem(storageKey) !== null) throw new Error('Retry storage unavailable')
}
