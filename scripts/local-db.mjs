// Optional legacy helper. This project develops against Neon, not a local
// Postgres install. Prefer DATABASE_URL from .env.example. Kept for any
// engineer who still wants a disposable local engine; do not require it.
import { constants, createReadStream, createWriteStream } from 'node:fs'
import { access, copyFile, mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { createHash, randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import pg from 'pg'

const root = fileURLToPath(new URL('../', import.meta.url))
const local = resolve(root, '.local')
const data = resolve(local, 'postgres-data')
const bin = resolve(local, 'pgsql/bin')
const metadataPath = resolve(local, 'database.json')
const archive = resolve(local, 'downloads/postgresql-18.6-5-windows-x64-binaries.zip')
const source = 'https://get.enterprisedb.com/postgresql/postgresql-18.6-5-windows-x64-binaries.zip'
const checksum = 'e2246ba91d22345bc3d017586c09ede52d9df180b1eeb480f050445f1cad84e2'

async function exists(path) {
  try { await access(path); return true } catch { return false }
}

function command(executable, args, quiet = false) {
  const result = spawnSync(executable, args, {
    cwd: root, encoding: 'utf8', windowsHide: true, stdio: quiet ? 'ignore' : 'pipe',
  })
  if (result.error || result.status !== 0) throw new Error('Local PostgreSQL command failed')
  if (!quiet && result.stdout?.trim()) console.info(result.stdout.trim())
  return result.stdout ?? ''
}

function running() {
  return spawnSync(resolve(bin, 'pg_ctl.exe'), ['status', '-D', data], { windowsHide: true }).status === 0
}

async function metadata() {
  if (!await exists(metadataPath)) throw new Error('Run npm run db:setup first')
  return JSON.parse(await readFile(metadataPath, 'utf8'))
}

async function start() {
  const settings = await metadata()
  if (!running()) {
    command(resolve(bin, 'pg_ctl.exe'), ['start', '-D', data, '-l', resolve(local, 'postgres.log'),
      '-o', `-h 127.0.0.1 -p ${settings.port}`, '-w'], true)
  }
  console.info(`Local PostgreSQL ready on 127.0.0.1:${settings.port}`)
}

async function setup() {
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    throw new Error('This helper requires Windows x64; use native PostgreSQL and .env on other platforms')
  }
  await mkdir(resolve(local, 'downloads'), { recursive: true })
  if (!await exists(resolve(bin, 'initdb.exe'))) {
    if (!await exists(archive)) {
      console.info('Downloading native PostgreSQL 18.6 from EDB')
      const response = await fetch(source)
      if (!response.ok || !response.body) throw new Error('PostgreSQL download failed')
      await pipeline(Readable.fromWeb(response.body), createWriteStream(archive))
    }
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(archive)) hash.update(chunk)
    if (hash.digest('hex') !== checksum) throw new Error('PostgreSQL archive checksum mismatch')
    command('tar.exe', ['-xf', archive, '-C', local, 'pgsql/bin', 'pgsql/lib', 'pgsql/share', 'pgsql/server_license.txt'], true)
  }

  let settings
  if (await exists(metadataPath)) settings = await metadata()
  else {
    if (await exists(resolve(data, 'PG_VERSION'))) {
      throw new Error('Existing PostgreSQL data has no project metadata; leaving it untouched')
    }
    settings = { port: 5433, adminPassword: randomBytes(24).toString('hex'), password: randomBytes(24).toString('hex') }
    await writeFile(metadataPath, JSON.stringify(settings), { flag: 'wx', mode: 0o600 })
  }
  if (!await exists(resolve(data, 'PG_VERSION'))) {
    const passwordFile = resolve(local, 'init-password')
    await writeFile(passwordFile, settings.adminPassword, { mode: 0o600 })
    try {
      command(resolve(bin, 'initdb.exe'), ['-D', data, '-U', 'postgres', '--encoding=UTF8', '--locale=C',
        '--auth=scram-sha-256', `--pwfile=${passwordFile}`], true)
    } finally {
      await unlink(passwordFile)
    }
  }
  await start()
  const client = new pg.Client({ host: '127.0.0.1', port: settings.port, user: 'postgres',
    password: settings.adminPassword, database: 'postgres', connectionTimeoutMillis: 3000 })
  await client.connect()
  try {
    const role = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', ['prod_tracker'])
    if (!role.rowCount) {
      // Password is freshly generated hexadecimal, never user supplied SQL.
      await client.query(`CREATE ROLE prod_tracker LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '${settings.password}'`)
    }
    for (const database of ['prod_tracker', 'prod_tracker_shadow']) {
      const found = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [database])
      if (!found.rowCount) await client.query(`CREATE DATABASE ${database} OWNER prod_tracker`)
    }
  } finally { await client.end() }

  const envPath = resolve(root, '.env')
  const envBackup = resolve(root, '.env.neon.local')
  let env = await exists(envPath) ? await readFile(envPath, 'utf8') : ''
  if (env && !await exists(envBackup) && /neon\.tech/.test(env)) {
    await copyFile(envPath, envBackup, constants.COPYFILE_EXCL)
    console.info('Preserved existing Neon configuration in ignored .env.neon.local')
  }
  const base = `postgresql://prod_tracker:${settings.password}@127.0.0.1:${settings.port}/`
  for (const [key, value] of Object.entries({ DATABASE_URL: `${base}prod_tracker`,
    DATABASE_URL_UNPOOLED: `${base}prod_tracker`, SHADOW_DATABASE_URL: `${base}prod_tracker_shadow` })) {
    const pattern = new RegExp(`^${key}=.*$`, 'm')
    const line = `${key}="${value}"`
    env = pattern.test(env) ? env.replace(pattern, line) : `${env.trimEnd()}\n${line}\n`
  }
  await writeFile(envPath, env, { mode: 0o600 })
  command(resolve(bin, 'postgres.exe'), ['--version'])
  console.info('Local development and shadow databases ready; .env now targets localhost')
}

try {
  const action = process.argv[2] ?? 'status'
  if (action === 'setup') await setup()
  else if (action === 'start') await start()
  else if (action === 'stop') {
    if (running()) command(resolve(bin, 'pg_ctl.exe'), ['stop', '-D', data, '-m', 'fast', '-w'], true)
    console.info('Local PostgreSQL stopped; data preserved')
  } else if (action === 'status') console.info(running() ? 'Local PostgreSQL is running' : 'Local PostgreSQL is stopped')
  else throw new Error('Choose setup, start, stop, or status')
} catch (error) {
  const allowed = ['Run npm run', 'This helper', 'Existing PostgreSQL', 'PostgreSQL archive', 'Choose ']
  console.error(error instanceof Error && allowed.some((prefix) => error.message.startsWith(prefix))
    ? error.message : 'Local PostgreSQL operation failed; see ignored .local/postgres.log if present')
  process.exitCode = 1
}
