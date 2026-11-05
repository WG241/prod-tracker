# Verify: Employee task lifecycle, spec 0009

Updated 2 November 2026. Feature 10 is built. Verification remains open because native 200 percent zoom and actual NVDA evidence have not been observed. Computer use stopped when it could not verify the current browser URL reliably enough to continue.

## Commands

* [x] `npm run db:deploy`, regenerate Prisma, and run the new migration SQL twice against Neon. Required columns and constraints exist, revisions are nonnegative and historical task timestamps remain unchanged. AC-2, AC-6, AC-8, AC-11.
* [x] `npm run test:setup` applies the migration to the explicit separate TEST_DATABASE_URL. AC-11.
* [x] `npm run check` passes lint, strict browser/server types and the production build. AC-11.
* [x] `npm run test:employee:lifecycle` passes 12 real database and HTTP checks. AC-2 through AC-9, AC-11.
* [x] `npm run test:employee` passes all 15 existing calendar and read API checks. AC-3, AC-9, AC-11.
* [x] `npm test` passes all 28 authentication regressions. AC-9, AC-11.
* [x] `npm run test:employee:browser` passes all 7 existing Employee browser regressions against Neon in each of development and production. AC-9, AC-10, AC-11.
* [x] `npm run test:employee:lifecycle:browser` exercises real development and production apps on isolated ports 3002 and 3001. See the browser steps below. AC-1, AC-7, AC-8, AC-10, AC-11.

To repeat browser checks, build and prepare the separate test database first. In a separate terminal run `npm run test:employee:app -- --dev` for port 3002, or `npm run test:employee:app` for port 3001. Set EMPLOYEE_BASE_URL to that origin and EMPLOYEE_TARGET to development or production, then run the browser command. The mutating browser suite accepts only these isolated ports, and its fixture writes use the guarded TEST_DATABASE_URL. Never point it at ordinary Neon development data.

## UI and runtime

* [x] Inspect the final prototype Employee forms, menus, drawer, blocker next step, completion and deletion dialogs before implementing them. Preserve the approved status only and error placement adjustments. AC-1, AC-10.
* [x] Create, edit, block, carry, reply, complete, withdraw a pending review by editing, and delete through actual List/Card controls in development and production. AC-1 through AC-7, AC-10.
* [x] Close a creation dialog after the server commits but its response is lost. Reopen, retain the submitted draft, Retry with the same UUID and observe exactly one task. AC-8, AC-10.
* [x] Change a task from another request while its edit form is open. Keep the rejected draft and explicitly Reload latest. AC-8, AC-10.
* [x] Exercise Escape focus return on the action menu, the shared modal focus behavior, axe checks, and a 320 pixel conflict form without horizontal overflow. AC-10.
* [x] Delete the only record on page two, observe automatic navigation to the populated first page and preserve List/Card selection. AC-7, AC-10. Passed in both app modes.
* [x] Create Ada's fictional `Feature 10 verification task` visibly in the Neon development app. Through the production build, edit it, carry it, submit completion and append a comment. The task remains Awaiting approval for inspection, with one immediate Pending continuation and persisted review evidence. AC-2, AC-5, AC-6, AC-7, AC-11.
* [ ] Observe native browser 200 percent zoom on the real task form, drawer and confirmation controls, with no clipped action or content. Viewport resizing is separate evidence. AC-10, AC-11.
* [ ] With actual NVDA, verify labels, first invalid field focus, one scoped error/success announcement, menu navigation and modal focus return. AC-10, AC-11.

## Value sourcing and failure checks

* [x] Authorization uses the persisted current session, Employee assignment, task owner and tracker user. Missing, other, hidden and future records cannot become write targets. AC-3, AC-9.
* [x] Calendar derives Monday and cutoffs in Africa/Lagos. A leave change committed during a held owner lock is seen by the waiting command. Closed planning permits activity/comments and rejects title/carry/delete. Exact freeze, unlock and leave union boundaries remain covered by existing calendar tests. AC-3.
* [x] New or changed dates obey Monday through Friday starts, real dates, inclusive 366 day span and required carry. Unchanged inherited long dates do not force a planning edit. Exact payloads reject extra fields and blank or oversized text. AC-2, AC-3.
* [x] Revisions reject a concurrent stale edit. Reusing a UUID with another revision rejects conflicting intent. Even a no change command receives a durable receipt that replays after later changes. AC-8.
* [x] Tracker context and submission attribution use the fresh current assignment and stored labels, while captured records stay immutable. No read creates domain rows. Existing frozen read checks remain passing. AC-2, AC-3, AC-5, AC-9.
* [x] Continuations share series/owner and predecessor, receive next Monday through at least Friday, remain independent, and restore the same untouched identity after undo. Added evidence blocks undo. Source deletion preserves the future copy. AC-6, AC-7.
* [x] Completion uses the next persisted attempt and current eligible manager. Invalid manager routing rolls back. Editing or carrying awaiting work withdraws its request, and later explicit completion creates a new attempt without changing old snapshots. AC-4, AC-5.
* [x] One submission commits one manager notification and business audit with its receipt. Injected task, request, notification, audit and receipt failures roll back all domain counts and content. AC-5, AC-8.
* [x] Comment author and timestamp come from the authenticated principal and server. Same request retries append once, keep task revision unchanged and preserve pending review. Approved tasks permit conversation and reject status changes. AC-3, AC-7, AC-8.
* [x] Replay returns the saved result; response loss recovery uses the original UUID and exact payload. Server errors and stale revision keep truthful, reviewable UI states. AC-8, AC-10.
* [x] Submission telemetry is invoked once after a new commit with its persisted timestamp and Employee/Human semantics. Replay, no change and rollback do not emit. Delivery exceptions cannot undo the commit. AC-5, AC-8.

Evidence is in `.local/verification/feature10/`: development and production screenshots, `neon-runtime.json`, and `acceptance.md`. Automated checks do not replace the two open manual accessibility steps. The scope Verify box remains unticked and the spec remains In Progress.
