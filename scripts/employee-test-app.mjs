import 'dotenv/config'
import { spawn } from 'node:child_process'
import { authTestDatabase } from '../dist-server/server/auth/config.js'

// Build first. Both modes deliberately use the separate test database.
const target = authTestDatabase(process.env.TEST_DATABASE_URL, process.env.DATABASE_URL)
const development = process.argv.includes('--dev')
const port = development ? '3002' : '3001'
const child = spawn(process.execPath, development ? ['--import', 'tsx', 'server/index.ts', '--dev'] : ['dist-server/server/index.js'], {
  windowsHide: true,
  stdio: 'inherit',
  env: { ...process.env, HOST: '127.0.0.1', PORT: port, DATABASE_URL: target, DATABASE_URL_UNPOOLED: target,
    BETTER_AUTH_URL: `http://127.0.0.1:${port}`, TELEMETRY_ORIGIN: `http://127.0.0.1:${port}`, TELEMETRY_MODE: 'off' },
})
process.once('SIGINT', () => child.kill('SIGTERM'))
process.once('SIGTERM', () => child.kill('SIGTERM'))
child.once('error', () => { console.error('Employee test app could not start'); process.exitCode = 1 })
child.once('exit', (code) => { process.exitCode = code ?? 0 })
