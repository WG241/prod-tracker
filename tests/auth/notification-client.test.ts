import assert from 'node:assert/strict'
import { test } from 'node:test'
import { NotificationOperations } from '../../src/features/notifications/read-operations.ts'

test('an uncertain notification command blocks new actions and keeps its key for the same actor', async (t) => {
  const keys: string[] = []
  t.mock.method(globalThis, 'fetch', async (_path: string, init: RequestInit) => {
    const key = new Headers(init.headers).get('Idempotency-Key')!
    keys.push(key)
    assert.equal(init.body, '{}')
    if (keys.length === 1) throw new TypeError('Connection interrupted')
    return Response.json({ unreadCount: 1, result: {
      version: 1, requestId: key, operation: 'NOTIFICATIONS_READ_ALL', appliedAt: new Date().toISOString(),
      changed: true, changedCount: 2, replayed: true,
    } })
  })
  const operations = new NotificationOperations()
  const invalid = () => assert.fail('Unexpected session revalidation')
  operations.bind('actor-one')
  await operations.send({ operation: 'NOTIFICATIONS_READ_ALL' }, invalid)
  assert.equal(operations.snapshot()?.phase, 'uncertain')
  operations.bind('actor-one')
  await operations.send({ operation: 'NOTIFICATION_READ', notificationId: 'another-message' }, invalid)
  assert.equal(keys.length, 1)
  await operations.send(null, invalid)
  assert.equal(operations.snapshot()?.phase, 'complete')
  assert.deepEqual(keys, [keys[0], keys[0]])
})

test('a former actor’s callback after decoding cannot publish its destination', async (t) => {
  let completeDecoding: (value: unknown) => void = () => {}
  let signalDecoding: (key: string) => void = () => {}
  const decoded = new Promise<unknown>((resolve) => { completeDecoding = resolve })
  const decoding = new Promise<string>((resolve) => { signalDecoding = resolve })
  t.mock.method(globalThis, 'fetch', async (_path: string, init: RequestInit) => {
    const response = new Response(null, { status: 200 })
    response.json = () => {
      signalDecoding(new Headers(init.headers).get('Idempotency-Key')!)
      return decoded
    }
    return response
  })
  const operations = new NotificationOperations()
  operations.bind('actor-one')
  const request = operations.send({ operation: 'NOTIFICATION_READ', notificationId: 'old-message' }, () => assert.fail('Unexpected session revalidation'))
  const requestId = await decoding
  operations.bind('actor-two')
  const at = new Date().toISOString()
  completeDecoding({ target: { kind: 'PROFILE' }, unreadCount: 0, result: {
    version: 1, operation: 'NOTIFICATION_READ', notificationId: 'old-message', requestId, appliedAt: at, readAt: at, changed: true, replayed: false,
  } })
  await request
  assert.equal(operations.snapshot(), null)
})
