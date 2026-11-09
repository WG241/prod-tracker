import type { MessageSnapshot } from './message.ts'

export type SendOutcome =
  | { kind: 'accepted'; id: string }
  | { kind: 'retry'; code: 'PROVIDER_RETRY'; delayMs: number }
  | { kind: 'unknown'; code: 'ACCEPTANCE_UNKNOWN' }
  | { kind: 'failed'; code: 'PROVIDER_REJECTED' | 'PAYLOAD_CONFLICT' | 'PREVIEW_WRITE_FAILED' }
  | { kind: 'previewed' }

function retryAfter(value: string | null) {
  if (!value) return 0
  const delay = /^\d+$/.test(value) ? Number(value) * 1000 : Date.parse(value) - Date.now()
  return Number.isFinite(delay) ? Math.max(0, delay) : 0
}

async function readSmallJson(response: Response): Promise<unknown> {
  const stream = response.body?.getReader()
  if (!stream) return null
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    for (;;) {
      const { done, value } = await stream.read()
      if (done) break
      length += value.byteLength
      if (length > 16384) { await stream.cancel(); return null }
      chunks.push(value)
    }
    return JSON.parse(Buffer.concat(chunks, length).toString('utf8')) as unknown
  } finally { stream.releaseLock() }
}

export async function sendResend(apiKey: string, key: string, { from, to, subject, text }: MessageSnapshot, fetcher: typeof fetch = fetch): Promise<SendOutcome> {
  try {
    const response = await fetcher('https://api.resend.com/emails', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000),
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': key },
      body: JSON.stringify({ from: `Workforce <${from}>`, to: [to], subject, text }),
    })
    if (response.ok || response.status === 409) {
      const value = await readSmallJson(response)
      if (value && typeof value === 'object') {
        if (response.ok && 'id' in value && typeof value.id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value.id)) return { kind: 'accepted', id: value.id }
        if (response.status === 409 && 'name' in value && value.name === 'concurrent_idempotent_requests') return { kind: 'retry', code: 'PROVIDER_RETRY', delayMs: retryAfter(response.headers.get('retry-after')) }
        if (response.status === 409 && 'name' in value && value.name === 'invalid_idempotent_request') return { kind: 'failed', code: 'PAYLOAD_CONFLICT' }
      }
      return { kind: 'unknown', code: 'ACCEPTANCE_UNKNOWN' }
    }
    void response.body?.cancel().catch(() => {})
    if ([429, 500, 502, 503, 504].includes(response.status)) return { kind: 'retry', code: 'PROVIDER_RETRY', delayMs: retryAfter(response.headers.get('retry-after')) }
    if ([400, 401, 403, 404, 422].includes(response.status)) return { kind: 'failed', code: 'PROVIDER_REJECTED' }
  } catch { /* A transport or response failure leaves acceptance unresolved. */ }
  return { kind: 'unknown', code: 'ACCEPTANCE_UNKNOWN' }
}
