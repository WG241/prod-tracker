# 0009. Employee task lifecycle

**Date**: 2026-11-02
**Status**: In Progress

## Summary

Employees can create and revise their current weekly work, record blockers, comment, carry work forward, delete editable records, and submit completion for manager review. Reuse the existing Employee Home and prototype dialogs. Use task revisions to reject stale edits and committed request receipts to make retries safe. Keep each task change, its review and notification evidence, and its audit in one database transaction.

## Requirements

As an Employee, I want to maintain my weekly tasks and submit completed work without losing changes or duplicating records when a request is retried.

1. **AC-1**: Employee Home exposes the final prototype's Add task form, task action menu, Edit task form, status control, blocker reason and next step dialogs, completion and deletion confirmations, and comment form. Keep List/Card, date controls, attention, pagination, shell and navigation from Feature 9. Use status only progress. The user approved replacing the numeric progress form with the existing small confirmation dialog. No progress percentage is stored or claimed as approved completion.
2. **AC-2**: Creating a task persists one owned TaskSeries and Pending WeeklyTask, creating the current WorkWeek and WeeklyTracker only if required and in the same transaction. A new task starts between the current Monday and Friday in Africa/Lagos. Title is 1 through 120 characters, activity 1 through 6000, and the inclusive task span is 1 through 366 days. Dates are real calendar dates in years 0001 through 9999. An end date beyond Friday requires carry over.
3. **AC-3**: The server reevaluates identity, assignment, leave, current week, captured cutoffs, manual locks and scoped unlocks for every new write. Planning closure blocks create, title/date/carry changes and deletion. Activity, working status and comments remain available before freeze. Past, future and frozen tasks, and effective current leave, block Employee writes. Approved tasks prohibit content, status, carry and delete changes; their current week conversation can still receive replies before freeze when the Employee is not on leave.
4. **AC-4**: Employees can set Pending, In progress or Blocked and request Completed. Blocked requires a nonempty reason of at most 2000 characters. Other working states clear the current blocker field. Revising an awaiting task withdraws its pending request without rewriting its submission evidence and returns it to the selected working state. Editing an awaiting task defaults to Pending and cannot submit completion in that same edit flow. A separate explicit Completed action resubmits it as a new attempt. Declined work can be revised and resubmitted while old decisions remain unchanged.
5. **AC-5**: A valid Completed action atomically creates the next numbered Pending ApprovalRequest, sets Awaiting approval, records the immutable version 1 submission snapshot and current submission assignment, routes to the current valid permanent manager, creates one manager notification, and records audit and retry receipt evidence. It never approves Employee work. Missing or ineligible manager routing fails without partial writes. Already awaiting completion is a no change result, not another attempt.
6. **AC-6**: Carry over immediately creates one Pending continuation in the next week, sharing the TaskSeries and preserving its predecessor. It starts next Monday and ends next Friday or on the original later end date. Only the immediate next week is created. The continuation is independent of later source edits and begins without further carry requested. Clearing carry hides only an untouched continuation; a touched continuation causes a conflict and leaves both records unchanged. Retrying and toggling carry must not create duplicate weekly identities.
7. **AC-7**: Delete hides only the selected editable weekly record. It withdraws any pending approval, preserves reviews, comments, audit and earlier or future carry records, and never physically deletes task history. A reply appends one comment with the real author and server timestamp, with 1 through 4000 characters. Comment append does not withdraw a pending approval or change task content.
8. **AC-8**: Every task change is atomic and safe under concurrency and retry. A stale task revision fails without overwriting another change. One Employee/request UUID maps to one committed result; the same key with different intent is rejected. A response lost after commit can be retried without duplicate tasks, comments, attempts, notifications or business audits. Failure at any domain step rolls back every domain row and receipt. Successful submission telemetry is emitted only for a newly committed submission, never a replay or rollback.
9. **AC-9**: Endpoints require a current valid Employee session and both task owner and tracker user ownership. Anonymous, expired, revoked or unusable sessions receive 401, other current roles receive 403, and missing, hidden and someone else's tasks share one 404. Reject conflicting origins, cross site metadata, unsupported methods/selectors/fields, malformed values and oversized bodies. No domain mutation is possible through preview roles or GET requests.
10. **AC-10**: Pending, failure, conflict and uncertain outcome states are truthful. Keep a failed draft, Retry with the same request identity and input, and provide Reload latest for a stale draft only on an explicit user action. Confirmed commits refresh Home, attention and an open drawer. Closing a dialog does not imply rollback. Late replies cannot replace a newer form, task, selection or actor. Session failures remove private content through Feature 6. Keyboard focus, announcements, modal containment, 320 pixel layout, reduced motion and native 200 percent zoom follow the shared baseline.
11. **AC-11**: The additive, idempotent migration is applied and verified on the actual development database. Lint, strict types, production build, required regression tests against TEST_DATABASE_URL, and real application verification in development and production pass. Verification includes real task creation, edits, completion, comments, carry and deletion, lock/leave/freeze boundaries, concurrent requests, lost responses and rollback probes. Preserve existing Feature 9 and authentication behavior.

