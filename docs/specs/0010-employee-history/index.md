# 0010. Employee history

**Date**: 2026-11-02
**Status**: In Progress

## Summary

Employees can browse their closed weekly work, filter it, and open a read only task record. A background process captures the historical roster, including people with no tasks. Catch-up preserves trustworthy evidence and leaves uncertain records unavailable for a reviewed repair.

## Structure

* `0010-history-read.md` specifies the page, filters, private read API and availability states.
* `0010-roster-capture.md` specifies automatic capture, durable progress, transactions and operator diagnostics.
* `rationale.md` records the choices and tradeoffs.

## Requirements

As an Employee, I want to find my previous deliverables and their recorded context without changing closed history.

1. **AC-1**: `/employee/history` implements the inspected Employee History prototype: its heading, week selector, date range control, four column task table and pagination. The user approved reusing the prototype's history status selector on this page and the shared loading, empty, error, Retry and availability banner treatments. Keep the fixed Employee navigation.
2. **AC-2**: History includes every owned frozen week, including the just finished week during the weekend and valid captured weeks with no tasks. Show distinct carried weekly records and exclude hidden tasks. All weeks and All statuses are the defaults. Week options include the ISO week year. Explicit dates use inclusive task overlap and at most 366 days. Counts and filters apply to the whole result before pages of 25.
3. **AC-3**: Each row opens the existing read only drawer. Owner and reporting context come from the validated historical snapshot. Content, dates, blocker and carry stay frozen under the existing writer rules. Latest permitted manager decisions may change the original week's status and review outcome without rewriting roster context or eligibility. Employee controls cannot edit, comment, carry or delete a closed record.
4. **AC-4**: The app starts a capture check at startup and every minute without blocking ordinary application availability. It processes existing WorkWeek rows and ensures reconstructable weeks from the once recorded current Monday onward, including weeks without submitted work. An uncertain covered gap remains represented as requiring repair. It does not invent earlier missing weeks or write from GET. Downtime is handled by subsequent bounded catch-up.
5. **AC-5**: A frozen roster includes every staff identity whose assignment overlaps that week's Monday 00:00 WAT through its freeze, including inactive, full leave, nonemployee and zero task cases. Attribution uses the historical assignment rule and expected days use the existing calendar helpers. A new snapshot stores actual capture time, immutable version 1 context and the captured expected days. Valid existing snapshots remain unchanged.
6. **AC-6**: Unreliable account or reporting labels, invalid assignment history and corrupt frozen snapshots never become best effort historical truth. Such person/week records stay unavailable for a separately reviewed repair. Valid individual snapshots remain readable while other people or weeks are incomplete. A week receives rosterCapturedAt only when every required roster entry is captured and valid.
7. **AC-7**: Capture and retry are safe across competing app instances, repeated ticks, crashes and shutdown. Each person snapshot and its System audit commit atomically, as does each completed week marker and its audit. A failed unit rolls back completely, does not prevent other valid units from progressing, and cannot mark a partial roster complete. Initialization and markers are not rewritten on retry.
8. **AC-8**: History requires the real current Employee session. Scope every task by both ownerId and tracker.userId. No caller supplied person or role can change scope. Missing, hidden and other owned ids share the existing detail 404. Invalid selectors receive fixed 400 errors, unavailable dependencies 503, anonymous sessions 401 and other current roles 403. Responses are private and no store.
9. **AC-9**: Filter changes reset pagination and close an old drawer. Selection survives same actor session revalidation, while private results are withheld. Failed reads retain appropriate drafts or same selection data with a stale notice and Retry. Old callbacks cannot populate a newer filter, drawer or actor. Shared keyboard, focus, announcements, mobile, reduced motion, NVDA and native zoom requirements apply.
10. **AC-10**: The additive idempotent migration is verified on Neon and TEST_DATABASE_URL without changing old snapshot timestamps. Lint, types, production build, meaningful separate database tests and real development/production application verification pass. Include capture concurrency, rollback, zero submitters, catch-up, unreliable facts, filter pagination and late decisions. Preserve Features 9 and 10 and their separately open manual accessibility gates.

## Decision

Reuse React, Express, PrismaPg, Neon and the existing authentication, accessibility and telemetry boundaries. Add one Employee History read endpoint, two nullable progress fields and an in process capture service. Provide a private diagnostic and safe retry command. No new provider, package, secret, public mutation route, HR screen or unrestricted backfill interface is introduced.

The confirmed model is WorkWeek.rosterCapturedAt as an optional Timestamptz(3), and TrackerSettings.trackingStartsOn as an optional date containing a Monday. The latter starts null until its first successful initialization and then cannot change. All existing relationships, weekly identities and immutable snapshot columns remain in use.

## Rationale

Reasoning and alternatives are in `rationale.md`.

## Feature design

The read and capture child specs supply the detailed API, security, state handling and critical test scenarios. They share this model and the value sources below.

| Record | New field | Relationship and invariant |
| --- | --- | --- |
| WorkWeek | rosterCapturedAt: optional Timestamptz(3) | Existing 1:N trackers; set once only after validating the complete required roster, never before freezesAt |
| TrackerSettings | trackingStartsOn: optional date | Existing singleton; initialized once to a real WAT Monday and then immutable |
| WeeklyTracker | No new fields | Existing unique person/week, historical assignment FK, version 1 context and 0..5 expected days become immutable when captured |
| User, EmploymentAssignment, LeaveRecord, Business, Unit | No new fields | Existing source relationships and dated history supply membership, eligibility and referenced labels |
| WeeklyTask, TaskSeries, comments and reviews | No new fields | Existing owned records and decisions remain the task history; capture never duplicates or revises them |
| AuditEvent | No new fields | System evidence commits with initialization, each newly captured person and whole roster completion |

