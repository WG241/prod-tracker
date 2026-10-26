import 'dotenv/config'
import { defineConfig, env } from 'prisma/config'

// Use the direct (unpooled) Neon URL for migrations / CLI.
// App runtime uses DATABASE_URL (pooled) via @prisma/adapter-neon.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: env('DATABASE_URL_UNPOOLED'),
  },
})