## Decision

Use the existing React, Express, PrismaPg, Neon PostgreSQL and Better Auth application boundaries. Add separate task operation endpoints, an integer WeeklyTask revision and a TaskMutationReceipt table. Reuse the existing shared controls and Feature 9 reads, with safe write capabilities added to their responses. Introduce no package, hosted service, email sender or runtime configuration.

Use short Read Committed transactions with explicit permission and task row locks, and at most three attempts for deadlock or natural key races. Each statement sees work committed before that statement, including after a lock wait. Compare an explicit revision after obtaining locks. A receipt commits with the business changes and supports exact replay. The rejected simpler alternative is last save wins with UI double click protection; it cannot protect separate tabs or a response lost after commit.

**Implementation skills**: existing project workflow skills and the shared auth, accessibility and telemetry area contracts. No new technology tool or provider is selected. Preserve Better Auth's existing wrapper and session lifecycle; no provider configuration or credential change is part of this feature.

## Rationale

Reasoning and alternatives are in `rationale.md`.

## Feature design

### Scope and prototype contract

Only the Employee role is writable here. Line Manager own tasks, manager decisions, History's separate screen, leave changes, notification screens and email delivery remain their named scope features. Existing On hold and Cancelled rows can be displayed and resumed through the available working states, but Feature 10 adds no controls or write commands to set those two states because the final Employee prototype provides none.

Use the final prototype task form, task drawer, row menu, blocker reason, blocked next step, complete and delete confirmation surfaces. These were inspected through the approved development URL on 2 November 2026. Further matching surfaces must be inspected before their UI is built. Keep the prototype's single modal at a time and restore a logical opener or heading when it closes.

The user approved two exceptions: replace the numeric progress form with the existing small confirmation layout saying `Set this task to In progress?`, and reuse existing form error regions, banners, buttons and toast for pending/failure/conflict states. Do not add a new page or navigation item. Completed confirmation copy describes submission for manager review, without a stored 100 percent value. Use a current manager name only from the safe current context, otherwise say `your line manager`.

When editing an awaiting task, show the explanation `Changing this task withdraws its pending review. Submit it again when ready.` Default its Status to Pending and disable Completed until that edit has been saved. Other editable states retain the prototype's Pending, In progress, Blocked and Completed choices; Declined, On hold and Cancelled default to Pending in this form. For other tasks, choosing Completed in Edit first obtains the existing completion confirmation, then applies edits and submission atomically. Choosing Blocked obtains its reason before any write. Cancelling either secondary dialog returns to the retained edit draft. Saving a blocker can then show the prototype next step dialog; its Carry/Delete choices respect current planning permissions.

Use the existing carry hint area for the actual next week and Monday through Friday day count, bounded by the accepted date span. For a new task or an actual date change, a date beyond Friday checks and requires Carry into next week. An unchanged inherited end date/carry combination is exempt, so an activity or status edit does not force a planning change after lock. Shrink the source end date to Friday or earlier before explicitly clearing an existing carry request. The next week record does not recursively create more weeks, even when its retained end date extends beyond its own Friday. Future rows remain inspection only until their week opens.

### Data model

All ids are strings unless noted. Existing relations and constraints from spec 0002 remain in force.

