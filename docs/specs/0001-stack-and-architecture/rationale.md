# Stack and architecture, decision record

## Context

The repository already contains React 19, Vite 8, TypeScript, Tailwind, Lucide, Prisma 7, a minimal User model, and a Neon specific database stub. It has no API service, applied local migration, or seed command. Feature 1 established lint and type checks. Those changes remain uncommitted and must be preserved.

Feature 2 needs a real browser to API to database connection without beginning the later role journeys. The scope specifies local PostgreSQL with migrations and seed data, with Neon ready for deployment. No local PostgreSQL or Docker installation was found. The existing environment file points to Neon and must not become the target of local setup operations.

The user selected one Node service, native PostgreSQL on Windows, Express 5, and PrismaPg for local and Neon connections. They requested verified official references and deferred optional additional skills and MCP discovery.

## Options considered

### Option 1: Existing React application with Express and native PostgreSQL

One Node service serves both browser files and the API. PrismaPg connects to the local development database and later to Neon. This retains the existing frontend and gives the team a familiar routing model, at the cost of running a database locally and maintaining an application server.

### Option 2: Existing React application with Fastify and native PostgreSQL

Fastify supports typed routes, schemas, plugins, and structured logging. Its stronger conventions could help a larger API, but introduce more framework concepts at the foundation stage. Both frameworks support the chosen Node runtime; the user preferred Express's straightforward routing.

### Option 3: Serverless API functions or separate UI and API deployments

This can align with managed static hosting and serverless platforms. It adds separate packaging and operational behavior for the browser and API. The user chose one Node deployment instead.

### Option 4: Prisma local PGlite, Docker, or Neon for development

Prisma's local server offers persistent local PostgreSQL protocol access but documents a single connection limit. Docker gives a native PostgreSQL engine in a container but is absent on this machine and adds a container runtime. Neon is already configured but would change the scope's local database approach. The user preferred native Windows PostgreSQL.

## Rationale

The chosen arrangement preserves the app scaffold and the prototype based UI workflow. Express adds the missing server boundary without a frontend migration. A shared origin avoids separate browser API origin configuration during this foundation. PrismaPg connects through ordinary PostgreSQL TCP in both target environments, so a separate Neon transport branch is unnecessary for the chosen Node service.

The health query against the migrated User table makes readiness meaningful. A successful SQL connection alone would not prove that the table exists. Verify the fictional upserted seed row independently, so deployed readiness does not depend on development data. The health response remains small and safe for public readiness checks. Authentication and the final employee data model stay with the scope features that own them.

The local database installation is operational work, not proof of application correctness. Verification must launch the app, observe the browser health request, inspect the seeded database, and exercise unavailable and recovered database states before Feature 2 is done.

## References

### Project sources

`AGENTS.md`, `docs/scope/index.md`, `docs/scope/foundations.md`, `package.json`, `prisma/schema.prisma`, `prisma.config.ts`, and the existing `src/db.ts` stub describe the current stack and Feature 2 boundary.

### Practices

One application deployment, server only database access, explicit versioned migrations, repeatable seed operations, readiness checks against live dependencies, and separate development and deployment databases.

### Verified official documentation

- [Express version support](https://expressjs.com/en/support/) documents supported Express releases and Node requirements.
- [Fastify TypeScript reference](https://fastify.dev/docs/latest/Reference/TypeScript/) describes the alternative framework's typing approach.
- [Prisma PostgreSQL connector](https://www.prisma.io/docs/orm/v7/core-concepts/supported-databases/postgresql) documents PostgreSQL support and adapter use.
- [Prisma database drivers](https://www.prisma.io/docs/orm/v7/core-concepts/supported-databases/database-drivers) distinguishes standard PostgreSQL access from Neon specific transports.
- [Prisma local PostgreSQL](https://www.prisma.io/docs/local-development/postgres) describes the PGlite alternative and its connection limit.
- [Prisma CLI reference](https://www.prisma.io/docs/orm/v7/reference/prisma-cli-reference) documents migration and generation commands.
- [Prisma seeding workflow](https://www.prisma.io/docs/orm/v7/prisma-migrate/workflows/seeding) documents explicit seed configuration and execution.
- [PostgreSQL Windows downloads](https://www.postgresql.org/download/windows/) identifies the official Windows distribution channel.
