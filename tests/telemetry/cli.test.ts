import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)
test('inspection commands work without a valid PostgreSQL connection and reject invalid options', async () => {
  for (const command of ['inspect', 'summary']) {
    const result = await exec(process.execPath, ['--import', 'tsx', 'scripts/telemetry.ts', command], { env: { ...process.env, DATABASE_URL: 'invalid' }, timeout: 10_000 }).catch((error: unknown) => {
      // Damaged existing operator files correctly return 2, while still yielding a report.
      if (error && typeof error === 'object' && 'code' in error && error.code === 2 && 'stdout' in error && 'stderr' in error) return { stdout: String(error.stdout), stderr: String(error.stderr) }
      throw error
    })
    const json = result.stdout.slice(result.stdout.indexOf('{'))
    assert.equal((JSON.parse(json) as { command: string }).command, command)
    assert.equal(result.stderr, '')
  }
  for (const args of [['inspect', '--limit', '501'], ['summary', '--limit', '2'], ['summary', '--from', '2026-02-30'], ['summary', '--kind', 'private'], ['prune', '--include-synthetic']]) {
    await assert.rejects(exec(process.execPath, ['--import', 'tsx', 'scripts/telemetry.ts', ...args], { timeout: 10_000 }), (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === 1)
  }
})