| Record | Fields and changes | Relationships and constraints |
| --- | --- | --- |
| WeeklyTask | Add required `revision: Int`, default 0, nonnegative. Preserve every existing field. | Every actual direct task edit, status, carry flag or delete change increments the source revision once. No change results and comment append leave it unchanged. |
| TaskMutationReceipt | `userId`, `requestId`, `operation`, `requestHash`, `taskId`, `result: Json`, `createdAt: Timestamptz(3)` | Composite primary key userId/requestId. User foreign key and composite taskId/userId reference WeeklyTask id/ownerId, restrictive deletion. Index taskId/userId. Request UUID is canonical lowercase; requestHash is SHA256 hexadecimal; operation is one of CREATE/EDIT/STATUS/CARRY/DELETE/COMMENT. Result is a validated version 1 object. Rows are immutable and retained with task history. |
| WorkWeek, WeeklyTracker, TaskSeries | Reuse existing columns and relations. | Unique week, person/week, and series/tracker remain the retry and carry identity boundaries. |
| TaskComment | Reuse author, task, body and createdAt. | One appended row per successful comment request. No edit/delete comment surface. |
| ApprovalRequest, ApprovalDecision | Reuse existing fields and immutable evidence. | One pending request per task, unique task/attempt, no rewriting old submission snapshots or decisions. No new human decision is made here. |
| Notification | Reuse existing columns. | Kind APPROVAL_REQUESTED, title `Completion awaiting approval`, body `<current employee name> has submitted <task title>.`, recipient current assigned manager, task FK, readAt null, and deduplicationKey `approval-requested:<request id>`. No EmailDelivery is created in this feature. |
| AuditEvent | Reuse existing columns. | One business event per changed command, actor current Employee, target task, safe before/after task fields plus request UUID and related ids. No cookie, session token, secret or raw HTTP body. |

One additive migration adds the revision and receipt model. Backfill existing task revisions to 1 without rewriting their updatedAt timestamps, then make the new default 0. This deliberately treats preexisting continuations as touched when their editing history cannot be proved. Use transactional, repeatable DDL and existence checks for columns, constraints, indexes and triggers. Do not edit the meaning of older applied migrations. Regenerate the Prisma client and verify the migration on Neon and the separate test database.

The receipt result contains only version 1, requestId, operation, taskId, taskRevision, nullable continuationId/commentId/approvalRequestId, appliedAt and changed. It does not store a full task response or credentials. Return that result plus a computed replayed boolean. CREATE uses 201, other operations 200, including their replays.

### States, permissions and validation

Capture the authorization `asOf` from the existing server clock after row locks have been acquired. Use this instant for current week, leave, session expiry, manager eligibility, cutoffs and all new evidence timestamps. Calendar dates use Africa/Lagos and the same Monday and freeze rules as spec 0008. A request delayed across a cutoff must obey the later authorization instant.

Every new task write targets the actual current week, before its captured freeze and without a frozen tracker snapshot. Effective current leave pauses all Employee task writes. Planning is open according to the existing week projection, including manual locks and exact Person/Unit/Business/Everyone unlock scopes. An unlock never opens a future or frozen week. The UI also withholds actions while inspecting a range, past week or future week; supplying a view mode to a write endpoint does not grant authority.

| Operation | Open planning | Closed planning before freeze |
| --- | --- | --- |
| Create, title/date/carry changes, Delete | Allowed for owned eligible work | Blocked |
| Activity, working status, completion | Allowed on unapproved eligible work | Allowed on unapproved eligible work |
| Comment | Allowed on owned eligible work, including Approved | Allowed on owned eligible work, including Approved |
| Approved content/status/carry/delete | Blocked | Blocked |

Only real changed values count as locked planning field changes. Sending the unchanged title/dates/carry alongside an allowed activity edit does not change those fields. Always compare the revision before applying the form, so an old form cannot restore an earlier value. Reject changing the selected week, owner, tracker, series, original carry predecessor, revision or audit fields through task input.

All text is well formed Unicode, trimmed, plain text and measured by JavaScript string length to match the prototype's native title limit. Title, activity, blocker and comment limits are respectively 120, 6000, 2000 and 4000. Whitespace only text is invalid. A Blocked state requires a blocker reason; any other selected working state clears blockerReason. There is no percentage field. New or actually changed task dates require a start within the selected current Monday through Friday, end not before start, and an inclusive span of at most 366 days. An unchanged valid legacy date pair or inherited end/carry combination does not block an otherwise permitted activity/status edit or silently request a continuation. Reject navigation or carry dates outside years 0001 through 9999, never roll into a different parsed calendar date.

