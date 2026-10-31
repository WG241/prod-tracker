# 0002. Workforce data model

**Date**: 2026-10-26
**Status**: Accepted

## Summary

Store people, reporting history, weekly work, decisions, leave, and tracker controls as linked database records. A task can continue across weeks without rewriting its earlier records. Preserve the prototype's cast and wording, while correcting inconsistent sample identities and making the participation and approval rules consistent.

## Requirements

Employees need their work, comments, leave and decisions retained by week. Managers and leaders need the right reporting context and trustworthy approved outcomes. HR needs dated organisation assignments, scoped tracker access, and an administrative history.

- **AC-1**: The schema represents all five roles, one current assignment per person, businesses and their units, and dated reporting history. A unit must match its business. Account deactivation and organisation archiving preserve references and historical records.
- **AC-2**: Weekly tasks have stable identities, one owner, dates, a canonical status, comments, and linked carry records. Carrying work preserves the original week. The schema supports the prototype's status actions without using legacy sample percentages as completion evidence.
- **AC-3**: Approval attempts and their decisions are retained separately. Only one attempt may be pending per task and only one decision may exist per attempt. The model distinguishes a human reviewer, a relief reviewer, and automatic approval of a manager's own work. It retains the original submission context when the assigned reviewer changes.
- **AC-4**: Leave and relief retain date ranges, return or cancellation evidence, and cover history. The model supports direct leave recording without approval, partial week eligibility, and temporary relief scope without changing permanent reporting lines.
- **AC-5**: Global settings, per week cutoffs, scoped unlocks, append only audit evidence, recipient specific notifications, and suppressed sample email deliveries are persisted. An unlock targets exactly the scope it declares.
- **AC-6**: An additive local migration preserves the existing User identity and migration history. Repeating the seed creates no duplicate fixtures. The prototype cast, tasks, settings and sample Week 43, representative prior history, and linked next week work can be queried from PostgreSQL with coherent foreign keys and dates.
- **AC-7**: Database probes confirm the key constraints and representative Employee, Line Manager, Business Director, Executive and HR projections. The existing health endpoint still works against the migrated database, and lint, type checks and the production build pass.

## Decision

Use normalized PostgreSQL records through the existing Prisma 7 and PrismaPg stack. Keep current account identity separate from dated role and organisation assignments. Use a task series to connect weekly task records, and store review attempts and decisions independently. This is the structure the user confirmed in the model preview (basis: scope Feature 3, prototype screens and confirmed design answers).

This feature owns schema, migrations, fixtures and database verification. It does not add role screens, authentication, public data routes, an email sender, scheduled workers, or a different database provider. Those remain in their planned scope features. Adding later authentication or report delivery tables is compatible with this model; no claim is made that the schema will never need additive changes.

## Feature design

### Storage conventions

Use string primary keys with the existing cuid default. Preserve existing User ids and columns. Fixture ids are deterministic strings with distinct prefixes and semantic names; never reuse the prototype's numeric ids as database keys.

`String?` means nullable text. All other fields listed below are required unless marked optional or described as generated. Creation times default to the database clock. Use `DateTime @db.Date` for calendar days, and `DateTime @db.Timestamptz(3)` for event instants. Interpret calendar dates using Africa/Lagos, as shown by the prototype. A Date column is not a UTC event timestamp.

The original User timestamps have no database timezone annotation. When converting them, interpret their existing Prisma observed values as UTC explicitly (`AT TIME ZONE 'UTC'`) rather than using the database session timezone. Compare the retained row before and after migration to confirm its application observed instants are unchanged.

Foreign keys use restrictive deletion for people, organisation, work and decision history. Archive or deactivate records instead of removing them. Structured JSON is limited to historical snapshots and event payloads; primary ownership, dates, roles, state and scope remain typed columns.

### People and organisation

| Model | Fields | Relations and constraints |
|---|---|---|
| User | Existing `id`, `email`, `name?`, `createdAt`, `updatedAt`; add `accountStatus` Active/Inactive (existing rows default Inactive), `emailRemindersEnabled` boolean default true, `deactivatedAt?` | Unique canonical lowercase email. Active staff have a nonempty name and one current EmploymentAssignment. Preserve the existing foundation identity as inactive and unassigned, outside the staff roster. |
| Business | `id`, `name`, `description?`, `archivedAt?`, creation/update times | Unique name. Director is resolved through the current Business Director assignment. No extra organisation or tenant table. |
| Unit | `id`, `businessId`, `name`, `description?`, `archivedAt?`, creation/update times | Business foreign key; unique business/name. Also expose the composite unique key `(id, businessId)` for assignment consistency. |
| EmploymentAssignment | `id`, `userId`, `role`, `businessId?`, `unitId?`, `managerId?`, `departmentLabel?`, `effectiveFrom: Timestamptz(3)`, `effectiveTo?: Timestamptz(3)`, `createdAt` | User, business, unit and manager foreign keys. A composite unit/business reference prevents mismatches. One current row per user (`effectiveTo IS NULL`); one current director per business. Effective end must follow effective start. Expose `(id, userId)` for identity matching. |

