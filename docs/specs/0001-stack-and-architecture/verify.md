# Verify: stack and architecture

Verified on 2026-10-26 against native local PostgreSQL 18.6. These checks cover Feature 2 and the architecture spec's verification boundary. Hosted Neon and role journeys were not exercised.

## Build and data

- [x] `npm run check` passes lint, all TypeScript projects, and the Vite production build. The existing font import order warning in `src/index.css` remains.
- [x] `npm run db:migrate -- --name init` applied `20261026125741_init` to `127.0.0.1:5433/prod_tracker` using the separate local shadow database.
- [x] `npm run db:generate` generated Prisma Client 7.10.1.
- [x] `npm run db:seed` passed twice. A direct PostgreSQL query confirmed exactly one row with the fictional foundation email.
- [x] Querying `information_schema.columns` confirmed the live User table contains `id`, `email`, `name`, `createdAt`, and `updatedAt`, with the documented types and nullability.

## Real app

- [x] `npm run dev` launched Express and Vite on `http://127.0.0.1:5173/`. The browser rendered the scaffold and logged `Workforce API and database connected` from `src/api/health.ts`.
- [x] `GET http://127.0.0.1:5173/api/health` returned HTTP 200, `Cache-Control: no-store`, and `{ "status": "ok", "database": "connected" }`.
- [x] After `npm run db:stop`, the same health request returned HTTP 503 and `{ "status": "unavailable", "database": "unavailable" }` in 121 ms.
- [x] After `npm run db:start`, the same app recovered to HTTP 200 without restarting its process.
- [x] A scratch TCP proxy completed the PostgreSQL handshake then withheld query traffic. A separate compiled app using that proxy returned the documented HTTP 503 in 5469 ms, within the 10 second bound. The probe process and proxy were closed.
- [x] Six concurrent stalled requests against the five connection pool all returned HTTP 503 within the bound. The queued request failed in 3051 ms; the others completed between 5263 and 5337 ms.
- [x] `npm run start` with local verification host and port served the compiled app on `http://127.0.0.1:4173/`. A real browser rendered the scaffold and logged a successful connection from `assets/index-B-IEhodb.js`.
- [x] Production `/api/health` returned JSON 200; `/api/missing` returned JSON 404; `/future-route` returned the SPA document; `/missing.js` returned JSON 404.

## Configuration boundaries

- [x] Separate process checks with a missing database URL, invalid database URL, and invalid port exited with code 1 and sanitized messages. The invalid URL's marker did not appear in output.
- [x] A scan of all five browser build files found neither the configured database URL or password nor Prisma client code.
- [x] The old Neon runtime adapter and serverless driver were removed after the PrismaPg replacement. The original `.env` was preserved in ignored `.env.neon.local`, and the active URLs point to local PostgreSQL.
- [x] Repeating `npm run db:setup` reused the existing instance and preserved the Neon backup. The final `npm run check` passed after the shutdown adjustment. Temporary app listeners on 5173, 4173, and 4174 were confirmed closed; local PostgreSQL was stopped with its data preserved.

The full domain schema belongs to Feature 3. This verification establishes the service and persistence foundation, not authentication or any role feature.
