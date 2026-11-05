import assert from 'node:assert/strict'
import { test } from 'node:test'
import { nextSaturdayClose } from '../../server/employee/history-snapshot.ts'

test('history close schedules the next Saturday at WAT midnight', () => {
  assert.equal(nextSaturdayClose(new Date('2026-11-06T22:59:59.000Z')).toISOString(), '2026-11-06T23:00:00.000Z')
  assert.equal(nextSaturdayClose(new Date('2026-11-06T23:00:00.000Z')).toISOString(), '2026-11-13T23:00:00.000Z')
})