Roles are Employee, Line Manager, Business Director, Executive and HR / Admin. There is one current primary role per staff account. Derive the current role and reporting scope from the open assignment; do not maintain competing role/business/manager copies on User.

Employee assignments require a business, unit and manager. Line Managers have a business and unit and do not have a manager reviewer for their own work. A Business Director has a business and no required unit. Executive and HR have group scope, without business or hierarchy unit membership. `departmentLabel` retains a profile label such as People & Culture for group scope accounts.

A permanent employee manager is an active Line Manager in the same business, and may supervise several units. Self reporting and reporting cycles are invalid. Check these cross record role rules in the seed validator and future assignment write transactions; foreign keys alone cannot prove a referenced person's role. Do not pretend that authentication or the HR assignment API exists in this foundation.

Assignment intervals use half open UTC instants: include effectiveFrom and exclude effectiveTo. Intervals for the same person must not overlap, including two changes on the same day. The seed validator and later transactional assignment writer check this historical condition as well as the database's one open assignment guarantee. The current HR form makes assignments effective immediately; scheduled future role changes are not introduced here.

When HR changes an assignment, close the old interval and create the new one in the same transaction. Closed assignments remain referenced by history. Current week trackers may follow the new assignment; closed weeks retain their prior assignment and display snapshots. Pending requests follow the employee's newly assigned manager, including an outstanding request for an older week, without overwriting its original submission assignment. Future HR and approval write features must implement these transactions.

### Weekly work

| Model | Fields | Relations and constraints |
|---|---|---|
| WorkWeek | `id`, `startsOn`, `planningLocksAt`, `freezesAt`, `manuallyLockedAt?`, `lockedById?`, `lockReason?`, `createdAt` | Unique Monday calendar start. Lock actor references User. Freeze follows the start; lock is before freeze. Capture cutoff instants from settings for that week. |
| WeeklyTracker | `id`, `userId`, `weekId`, `assignmentId`, `contextSnapshot` JSON, `expectedWorkingDaysSnapshot?` integer, `snapshotAt?`, creation/update times | Unique person/week. Composite `(assignmentId, userId)` references EmploymentAssignment `(id, userId)`. Expose `(id, userId)` for task ownership consistency. A frozen snapshot has an expected day count from 0 through 5. |
| TaskSeries | `id`, `ownerId`, `createdAt` | User foreign key; expose `(id, ownerId)` for weekly task ownership consistency. No mutable master title that could rewrite previous weeks. |
| WeeklyTask | `id`, `seriesId`, `trackerId`, `ownerId`, `carriedFromId?`, `title` up to 120 characters, `activity`, `startsOn`, `endsOn`, `status`, `blockerReason?`, `carryRequested` boolean default false, `deletedAt?`, creation/update times | Owner matches both series and tracker through composite foreign keys. Unique series/tracker. Expose `(id, ownerId)` for submitter matching and `(id, seriesId)` for the composite carry reference. End is not before start; title and activity are nonempty. |
| TaskComment | `id`, `weeklyTaskId`, `authorId`, `body`, `createdAt` | Task and User foreign keys. Nonempty body. Retain author and original task context. |

Task statuses are Pending, In progress, Blocked, Awaiting approval, Approved, Declined, On hold and Cancelled. The Completed action on employee work produces Awaiting approval, not an approved outcome. A manager's own Completed action produces an automatic approval record and Approved status, as stated in the prototype. Do not store a progress percentage merely because the old fixture contains one.

Title, activity, dates, blocker, status and carry history belong to the weekly task. Its date range may span a week boundary, as the prototype's 22 to 27 October example does. A linked next week record preserves the earlier record and shares its TaskSeries. Validate same owner, forward week order and series consistency when constructing a carry. The fixture continuation begins Pending, with its predecessor preserved; later task lifecycle behavior is owned by Feature 10.

