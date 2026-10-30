# Verify: Workforce data model, spec 0002

Verified on 26 October 2026 against native PostgreSQL 18.6 on localhost:5433. Feature 3 is a data foundation with no new product UI. All seven acceptance criteria passed the runtime checks below.

## Commands and observed evidence

* [x] `npx prisma migrate status`, exit 0, reports three migrations and database schema up to date. The original `20261026125741_init` remains, followed by `20261026140213_workforce_data_model` and `20261026144154_frozen_roster_guard`. AC-6, AC-7.
* [x] `npm run db:verify`, exit 0, reports 18 live model tables and four live history guards. It queries PostgreSQL catalogs, not generated types alone. AC-1 through AC-7.
* [x] The same command reseeds transactionally and compares record fingerprints, counts, ids and timestamps. It reports `PASS seed repeatability and retained foundation identity`. The existing inactive foundation user remains, alongside 28 staff, 35 weekly tasks and 110 rosters. AC-6.
* [x] Full frozen rosters retain Femi with zero expected days, Ada with four, Tosin with three, and Grace with five despite her later deactivation and zero tasks. Damilola's earlier manager remains Nneka while the transfer week uses Tunde. Temporary later deactivation leaves historical metrics unchanged. AC-1, AC-4, AC-6.
* [x] SQL projections match the independent expected table in the [fixture manifest](../../../prisma/fixtures/README.md). Employee, Line Manager, Business Director, Executive, HR / Admin and empty Outsourcing task scope are covered. Week 44 includes 20 expected employees and three submissions from automatic carry alone. AC-1, AC-2, AC-7.
* [x] The command verifies three carry parents in the same task series, pending reviewer reassignment with the original submission assignment retained, approval in the original week with the later actual date, changed resubmission content, one automatic decision and one relief decision. AC-2, AC-3, AC-4.
* [x] All four mail deliveries are Suppressed. Notification ownership and three unread versus one read record are retained. Unlock replacement and source corrections are checked by fixture validation before seeding. AC-5, AC-6.
* [x] All 23 invalid writes fail inside savepoints. A final rollback and unchanged fingerprint confirm no persistent probe mutations. Covered guarantees include current assignment/director uniqueness, business/unit and owner references, pending attempts, single decisions, dates/content, leave, relief, unlock targeting, settings, delivery timestamps, retained identities, immutable audit/decision/submission evidence, and frozen missing submitters. AC-1 through AC-5, AC-7.
* [x] `npm run check`, exit 0, runs Oxlint, strict TypeScript checks and the Vite production build. AC-7.

Raw database command output was captured in ignored `.tmp/data-model-verify.log`; rerun `npm run db:verify` to reproduce it on the clean sample database. Expected metrics and the list of synthetic examples are durable in the fixture manifest.

## Real app checks

* [x] Opened `http://127.0.0.1:5173/` in a real browser after migration. The existing scaffold rendered. Console at 14:56:31 UTC reported `Workforce API and database connected`, with no application errors. AC-7.
* [x] `GET http://127.0.0.1:5173/api/health` returned 200 with exactly `{"status":"ok","database":"connected"}` and `Cache-Control: no-store`. New model data and configuration are absent from the response. AC-7.
* [x] `GET http://127.0.0.1:5173/api/feature3-missing` returned 404 with `{"error":"Not found"}`. AC-7.
* [x] Ran `npm run start` with HOST=127.0.0.1 and PORT=3001. The compiled app rendered in a real browser, whose console at 14:59:33 UTC reported `Workforce API and database connected`. Its health endpoint also returned 200 with the documented two fields. AC-7.
* [x] After the final build, restarted the compiled service and sent five consecutive health requests with a ten second client timeout. All five returned 200 and the documented connected response. AC-7.

## Acceptance coverage

| Criterion | Result | Evidence |
|---|---|---|
| AC-1, people and organisation | Met | Live tables, composite reference probes, dated assignments, retained identity and frozen roster checks |
| AC-2, weekly work and carry | Met | 35 tasks, three linked carries, status and owner checks, role projections |
| AC-3, approval evidence | Met | 24 attempts, 17 decisions, retained submission snapshots, reassignment, automatic and relief examples |
| AC-4, leave and relief | Met | Validated intervals and actors, partial/full leave, partial day assignment and frozen eligibility |
| AC-5, controls and messages | Met | Live settings/unlocks, append only guards, recipient state and suppressed deliveries |
| AC-6, migration and repeatable cast | Met | All migrations applied, original identity retained, stable seed fingerprints, documented normalized cast |
| AC-7, real app and checks | Met | PostgreSQL probes, five role projections, development and production browser readiness, health responses and build |

## Limits and follow up

The original timestamp comparison scratch file was accidentally overwritten after migration. Therefore a direct retained row before/after timestamp comparison is unavailable. The migration explicitly interprets the legacy timestamp columns as UTC with `AT TIME ZONE 'UTC'`, the retained row remains, and the verifier confirms the conversion round trip on representative millisecond values. This is evidence of the conversion rule, not a replacement claim that the lost row comparison occurred. No reset or identity replacement was used.

The production build retains the preexisting CSS Google Fonts import order warning. This feature adds no UI and does not change that styling.

The development server's accumulated log included `database_health_unavailable` and a browser readiness warning at 14:58:57 UTC during the work session. Later development and production requests succeeded. The final five request check passed without another failure. The cause of that earlier transient warning was not isolated, so this verification does not claim that readiness was uninterrupted throughout the session.

Workflow write APIs, authentication, scheduled freezing, reminders, email transmission and hosted Neon behavior remain in later scope features. Fixture coherence checks do not claim that future API transactions or authorization already exist. The existing sample database was exercised; a separate fresh database installation was not repeated in this feature.