Per person history moves from uncaptured to captured only after successful validation and commit. Unsafe or corrupt records stay unavailable; valid captured records never return to uncaptured. A week moves from incomplete to complete only after every required roster entry validates. Transient failures leave the committed state unchanged.

### Shared invariants

Use Africa/Lagos and the server clock. A week is historical when its persisted freezesAt is at or before authorization time, regardless of its Monday relative to today's Monday. Automatic missing week creation uses the existing validated settings and fixed Saturday 00:00 WAT freeze rule. Never change an existing week's cutoffs to match new settings.

Employee History availability is per owner/week, not the global roster completion marker. Whole roster completion is reserved for later denominator and reporting consumers. No current account flag, role or label may overwrite a valid captured row. Current role and account eligibility still govern whether the caller may sign in and read.

Background capture is System work. It is not submission, approval, notification or email delivery. Capture creates no task, comment, request, decision or message and never changes task status, content, revision or carry linkage. Existing late decision contracts remain in force.

## Value sourcing

| Action | Produced value | Named source |
| --- | --- | --- |
| Authorize History | current user, Employee role and session | existing real session wrapper and fresh persisted principal checks |
| Select records | frozen membership, selected week/status/dates and totals | WorkWeek.freezesAt, WeeklyTracker.userId, WeeklyTask.ownerId/deletedAt, validated query and task overlap |
| Display rows and drawer | title, status, dates, owner, reporting labels, review and comments | owned WeeklyTask, validated version 1 contextSnapshot and the existing authorized detail projection |
| Explain availability | available, pending or repair required | snapshot validation and the same pure reconstruction eligibility checks used by capture, scoped to the caller |
| Establish automatic coverage | first tracked Monday and later missing weeks | once initialized TrackerSettings.trackingStartsOn, WAT Monday arithmetic, stored WorkWeek rows and validated settings |
| Select roster and assignment | required identities, role and reporting ids | dated EmploymentAssignment overlap and assignmentForWeek at freeze minus one millisecond |
| Capture eligibility | zero through five expected days and account status at reference | activeAt/expectedWorkingDays, User account timestamps, protected historical assignment/leave projections and the immutable initialization audit's protection start time |
| Capture labels safely | name, organisation, manager and department | referenced stored labels, source timestamps and the conservative reconstruction rules in the capture child spec |
| Commit evidence | snapshotAt, rosterCapturedAt and System audit | actual server capture time, successful validation, guarded transaction result and fixed audit actions |
| Operate and retry | target selection, counts, fixed reason codes and outcome | validated private CLI selectors and persisted records; no caller supplied historical facts |
| Refresh UI | page, filters, pending/error/stale state and focus | nonprivate per actor view state, actual fetch outcome and existing shared focus/announcement helpers |
| Observe failures | sanitized background diagnostic | real capture exception or reconstruction failure, fixed private taxonomy, existing telemetry sanitizer |

## Build plan

Use the project's Facade approach, with real data in this feature rather than a final fake page.

1. Compose the inspected History table, filter bar and reused drawer with the approved status and state treatments. Add safe view and response types, satisfying AC-1, AC-2, AC-3 and AC-9.
2. Add, regenerate, apply and rerun the one additive migration for the two progress fields and their guards, satisfying AC-4, AC-6, AC-7 and AC-10.
3. Implement pure snapshot validation and reconstruction checks, capture units, coverage initialization, whole roster completion, scheduler lifecycle and private diagnostics/retry, satisfying AC-4 through AC-7 and AC-10.
4. Add the private History endpoint and connect filters, pagination, availability, session handling and the existing drawer without GET mutations, satisfying AC-1 through AC-3, AC-6, AC-8 and AC-9.
5. Test capture races, rollback and historical uncertainty on the separate database, run existing regressions, and verify development and production UI plus actual Neon behavior. Record manual accessibility evidence honestly, satisfying AC-1 through AC-10.

## Consequences

History becomes a real closed work journey, and future reporting gets a complete roster marker rather than treating task authors as the entire roster. Captures remain immutable and retries add no duplicate evidence.

The service runs only while an app or the private command is running. Catch-up is eventual and conservative. Old records with uncertain facts may need a separate reviewed repair; the feature does not silently fill those gaps. Per person capture deliberately permits partial progress while withholding whole roster completion.

## Follow-up

* Later HR assignment, account, leave, organisation and settings writers must preserve dated history and coordinate with owner/week locks. They should settle overdue capture before a change would destroy needed historical facts. Do not backdate changes into a captured week through ordinary forms.
* Later leadership reporting must require rosterCapturedAt for a complete weekly denominator. Employee History uses its own valid snapshot independently.
* A reviewed repair process may be designed separately for ambiguous or corrupt records. The safe retry command cannot rewrite frozen evidence.
* Uncaptured periods before the protection start audit, including unproven whole legacy rosters, require reviewed certification even if some individual snapshots are already valid. Those individual records remain available to their owners.
* Deployment to a platform that suspends this Node process requires an explicit scheduling decision. This feature adds no external scheduler.
* Native NVDA and 200 percent browser zoom remain required manual evidence, including the earlier features' open gates.