`deletedAt` is the explicit exception to archival naming: the prototype has a Delete action for editable tasks. It hides only that weekly record, with audit evidence retained. It must not remove its earlier carry records, review evidence or comments. Approved or frozen work cannot be deleted through normal owner operations. All application projections must explicitly exclude hidden tasks where applicable.

### Review evidence

| Model | Fields | Relations and constraints |
|---|---|---|
| ApprovalRequest | `id`, `weeklyTaskId`, `attemptNumber`, `submittedById`, `submissionAssignmentId`, `submissionSnapshot` JSON, `assignedManagerId?`, `submittedAt`, `state` Pending/Decided/Withdrawn | Composite `(weeklyTaskId, submittedById)` references WeeklyTask `(id, ownerId)`; `(submissionAssignmentId, submittedById)` references EmploymentAssignment `(id, userId)`. Reviewer references User. Unique task/attempt; positive attempt number. Partial unique key permits only one Pending request per task. |
| ApprovalDecision | `id`, `requestId`, `decision` Approve/Decline, `method` Human/Automatic, `actorId?`, `actingForManagerId?`, `reliefAssignmentId?`, `reason?`, `decidedAt` | Unique request foreign key. Optional User and ReliefAssignment references. Human decisions require an actor; automatic decisions have no human reviewer. Decline requires a nonempty reason. Decision records are immutable. |

Submissions create a new numbered request. A human approve or decline records one immutable decision and ends that request. A declined task can be revised and resubmitted as a new attempt without changing the old decision. A withdrawn request retains its submission context. Automatic manager completion creates a decided request and an Automatic Approve decision in the same transaction.

The immutable `submissionSnapshot` version 1 records title, activity, startsOn and endsOn as ISO dates, owner id and display name, WorkWeek startsOn, and the status being submitted. Capture it from the weekly task and its context at submittedAt. Keep it unchanged when routing or request state changes. A database update guard protects the request's task/owner, attempt number, original assignment, submittedAt and submissionSnapshot while permitting state and assigned reviewer changes. This preserves what was reviewed even after a decline and later edit.

A relief decision identifies the actual actor, the covered manager, and the specific relief assignment. That differs from changing the permanent manager. Validate that relief is active at the decision instant in the later approval write transaction. Assignment transfer updates only the pending routing pointer and records an audit event, leaving the submission assignment intact.

Late approval belongs to the task's original week and retains its actual `decidedAt`. Historical task content and reporting context remain read only; a later decision is an explicitly separate piece of evidence. Current status and the latest attempt's outcome must agree. The seed validates this coherence; future task and approval APIs must maintain it atomically.

### Leave and relief

| Model | Fields | Relations and constraints |
|---|---|---|
| LeaveRecord | `id`, `userId`, `startsOn`, `expectedReturnOn`, `actualReturnOn?`, `cancelledAt?`, `cancelledById?`, `createdAt` | User and cancellation actor foreign keys. Expose `(id, userId)` for owner matching. Expected return is strictly after start; actual return is not before start. Keep records after return or cancellation. |
| ReliefAssignment | `id`, `leaveId`, `coveredManagerId`, `reliefManagerId`, `startsOn`, `endsOn`, `endedAt?`, `endedById?`, `createdAt` | Composite `(leaveId, coveredManagerId)` references LeaveRecord `(id, userId)`. Other people reference User. Relief differs from owner. End follows start. Keep ended cover history. |

Leave includes the start date and excludes the expected or actual return date. Relief uses the same date interval convention. It is effective only during the related leave, its cover interval, and before an early end or cancellation. A manager returning ends effective relief access. At most one officer covers a manager at a given instant; the validator and future transactional relief writer must reject overlap. An active Line Manager from another business may provide temporary cover, as shown by Tunde covering Nneka.

No leave approval workflow is added. Scheduled, on leave, completed, returned early and cancelled display states derive from these dates and events. On leave does not deactivate the account. Suppress reminders during effective leave. Available working days are Monday through Friday, excluding leave dates; no holiday calendar is introduced in this release.

### Settings, planning and messages

