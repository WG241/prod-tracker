# Server context

This area implements architecture [spec 0001](../docs/specs/0001-stack-and-architecture/index.md). Root `AGENTS.md` applies.

`index.ts` starts Express with Vite middleware in development and compiled browser files in production. API handling comes before the browser route fallback. Unknown API paths return JSON 404 responses.

`config.ts` validates server configuration without logging its values. `db.ts` creates PrismaPg with a bounded PostgreSQL connection pool. Database clients and connection strings stay in this area, never in browser imports. The generated Prisma source stays in ignored `src/generated/prisma/` and compiles with the server.

`health.ts` queries the migrated User table. Readiness works with an empty table, returns only the documented status fields, and sends `Cache-Control: no-store`. Database errors return 503 and log a sanitized category. Authentication lives in [auth/AGENTS.md](auth/AGENTS.md); domain data APIs remain later scope features.

`data-proof/router.ts` adds the isolated local development proof before the API fallback. Its fixed fixture scope and request guards are documented in [data-proof/AGENTS.md](data-proof/AGENTS.md); it is absent in production and is not an authentication boundary for later role APIs.

`data-model/calendar.ts` derives weekly assignment attribution and expected working days in Africa/Lagos. Closed weeks use immutable roster snapshots. Role and reporting scope come from dated EmploymentAssignment records, not fields on User. See [spec 0002](../docs/specs/0002-data-model/index.md).

Use `npm run dev` for development. `npm run check` checks and builds both browser and server; `npm run start` runs compiled output. `npm run db:start` starts the persistent local database. Server shutdown closes the HTTP listener, Vite when present, and Prisma's pool.

_Drafted by /sync from the introducing change, worth a quick human pass._
