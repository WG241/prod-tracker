import { lstat, mkdir, readdir, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

export const managedName = /^(errors|events)-(\d{8})-([1-9]\d{0,8})\.jsonl$/
export type Segment = { name: string; path: string; day: string; number: number; family: 'errors' | 'events'; size: number }
export const defaults = { retentionDays: 30, totalBytes: 100_000_000, segmentBytes: 10 * 1024 * 1024, queueSize: 256, maintenanceMs: 30_000, retryMs: 1000 }

export function inside(root: string, path: string) {
  const part = relative(root, path)
  return part !== '' && part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part)
}

// Check each existing ancestor before mkdir. Never follow a .local directory link.
export async function prepareDirectory(root: string, directory: string, create: boolean) {
  const absoluteRoot = resolve(root)
  const target = resolve(directory)
  if (!inside(absoluteRoot, target)) throw new Error('Unsafe telemetry directory')
  const canonicalRoot = await realpath(absoluteRoot)
  let current = absoluteRoot
  for (const part of relative(absoluteRoot, target).split(sep)) {
    current = join(current, part)
    let info
    try { info = await lstat(current) } catch (error) {
      if (!isMissing(error)) throw error
      if (!create) return false
      await mkdir(current)
      info = await lstat(current)
    }
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('Unsafe telemetry directory')
    if (!inside(canonicalRoot, await realpath(current))) throw new Error('Unsafe telemetry directory')
  }
  return true
}
export function isMissing(error: unknown) { return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT' }
export async function segments(directory: string): Promise<Segment[]> {
  let entries
  try { entries = await readdir(directory, { withFileTypes: true }) } catch (error) { if (isMissing(error)) return []; throw error }
  const result: Segment[] = []
  for (const entry of entries) {
    const match = managedName.exec(entry.name)
    if (!match || !entry.isFile() || entry.isSymbolicLink()) continue
    const day = `${match[2].slice(0, 4)}-${match[2].slice(4, 6)}-${match[2].slice(6, 8)}`
    const date = new Date(`${day}T00:00:00.000Z`)
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== day) continue
    const path = join(directory, entry.name)
    const info = await lstat(path)
    if (info.isFile() && !info.isSymbolicLink()) result.push({ name: entry.name, path, day, number: Number(match[3]), family: match[1] as Segment['family'], size: info.size })
  }
  return result.sort((a, b) => a.day.localeCompare(b.day) || a.number - b.number || a.name.localeCompare(b.name))
}
