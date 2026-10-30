import 'dotenv/config'
import assert from 'node:assert/strict'
import { readConfig } from '../server/config.ts'
import { localProofConnection } from '../server/data-proof/access.ts'
import { proofTaskIds } from '../server/data-proof/router.ts'
import { createSeedPlan } from '../prisma/fixtures/plan.ts'

assert(localProofConnection(readConfig().connectionString), 'Feature 5 requires a strictly local database connection without host overrides')
const tasks = createSeedPlan().tasks.filter((row) => row.ownerId === 'person-ada-okafor' && row.trackerId === 'tracker-ada-okafor-2026-10-26')
assert.deepEqual(tasks.map((row) => row.id).sort(), [...proofTaskIds].sort())
console.info('Feature 5 connection and fixed fixture allowlist verified; no credentials displayed')
