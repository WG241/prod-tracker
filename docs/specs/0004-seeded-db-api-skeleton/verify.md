# Verify: seeded local DB and API skeleton

Spec 0004, checked on 2026-10-28. This records real local PostgreSQL, HTTP and Chrome observations. Fictional verification replies remain in the local database as required by the spec.

## Checklist

- [x] Check the configured connection against the full loopback and query override rule before migration or seed commands. Confirm the seed plan has the one specified Ada Week 44 carry id (AC-1, AC-2, AC-6).
- [x] Apply existing migrations without reset, seed twice, and confirm 28 staff identities and 35 weekly tasks without duplicate fixtures (AC-1).
- [x] Open `/__data-proof`, read the real task, its canonical Pending status, activity and 26 to 27 October dates, with the explicit fictional actor and Week 44 labels (AC-2, AC-7).
- [x] Submit a browser reply, reload and restart the app, seed twice again, then confirm the original row id and event time remain and replay returns 200 (AC-1, AC-3, AC-5).
- [x] Exercise malformed input, empty/whitespace text, 500/501 Unicode code points, emoji, null character, unpaired surrogates, HTML shaped text, extra keys, malformed JSON, wrong media type and oversized JSON (AC-4).
- [x] Send eight simultaneous identical submissions. Observe one 201, seven 200 replays, one retained row, stable event time and 409 for changed content (AC-5).
- [x] Deny unknown tasks, invalid ids, hidden task, inactive actor, missing tracker/week, wrong stored week date, mismatched tracker week, bad Host or port, foreign/missing Origin and cross site writes (AC-6).
- [x] Confirm GET page size 20, the extra row probe, page 2, empty page 10000, rejected duplicate/unknown query keys, 405 with Allow and structured unknown resource errors (AC-2, AC-3, AC-6).
- [x] Stop PostgreSQL, refresh after a successful save and retain its confirmation. Attempt another reply, observe unconfirmed state, reload, recover its fixed text, restart PostgreSQL and Retry successfully (AC-3, AC-5, AC-7).
- [x] Observe empty tasks and empty replies in Chrome using rollback fixture scenarios (AC-7).
- [x] Check field validation and focus, keyboard Tab from Reply to Post reply, live save/error feedback, plain text rendering, WAT timestamps, and 320 CSS pixel layout without horizontal page overflow (AC-4, AC-7).
- [x] In production open `/__data-proof` and observe the ordinary Home placeholder rather than the proof. Six GET/POST proof requests return the existing API 404 body, and browser assets contain no proof page, URL, labels, storage key or stylesheet (AC-6, AC-7).
- [x] Run lint, type checks, production build and the existing live database verification. Health remains connected in development and production (AC-8).

## Commands and observed results

1. `node_modules/.bin/tsx.cmd scripts/check-proof-context.ts`: passed the strict local connection and exact seed allowlist checks without displaying credentials.
2. `npm run db:deploy`: three migrations present, no pending migration. No schema change or reset was introduced.
3. `npm run db:seed`, twice before implementation verification and twice after browser writes: 28 staff identities and 35 weekly tasks reported each time. Browser replies remained present.
4. `node_modules/.bin/tsx.cmd scripts/verify-data-proof.ts`: the final expanded run passed 118 assertions. Earlier pagination setup retained enough fictional replies to exercise a second page. Context mutations ran inside a real PostgreSQL transaction and rolled back. Test servers closed afterward. The fixed `data_proof_fixtures_unavailable` log categories were expected for those probes.
5. `node_modules/.bin/tsx.cmd scripts/check-proof-persistence.ts`: both browser replies were present exactly once after app restart and reseed. Their submission ids replayed with the original timestamps. Six production API requests returned 404 `{ error: 'Not found' }`. Both health endpoints returned 200 `{ status: 'ok', database: 'connected' }`. Production asset inspection passed.
6. `npm run lint` and `npm run build`: passed after the final timeout and recovery changes. Build includes strict type checking. Vite produced the production browser bundle without the old font import warning.
7. `npm run db:verify`: passed 18 model tables, four history guards, fixture repeatability, all role projections, and 23 rejected invalid writes. Probe mutations rolled back.

The first build attempt that needed a Windows helper was rerun outside the sandbox after a spawn restriction. No dependency or toolchain version change was needed. The first raw Host probe used fetch, which can discard a supplied Host header. The verification harness was corrected to use a real Node HTTP request for those probes; the request guard then passed.

