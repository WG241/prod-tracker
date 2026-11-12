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
  const baseline = new Date('2026-11-02T00:00:00Z')
  const now = new Date('2026-11-23T12:00:00Z')
  const missing = [new Date('2026-11-09T00:00:00Z'), new Date('2026-11-16T00:00:00Z')]
  const reconstructed: { startsOn: Date; freezesAt: string }[] = []
  const tx = {
    $executeRaw: async () => 0,
    async $queryRaw(query: TemplateStringsArray) {
      if (query[0].includes('extract(epoch')) return [{ milliseconds: BigInt(now.getTime()) }]
      if (query[0].includes('pg_trigger')) return [{ total: 6 }]
      assert.match(query.join(''), /generate_series/)
      return missing.filter((date) => !reconstructed.some(({ startsOn }) => startsOn.getTime() === date.getTime())).map((startsOn) => ({ startsOn }))
    },
    trackerSettings: { async findUnique() { return { trackingStartsOn: baseline, updatedAt: baseline, timezone: 'Africa/Lagos', lockDay: 'TUESDAY', lockTime: '14:00' } } },
    auditEvent: { async findMany() { return [{ createdAt: baseline, after: { version: 1, historicalProtectionVersion: 1, trackingStartsOn: '2026-11-02' } }] } },
    workWeek: { async createMany({ data }: { data: typeof reconstructed }) { reconstructed.push(...data) } },
  }
  const db = {
    trackerSettings: { async findUnique() {
      if (++connections === 1) throw new Error('Connection terminated due to connection timeout')
      return { trackingStartsOn: baseline }
    } },
    workWeek: { async findMany() { closes++; return [] } },
    async $transaction(work: (client: typeof tx) => Promise<unknown>) { return work(tx) },
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
    assert.deepEqual(reconstructed.map(({ startsOn }) => startsOn), missing)
    assert.deepEqual(reconstructed.map(({ freezesAt }) => freezesAt), ['2026-11-13T23:00:00.000Z', '2026-11-20T23:00:00.000Z'])
    t.mock.timers.tick(60000)
    await flush()
    assert.equal(connections, 2)
  } finally { await stop() }
})
