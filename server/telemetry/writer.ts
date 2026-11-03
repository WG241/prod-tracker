import { randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import type { WriteStream } from 'node:fs'
import { lstat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { baseRecord, encodeRecord } from './records.ts'
import type { Counters, Environment, TelemetryRecord } from './records.ts'
import { defaults, isMissing, prepareDirectory, segments } from './files.ts'

type Active = { stream: WriteStream; path: string; day: string; size: number; failed: boolean }
type Entry = { line: string; day: string; family: 'errors' | 'events' }
type DiagnosticStream = { write: (line: string) => boolean; once: (event: 'drain', listener: () => void) => unknown }
export type WriterOptions = {
  root: string
  directory: string
  environment: Environment | null
  inventory: ReadonlySet<string>
  enabled?: boolean
  now?: () => Date
  // Smaller bounds and injected streams are used by isolated tests only.
  limits?: Partial<typeof defaults>
  openStream?: typeof createWriteStream
  stderr?: DiagnosticStream
}

/** One process owns a directory. Offers never wait for filesystem work. */
export class LocalTelemetryWriter {
  readonly runId = randomUUID()
  private readonly queue: Entry[] = []
  private readonly active = new Map<Entry['family'], Active>()
  private readonly counts = { written: 0, dropped: 0, invalid: 0, writeFailures: 0 }
  private readonly options: WriterOptions
  private readonly limits: typeof defaults
  private readonly now: () => Date
  private readonly openStream: typeof createWriteStream
  private readonly stderr: DiagnosticStream
  private processing: Promise<void> | null = null
  private prepared = false
  private readyToRetryAt = 0
  private nextDiagnosticAt = 0
  private stderrBlocked = false
  private nextHealthAt = 0
  private healthPending = false
  private nextMaintenanceAt = 0
  private stopping = false
  private abandoned = false
  private readonly timer: NodeJS.Timeout
  private retryTimer?: NodeJS.Timeout

  constructor(options: WriterOptions) {
    this.options = options
    this.now = options.now ?? (() => new Date())
    this.limits = { ...defaults, ...options.limits }
    if (this.limits.queueSize < 1 || this.limits.queueSize > 256 || this.limits.retryMs < 1000 || this.limits.retentionDays > 30
      || this.limits.totalBytes > defaults.totalBytes || this.limits.segmentBytes > defaults.segmentBytes
      || Object.values(this.limits).some((number) => !Number.isSafeInteger(number) || number < 1)) throw new Error('Invalid telemetry bounds')
    this.openStream = options.openStream ?? createWriteStream
    this.stderr = options.stderr ?? process.stderr
    this.timer = setInterval(() => this.kick(), this.limits.maintenanceMs).unref()
    this.kick()
  }

  get counters(): Counters { return { queueDepth: this.queue.length, ...this.counts } }

  offer(record: unknown): boolean {
    if (this.options.enabled === false) return false
    const line = encodeRecord(record, this.options.inventory)
    if (!line) { this.counts.invalid++; this.diagnostic(); return false }
    if (this.stopping || this.queue.length >= this.limits.queueSize) { this.counts.dropped++; this.diagnostic(); return false }
    const valid = record as TelemetryRecord
    this.queue.push({ line, day: valid.observedAt.slice(0, 10), family: valid.kind === 'product' ? 'events' : 'errors' })
    this.kick()
    return true
  }

  private diagnostic() {
    const at = this.now().getTime()
    if (this.stderrBlocked || at < this.nextDiagnosticAt) return
    this.nextDiagnosticAt = at + 60_000
    // Fixed keys and numeric counters only. Never forward a caught exception.
    try {
      if (!this.stderr.write(`${JSON.stringify({ code: 'TELEMETRY_DEGRADED', ...this.counters })}\n`)) {
        this.stderrBlocked = true
        this.stderr.once('drain', () => { this.stderrBlocked = false })
      }
    } catch { /* A failed terminal is not a new reporting channel. */ }
  }

  private kick() {
    if (this.processing || this.abandoned || (this.stopping && !this.queue.length)) return
    const remaining = this.readyToRetryAt - this.now().getTime()
    if (remaining > 0) {
      if (!this.retryTimer) this.retryTimer = setTimeout(() => { this.retryTimer = undefined; this.kick() }, remaining).unref()
      return
    }
    this.processing = this.work().catch(() => {
      this.counts.writeFailures++
      this.readyToRetryAt = this.now().getTime() + this.limits.retryMs
      for (const file of this.active.values()) file.stream.destroy()
      this.active.clear()
      this.prepared = false
      this.diagnostic()
    }).finally(() => {
      this.processing = null
      if (this.queue.length && !this.abandoned) this.kick()
    })
  }

  private async work() {
    if (!this.prepared) {
      this.prepared = await prepareDirectory(this.options.root, this.options.directory, this.options.enabled !== false)
    }
    if (!this.prepared || this.abandoned) return
    const time = this.now().getTime()
    if (time >= this.nextMaintenanceAt) {
      this.nextMaintenanceAt = time + this.limits.maintenanceMs
      await this.maintain(0)
    }
    if (this.options.enabled !== false && !this.stopping && time >= this.nextHealthAt && this.queue.length < this.limits.queueSize) {
      this.nextHealthAt = time + 30_000
      this.healthPending = true
    }
    while (this.queue.length && !this.abandoned) {
      const entry = this.queue[0]
      try { await this.write(entry) } catch (error) {
        // The failed entry is lost, never retried after a possibly partial append.
        if (!this.abandoned) { this.queue.shift(); this.counts.dropped++ }
        throw error
      }
      if (!this.abandoned) { this.queue.shift(); this.counts.written++ }
    }
    if (this.healthPending && !this.abandoned && !this.stopping && this.options.environment) {
      this.healthPending = false
      const record = { ...baseRecord(this.options.environment, false, this.now()), kind: 'health' as const, runId: this.runId, ...this.counters }
      const line = encodeRecord(record, this.options.inventory)
      if (line) await this.write({ line, day: record.observedAt.slice(0, 10), family: 'errors' })
    }
  }

  private async close(family: Entry['family']) {
    const file = this.active.get(family)
    if (!file) return
    this.active.delete(family)
    if (file.stream.destroyed) return
    await new Promise<void>((done) => {
      file.stream.once('close', done)
      file.stream.end()
    })
    if (file.failed) throw new Error('Telemetry close failed')
  }

  private async maintain(reserve: number) {
    for (const [family, file] of this.active) {
      if (file.day !== this.now().toISOString().slice(0, 10)) await this.close(family)
    }
    let files = await segments(this.options.directory)
    let total = files.reduce((sum, file) => sum + file.size, 0)
    // Close before pruning if active segments are the only space available.
    if (total + reserve > this.limits.totalBytes) {
      for (const family of [...this.active.keys()]) await this.close(family)
      files = await segments(this.options.directory)
      total = files.reduce((sum, file) => sum + file.size, 0)
    }
    const cutoff = this.now().getTime() - this.limits.retentionDays * 86_400_000
    for (const file of files) {
      if ([...this.active.values()].some((active) => active.path === file.path)) continue
      if (new Date(`${file.day}T00:00:00Z`).getTime() > cutoff && total + reserve <= this.limits.totalBytes) continue
      // Check again at the removal boundary. Unrecognized entries and links stay untouched.
      try {
        const info = await lstat(file.path)
        if (info.isSymbolicLink() || !info.isFile()) continue
        await unlink(file.path)
        total -= info.size
      } catch (error) { if (!isMissing(error)) throw error }
    }
    if (total + reserve > this.limits.totalBytes) throw new Error('Telemetry cap unavailable')
  }

  private async write(entry: Entry) {
    const bytes = Buffer.byteLength(entry.line)
    if (bytes > this.limits.totalBytes || bytes > this.limits.segmentBytes) throw new Error('Telemetry record exceeds segment')
    let active = this.active.get(entry.family)
    if (active && (active.day !== entry.day || active.size + bytes > this.limits.segmentBytes || active.failed)) await this.close(entry.family)
    await this.maintain(bytes)
    if (this.abandoned) return
    active = this.active.get(entry.family)
    if (!active) {
      const files = await segments(this.options.directory)
      const number = files.filter((file) => file.family === entry.family && file.day === entry.day).reduce((max, file) => Math.max(max, file.number), 0) + 1
      if (number > 999_999_999) throw new Error('Telemetry segment limit')
      const path = join(this.options.directory, `${entry.family}-${entry.day.replaceAll('-', '')}-${number}.jsonl`)
      const stream = this.openStream(path, { flags: 'wx', highWaterMark: 64 * 1024, mode: 0o600 })
      active = { stream, path, day: entry.day, size: 0, failed: false }
      const file = active
      // The listener stays installed, including after destroy, so errors never escape.
      stream.on('error', () => { file.failed = true })
      this.active.set(entry.family, file)
    }
    const file = active
    await new Promise<void>((done, reject) => {
      let callbackDone = false
      let drained = true
      let settled = false
      const cleanup = () => { file.stream.removeListener('error', failed); file.stream.removeListener('drain', onDrain); file.stream.removeListener('close', closed) }
      const failed = () => { if (!settled) { settled = true; cleanup(); reject(new Error('Telemetry append failed')) } }
      const finish = () => { if (callbackDone && drained && !settled) { settled = true; cleanup(); done() } }
      const onDrain = () => { drained = true; finish() }
      const closed = () => { if (!settled) failed() }
      file.stream.once('error', failed)
      file.stream.once('close', closed)
      // Only one write can be in flight, even when the stream accepts more.
      drained = file.stream.write(entry.line, (error) => { if (error) failed(); else { callbackDone = true; finish() } })
      if (!drained) file.stream.once('drain', onDrain)
      finish()
    })
    file.size += bytes
  }

  async flush(timeoutMs = 1000) {
    const deadline = Date.now() + Math.max(0, Math.min(1000, timeoutMs))
    this.kick()
    while ((this.processing || this.queue.length) && Date.now() < deadline) {
      await new Promise<void>((done) => setTimeout(done, 5))
    }
    return !this.processing && this.queue.length === 0
  }

  async shutdown(timeoutMs = 1000) {
    this.stopping = true
    clearInterval(this.timer)
    if (this.retryTimer) clearTimeout(this.retryTimer)
    const drained = await this.flush(timeoutMs)
    this.abandoned = true
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.counts.dropped += this.queue.length
    this.queue.length = 0
    for (const file of this.active.values()) file.stream.destroy()
    this.active.clear()
    if (!drained) this.diagnostic()
    return drained
  }
}
