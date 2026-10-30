import 'dotenv/config'
import { execFileSync } from 'node:child_process'
import { authTestDatabase } from '../server/auth/config.ts'

const value = authTestDatabase(process.env.TEST_DATABASE_URL, process.env.DATABASE_URL)
const env = { ...process.env, DATABASE_URL: value, DATABASE_URL_UNPOOLED: value }
// No reset or cleanup. Existing test audit and fixture evidence remain intact.
execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { env, stdio: 'inherit' })
execFileSync(process.execPath, ['--import', 'tsx', 'prisma/seed.ts'], { env, stdio: 'inherit' })
