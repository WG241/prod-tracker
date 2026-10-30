# 0001. Stack and architecture

**Date**: 2026-10-26
**Status**: Accepted

## Summary

Keep the React application and add Express to serve its API from the same Node service. Use native PostgreSQL on this Windows machine for development, with PrismaPg making standard PostgreSQL connections locally and on Neon. First prove the connection with a migrated and seeded database and a small health request from the browser.

## Decision

Choose one Node service with Express 5, the existing Vite and React application, native local PostgreSQL, and Prisma 7 through `@prisma/adapter-pg`. The user selected this arrangement during the architecture conversation. The development database is local; the existing Neon configuration remains available for later deployment.

This is the architecture decision for scope Feature 2. Its execution milestones live in `docs/scope/foundations.md`. The full product data model, authentication, shared design system, and core entity API remain separate scope features.

## Proposed stack

| Layer | Choice | Reason |
|---|---|---|
| Language and runtime | Existing TypeScript, strict checks, ESM, Node 24, npm 11 | Retain the scaffold and Feature 1 conventions. |
| Browser application | Existing React 19, Vite 8, Tailwind 4, Lucide | Preserve the prototype based UI path. |
| Application pattern | One service, with feature modules inside it | Keep one deployment and make the browser and API share an origin. |
| API framework | Express 5 | The user chose straightforward routing and familiar conventions. |
| Development database | Native PostgreSQL on Windows, with a persistent local data directory | Exercise the same database engine used for deployment. |
| Deployment database | Neon PostgreSQL, configured through environment variables | Retain the existing deployment preparation. |
| Database access | Prisma 7 with `@prisma/adapter-pg` | Use the same TCP connection path locally and on Neon. |
| Migration connection | `DATABASE_URL_UNPOOLED` in `prisma.config.ts` | Keep migration operations on a direct database connection. |
| Runtime connection | `DATABASE_URL` on the Node service only | Keep database credentials and clients outside the browser bundle. |
| Development serving | Express with Vite middleware, started together | Give developers one command and one browser origin. |
| Production serving | Express serves the Vite build and `/api/*` | The production app runs without the Vite development server. |
| Server build | TypeScript emits server JavaScript into `dist-server/` | Production starts with Node and compiled JavaScript. |

### Module and process boundaries

`src/` holds browser code. `server/` holds the Express entry, health handler, configuration, and Prisma client initialization. Move the existing `src/db.ts` stub to the server area and replace its Neon adapter with PrismaPg. The generated Prisma client can remain under the existing ignored `src/generated/prisma/` path; only server code imports it.

`tsconfig.app.json` checks browser code without Node globals. The server TypeScript project checks and emits the server and its generated Prisma imports. Relative TypeScript imports are rewritten to JavaScript extensions when emitted. The tooling TypeScript project continues checking Vite and Prisma configuration. `npm run check` includes lint and all required type and production build checks.

In development, the server enables Vite middleware before the SPA fallback (the handler that serves the application for browser routes). In production, it serves `dist/` and uses the same API handlers. Mount API handling first. An unknown `/api/*` request returns a JSON 404, never the SPA HTML. Only browser GET navigation may use the SPA fallback. The server closes its HTTP listener, Vite instance when present, and database pool on shutdown.

### Native local database setup

Use the PostgreSQL Windows distribution linked by the official PostgreSQL project. Prefer a workspace scoped installation and data directory when the official binaries support it; do not require a Windows service for this project. Record the installed executable version during setup. Keep binaries, local data, generated credentials, and database logs ignored by Git.

Create a dedicated development database and role. Bind PostgreSQL to loopback and use password authentication. Use a separate local shadow database for Prisma migration comparisons if required by the role permissions. Do not run migrations against the existing Neon database. Preserve the existing `.env` in an ignored backup before switching the active connection variables to local PostgreSQL, and do not overwrite an existing backup.

Keep the existing `User` schema unchanged for this foundation. Its columns remain `id` (required string primary key, default cuid), `email` (required unique string), `name` (nullable string), `createdAt` (required timestamp, default now), and `updatedAt` (required timestamp, updated automatically). There are no relationships yet.

Create and apply its initial migration locally. An explicit `npm run db:seed` command uses an upsert by email to create one fictional foundation row, with email `foundation-health@example.invalid` and name `Local foundation check`. Repeating the command preserves a single row. This row proves the database setup; it is not an authenticated employee or the final prototype seed cast. Prisma 7 client generation and seeding run explicitly after migration.

