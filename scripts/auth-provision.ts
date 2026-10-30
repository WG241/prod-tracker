import 'dotenv/config'
import { emitKeypressEvents } from 'node:readline'
import { createDatabase } from '../server/db.ts'
import { readConfig } from '../server/config.ts'
import { checkedDatabaseTarget, isLoopback, readAuthConfig } from '../server/auth/config.ts'
import { provision } from '../server/auth/provision.ts'

async function hiddenPassword(label: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('An interactive TTY is required for a hidden password prompt')
  process.stdout.write(label)
  emitKeypressEvents(process.stdin)
  process.stdin.setRawMode(true)
  process.stdin.resume()
  return new Promise((resolve, reject) => {
    let value = ''
    const finish = () => {
      process.stdin.off('keypress', keypress)
      process.stdin.setRawMode(false)
      process.stdin.pause()
      process.stdout.write('\n')
    }
    const keypress = (text: string | undefined, key: { name?: string; ctrl?: boolean; meta?: boolean }) => {
      if (key.ctrl && key.name === 'c') { finish(); reject(new Error('Provisioning cancelled')); return }
      if (key.name === 'return' || key.name === 'enter') { finish(); resolve(value); return }
      if (key.name === 'backspace') { value = [...value].slice(0, -1).join(''); return }
      if (text && !key.ctrl && !key.meta && ![...text].some((character) => character.codePointAt(0)! < 32 || character.codePointAt(0) === 127)) value += text
    }
    process.stdin.on('keypress', keypress)
  })
}

async function main() {
  const args = process.argv.slice(2)
  const flags = new Set(['--resume', '--repair-incomplete', '--acknowledge-remote-database'])
  const idIndex = args.indexOf('--user-id')
  const id = args[idIndex + 1]
  if (idIndex < 0 || !id || id.startsWith('--') || args.filter((arg) => arg === '--user-id').length !== 1
    || args.some((arg, index) => index !== idIndex && index !== idIndex + 1 && !flags.has(arg))
    || (args.includes('--resume') && args.includes('--repair-incomplete'))) throw new Error('Use --user-id with optional --resume or --repair-incomplete')
  const config = readAuthConfig()
  const connection = readConfig().connectionString
  if (!isLoopback(checkedDatabaseTarget(connection).hostname) && !args.includes('--acknowledge-remote-database')) throw new Error('Remote database requires --acknowledge-remote-database')
  const db = createDatabase(connection)
  try {
    const password = await hiddenPassword('Password (hidden): ')
    const confirmation = await hiddenPassword('Confirm password (hidden): ')
    if (password !== confirmation) throw new Error('Passwords do not match')
    console.info(await provision(db, config, id, password, { resume: args.includes('--resume'), repair: args.includes('--repair-incomplete') }))
  } finally { await db.$disconnect() }
}
main().catch((error: unknown) => { console.error(error instanceof Error && !/prisma|query|constraint/i.test(error.message) ? error.message : 'Provisioning failed'); process.exitCode = 1 })