Working state targets are Pending, In progress and Blocked. They are permitted from any unapproved, visible, eligible current task. A real change to an Awaiting approval task withdraws its pending request and applies the selected working state. A content/carry edit without an explicit working status returns an awaiting task to Pending. Comments never withdraw a review. Existing Declined evidence remains immutable when the task resumes. Completed is an action input; the stored result is Awaiting approval. Setting the same working state/content to the same values, or completing an already awaiting task without edits, is a no change result and creates no new attempt, business audit or telemetry event.

An inconsistent awaiting state without exactly one pending request, or a pending request attached to a contradictory task state, fails closed with SERVICE_UNAVAILABLE. Do not repair historical evidence through an ordinary Employee command.

### Current context and carry records

On first successful create, capture WorkWeek cutoffs from the singleton TrackerSettings using the same validated timezone/lock schedule as spec 0008, then create the owned tracker if absent. Its open contextSnapshot version 1 and assignmentId come from the caller's fresh current assignment and referenced User/business/unit/manager labels. snapshotAt and expectedWorkingDaysSnapshot remain null. Existing mutable current trackers are refreshed to that current assignment and display context during a successful write; captured trackers are never rewritten.

A source carry request may create or obtain next week's WorkWeek and owned open tracker inside the same transaction even though next week is otherwise read only. This exception creates the continuation through an authorized current source operation; it does not open next week's planning. Its dates are next Monday and max(source endsOn, next Friday), its title/activity are copied at first carry, status Pending, blockerReason null, carryRequested false, same series/owner and carriedFromId source id. Preserve the source blocker and status except when an actual carry change withdraws an awaiting request; then the source becomes Pending and its blockerReason is cleared. An unchanged carry request is a no change result. Do not recursively create following weeks.

Existing visible continuations with the same natural series/tracker identity are returned rather than overwritten. Reject inconsistent predecessor/owner identity. Source edits never update continuation content. An untouched continuation has revision 0, Pending status, no comments, no approval requests, no outgoing carry request and no further continuations. Every older row starts revision 1 and is conservatively protected.

Clearing carry hides only that untouched future continuation. Reenabling carry restores the same hidden untouched row, preserving its copied content, dates, id and createdAt. These source controlled visibility toggles do not increment the continuation's direct content revision; it remains uneditable as a future record and its content is unchanged. The source revision increments. Once the continuation has any direct edit or evidence, return CARRY_IN_USE without modifying either record. A direct source Delete hides only the source and leaves the continuation intact.

This feature enforces the freeze cutoff but adds no background roster or snapshot worker. Historical snapshot capture remains a prerequisite to the later History acceptance path. Do not create snapshots on GET or pretend that a missing frozen snapshot is valid evidence.

### Completion evidence

Validate the Employee's current permanent manager from their fresh assignment. The referenced manager must be Active, have a current effective Line Manager assignment, and be in the same business. On leave is not account inactivity; retain permanent routing, while later approval/relief features resolve who may act. If routing is invalid, return MANAGER_UNAVAILABLE with contact HR copy and commit nothing.

Under the task lock, choose max existing attemptNumber plus one. Create one Pending request with submittedById caller id, submissionAssignmentId current assignment id, assignedManagerId current manager id, submittedAt asOf and immutable submissionSnapshot version 1 containing title, activity, startsOn/endsOn ISO dates, ownerId, ownerDisplayName, weekStartsOn and status AWAITING_APPROVAL. Source all fields from the authorized task and current context after accepted edits, never a raw client snapshot. Persist task status, notification, audit and receipt together. No ApprovalDecision is created.

After commit only, use the existing committedEvents.submitted adapter with newlyApplied true, persisted submittedAt, role EMPLOYEE and method HUMAN. Receipt replay, no change, rollback and telemetry failure emit no new submission event. Local delivery remains best effort and cannot undo the domain commit. Notifications are persisted only; their consumer and email delivery remain Features 14 and 15.

### API surface

All paths below start with `/api/employee`. Writes accept no query parameters and exact JSON object shapes, at most 32 KiB. Every write needs a canonical UUID `Idempotency-Key` header. Existing task edits, status, carry and delete also need `If-Match: "<revision>"`, a quoted nonnegative safe integer. Comments are appended, so do not require an edit revision. Reads return the safe current revision and action capabilities without exposing internal records.

