# Verify: Employee leave, spec 0011

Built and exercised on 3 November 2026. Automated and live application checks pass. Overall verification remains open for actual NVDA and native browser zoom evidence. Spec status remains In Progress.

## UI and live application

* [x] Match the Employee prototype's two cards, dates, heading and fixed navigation, with the approved Scheduled and failure treatments. No relief selector or leave history table. AC-1.
* [x] Confirm leave, inspect Scheduled, cancel, confirm current leave and return from Home at 1280 and 320 pixels. Repeat in development and production. AC-1 through AC-4.
* [x] Clear a required date, submit by keyboard and focus its linked error. Clearing a field retains an empty draft rather than restoring a default. No horizontal page overflow or normative axe findings in the scanned states. AC-10.
* [x] Lose a committed create response, navigate to Home and retry its original UUID. Exactly one leave and audit persist. AC-6, AC-10.
* [x] Retain a conflict draft until explicit Reload latest; distinguish an acknowledged save from a failed read; hide private content during foreground session revalidation and retain the same actor draft. AC-10.
* [x] Show a repair warning for conflicting legacy periods, preserve Home's union pause and disable ambiguous return. AC-9.
* [x] Show notification configuration warnings as a saved result with no write Retry. The database suite separately proves real gap codes and available recipient persistence. AC-5, AC-10.
* [x] On the ordinary Neon app at port 5173, inspect Ada's real Leave form, create leave, observe the pause and return from Leave and Home. Enter 3 to 10 December using native date keyboard input and observe Scheduled. AC-1 through AC-5.
* [x] In the compiled Neon app at port 3000, cancel that scheduled booking. The API returns NONE afterwards. Each changed event has one receipt, one audit and three notification rows. Ada's task and frozen History hashes remain unchanged across cancellation. AC-4, AC-5, AC-7, AC-11.
* [ ] With actual NVDA and Chrome or Edge, exercise labels, invalid submit focus, Scheduled cancellation, return on both pages, saved/error announcements, Retry and explicit Reload latest. Confirm each new outcome is announced once and private content is withheld during revalidation. AC-10, AC-11.
* [ ] At native browser zoom of 200 percent, repeat form entry, Scheduled/current cards, warnings, navigation and Home return. Confirm text, date controls, actions and focus remain visible without page overflow. Viewport resizing is separate evidence. AC-10, AC-11.

## Commands and data checks

* [x] `npm run check`: lint, strict types and production build pass. AC-11.
* [x] `npm run test:employee:leave`: 15 checks pass against the explicit separate test database. AC-2 through AC-10.
* [x] `npm run test:employee:leave:browser`: eight cases pass in each app mode, including notification warnings and retained Retry focus with duplicate activation blocked. AC-1, AC-3 through AC-6, AC-9, AC-10.
* [x] Existing Employee calendar/API, task lifecycle and History database regressions: 40 checks pass. AC-4, AC-7, AC-11.
* [x] `npm test`: 28 authentication checks pass. AC-8, AC-11.
* [x] Existing History browser suite: six checks pass. Task lifecycle browser suite: four checks pass. Pagination browser suite: three checks pass. AC-4, AC-7, AC-11.
* [x] Apply `20261103080000_employee_leave` using Prisma on Neon and the separate database, then execute its SQL twice on each. Receipt constraints and immutable/source triggers are active; migration checksum matches. Existing leaves, audits and frozen tracker values remain unchanged. AC-7.
* [x] Run the seed twice on the separate database. Existing leave rows, receipts and captured trackers remain unchanged. No reset or cleanup of historical evidence. AC-7.

## Acceptance coverage

| Criterion | Observed evidence | Verdict |
| --- | --- | --- |
| AC-1 | Inspected prototype, live Neon screenshots, desktop/mobile browser flows | Met |
| AC-2 | Real date, horizon, duration, terminal year, exclusive return and WAT boundary tests | Met |
| AC-3 | Current/Scheduled transitions, natural expiry classification, racing create tests, live cancellation | Met |
| AC-4 | Both return controls, zero day return, unchanged WorkWeek and protected task/History evidence | Met |
| AC-5 | Available/missing recipients, changed recipient after a lock wait, injected write failures, live three recipient events, warning UI | Met |
| AC-6 | Same/different key races, changed payload conflict, terminal no change receipts, lost response retry | Met |
| AC-7 | Both migration proofs, repeated seed, immutable receipts, source guard rejection, source lock and post guard midnight tests | Met |
| AC-8 | HTTP selector/body/origin/ownership/session guards and persisted deactivation after a lock wait; auth regressions | Met |
| AC-9 | Separate database and real app repair states, combined pause and no arbitrary return target | Met |
| AC-10 | Drafts, validation, retry, conflict, revalidation, stale actor reply, responsive and axe checks | Manual NVDA/zoom open |
| AC-11 | Real development/production and Neon flows, build, domain and regression suites | Manual NVDA/zoom open |

All specified surfaces exist: Leave page, Home return integration, private current leave GET, create/cancel/return POSTs, the shared classifier and atomic mutation service, Prisma receipt model and migration. No application email delivery or unrestricted history repair was added.

## Evidence ledger

Scratch artifacts are private and ignored by Git under `.local/verification/feature12/`:

* `production/report.json` and `development/report.json`: route, screenshot and axe evidence for the most recent browser invocation. Earlier screenshot artifacts remain alongside each report.
* `form-1280.png`, `form-320.png`, `validation-*`, `scheduled-*`, `on-leave-*`, `home-paused-*`, `home-returned-*`, `conflict-retained.png`, `saved-read-failed.png`, `repair-required.png`, `lost-response-recovered.png` and `notification-warning.png` within each mode directory.
* `neon-scheduled.png`: live Scheduled card with 3 and 10 December dates. `neon-production.png`: restored form after production cancellation.
* `neon-scheduled.json` and `neon-returned.json`: sanitized API/data checks, per event audit/receipt/notification counts and protected record hashes.
* `migration-test.json`, `migration-neon.json` and `seed.json`: repeated SQL/seed checks and preserved evidence counts.

Browser verification uses isolated loopback ports 3001 (compiled) and 3002 (development) with TEST_DATABASE_URL. Ordinary port 5173 and temporary compiled port 3000 use Neon with the existing fictional Ada account. Credentials, cookies and raw browser storage are excluded from artifacts. All fictional leave bookings made during the Neon check were returned or cancelled; their immutable evidence remains.

The Chrome extension's date fill helper changed the visible input without firing React's change handler. Native keyboard input verified the intended scheduled range. The Playwright regression suites use actual input events and assert persisted outcomes. This tool limitation is separate from the cleared draft bug fixed and covered by the suite.

Final boundary review added regressions for a legacy end date in year 10000 and an actor change while a response body is decoding. Both were reproduced failing before the minimal corrections and passed afterwards. The classifier now compares date bounds numerically, and the client rechecks its actor after decoding before publishing a commit.

## Handover

Build boxes are complete. Verify remains unticked until the two manual items above are observed. This feature does not close the earlier features' outstanding manual checks. No branch, commit or push was created.
