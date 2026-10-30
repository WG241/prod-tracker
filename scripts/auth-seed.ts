import 'dotenv/config'
import { createDatabase } from '../server/db.ts'
import { readConfig } from '../server/config.ts'
import { checkedDatabaseTarget, isLoopback, readAuthConfig } from '../server/auth/config.ts'
import { provision } from '../server/auth/provision.ts'

const connection = readConfig().connectionString
const config = readAuthConfig()
if (process.env.NODE_ENV === 'production' || !isLoopback(checkedDatabaseTarget(connection).hostname)
  || !isLoopback(new URL(config.origin).hostname)) throw new Error('Auth fixtures require nonproduction loopback database and origin')
const password = process.env.LOCAL_AUTH_TEST_PASSWORD
if (!password) throw new Error('LOCAL_AUTH_TEST_PASSWORD must be explicitly supplied')
const db = createDatabase(connection)
try {
  for (const id of ['person-ada-okafor', 'person-tunde-bakare', 'person-amara-bello', 'person-david-cole', 'person-kemi-adebayo']) {
    console.info(`${id}: ${await provision(db, config, id, password)}`)
  }
} catch { console.error('Local credential provisioning failed'); process.exitCode = 1 }
finally { await db.$disconnect() }