| Model | Fields | Relations and constraints |
|---|---|---|
| TrackerSettings | `id` fixed to Workforce Group, `timezone` fixed to Africa/Lagos, opening/followup/update/lock day and time, `overdueApprovalDays`, `monthEndDay`, `updatedById?`, `updatedAt` | Day values Monday through Sunday; times are `HH:mm` with a database format/range check. Threshold is positive. Month end day is 1 to 28, avoiding invalid dates. |
| PlanningUnlock | `id`, `weekId`, `scope` Person/Unit/Business/Everyone, `userId?`, `unitId?`, `businessId?`, `grantedById`, `reason`, `grantedAt`, `expiresAt`, `revokedAt?`, `revokedById?` | Foreign keys to week, target and actors. Exactly the declared target is populated; Everyone has no target. Nonempty reason. Expiry follows grant; revocation does not precede grant. Partial unique indexes prevent duplicate unrevoked unlocks for the same week and target. |
| AuditEvent | `id`, `actorId?`, `action`, `targetType`, `targetId`, `before?` JSON, `after?` JSON, `createdAt` | Actor User foreign key, null for System. Target type/id are intentional historical pointers; snapshots remain readable independently of the current target. Database trigger rejects update or delete. |
| Notification | `id`, `recipientId`, `kind`, `title`, `body`, `weeklyTaskId?`, `leaveId?`, `reliefAssignmentId?`, `deduplicationKey`, `readAt?`, `createdAt` | User and optional target foreign keys. Unique recipient/deduplication key. Read state belongs to one recipient. In app notifications cannot be disabled. |
| EmailDelivery | `id`, `notificationId`, `recipientEmail`, `state` Queued/Sent/Failed/Suppressed, `attemptCount`, `scheduledAt`, `lastAttemptAt?`, `sentAt?`, `failureCode?` | Unique Notification foreign key. Nonnegative attempt count. A Sent record requires sentAt. Sample deliveries are Suppressed, with no provider or worker involved. |

WorkWeek cutoff fields capture the calendar schedule, so changing settings cannot rewrite closed weeks. The prototype freeze is Saturday 00:00 WAT (Friday midnight). An unlock cannot outlive its week freeze or open a frozen week; validate the cross record cutoff in fixture validation and future tracker write transactions. An early manual lock uses the WorkWeek fields; unrevoked targeted unlocks are separate evidence of temporary permission.

For unlock renewal, retire any expired but unrevoked row for that week/target by setting revokedAt and revokedById, recording renewal in audit, then create its replacement in the same transaction. Preserve its original expiresAt. This fits the simple unrevoked uniqueness predicate without deleting expired evidence. Include an expired row and its replacement in the fixture. Display expiry from the original interval even if the row was retired later during renewal.

Notification kind is a nonempty stable string, permitting later event categories without rewriting the notification schema. It comes from the domain event, not from user entered arbitrary HTML. Title and body are English text, rendered as text. Future event writes create notification and optional email outbox rows in the same transaction. This feature does not send mail. The profile toggle controls email reminders, not in app messages.

### Participation and metrics

An active Employee is expected if at least one Monday to Friday workday remains after effective leave for that week. A full leave week is excluded. A nonemployee role can own a tracker, but does not enter an employee submission denominator.

A person has submitted when their weekly tracker contains any nondeleted task, including an automatically carried task. Cancelled work still demonstrates that a tracker exists; it is excluded from completion eligibility. Do not persist a contradictory `notSubmitted` flag.

Submission rate is expected employees with a tracker task divided by expected employees. Approved completion is Approved weekly tasks divided by eligible weekly tasks. Eligible tasks exclude Awaiting approval, Cancelled and hidden records. Round displayed percentages to the nearest integer; an empty denominator gives zero. Query role/team scope before aggregation.

For reporting attribution, use the assignment effective at the reference instant: now for an open week, and the last millisecond before freezesAt for a closed week. If no assignment remains at that instant, use the final assignment overlapping that workweek. Attribute the person's whole week to that one assignment; do not split a week between businesses. A later assignment outside the week must not replace a frozen one.

For open week eligibility, require an active account and an Employee assignment at the reference instant. Count a Monday to Friday date as available if an Employee assignment interval overlaps any part of that WAT day and effective leave does not cover the date. A part day counts as one workday for participation only, not an hours or effort measure. Group scope and manager roles have zero expected employee participation days. Historical expected days are captured at freeze, not recomputed from a later account state.

The frozen roster must include every staff identity whose assignment overlaps that week's Monday 00:00 to freeze interval, including zero task, inactive/nonexpected, and full leave cases. Do not create trackers only when a task is submitted. This ensures that missing submitters remain in the historical denominator.

`contextSnapshot` version 1 requires `version: 1`, userId, displayName, role, accountStatus, nullable businessId/businessName, unitId/unitName, managerId/managerName and departmentLabel. Sources are the selected assignment and its referenced labels at capture. `snapshotAt` is the capture instant; `expectedWorkingDaysSnapshot` is the captured eligibility count. A frozen row requires both columns. Historical scope and expected denominator queries use these snapshots rather than filtering on the person's current assignment or active flag.

