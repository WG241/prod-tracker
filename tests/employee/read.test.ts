import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EMPLOYEE_READ_TIMEOUT_MS, employeeReadInit } from '../../src/features/employee/useEmployeeRead.ts'

test('employee reads use a bounded timeout so stalled responses reach Retry (Greptile P2 reproduction)', async () => {
  assert.equal(EMPLOYEE_READ_TIMEOUT_MS, 20_000)
  const controller = new AbortController()
  const init = employeeReadInit(controller.signal, 25)
  assert.equal(init.credentials, 'same-origin')
  assert.equal(init.cache, 'no-store')
  assert.ok(init.signal instanceof AbortSignal)

  const originalFetch = globalThis.fetch
  globalThis.fetch = (_input, request) => new Promise((_resolve, reject) => {
    request?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('The operation was aborted.'), { name: 'TimeoutError' })))
  })
  try {
    const started = Date.now()
    await assert.rejects(() => fetch('/api/employee/home', init), (error: unknown) => error instanceof Error && error.name === 'TimeoutError')
    assert.ok(Date.now() - started < 500, 'timeout must fire without waiting forever')
    assert.equal(controller.signal.aborted, false, 'deliberate cancellation stays silent via the caller controller')
  } finally {
    globalThis.fetch = originalFetch
  }
})
