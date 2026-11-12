import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EMPLOYEE_READ_TIMEOUT_MS, employeeReadInit, nextReadDelay } from '../../src/features/employee/useEmployeeRead.ts'

test('read boundaries use server time and a minimum interval regardless of the device clock', (testContext) => {
  const clock = { asOf: '2026-11-12T12:00:00Z', nextChangeAt: '2026-11-12T12:00:15Z', currentWeekStart: '2026-11-09', timezone: 'Africa/Lagos' } as const
  const now = testContext.mock.method(Date, 'now', () => Date.parse('2026-11-12T12:10:00Z'))
  assert.equal(nextReadDelay(clock), 15020)
  now.mock.mockImplementation(() => Date.parse('2026-11-12T11:50:00Z'))
  assert.equal(nextReadDelay(clock), 15020)
  assert.equal(nextReadDelay({ ...clock, nextChangeAt: clock.asOf }), 1000)
})

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