At freeze, retain the eligibility result and organisation/name context. Late decisions may update the original week's approved outcome without rewriting frozen content, roster or eligibility. The fixture includes coherent frozen snapshots and a missing submitter whose later reassignment/deactivation must not alter historical scope or denominator. Automatic freezing and role query endpoints are later feature implementation, not an unbuilt job claimed complete here.

### Interfaces and value sourcing

The model is exposed through the generated server only Prisma client. This feature adds no public data API. Existing `GET /api/health` still queries User and returns the spec 0001 readiness contract. `npm run db:migrate`, `npm run db:generate` and `npm run db:seed` remain the supported storage commands. Constraint errors are observed in rollback probes, never returned to a new unauthenticated endpoint.

| Produced value | Source |
|---|---|
| Current role, business, unit and manager | User's open EmploymentAssignment and referenced organisation records. |
| Historical organisation and manager | WeeklyTracker assignment and captured context, plus the original submission assignment on ApprovalRequest. |
| Week identity and date range | Unique Monday `WorkWeek.startsOn`, interpreted in Africa/Lagos; workdays are offsets 0 through 4. |
| Lock and freeze instants | Global settings applied to that week's Monday; captured WorkWeek timestamps. |
| Current expected days | Effective assignment, active account and leave intervals over the five workdays. |
| Historical expected days | Captured WeeklyTracker expected day snapshot. |
| Submitted state and rate | Presence of nondeleted WeeklyTask rows, filtered to expected employees in scope. |
| Approved outcome and rate | Canonical WeeklyTask status, review evidence and the eligible denominator defined above. |
| Approval age and actual reviewer | ApprovalRequest.submittedAt and ApprovalDecision.decidedAt/actor/method/relief references; no hardcoded waiting days. |
| Carry lineage | TaskSeries identity and WeeklyTask.carriedFromId; previous week rows remain unchanged. |
| Leave and cover display state | Calendar interval, actual return, cancellation and cover end/revocation fields. |
| Notification unread state | Per recipient readAt; content and targets come from the recorded event. |
| Sample data and clock | The HTML prototype's named fixtures and fixed Week 43 dates, with deterministic prior/next week examples. Creation/decision fixture instants are explicit, never shifted to the machine's current week. |

### Database guarantees and workflow responsibilities

Use additive migrations, generated with `--create-only` and reviewed before application. Keep foreign keys, ordinary unique keys and enums in the Prisma schema. Add PostgreSQL CHECK constraints, partial unique indexes and the append only triggers through checked in SQL migrations, without enabling a Prisma preview feature. Prisma does not express every PostgreSQL constraint; document their names so later migrations preserve them. The implementation uses `20261026140213_workforce_data_model` and a subsequent `20261026144154_frozen_roster_guard` to protect frozen roster context even when a person has no tasks. Migration SQL must be idempotent and applied atomically (project Rules in `AGENTS.md`): prefer hardening the migration under review over stacking an override migration. Do not rewrite the schema intent of a migration already applied in shared environments; safe re-run hardening of a just-authored file (with checksum repair) is allowed.

Database checks cover lowercase email, required active staff name, coherent role field presence, unit/business composite references, date ordering, task text, positive attempts, human/automatic actor shape, decline reasons, scope target shape, schedule ranges, and nonnegative delivery attempts. Unique keys prevent duplicate current assignments, duplicate current directors, duplicate pending attempts, repeated decisions, repeated weekly identities, duplicate active unlocks and duplicate recipient events. ApprovalDecision and AuditEvent are append only.

Cross record business rules such as reporting role validity, interval overlap, carry week order, relief eligibility, and status/decision coherence are validated for the fixture here. Future APIs must perform these checks and related writes within transactions. Do not describe these as database enforced CHECK constraints: PostgreSQL CHECK cannot enforce arbitrary other row state. Access control and concurrency handling for those workflows belong to their planned feature specs.

### Seed contract

Retain `20261026125741_init` and the existing foundation User. New User columns give that identity an inactive, unassigned state. Never reset the database and never run this migration against Neon as part of local work.

