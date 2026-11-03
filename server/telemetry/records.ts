import { randomUUID } from 'node:crypto'
import { roleRoutes } from '../../src/features/auth/contracts.ts'

export const environments = ['development', 'test', 'staging', 'production'] as const
export const errorCodes = ['RENDER_ERROR', 'REACT_RECOVERABLE', 'BROWSER_ERROR', 'UNHANDLED_REJECTION', 'API_UNAVAILABLE', 'API_INTERNAL_ERROR', 'DATABASE_UNAVAILABLE', 'STARTUP_FAILURE', 'PROCESS_FATAL', 'HISTORY_CAPTURE_FAILED'] as const
export const sources = ['react', 'browser', 'api', 'database', 'startup', 'process', 'background'] as const
export const pageKeys = ['profile', ...Object.values(roleRoutes).flatMap((route) => route.pages.map(([page]) => `${route.prefix.slice(1)}/${page}`))]
export const locationKeys = ['app', 'health', 'database-pool', 'startup', 'process', 'api', 'telemetry-probe', 'history-capture', ...pageKeys]
export type Environment = typeof environments[number]
export type ErrorCode = typeof errorCodes[number]
export type ErrorSource = typeof sources[number]
export type Role = keyof typeof roleRoutes
export type Frame = { file: string; line: number; column?: number }
type Base = { version: 1; id: string; observedAt: string; environment: Environment; synthetic: boolean }
export type ErrorRecord = Base & { kind: 'error'; code: ErrorCode; source: ErrorSource; locationKey: string; frames?: Frame[]; httpStatus?: number }
export type ProductRecord = Base & { kind: 'product'; name: 'workspace_viewed' | 'task_submitted' | 'task_approved'; occurredAt: string; role: Role; pageKey?: string; method?: 'HUMAN' | 'AUTOMATIC'; timing?: 'ON_TIME' | 'LATE' }
export type Counters = { queueDepth: number; written: number; dropped: number; invalid: number; writeFailures: number }
export type HealthRecord = Base & Counters & { kind: 'health'; runId: string }
export type TelemetryRecord = ErrorRecord | ProductRecord | HealthRecord
export const recordBytes = 4096

export function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
}
export function keys(value: Record<string, unknown>, allowed: readonly string[]) {
  return Object.keys(value).every((key) => allowed.includes(key))
}
export function uuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}
export function instant(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
}
function member<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === 'string' && values.includes(value as T)
}
export function validFrame(value: unknown, inventory: ReadonlySet<string>): value is Frame {
  return object(value) && keys(value, ['file', 'line', 'column']) && typeof value.file === 'string'
    && value.file.length <= 240 && inventory.has(value.file) && position(value.line)
    && (value.column === undefined || position(value.column))
}
function position(value: unknown): value is number { return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 10_000_000 }
export function roleCanView(role: Role, page: string) {
  return page === 'profile' || roleRoutes[role].pages.some(([suffix]) => `${roleRoutes[role].prefix.slice(1)}/${suffix}` === page)
}

// This validator is also used by the reader. No arbitrary metadata survives it.
export function validRecord(value: unknown, inventory: ReadonlySet<string>): value is TelemetryRecord {
  if (!object(value) || value.version !== 1 || !uuid(value.id) || !instant(value.observedAt)
    || !member(value.environment, environments) || typeof value.synthetic !== 'boolean') return false
  const base = ['version', 'id', 'observedAt', 'environment', 'synthetic', 'kind']
  if (value.kind === 'error') {
    return keys(value, [...base, 'code', 'source', 'locationKey', 'frames', 'httpStatus'])
      && member(value.code, errorCodes) && member(value.source, sources) && member(value.locationKey, locationKeys)
      && (value.httpStatus === undefined || (Number.isInteger(value.httpStatus) && Number(value.httpStatus) >= 500 && Number(value.httpStatus) <= 599))
      && (value.frames === undefined || (Array.isArray(value.frames) && value.frames.length <= 10 && value.frames.every((frame) => validFrame(frame, inventory))))
  }
  if (value.kind === 'health') return keys(value, [...base, 'runId', 'queueDepth', 'written', 'dropped', 'invalid', 'writeFailures'])
    && uuid(value.runId) && ['queueDepth', 'written', 'dropped', 'invalid', 'writeFailures'].every((key) => Number.isSafeInteger(value[key]) && Number(value[key]) >= 0)
    && Number(value.queueDepth) <= 256
  if (value.kind !== 'product' || !keys(value, [...base, 'name', 'occurredAt', 'role', 'pageKey', 'method', 'timing'])
    || !instant(value.occurredAt) || !member(value.role, Object.keys(roleRoutes))) return false
  const role = value.role as Role
  if (value.name === 'workspace_viewed') return typeof value.pageKey === 'string' && roleCanView(role, value.pageKey)
    && value.method === undefined && value.timing === undefined
  if (value.pageKey !== undefined || !member(value.method, ['HUMAN', 'AUTOMATIC'])) return false
  if (value.name === 'task_submitted') return ['EMPLOYEE', 'LINE_MANAGER'].includes(role)
    && (value.method !== 'AUTOMATIC' || role === 'LINE_MANAGER') && value.timing === undefined
  return value.name === 'task_approved' && role === 'LINE_MANAGER' && member(value.timing, ['ON_TIME', 'LATE'])
}

export function baseRecord(environment: Environment, synthetic = false, now = new Date()): Base {
  return { version: 1, id: randomUUID(), observedAt: now.toISOString(), environment, synthetic }
}

export function encodeRecord(value: unknown, inventory: ReadonlySet<string>): string | null {
  try {
    if (!validRecord(value, inventory)) return null
    const line = `${JSON.stringify(value)}\n`
    return Buffer.byteLength(line) <= recordBytes ? line : null
  } catch { return null }
}
