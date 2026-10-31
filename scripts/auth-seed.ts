import 'dotenv/config'
import { createDatabase } from '../server/db.ts'
import { readConfig } from '../server/config.ts'
import { readAuthConfig } from '../server/auth/config.ts'
import {
  AUTH_FIXTURE_PERSON_IDS,
  requireAuthFixtureTarget,
} from '../server/auth/operator-target.ts'
import { provision } from '../server/auth/provision.ts'

const connection = readConfig().connectionString
const config = readAuthConfig()
requireAuthFixtureTarget({
  connectionString: connection,
  origin: config.origin,
  nodeEnv: process.env.NODE_ENV,
})
const password = process.env.LOCAL_AUTH_TEST_PASSWORD
if (!password) throw new Error('LOCAL_AUTH_TEST_PASSWORD must be explicitly supplied')
const db = createDatabase(connection)
try {
  for (const id of AUTH_FIXTURE_PERSON_IDS) {
    console.info(`${id}: ${await provision(db, config, id, password)}`)
  }
} catch { console.error('Fixture credential provisioning failed'); process.exitCode = 1 }
finally { await db.$disconnect() }