Use the prototype's 23 base tasks plus the two additional v1.2 tasks with separate fixture ids. Include its named staff roster and the named Executive, HR, directors and historical relief people needed by references. Match the task wording and comments. Treat Emeka as the current Outsourcing director and exclude him from current relief candidates. Normalize conflicting historical cover fixtures to eligible managers and record the correction in the seed manifest; do not silently create simultaneous primary roles. Map an Outsourcing employee shown with a Resourcing unit to a valid Outsourcing unit while preserving that person's business and manager, and record the mapping.

Seed Week 43 starting 19 October 2026, Week 42 history and Week 44 carry records. Include the prototype leave history, a current partial/full leave example, a human approval, a decline followed by resubmission, a manager automatic approval, scoped unlock history, audit evidence, recipient read/unread examples, and Suppressed email delivery. Synthetic supporting fixture dates and actors are labeled as such in the manifest.

Use these settings from the live screen: opening Monday 08:00, follow up Tuesday 12:00, update Friday 15:00, planning lock Tuesday 14:00, overdue threshold 3 days, following month report day 1, all WAT. Frozen history includes the full considered roster with explicit snapshots, not only submitters; open week eligibility remains derived. Include a midweek reassignment example, a partial day assignment, and an expired unlock with replacement to exercise the confirmed review resolutions.

Upsert mutable fixture identities and create immutable evidence only if absent. Repeating the seed must not change event timestamps or produce duplicates. Keep nonfixture rows and identifiers intact. The seed validates references and policy coherence before committing; failure rolls back the fixture transaction and emits a sanitized error. It does not transmit emails or require a new secret.

### Security and configuration

No credentials, password hashes or sign in sessions are added here; authentication is Feature 6. Existing database environment variables and local PostgreSQL remain unchanged. Fixture delivery is suppressed, with no external provider. Database credentials and Prisma code stay on the server.

Employee queries will scope by owner, manager queries by current or recorded team context, director queries by business, and Executive/HR queries by their authorised organisation scope. An assigned pending reviewer or valid relief officer receives the narrow review context required for that request. These are boundaries for later authenticated APIs, not public endpoints added by this feature. The prototype names are fictional fixture records; no claim of a legal compliance certification is made.

### Critical verification scenarios

Verify the actual migrated schema and foreign keys, not only the generated Prisma types. Probe duplicate current assignments, mismatched business/unit, duplicate pending requests and decisions, invalid date ranges, invalid unlock targets, uppercase email and history rewrite attempts; each must fail through the intended database guarantee (AC-1 through AC-5).

Run the seed twice and compare fixture identities/counts and immutable timestamps. Query all five role scopes, carry lineage, old/new manager references, original week late approval, leave/relief intervals, expected participation, notification ownership and suppressed deliveries (AC-1 through AC-6). Check frozen context against an independent expected fixture manifest.

Start the real app and observe its browser readiness request after migration. Run lint, strict type checks and production build. Verify hidden/new database data is not exposed by the unchanged public health response (AC-7). There is no new product UI to invent or match in this feature.

## Build plan

1. [x] Add typed Prisma entities and relations while retaining existing User ids and columns, satisfies AC-1 through AC-5.
2. [x] Generate the migration without applying it; add and inspect PostgreSQL constraints, indexes and append only history guards, satisfies AC-1 through AC-5.
3. [x] Apply the additive migrations to the existing local database and confirm the live schema and retained foundation row, satisfies AC-6 and AC-7.
4. [x] Add deterministic, documented fixture data and transactional seeding, with explicit normalization mappings, satisfies AC-1 through AC-6.
5. [x] Run seed repeatability, policy coherence and rollback constraint probes against PostgreSQL; record expected and observed results, satisfies AC-1 through AC-7.
6. [x] Verify the real app's unchanged health path, lint, types and build; update the feature's verification record and context, satisfies AC-7.

## Consequences

Weekly history and review evidence remain understandable after reassignment, carry, leave or account deactivation. The schema supports the five roles without encoding mutable people or organisation names as relationship keys.

The model introduces more records and joins than the prototype's arrays. PostgreSQL specific constraints need to remain in migration SQL. Historical snapshots deliberately duplicate context so later renames cannot rewrite a past view. Workflow APIs still need authorization, transaction checks and tests when they are built; this foundation does not provide those features by implication.

## Follow-up

Authentication and role gates remain Feature 6. Role screens and task/approval/leave write transactions remain with their scope features. Email sending, report generation, reminders and automatic week closing remain later implementation. Additional technology skills and MCP discovery remain deferred as previously chosen.

## Rationale

See [rationale.md](rationale.md) for source observations, alternatives, normalization decisions and verified documentation.
