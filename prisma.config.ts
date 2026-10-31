import 'dotenv/config'
import { defineConfig, env } from 'prisma/config'

// Use the direct local or Neon URL for migrations / CLI.
// App runtime uses DATABASE_URL via PrismaPg on the Node service.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: env('DATABASE_URL_UNPOOLED'),
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
})
