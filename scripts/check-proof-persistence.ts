import 'dotenv/config'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { readConfig } from '../server/config.ts'
import { createDatabase } from '../server/db.ts'
import { localProofConnection } from '../server/data-proof/access.ts'
import { proofTaskIds } from '../server/data-proof/router.ts'

assert(localProofConnection(readConfig().connectionString), 'Only local database verification is allowed')
const prisma = createDatabase(readConfig().connectionString)
const taskId = proofTaskIds[0]
const path = `/api/dev/data-proof/tasks/${taskId}/comments`
try {
  const browserBodies = ['<b>Browser persistence check, 28 October 2026</b> 😀', 'Browser uncertain recovery check, 28 October 2026']
  const records = []
  for (const body of browserBodies) {
    const rows = await prisma.taskComment.findMany({ where: { weeklyTaskId: taskId, authorId: 'person-ada-okafor', body } })
    assert.equal(rows.length, 1, 'A browser proof reply exists exactly once after restart and reseed')
    const row = rows[0]
    const response = await fetch(`http://127.0.0.1:5173${path}`, { method: 'POST', headers: { Origin: 'http://127.0.0.1:5173', 'Content-Type': 'application/json' }, body: JSON.stringify({ submissionId: row.id.slice('proof-comment-'.length), body }) })
    assert.equal(response.status, 200)
    const replay = await response.json() as { replayed: boolean; comment: { id: string; createdAt: string } }
    assert.equal(replay.replayed, true)
    assert.equal(replay.comment.id, row.id)
    assert.equal(replay.comment.createdAt, row.createdAt.toISOString())
    records.push({ id: row.id, createdAt: row.createdAt.toISOString() })
  }
  for (const resource of ['/api/dev/data-proof/tasks', path, '/api/dev/data-proof/unknown']) {
    for (const method of ['GET', 'POST']) {
      const response = await fetch(`http://127.0.0.1:3000${resource}`, { method, headers: { Origin: 'http://127.0.0.1:3000', 'Content-Type': 'application/json' }, ...(method === 'POST' ? { body: '{}' } : {}) })
      assert.equal(response.status, 404)
      assert.deepEqual(await response.json(), { error: 'Not found' })
    }
  }
  for (const port of [3000, 5173]) {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`)
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { status: 'ok', database: 'connected' })
  }
  const assetFiles = await readdir('dist/assets')
  for (const name of assetFiles) {
    const content = await readFile(`dist/assets/${name}`, 'utf8')
    assert(!/Development data proof|api\/dev\/data-proof|proof-grid|workforce:data-proof|proof-comment-|Data proof/.test(content), 'Production assets exclude the proof')
  }
  console.info(JSON.stringify({ browserRepliesRetainedOnce: records, replayAfterAppRestart: '200 with original id/time', productionProofResponses: 'six legacy 404 responses', health: 'development and production connected', productionAssets: 'proof excluded' }))
} finally { await prisma.$disconnect() }