The temporary read only UI scenario service at `http://127.0.0.1:5180/__data-proof` returned actual PostgreSQL projections within a rollback transaction. Chrome observed `No sample tasks are available.` with no reply field, then `No replies yet.` with the reply composer available. Its helper closed and all fixture changes rolled back. The persistence verification was rerun afterward and retained both original browser rows and timestamps.

## Browser evidence

Development URL: `http://127.0.0.1:5173/__data-proof`. Prototype reference: `http://127.0.0.1:5173/docs/workforce-prototype-updated.html`, Employee task list and its task detail Reply/Post reply controls, visually inspected before implementation. The user had approved serving this local HTTP reference.

The page uses the existing shared Card, Button, Badge and Field styles without the role shell. The sample selection and comment pages came from HTTP and PostgreSQL, not a local fixture array. The browser saved HTML shaped text literally, and DOM inspection found no injected `b` element inside reply bodies.

Retained browser reply evidence:

| Scenario | Persisted id | Original UTC creation instant |
|---|---|---|
| Browser persistence and escaped text | `proof-comment-a29604d4-f1d7-4de7-85f1-70da09586157` | `2026-10-28T17:03:06.709Z` |
| Unconfirmed submission, reload, database restart and Retry | `proof-comment-8c48429f-fc56-4880-8f10-25e905a5530d` | `2026-10-28T17:05:37.975Z` |

Both records were checked directly through Prisma and replayed through the restarted development HTTP service. The UI displayed event instants in Africa/Lagos as GMT+1. The carry task's status and timestamps remained unchanged after comment writes.

At 320 CSS pixels, `innerWidth` was 320 and document width was 305, allowing for the scrollbar. There was no horizontal page overflow. Replies scroll inside their own keyboard reachable region. Previous and Next reply controls loaded the older page and returned to the newly saved browser record.

Screenshots are local verification artifacts, excluded from Git with the existing `.local/` rule:

- `.local/verification/feature5/proof-desktop.jpg`, the sample task and persisted browser replies.
- `.local/verification/feature5/proof-mobile.jpg`, the 320 CSS pixel proof page.

Production URL: `http://127.0.0.1:3000/__data-proof`. Chrome rendered `Home`, `Preview workspace`, and `This feature is not built yet.` It showed no proof page, development role control or proof entry link. API and asset checks above independently verified production omission.

## Value sourcing coverage

| Spec value source | Observed check |
|---|---|
| Fixed actor, week and tracker | Context script, live task response, and rollback context failure probes |
| Eligible carry task id | Exact equality with createSeedPlan; Week 43 id text retained while task belongs to Week 44 |
| Names, task text, dates and status | Live API projection and browser sample task; no email exposed |
| Fixed sample scope | Week 44 response and UI labels throughout the actual current date |
| Comment text | Browser HTML shaped reply, trim and Unicode API probes, direct database equality |
| Submission UUID and comment id | Eight concurrent requests, original browser row ids and restart replay |
| Database creation time | Original row timestamp equals all replay responses |
| WAT display | Browser full timestamps displayed as GMT+1, while API instants remain UTC |
| Page size and hasMore | Twenty first page replies, next page and empty page 10000 |
| Insert or replay outcome | One 201, exact retry 200, conflict 409, unchanged task record |
| Draft and uncertain state | Real database outage, preserved disabled draft after reload, same reply recovered through Retry |
| Availability guards | Unsafe configuration omission, Host/Origin probes, production 404 and asset absence |
| Error and empty copy | Live 400/403/404/405/409/413/415/503 states; both browser empty scenarios observed through the rollback fixture service |
| Prototype controls | Live visual reference and proof page screenshots |

## Boundaries

Only one eligible task exists in this proof, so a conflict between two different eligible tasks is not an available fixture scenario. Outside scope tasks are denied before lookup. The retry tuple comparison still checks both task and author.

Closing the browser tab can lose sessionStorage recovery and is outside the agreed guarantee. Actual storage denial and an artificial network stall lasting exactly 12 seconds were not fault injected. The browser's real 503 outage path exercised the same unconfirmed recovery behavior. No remote database, real employee authentication or complete task lifecycle was exercised or claimed.

Feature 4's complete verification remains separate and unfinished. This verification does not mark that shared foundation done.

## Acceptance result

AC-1 through AC-8 passed for the agreed local proof. Build and verification scope boxes may be checked. This is not a claim that authentication, Employee task lifecycle or the wider shared UI verification has shipped.