| Endpoint | Method | Body | Result and permission |
| --- | --- | --- | --- |
| `/tasks` | POST | week Monday ISO date, title, activity, startsOn, endsOn, carryRequested boolean | 201 receipt; current week create permission. week must still equal the server's current Monday. |
| `/tasks/:taskId` | PATCH | title, activity, startsOn, endsOn, carryRequested; optional working status or COMPLETED action and blockerReason | 200 receipt; actual changed fields determine planning permissions. COMPLETED with edits requires prior completion confirmation and atomically applies both, except an awaiting task must first save its revision and withdraw before separate resubmission. |
| `/tasks/:taskId/status` | POST | status PENDING/IN_PROGRESS/BLOCKED/COMPLETED, optional blockerReason | 200 receipt; working status permission. COMPLETED creates review evidence. |
| `/tasks/:taskId/comments` | POST | body string | 200 receipt with commentId; current own conversation permission. |
| `/tasks/:taskId/carry` | POST | carryRequested boolean | 200 receipt with continuationId when relevant; current source planning permission. |
| `/tasks/:taskId` | DELETE | empty object | 200 receipt; own delete permission, never physical deletion. |

Retain the two GET surfaces from spec 0008 and add task revision plus safe canEdit/canChangeStatus/canComment/canCarry/canDelete and planningFieldsEditable facts, with fixed unavailability reasons. Home also returns canCreate. Derive permissions from the same persisted week, leave, snapshot and status facts used by the write guard. The browser's capability display is guidance, not authority. Keep read pagination, field projection and consistent snapshots intact.

Use `{ error: { code, message, fields? } }`. Fixed field errors may identify validated form fields, never SQL or private rows. Use 400 INVALID_INPUT, 401 SESSION_REQUIRED, 403 FORBIDDEN, 404 NOT_FOUND, 409 STALE_TASK/IDEMPOTENCY_CONFLICT/CARRY_IN_USE/WEEK_CHANGED/SAVE_BEFORE_RESUBMIT/MANAGER_UNAVAILABLE, 423 TASK_LOCKED/ON_LEAVE, 429 RATE_LIMITED with Retry-After, and 503 SERVICE_UNAVAILABLE. Oversized JSON receives 413 and unsupported content type 415 with the same error envelope. Preserve existing unrelated fallback behavior.

### Transactions, receipts and security

Use the real session wrapper. Extend its private return value with an internal session id for server use only; `/api/session` continues returning only SessionContext. Inside the write transaction, lock the principal's User row, validate the still existing unexpired persisted session for that user and hold its row through commit, recheck canonical identity and the effective Employee assignment, lock the relevant week and task rows in a consistent order, then capture authorization asOf. Include ownerId and tracker.userId in every task lookup. A hidden task is not a target for a new command. A successful receipt replay can return its original result after deletion or freeze because it performs no new domain mutation, but still requires a valid current Employee principal.

Serialize this Employee's task commands with the User row lock. Then hold shared locks on persisted session, auth identity, existing assignments and leave rows, settings, relevant weeks and existing unlock rows. The User lock blocks new assignment and leave rows through their foreign keys. Shared week locks coordinate cutoff changes without serializing all Employees' ordinary writes. New unlocks can only expand permission; existing unlock revocation remains blocked. Lock source task before continuation for update. Completion also holds the manager User for update and manager assignments for share, preventing assignment insertion during routing validation. Capture authorization time after these locks and reread current authority and calendar facts. Future approval, HR assignment and leave writers must honor the same person/week/task order, beginning with the task owner. Retry the complete transaction, including fresh clock and permission checks, at most three total attempts for deadlock or natural key races. Never hold a transaction while awaiting UI, telemetry or another HTTP request.

After locking the principal, look up the user/request receipt. Compute requestHash from canonical operation, target id, validated normalized input and the supplied If-Match revision when required, excluding credentials and the request UUID. A matching receipt returns its stored result without reapplying anything; a different digest returns IDEMPOTENCY_CONFLICT, including reuse with a different revision. New commands compare If-Match with the locked task revision before writing. Every successful command, including changed false, must commit a receipt. A no change result adds no business audit or submission event. Only failed commands omit receipts. Domain failures, including audit/notification/receipt insertion failure, roll back everything.

Require exact configured Origin and the existing Fetch Metadata mutation policy, JSON, and an allowlist of fields. Identity never comes from a body, query, preview selector or supplied role. Reuse the persistent HMAC throttle mechanism with separate task write namespaces, 60 requests per minute per current user and 300 per minute per direct client IP. Failed or replayed requests still count toward this independent security limit. Keep trusted proxy behavior unchanged.

