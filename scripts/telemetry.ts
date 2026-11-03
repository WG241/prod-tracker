import 'dotenv/config'
import { join } from 'node:path'
import { lstat, unlink } from 'node:fs/promises'
import { prepareDirectory, segments, defaults } from '../server/telemetry/files.ts'
import { loadInventory, projectRoot } from '../server/telemetry/inventory.ts'
import { calendarBoundary, inspect, summarize } from '../server/telemetry/reader.ts'
import type { Filters } from '../server/telemetry/reader.ts'

async function main() {
  const [command, ...args] = process.argv.slice(2)
  if (!['inspect', 'summary', 'prune'].includes(command)) throw new Error('Choose inspect, summary or prune')
  const filter: Filters = {}
  let limit = 20
  const seen = new Set<string>()
  for (let index = 0; index < args.length; index++) {
    const flag = args[index]
    if (seen.has(flag)) throw new Error('Repeated option')
    seen.add(flag)
    if (flag === '--include-synthetic') { filter.includeSynthetic = true; continue }
    if (!['--from', '--to', '--kind', '--limit'].includes(flag) || !args[index + 1]) throw new Error('Invalid option')
    const value = args[++index]
    if (flag === '--from') filter.from = calendarBoundary(value)
    if (flag === '--to') filter.to = calendarBoundary(value)
    if (flag === '--kind') {
      if (!['error', 'product', 'health', 'all'].includes(value)) throw new Error('Invalid kind')
      filter.kind = value as Filters['kind']
    }
    if (flag === '--limit') {
      if (command !== 'inspect' || !/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 500) throw new Error('Limit must be 1 through 500 for inspect')
      limit = Number(value)
    }
  }
  if (filter.from && filter.to && filter.from >= filter.to) throw new Error('From must precede exclusive to')
  if (command === 'prune' && args.length) throw new Error('Prune accepts no filters')
  const directory = join(projectRoot, '.local/telemetry')
  await prepareDirectory(projectRoot, directory, false)
  if (command === 'prune') {
    // Operator command: run only with the application stopped.
    const files = await segments(directory)
    let bytes = files.reduce((sum, file) => sum + file.size, 0)
    let removed = 0
    for (const file of files) {
      if (new Date(`${file.day}T00:00:00Z`).getTime() > Date.now() - defaults.retentionDays * 86_400_000 && bytes <= defaults.totalBytes) continue
      const info = await lstat(file.path)
      if (info.isSymbolicLink() || !info.isFile()) continue
      await unlink(file.path)
      bytes -= info.size
      removed++
    }
    console.info(JSON.stringify({ command, removed, managedBytes: bytes }))
    return
  }
  const inventory = await loadInventory(projectRoot)
  const result = command === 'inspect' ? await inspect(directory, inventory, filter, limit) : await summarize(directory, inventory, filter)
  console.info(JSON.stringify({ command, includeSynthetic: filter.includeSynthetic === true,
    from: filter.from?.toISOString(), toExclusive: filter.to?.toISOString(),
    note: 'Best effort observations, not unique people or authoritative business totals.', ...result }, null, 2))
  if (result.malformed || result.incomplete) process.exitCode = 2
}

main().catch(() => { console.error('Telemetry command failed. Check options, storage access, and directory safety.'); process.exitCode = 1 })