### Health contract and proof from the browser

| Endpoint | Method | Input | Success | Failure | Access |
|---|---|---|---|---|---|
| `/api/health` | GET | None | HTTP 200, JSON `{ "status": "ok", "database": "connected" }` | HTTP 503, JSON `{ "status": "unavailable", "database": "unavailable" }` | Public, exposes no employee or configuration data |

Send `Cache-Control: no-store`. Every request checks the live database with `prisma.user.findFirst({ select: { id: true } })`. Completion proves that the migrated `User` table can be queried, even if it is empty. Do not return the query result, names, emails, row counts, database addresses, credentials, or exception text. Verify the fictional seed row separately against the local database; readiness must not require development seed data in deployment.

| Produced value | Source |
|---|---|
| HTTP 200 and `status: ok` | The fixed read against the migrated User table completed. |
| `database: connected` | The same successful live query through the configured Prisma client. |
| HTTP 503 and unavailable values | A connection or query failure, including an unapplied initial migration. |
| Seed identity | The fixed fictional email above; Prisma supplies the existing schema defaults. |
| Browser request destination | Relative URL `/api/health` on the application's own origin. |

Set pool connection timeout to 3000 ms and query timeout to 5000 ms so a failed database check returns 503 rather than hanging indefinitely. Log only a sanitized error category on failure. Missing or invalid required server configuration fails startup with a message that names the variable, without printing its value. An unavailable database with otherwise valid configuration leaves the HTTP service able to return 503 and recover on a subsequent health request after the database returns.

The existing browser entry makes one health request when the application boots. Verification observes the actual request and response in the browser and a sanitized connection result in its console. Do not invent a health dashboard, sidebar item, badge, dialog, or product screen for this foundation. The visible scaffold remains the same. The HTML prototype remains the design contract for later UI work.

### Configuration and operational boundaries

`DATABASE_URL` and `DATABASE_URL_UNPOOLED` stay server only. Document local PostgreSQL examples in `.env.example`. Keep Neon deployment instructions, including the direct migration URL and runtime connection URL. Retire the Neon specific runtime adapter and serverless driver dependencies after PrismaPg replaces all imports. Preserve certificate validation for remote database connections.

Document development, build, production start, database start and stop, migration, generation, and seed commands. Development binds to loopback and defaults to port 5173. Production takes its listen port from `PORT`, falling back to 3000; allow the listen host to be configured for hosting and local verification. A local PostgreSQL data directory persists across application and database restarts; stopping a process must not delete the database.

Authentication is owned by Feature 6. This feature exposes only the narrow readiness endpoint and serves the scaffold. Email, background processing, analytics providers, and deployment vendor selection do not belong to this decision.

### Verification boundary

Before Feature 2 is done, exercise the following on the real local app:

1. Apply the initial migration and run the explicit seed command twice. Confirm the fictional seed exists exactly once in local PostgreSQL.
2. Load the application in a browser and observe its real `/api/health` request returning HTTP 200 and the documented JSON body.
3. Stop the local database. Confirm readiness returns the documented HTTP 503, without database details. Restart the database and confirm a later request recovers to HTTP 200 without restarting the app.
4. Exercise a stalled database connection as well as a refused connection. In local verification, each health request must finish with HTTP 503 within 10 seconds. Confirm the configured connection and query timeouts bound the wait, including an unavailable connection from the pool.
5. Build and start the production server, load the compiled app in a browser, and confirm its health request succeeds. An unknown `/api/*` URL returns JSON 404; a browser navigation route can receive the SPA document.
6. Confirm missing or invalid required configuration fails startup with a sanitized message. Check that the browser build contains neither database credentials nor imported database client code.

## Consequences

The app keeps one deployment and one database driver path. Database access has a clear server boundary, and migrations and seed data can be exercised locally before role features land.

Native PostgreSQL adds a local process, installation work, and responsibility for maintaining local data. Express supplies routing but does not choose validation or authentication patterns for later features. Local database checks do not prove Neon credentials or hosted deployment behavior.

## Follow-up

Optional technology specific Agent Skills and MCP connections were deferred by the user. They may later help with Express and Prisma conventions or live database inspection.

The full schema and prototype seed cast belong to Features 3 and 5. The role shells and shared UI belong to Feature 4, and sign in and authorization belong to Feature 6. A hosting vendor and deployment secrets will need an explicit decision when deployment is requested.

## Rationale

See [rationale.md](rationale.md) for the alternatives, verified sources, and reasons behind this decision.
