import assert from 'node:assert/strict'
import { test } from 'node:test'
import { clearWorkspaceOperations, restoreWorkspaceOperations, sessionActor } from '../../src/features/auth/workspace-operations.ts'
import { LeaveOperations } from '../../src/features/employee/leave-operations.ts'
import { TaskOperations } from '../../src/features/employee/operations.ts'
import type { MutationResult } from '../../src/features/employee/mutations.ts'
import type { LeaveResult } from '../../src/features/employee/leave-contracts.ts'

const draft = { title: 'Plan', activity: 'Ship', startsOn: '2026-11-02', endsOn: '2026-11-06', carryRequested: false }
const createTask = { kind: 'CREATE' as const, week: '2026-11-02', draft }
const createLeave = { kind: 'CREATE' as const, draft: { startsOn: '2026-11-10', expectedReturnOn: '2026-11-17' } }

function withWindowFetch(run: () => Promise<void>) {
  return async () => {
    const originalFetch = globalThis.fetch
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { setTimeout, clearTimeout } })
    try { await run() }
    finally {
      globalThis.fetch = originalFetch
      if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
      else Reflect.deleteProperty(globalThis, 'window')
    }
  }
}

test('failed sign-out recovery rebinds leave so Confirm leave can send again', withWindowFetch(async () => {
  const tasks = new TaskOperations()
  const leave = new LeaveOperations()
  const actor = sessionActor('person-ada', 'EMPLOYEE')
  let sent = 0
  globalThis.fetch = async (_input, init) => {
    sent++
    const id = new Headers(init?.headers).get('Idempotency-Key')!
    return Response.json({
      version: 1, requestId: id, operation: 'CREATE', leaveId: 'leave-1', appliedAt: new Date().toISOString(),
      changed: true, replayed: false, notificationWarnings: [],
    } satisfies LeaveResult)
  }

  leave.bind(actor)
  clearWorkspaceOperations(tasks, leave)
  await leave.send(createLeave, () => assert.fail('session should stay valid'))
  assert.equal(sent, 0, 'cleared actor must block leave sends (Greptile P1 reproduction)')
  assert.equal(leave.record === null, true)

  restoreWorkspaceOperations(tasks, leave, actor)
  await leave.send(createLeave, () => assert.fail('session should stay valid'))
  assert.equal(sent, 1)
  assert.equal(leave.record?.state, 'committed')
  leave.clear(); tasks.clear()
}))

test('TaskOperations ignores a response body decoded after the store was rebound', withWindowFetch(async () => {
  const store = new TaskOperations()
  let pendingId = ''
  let reading: () => void = () => {}
  const bodyReady = new Promise<void>((resolve) => { reading = resolve })
  let bodyReply: (value: MutationResult) => void = () => {}

  globalThis.fetch = async (_input, init) => {
    pendingId = new Headers(init?.headers).get('Idempotency-Key')!
    const response = new Response('')
    response.json = () => {
      reading()
      return new Promise<MutationResult>((resolve) => { bodyReply = resolve })
    }
    return response
  }

  store.bind('first:EMPLOYEE')
  const decoding = store.send(createTask, () => assert.fail('should not invalidate'))
  await bodyReady
  store.bind('second:EMPLOYEE')
  bodyReply({
    version: 1, requestId: pendingId, operation: 'CREATE', taskId: 'old-task', taskRevision: 1,
    continuationId: null, commentId: null, approvalRequestId: null, appliedAt: new Date().toISOString(),
    changed: true, replayed: false,
  })
  await decoding
  assert.equal(store.commits, 0, 'stale decoded body must not publish Change saved (Greptile P2 reproduction)')
  assert.equal(store.notice, '')
  assert.equal(store.get('CREATE'), undefined)
  store.clear()
}))