No new runtime secret or provider is needed. Keep database clients on the server and render all task/comment/reason strings as React text. Private responses use no store headers and sanitized errors. Do not introduce unrestricted Better Auth routes, owner imports in the browser, raw request logging or external delivery.

### Client mutation behavior

Generate a request UUID when an action is first submitted. An in memory operation record above modal lifetime owns the UUID, exact submitted payload, supplied revision, actor, operation/target and known or uncertain outcome until resolved. Reopening Add or the same task/comment action reconnects to its unresolved operation and offers the existing Retry treatment, rather than generating a second UUID. Disable changing that submitted intent while its outcome is uncertain; Retry resolves it using the same payload and precondition. After a definitive rejection or known commit, a new deliberate action may obtain a new UUID. Do not retry a changed payload or revision under the old key. Do not persist private drafts, responses or receipts in browser storage.

Use shared busy buttons with duplicate activation guards. Confirm before completion or delete using their inspected prototype dialogs. Keep failed forms and entered text, associate field errors, and use the shared first invalid focus and scoped announcement helpers. A conflict keeps the draft and offers Reload latest; that explicit action discards the draft and reloads the authorized task. Do not silently retry an edit with a newer revision.

After confirmed commit, refresh the current Home selection and any still open matching drawer. Preserve page/view/anchor when still valid. If deletion empties a page, explicitly navigate to the last valid page and requery rather than leave a blank success state. Refresh failures after commit say the change was saved and the view may be stale; they never claim the write failed. Replaying a committed command produces no duplicate success announcement or telemetry event.

Closing a modal detaches that view but does not discard the operation record or imply rollback. The owner above modal lifetime handles late known results and refreshes only a still matching workspace. Foreground revalidation withholds that operation's private content until the same actor is reauthorized. Sign out, identity/role change and 401/403 clear private operation records and prevent old callbacks from populating a new context. Period changes do not turn a pending create/comment into a new intent. Keep the write operation's confirmed result distinct from a subsequent read failure.

### Value sourcing

| Action | Produced value | Named source |
| --- | --- | --- |
| Authorize | actor, role, business/unit/manager, session validity | private auth session id, persisted AuthSession, User/AuthUser and current effective EmploymentAssignment |
| Enforce time | current Monday, leave union, locks, freeze, unlock scope | fresh server authorization asOf after locks, existing calendar helpers, WorkWeek, TrackerSettings, PlanningUnlock and LeaveRecord |
| Create or edit | task text, dates, requested carry and working state | validated exact input fields, selected week and accepted limits; current stored fields for comparisons |
| Reject stale edit | current task version | locked WeeklyTask.revision and If-Match header |
| Create tracker | owner context and assignment | fresh authorized assignment and referenced User/business/unit/manager labels; existing version 1 context shape |
| Carry | identity, dates, content, untouched result | source series/owner/id and first carry fields, next Monday/Friday arithmetic, natural series/tracker key, continuation revision and comments/requests/children counts |
| Submit | attempt, routing, immutable snapshot | max persisted attempt plus one, current validated manager/assignment, accepted task fields and asOf |
| Notify and audit | recipient, copy, event identity and before/after | persisted approval id, current manager and owner name, fixed notification template, locked old task and committed new task, request UUID |
| Reply | author, body and created time | authenticated current User, normalized body input, asOf |
| Replay | same result or conflicting intent | current user/request UUID receipt, canonical request hash and stored result |
| Display writes | capability names, form values, committed outcome | extended safe GET projections, selected task revision, local draft, mutation receipt and fresh GET result |
| Explain failure | field error, lock, conflict, unknown result or stale view | fixed English error code mapping, current operation identity and actual HTTP/receipt/read outcomes |
| Emit submission event | newlyApplied, role, method and occurredAt | newly committed request result, persisted submittedAt, fixed EMPLOYEE/HUMAN semantics |

### Critical test scenarios

