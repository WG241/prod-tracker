import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { PrismaClient } from '../../src/generated/prisma/client.ts'
import { nextSaturdayClose } from '../../server/employee/history-snapshot.ts'
import { startHistoryCloser } from '../../server/employee/history-worker.ts'

test('history close schedules the next Saturday at WAT midnight', () => {
  assert.equal(nextSaturdayClose(new Date('2026-11-06T22:59:59.000Z')).toISOString(), '2026-11-06T23:00:00.000Z')
  assert.equal(nextSaturdayClose(new Date('2026-11-06T23:00:00.000Z')).toISOString(), '2026-11-13T23:00:00.000Z')
})

test('a startup database timeout retries history before Saturday and resumes the weekly schedule', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: new Date('2026-11-09T12:00:00Z') })
  t.mock.method(console, 'error', () => {})
  let connections = 0, closes = 0
  const db = {
    trackerSettings: { async findUnique() {
      if (++connections === 1) throw new Error('Connection terminated due to connection timeout')
      return { trackingStartsOn: new Date('2026-11-02T00:00:00Z') }
    } },
    workWeek: { async findMany() { closes++; return [] } },
  } as unknown as PrismaClient
  const flush = () => new Promise<void>((resolve) => setImmediate(resolve))
  const stop = startHistoryCloser(db)
  try {
    await flush()
    assert.equal(connections, 1)
    t.mock.timers.tick(60000)
    await flush()
    assert.equal(connections, 2)
    assert.equal(closes, 1)
    t.mock.timers.tick(60000)
    await flush()
    assert.equal(connections, 2)
  } finally { await stop() }
})
