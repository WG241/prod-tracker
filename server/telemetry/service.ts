import { join } from 'node:path'
import { telemetryConfig } from './config.ts'
import { loadInventory, projectRoot, sanitizeFrames } from './inventory.ts'
import { baseRecord } from './records.ts'
import type { Environment, ErrorCode, ErrorSource, Role } from './records.ts'
import { LocalTelemetryWriter } from './writer.ts'

export type Capture = (code: ErrorCode, source: ErrorSource, locationKey: string, error?: unknown, status?: number, synthetic?: boolean) => void
export function createTelemetry() {
  const config = telemetryConfig()
  const inventory = new Set<string>()
  // Disabled configuration cannot offer records. The writer still maintains old files.
  const writer = new LocalTelemetryWriter({ root: projectRoot, directory: join(projectRoot, '.local/telemetry'),
    inventory, environment: config.environment, enabled: config.enabled })
  if (!config.valid) process.stderr.write('{"code":"TELEMETRY_CONFIGURATION_DISABLED"}\n')
  void loadInventory(projectRoot).then((files) => { for (const file of files) inventory.add(file) }).catch(() => {
    process.stderr.write('{"code":"TELEMETRY_LOCATIONS_UNAVAILABLE"}\n')
  })
  const capture = errorCapture(writer, config.environment, inventory, config.enabled)
  return { writer, capture, inventory, environment: config.environment, enabled: config.enabled }
}
export function errorCapture(writer: LocalTelemetryWriter, environment: Environment | null, inventory: ReadonlySet<string>, enabled = true): Capture {
  const seen = new WeakSet<object>()
  return (code, source, locationKey, error, httpStatus, synthetic = false) => {
    if (!enabled || !environment) return
    try {
      if (typeof error === 'object' && error !== null) {
        if (seen.has(error)) return
        seen.add(error)
      }
      const frames = sanitizeFrames(error instanceof Error ? error.stack : undefined, inventory)
      writer.offer({ ...baseRecord(environment, synthetic), kind: 'error', code, source, locationKey,
        ...(frames.length ? { frames } : {}), ...(httpStatus === undefined ? {} : { httpStatus }) })
    } catch { /* Capture must never replace a domain outcome. */ }
  }
}
export type Telemetry = ReturnType<typeof createTelemetry>

type Submitted = { newlyApplied: boolean; submittedAt: Date; role: 'EMPLOYEE' | 'LINE_MANAGER'; method: 'HUMAN' | 'AUTOMATIC' }
type Approved = { newlyApplied: boolean; decidedAt: Date; originalFreezesAt: Date; role: 'LINE_MANAGER'; method: 'HUMAN' | 'AUTOMATIC' }
export function committedEvents(offer: (record: unknown) => boolean, environment: Environment) {
  return {
    submitted(result: Submitted) {
      if (!result.newlyApplied) return false
      try { return offer({ ...baseRecord(environment), kind: 'product', name: 'task_submitted', role: result.role,
        occurredAt: result.submittedAt.toISOString(), method: result.method }) } catch { return false }
    },
    approved(result: Approved) {
      if (!result.newlyApplied || !Number.isFinite(result.originalFreezesAt.getTime())) return false
      try { return offer({ ...baseRecord(environment), kind: 'product', name: 'task_approved', role: result.role,
        occurredAt: result.decidedAt.toISOString(), method: result.method,
        timing: result.decidedAt >= result.originalFreezesAt ? 'LATE' : 'ON_TIME' }) } catch { return false }
    },
  }
}
export function viewRecord(environment: Environment, id: string, role: Role, pageKey: string) {
  const base = baseRecord(environment)
  return { ...base, id, kind: 'product' as const, name: 'workspace_viewed' as const, occurredAt: base.observedAt, role, pageKey }
}