1. Real Employee create, edit, status only progress, blocked reason/next step, completion, reply, carry and delete in List/Card with inspected dialogs and focus return (AC-1 through AC-7, AC-10).
2. Current week missing, new week/tracker creation, exact Monday/Friday and date year boundaries, blank/oversized text, invalid/leap dates and 366 versus 367 day spans (AC-2, AC-3, AC-11).
3. Scheduled/manual lock, all unlock scopes, expiry during a delayed request, freeze during lock wait, future/past selections, overlapping leave and Approved task restrictions, including allowed current Approved comments (AC-3, AC-9).
4. Awaiting edit withdraws old request and requires separate resubmission; immutable old snapshot/decision remains. Invalid manager causes full rollback. Notification, attempt and submission event occur once on commit (AC-4, AC-5, AC-8).
5. Next week carry dates, long end date, no recursive carry, independent source edit, activity edit of an unchanged long-date continuation after planning lock, awaiting source carry withdrawal, undo/restore using the same continuation id, touched copy conflict, hidden source with preserved future copy, existing legacy continuation protected (AC-3, AC-4, AC-6, AC-7).
6. Two tabs with the same revision, same UUID simultaneous requests, different UUID creates, repeated comment, repeated Complete, mandatory no change receipt replay after later modification/deletion, mismatched reuse of a key or revision, lost response after commit and same key retry after deletion/freeze (AC-8).
7. Inject failure after each domain step, especially review, notification, audit and receipt insertion; assert unchanged counts/content and no emitted submission event. Separate test database only (AC-8, AC-11).
8. Anonymous/revoked/expired session, role or assignment change while waiting, forged user/role/target, hidden/other task ids, wrong origin/method/content type, extra selectors and throttle exhaustion (AC-9).
9. Form failure, stale revision, explicit Reload latest, retained draft, close then lost response then reopen and same key retry, change selection/actor while pending, success followed by failed refresh, current row removal and page repair (AC-8, AC-10).
10. Lint, strict types, applied migration and a second no change migration SQL run, actual Neon development/production flows, separate database tests, keyboard/axe/320 pixels, observed native zoom and shared assistive technology evidence (AC-11).

## Build plan

The approach is Facade on the existing live application. Build the prototype controls and typed operation contracts first, then connect the guarded database writes within this feature. Do not leave a fake mutation implementation at handover.

1. Confirm the exact remaining prototype write dialogs and compose the action menu, forms and confirmations on the existing Employee surfaces, including the approved status only and failure/conflict adjustments (AC-1, AC-10).
2. Add shared operation/result/capability types. Author, regenerate, apply and verify the one additive transactional migration for task revision and immutable receipts, preserving historical timestamps (AC-2, AC-6, AC-8, AC-11).
3. Implement fresh session/ownership/calendar guards, ordered transaction locks, receipts, revision comparison, validation, audit and retry limits. Add current task create/edit/status/comment/delete operations and extend safe read capabilities (AC-2 through AC-5, AC-7 through AC-9).
4. Implement immediate carry, untouched undo/restore, review withdrawal/submission and atomic manager notification. Connect post commit submission telemetry without claiming approval or mail delivery (AC-4 through AC-8).
5. Connect the UI with retained drafts, stable request identity, confirmed result refresh, conflict reload, cancellation/session guards, pagination repair and shared announcements (AC-1, AC-6, AC-7, AC-10).
6. Add and run meaningful regression, concurrency and rollback tests on TEST_DATABASE_URL, verify real development and production flows, and record visual, keyboard and manual accessibility evidence. Keep the feature in progress until its required checks pass (AC-1 through AC-11).

## Consequences

Employees can perform their weekly work against real persisted data, with coherent review and carry history. A failed response or a second tab cannot silently duplicate or overwrite work. No additional infrastructure is operated.

The migration adds a revision field and an indefinitely retained request receipt table. Old continuations are conservatively treated as touched. Transaction retries and ordered locks add code and some contention; the User lock deliberately serializes one Employee's simultaneous commands. In app notifications are produced before their consumer screen exists. Email, manager decisions and automatic frozen roster capture remain separate work.

## Follow-up

* Feature 11 must settle historical roster/snapshot capture before claiming a complete History journey. This feature checks freeze permissions but is not a background freeze service.
* Features 14 and 15 own notification consumption and email delivery. Feature 10 creates only the existing in app notification record for submission.
* Features 17 and 19 own manager personal tasks, automatic manager completion and human/relief decisions. Their writers must honor revision, request and person/week/task locking contracts.
* Later HR assignment, leave and tracker writers must coordinate with the same locks and preserve captured snapshots. Existing Feature 9 and shared accessibility manual gates remain separately visible.
