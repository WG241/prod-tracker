# Epic: Employee

Recommended first user group. Finish this epic (plus shared profile and notifications when they unblock the happy path) before Line Manager.

## Employee

### 9. Employee home and weekly board · in-progress
Employee Home: week context, metrics, and the weekly task board or list for the open week, respecting tracker lock state from HR.
**Done when:** a signed in Employee sees this week's tasks from the DB, empty and locked states render clearly, and week navigation matches the prototype intent.
- [x] Design it (spec): `/architect employee home and weekly board`
- [x] Build it: `/develop employee home and weekly board`
  - [x] Confirm the built shared shell and authentication prerequisites, and obtain approved visual prototype references (AC-1, AC-5, AC-8, AC-9).
  - [x] Compose the final prototype List and Card views, date controls, attention section, read only drawer, and approved states (AC-1 through AC-6, AC-8).
  - [x] Implement the two guarded read endpoints, calendar and lock projections, ownership checks, and pagination on the existing database model (AC-2 through AC-5, AC-7, AC-8).
  - [x] Connect live data with cancellation, boundary refresh, stale states, and session handling (AC-2 through AC-8).
- [ ] Verify it: `/check verify employee home and weekly board`

spec [0008](../specs/0008-employee-home-weekly-board.md) · code in `src/features/employee/`, `server/employee/`, and `tests/employee/`. Shared shell and real authentication prerequisites confirmed. Prototype inspected through the approved development URL. Build, 15 API/calendar checks, 28 auth regressions, 7 browser flows in each app mode, and isolated pagination checks pass. Runtime evidence and the manual handoff are in `.local/verification/feature9/acceptance.md`. Native NVDA and 200 percent browser zoom evidence remain open under the shared accessibility baseline. Task changes remain in Feature 10.

### 10. Employee task lifecycle · in-progress
Create and edit tasks, update progress, mark complete for approval, carry tasks, cancel or hold where the prototype allows, with comments.
**Done when:** Employee can take a task from creation through awaiting approval against seeded or new rows; invalid edits while locked are blocked with a clear message.
- [x] Design it (spec): `/architect employee task lifecycle`
- [x] Build it: `/develop employee task lifecycle`
  - [x] Compose the inspected task forms, action menus and confirmations, including the approved status only and error adjustments (AC-1, AC-10).
  - [x] Apply and verify task revisions and receipts, fresh write guards, and safe read capabilities (AC-2, AC-3, AC-8, AC-9, AC-11).
  - [x] Implement task changes, immediate carry, review attempts, atomic notifications and post commit telemetry (AC-2 through AC-9).
  - [x] Connect retained drafts, retry identity, conflict reload and confirmed refresh behavior (AC-1, AC-8, AC-10).
  - [x] Run regression, concurrency, rollback and real application checks in development and production (AC-1 through AC-11).
- [ ] Verify it: `/check verify employee task lifecycle`

spec [0009](../specs/0009-employee-task-lifecycle/index.md) · code in `src/features/employee/`, `server/employee/`, the revision/receipt migration and `tests/employee/lifecycle*`. Build confirmed on 2 November 2026. The migration is live on Neon and the separate test database, and its second run preserves timestamps. Lint/types/build, 12 lifecycle checks, 15 existing Employee checks, 28 authentication checks and 4 lifecycle browser flows in each app mode pass. [Verification checklist](../specs/0009-employee-task-lifecycle/verify.md) records the evidence. Native NVDA and 200 percent browser zoom remain open, so Verify stays unticked. Notifications are persisted here; their screen and email delivery remain Features 14 and 15.

### 11. Employee history · in-progress
Past weeks of the Employee's own work with status filters, read only when the week is closed.
**Done when:** Employee can browse prior weeks' tasks from the DB and open task detail without editing closed history.
- [x] Design it (spec): `/architect employee history`

- [x] Build it: `/develop employee history`
  - [x] Compose the inspected History screen, approved filters, states and existing drawer (AC-1, AC-2, AC-3, AC-9).
  - [x] Apply the two progress fields and historical source guards, preserving existing evidence (AC-4 through AC-7, AC-10).
  - [x] Implement bounded capture, coverage, completion and private diagnostics/retry (AC-4 through AC-7).
  - [x] Connect the private History API, availability, pagination and session handling (AC-1 through AC-3, AC-6, AC-8, AC-9).
  - [x] Run capture, rollback, concurrency, regression and real application verification (AC-1 through AC-10).
- [ ] Verify it: `/check verify employee history`

spec [0010](../specs/0010-employee-history/index.md) · code in `src/features/employee/EmployeeHistory.tsx`, `server/employee/history-*`, the progress/source guard migration and `tests/employee/history*`. Built on 2 November 2026. Neon and separate database migrations preserve existing evidence. Lint/types/build, 13 History checks, the broader regression suite, 20 production browser flows and six development History flows pass. [Verification checklist](../specs/0010-employee-history/verify.md) records evidence and local setup. Existing valid snapshots remain readable; unproven earlier records require reviewed repair. The engineer chose to leave NVDA and native 200 percent zoom open, so Verify stays unticked.

### 12. Employee leave · in-progress
Request leave, see status, and understand relief officer impact for the Employee's own absences.
**Done when:** Employee can submit a leave request stored in the DB, see it listed, and get in app (and later email) confirmation of the request path from the prototype.
- [x] Design it (spec): `/architect employee leave`
- [x] Build it: `/develop employee leave`
  - [x] Compose the inspected Leave screen and approved scheduled/failure states (AC-1, AC-3, AC-10).
  - [x] Apply immutable leave receipts and safe atomic writes with notifications/audit (AC-2 through AC-8).
  - [x] Connect current leave reads, Home return, conflict handling and retained request identity (AC-3, AC-4, AC-9, AC-10).
  - [x] Run separate database, migration and real app regression checks (AC-1 through AC-11).
- [ ] Verify it: `/check verify employee leave`

spec [0011](../specs/0011-employee-leave/index.md) · code in `src/features/employee/EmployeeLeave.tsx`, `leave-*`, `server/employee/leave-*`, the receipt migration and `tests/employee/leave*`. Built on 3 November 2026. Neon and separate database migrations preserve existing evidence. Lint/types/build, 15 leave checks, 40 Employee regressions and 28 authentication checks pass, together with leave and existing History/task browser checks in the real app. [Verification checklist](../specs/0011-employee-leave/verify.md) records runtime evidence. Native NVDA and 200 percent browser zoom remain open, so Verify stays unticked. Notification rows are persisted; their screen and email delivery remain Features 14 and 15.
