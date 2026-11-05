# Verify: Employee history, spec 0010

Built on 2 November 2026. Automated and observed application checks pass. Overall acceptance remains open for actual NVDA and native 200 percent browser zoom. The engineer explicitly chose to leave those two checks open. The feature and spec remain In Progress.

## UI and runtime

* [x] Inspect the exact Employee History prototype, date dialog and frozen drawer. Reuse its table and approved status/state treatments. Keep the Employee navigation. AC-1.
* [x] Open `/employee/history` in development and production. Exercise all weeks, an individual week, status and inclusive date overlap, page two, combined filters and a captured empty week. AC-1, AC-2.
* [x] Distinguish a valid empty week from a corrupt or unavailable week. Keep valid history visible alongside the scoped repair banner. AC-6.
* [x] Open a task by keyboard, inspect frozen owner/reporting labels and review evidence, confirm no Employee editor or reply control, then Escape back to the task button. AC-3, AC-9.
* [x] Exercise the table, date dialog and drawer at 1280 and 320 pixels with reduced motion and axe. No normative axe violation or horizontal page overflow was found. The wide table uses its shared focusable scroll region. AC-9.
* [x] Fail a refresh, retain same selection rows as stale, Retry successfully, reject a late older filter response and withhold private content during foreground session revalidation while preserving filters. AC-9.
* [x] In the Neon app, observe Ada's 13 historical tasks, three Approved tasks for 19 October, and a frozen approved drawer with every write capability false. The 26 October week correctly returns REPAIR_REQUIRED and zero readable records. A 26 to 30 October range still includes the older long task. AC-2, AC-3, AC-6, AC-8.
* [ ] Check actual native browser 200 percent zoom on History, its filters, date dialog and drawer. Confirm all content and controls remain reachable. Viewport resizing is separate evidence. AC-9.
* [ ] With actual NVDA, verify heading/table semantics, filter labels, loading/error announcements, dialog focus, keyboard row activation and focus return. AC-9.

Native control returned another application's screenshot and reported unavailable input geometry, so it could not safely prove browser zoom. NVDA was absent from both standard install paths. Neither check is claimed as passed. Earlier Features 9 and 10 retain their own open manual gates.

## Commands and data

* [x] `npm run check` passes lint, strict TypeScript and the production build. AC-10.
* [x] `npm run test:employee:history` passes 13 real separate database checks, including concurrent capture, atomic person and roster audits, all five roles, full/partial leave, inactive and zero task staff, source guards, late approvals and diagnostics. AC-2 through AC-8, AC-10.
* [x] The combined authentication, Employee, History and telemetry run passed 94 checks with three optional telemetry browser checks skipped, before the additional worker continuation test. The final targeted History run includes that continuation test. No regression failure remains. AC-8, AC-10.
* [x] The production browser run passed 20 flows: seven Home flows, six History flows, four lifecycle flows and three pagination flows. The development History run passed all six flows. Both use isolated test app ports 3001/3002 and the explicit TEST_DATABASE_URL. AC-1 through AC-3, AC-6, AC-8 through AC-10.
* [x] Apply `20261102170000_employee_history` on Neon and the separate test database, then execute its SQL twice on each. Both progress fields and all four new guards exist. All 82 previously captured Neon snapshots retained their timestamp and context. AC-4 through AC-7, AC-10.
* [x] Repeat the test seed after capture. All 979 already captured trackers, the tracking start and its initialization audit remain identical. Historical source fixtures are filtered under transaction locks. AC-7, AC-10.
* [x] Run private diagnostics and safe retry for Ada's captured 19 October week. Both return ALREADY_CAPTURED, changed false, exit 0. An unproven 26 October record returns HISTORICAL_FACTS_UNAVAILABLE and exit 2. An unsupported override argument returns exit 1. Actual child process exit codes were recorded, separately from PowerShell's handling of nonzero commands. AC-6, AC-7.
* [x] Restart the final compiled app and observe readiness 200 and authenticated History 200 while capture remains enabled. Startup, minute scheduling and stopping are owned by the existing process, with no new public write endpoint. AC-4, AC-7, AC-10.

The combined regression command was:

