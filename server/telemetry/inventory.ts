import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isMissing } from './files.ts'
import type { Frame } from './records.ts'

export const projectRoot = fileURLToPath(new URL(import.meta.url.includes('/dist-server/') ? '../../../' : '../../', import.meta.url))

export async function loadInventory(root: string) {
  const files = new Set<string>()
  async function visit(directory: string) {
    let entries
    try { entries = await readdir(join(root, directory), { withFileTypes: true }) } catch (error) { if (isMissing(error)) return; throw error }
    for (const entry of entries) {
      if (entry.isSymbolicLink() || entry.name === 'generated') continue
      const path = `${directory}/${entry.name}`
      if (entry.isDirectory()) await visit(path)
      else if (entry.isFile() && /\.(?:[cm]?js|tsx?)$/.test(entry.name) && path.length <= 240 && /^[\w./-]+$/.test(path)) files.add(path)
    }
  }
  for (const directory of ['src', 'server', 'dist/assets', 'dist-server/server', 'dist-server/src']) await visit(directory)
  return files
}

export function sanitizeFrames(stack: unknown, inventory: ReadonlySet<string>): Frame[] {
  if (typeof stack !== 'string') return []
  const frames: Frame[] = []
  // Never persist the first line, function names, message text or unknown file names.
  for (const line of stack.slice(0, 32_768).split('\n').slice(1, 41)) {
    const match = /(?:\(|\s|^)((?:https?:\/\/|file:\/\/\/|\/|[A-Za-z]:[\\/])[^\s()]+?):(\d{1,8}):(\d{1,8})\)?$/.exec(line.trim())
    if (!match) continue
    const location = match[1].replaceAll('\\', '/').split(/[?#]/)[0]
    const file = [...inventory].find((known) => location.endsWith(`/${known}`))
    const row = Number(match[2]); const column = Number(match[3])
    if (file && row > 0 && row <= 10_000_000 && column > 0 && column <= 10_000_000) frames.push({ file, line: row, column })
    if (frames.length === 10) break
  }
  return frames
}
