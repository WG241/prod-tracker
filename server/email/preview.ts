import { randomUUID } from 'node:crypto'
import { link, lstat, mkdir, open, readdir, realpath, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { MessageSnapshot } from './message.ts'

const budget = 10 * 1024 * 1024
const retention = 7 * 86400000
const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const owned = new RegExp(`^(?:${uuid}\\.json|${uuid}\\.${uuid}\\.tmp)$`)
const missing = (error: unknown) => !!error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'

async function previewDirectory(root: string, create: boolean) {
  let path = await realpath(root)
  for (const directory of ['.local', 'email-preview']) {
    path = join(path, directory)
    if (create) await mkdir(path, { mode: 0o700 }).catch((error: unknown) => {
      if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'EEXIST') throw error
    })
    const info = await lstat(path).catch((error: unknown) => { if (!create && missing(error)) return null; throw error })
    if (!info) return null
    if (!info.isDirectory() || info.isSymbolicLink() || await realpath(path) !== path) throw new Error('Unsafe preview directory')
  }
  return path
}

async function prune(path: string, now: number, space: number, keep?: string) {
  const files = []
  for (const name of await readdir(path)) {
    if (!owned.test(name)) continue
    const file = join(path, name)
    const info = await lstat(file)
    if (!info.isFile() || info.isSymbolicLink()) continue
    if (info.mtimeMs + retention <= now && name !== keep) { await unlink(file); continue }
    files.push({ name, file, time: info.mtimeMs, size: info.size })
  }
  let used = files.reduce((total, file) => total + file.size, space)
  for (const file of files.sort((a, b) => a.time - b.time || a.name.localeCompare(b.name))) {
    if (used <= budget) break
    if (file.name === keep) continue
    await unlink(file.file)
    used -= file.size
  }
  if (used > budget) throw new Error('Preview capacity exceeded')
}

export async function prunePreviews(root = process.cwd()) {
  const path = await previewDirectory(root, false)
  if (path) await prune(path, Date.now(), 0)
}

export async function hasPreviewDirectory(root = process.cwd()) { return (await previewDirectory(root, false)) !== null }

export async function persistPreview(id: string, message: MessageSnapshot, root = process.cwd()) {
  const name = `${id}.json`
  if (!owned.test(name)) throw new Error('Invalid preview id')
  const path = await previewDirectory(root, true)
  if (!path) throw new Error('Preview directory unavailable')
  const target = join(path, name)
  const content = Buffer.from(JSON.stringify(message))
  const existing = await lstat(target).catch((error: unknown) => { if (!missing(error)) throw error; return null })
  if (existing) {
    if (!existing.isFile() || existing.isSymbolicLink() || existing.size !== content.length) throw new Error('Preview integrity failure')
    if (existing.nlink > 1) {
      // A crash after linking can leave the staging name attached to the same file.
      for (const candidate of await readdir(path)) {
        if (!owned.test(candidate) || !candidate.startsWith(`${id}.`) || !candidate.endsWith('.tmp')) continue
        const temporary = join(path, candidate)
        const info = await lstat(temporary)
        if (info.isFile() && !info.isSymbolicLink() && info.ino === existing.ino && info.dev === existing.dev) await unlink(temporary)
      }
    }
    const file = await open(target, 'r')
    try {
      const info = await file.stat()
      if (info.ino !== existing.ino || info.dev !== existing.dev || info.nlink !== 1 || !(await file.readFile()).equals(content)) throw new Error('Preview integrity failure')
    } finally { await file.close() }
    return
  }
  await prune(path, Date.now(), content.length, name)
  const temporary = join(path, `${id}.${randomUUID()}.tmp`)
  const file = await open(temporary, 'wx', 0o600)
  try {
    try { await file.writeFile(content); await file.sync() } finally { await file.close() }
    await link(temporary, target)
  } finally { await unlink(temporary) }
}