```text
node --import tsx --test --test-concurrency=1 tests/auth/*.test.ts tests/employee/calendar.test.ts tests/employee/api.test.ts tests/employee/lifecycle.test.ts tests/employee/history.test.ts tests/telemetry/*.test.ts
```

The production browser command used `EMPLOYEE_BASE_URL=http://127.0.0.1:3001` and ran `tests/employee/browser.test.ts`, `history.browser.test.ts`, `lifecycle.browser.test.ts` and `pagination.browser.test.ts`. Set `EMPLOYEE_BASE_URL=http://127.0.0.1:3002` for the development History suite. Run the Employee API fixtures first on a fresh test database, then build and start the isolated app with `npm run test:employee:app` or `npm run test:employee:app -- --dev`.

## Failure and value sourcing proof

* [x] Current Employee authorization uses the real session and fresh persisted assignment. Both task owner and tracker user predicates remain enforced. Extra, duplicate, invalid and substituted selectors are rejected. Responses are private and no store. AC-8.
* [x] A shared validator requires the recorded version 1 role/context shape, expected days and freeze timestamp. Corrupt snapshots are not counted or overwritten; valid recorded labels survive a current rename. AC-3, AC-6.
* [x] Database sessions force UTC, including when the URL supplies a different timezone. Database epoch and Prisma instant agree. Business dates retain Africa/Lagos semantics and ISO week years cross New Year correctly. AC-2, AC-5, AC-7.
* [x] Competing person captures commit one snapshot/audit. Whole roster completion waits on the assignment table fence, defers on a 500 millisecond lock timeout, and commits one marker/audit only after every required snapshot validates. Injected failures leave no partial evidence. AC-5, AC-7.
* [x] A capture waiting on its owner lock crosses freeze and observes the source change committed during its wait, then refuses unsafe reconstruction. Safe later assignment closure and leave events preserve historical projections; retroactive changes are rejected. AC-5, AC-6, AC-7.
* [x] Catch-up advances independent cursors past permanent repair targets, rotates phases and respects bounded admission. One failed person audit rolls back that person while unrelated captures commit. Refusals and exceptions produce only the fixed private diagnostic category, and the worker backs off failures. AC-4, AC-6, AC-7.
* [x] Initialization repeats without changing baseline/audit. Scoped retries do not mark an unrelated global roster complete. Capture creates no task, comment, approval, notification or email. AC-4, AC-7.
* [x] A late manager decision changes History's status and drawer review while the full captured tracker remains identical. Frozen Employee writes still reject the record. AC-3.

## Evidence and local setup

Evidence lives in `.local/verification/feature11/`: `development/report.json`, `production/report.json`, their screenshots, `migration-test.json`, `migration-neon.json`, `seed.json`, `operator.json`, `neon-runtime.json` and `production-runtime.json`. The current production browser bundle also passed the preserved Feature 9 and 10 suites, saved under their separate `feature11-regression-production` evidence directories.

An early local test run exposed PrismaPg's UTC session requirement. Its old local test database was preserved. `.env` now points TEST_DATABASE_URL to the fresh separate local `prod_tracker_history_test` database, which was migrated and seeded. The ordinary DATABASE_URL remains Neon. No credential or database URL is stored in this checklist.

## Acceptance coverage

| Criterion | Outcome |
| --- | --- |
| AC-1 | Passed prototype and live page checks |
| AC-2 | Passed filters, overlap, ISO year, distinct carry and pagination checks |
| AC-3 | Passed frozen detail and late decision checks |
| AC-4 | Passed initialized coverage, bounded catch-up and live startup checks |
| AC-5 | Passed real roster, attribution, leave, clock and freeze checks |
| AC-6 | Passed preserved valid history, unavailable records and partial progress checks |
| AC-7 | Passed atomicity, lock contention, retry, continuation and operator checks |
| AC-8 | Passed session, ownership, exact selector and response privacy checks |
| AC-9 | Automated checks passed, native zoom and NVDA remain open |
| AC-10 | Tooling, separate database, migration and development/production runtime checks passed, final acceptance waits for AC-9 |

All specified implementation surfaces exist. Overall verification is incomplete solely for the two deferred manual checks. Keep Verify unticked and do not mark the feature done.
