import { constants, createReadStream } from 'node:fs'
import { open } from 'node:fs/promises'
import { segments } from './files.ts'
import { object, recordBytes, validFrame, validRecord } from './records.ts'
import type { TelemetryRecord } from './records.ts'

export type ReadItem = { type: 'record'; record: TelemetryRecord } | { type: 'malformed' } | { type: 'incomplete' }

// A malformed file cannot turn readline's buffer into an unbounded allocation.
export async function* readRecords(directory: string, inventory: ReadonlySet<string>): AsyncGenerator<ReadItem> {
  for (const segment of await segments(directory)) {
    const handle = await open(segment.path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    try {
      const info = await handle.stat()
      if (!info.isFile()) continue
      const stream = createReadStream(segment.path, { fd: handle.fd, autoClose: false, highWaterMark: 16 * 1024 })
      let pending = Buffer.alloc(0)
      let oversized = false
      for await (const chunk of stream) {
        const buffer = chunk as Buffer
        let offset = 0
        while (offset < buffer.length) {
          const end = buffer.indexOf(10, offset)
          const piece = buffer.subarray(offset, end < 0 ? buffer.length : end)
          if (!oversized && pending.length + piece.length + 1 > recordBytes) { oversized = true; pending = Buffer.alloc(0) }
          if (!oversized) pending = Buffer.concat([pending, piece])
          if (end < 0) break
          if (oversized) yield { type: 'malformed' }
          else {
            let value: unknown
            try { value = JSON.parse(pending.toString('utf8')) } catch { /* report damaged line without echoing it */ }
            // Old bundles may no longer be in the current inventory. Keep the
            // fixed error category while omitting unverifiable locations.
            if (object(value) && value.kind === 'error' && Array.isArray(value.frames) && value.frames.length <= 10) value.frames = value.frames.filter((frame) => validFrame(frame, inventory))
            if (validRecord(value, inventory)) yield { type: 'record', record: value }
            else yield { type: 'malformed' }
          }
          pending = Buffer.alloc(0)
          oversized = false
          offset = end + 1
        }
      }
      if (pending.length || oversized) yield { type: 'incomplete' }
    } finally { await handle.close() }
  }
}

export type Filters = { includeSynthetic?: boolean; from?: Date; to?: Date; kind?: TelemetryRecord['kind'] | 'all' }
export function matches(record: TelemetryRecord, filter: Filters) {
  const at = new Date(record.kind === 'product' ? record.occurredAt : record.observedAt)
  return (filter.includeSynthetic || !record.synthetic) && (!filter.kind || filter.kind === 'all' || record.kind === filter.kind)
    && (!filter.from || at >= filter.from) && (!filter.to || at < filter.to)
}
export function calendarBoundary(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Dates must use YYYY-MM-DD')
  const utc = new Date(`${value}T00:00:00.000Z`)
  if (!Number.isFinite(utc.getTime()) || utc.toISOString().slice(0, 10) !== value) throw new Error('Invalid calendar date')
  // Existing project convention: Africa/Lagos uses UTC+01:00, no daylight saving.
  return new Date(`${value}T00:00:00.000+01:00`)
}
export async function inspect(directory: string, inventory: ReadonlySet<string>, filter: Filters = {}, limit = 20) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new Error('Limit must be 1 through 500')
  const records: TelemetryRecord[] = []
  const seen = new Set<string>()
  let malformed = 0; let incomplete = 0; let duplicates = 0
  for await (const item of readRecords(directory, inventory)) {
    if (item.type === 'malformed') { malformed++; continue }
    if (item.type === 'incomplete') { incomplete++; continue }
    const id = item.record.id.toLowerCase()
    if (seen.has(id)) { duplicates++; continue }
    seen.add(id)
    if (!matches(item.record, filter)) continue
    records.push(item.record)
    records.sort((a, b) => b.observedAt.localeCompare(a.observedAt) || a.id.localeCompare(b.id))
    if (records.length > limit) records.pop()
  }
  return { records, malformed, incomplete, duplicates }
}
export async function summarize(directory: string, inventory: ReadonlySet<string>, filter: Filters = {}, now = new Date()) {
  const seen = new Set<string>()
  const products: Record<string, number> = {}
  const errors: Record<string, number> = {}
  let earliest: string | null = null; let latest: string | null = null
  let health: Extract<TelemetryRecord, { kind: 'health' }> | null = null
  let malformed = 0; let incomplete = 0; let duplicates = 0; let matched = 0
  for await (const item of readRecords(directory, inventory)) {
    if (item.type === 'malformed') { malformed++; continue }
    if (item.type === 'incomplete') { incomplete++; continue }
    const record = item.record
    const id = record.id.toLowerCase()
    if (seen.has(id)) { duplicates++; continue }
    seen.add(id)
    if (!matches(record, filter)) continue
    matched++
    const at = record.kind === 'product' ? record.occurredAt : record.observedAt
    if (!earliest || at < earliest) earliest = at
    if (!latest || at > latest) latest = at
    if (record.kind === 'health') { if (!health || record.observedAt > health.observedAt) health = record }
    else if (record.kind === 'error') {
      const key = `${record.code}/${record.source}`
      errors[key] = (errors[key] ?? 0) + 1
    } else {
      const key = [record.name, record.role, record.method, record.timing].filter(Boolean).join('/')
      products[key] = (products[key] ?? 0) + 1
    }
  }
  return { matched, earliest, latest, products, errors, malformed, incomplete, duplicates,
    health: health ? { asOf: health.observedAt, ageSeconds: Math.max(0, Math.floor((now.getTime() - Date.parse(health.observedAt)) / 1000)),
      runId: health.runId, queueDepth: health.queueDepth, written: health.written, dropped: health.dropped, invalid: health.invalid, writeFailures: health.writeFailures } : null }
}
