# Manager scope, commands and events

## Summary

Share calendar and evidence rules while keeping own work, permanent team reporting and temporary review authority separate. Never turn a role selector or notification into permission.

## Build prerequisites

Features 13 through 15 currently have confirmed designs, not implementations. Their preference/receipt records, typed notification factory/targets and safe outbox must land as separate features before the dependent manager builds claim complete integration. Do not fold those builds into Feature 16 or replace them with simulated success. Email Off is a valid implemented mode; connecting an external provider is not necessary for manager domain tests. Follow the intended build order 13 through 20, one feature per run, retaining each feature's own verification gates.

## Reads and authority

Use current Active User, canonical ready identity, persisted unexpired session and exactly one current effective LINE_MANAGER assignment. Recheck inside the read transaction. Role/business input never supplies authority. Pure scoped helpers accept a transaction and explicit database asOf; do not call a helper that silently opens another transaction or requires a browser-shaped SessionContext for domain-only recipients.

Permanent current-team scope is Active Employee, exactly one effective Employee assignment, managerId = actor and businessId equal to actor's business. Frozen scope is a validated tracker context with role EMPLOYEE and managerId = actor; a later business/assignment cannot replace it. Current actor must still be a Line Manager, but a later transfer does not remove that actor's valid recorded historical team. Other managers' owned work is never included.

Use spec 0010's snapshot validator and capture coverage. Individual valid snapshots remain readable independently of roster completion. Reliable frozen aggregate requires rosterCapturedAt and valid required scoped snapshots; otherwise affected totals/rates are unavailable. Unknown historical membership cannot be inferred from today's assignment. Return only a scoped availability state, never global roster failures or unrelated identities. No GET creates weeks/trackers, captures history, reroutes requests, marks notifications or repairs data.

All reads use bounded pages, stable ties, no store, exact documented selectors and safe errors. Missing, hidden and outside-scope ids share 404. An unavailable trustworthy snapshot yields 503 or the explicit list availability state, never current labels. Use database time and the Africa/Lagos calendar in years 0001 through 9999. Week cutoffs are persisted where present; future/missing-week projections remain read only.

nextChangeAt is the earliest known future relevant boundary: session expiry, planning/unlock/freeze cutoff, leave/relief start or exclusive end, explicit terminal instant, next overdue-day threshold or next WAT midnight. A timer withholds stale write capabilities and refetches the affected selection. It does not predict a new decision or assignment change; foreground/explicit refresh and the separate badge checks cover those. Unknown read failures retain a stale label and closed capabilities, not a false zero.

## Commands and receipts

Manager commands use strict JSON, a 32 KiB body ceiling, UUID Idempotency-Key and documented inputs only. Independent persistent namespaces allow 60 actor writes/minute and 300 direct socket-IP writes/minute; return Retry-After. Preserve exact Origin/Fetch Metadata checks, cookies, sanitized errors and bounded database operations. Own task/leave routes retain their existing contracts, limits and receipt tables.

Use Read Committed. For a command affecting Employee work, acquire that owner User mutex first, then permission principals (covered manager before a distinct relief actor), persisted initiating session/identity and current assignment locks, relevant week, task(s), request(s) and relief evidence in deterministic id order. Follow the Employee writer's owner, permission, week, source task, continuation order. A per-Employee approval batch locks all source tasks in order and stays one transaction. A command affecting own manager leave starts with that manager's owner mutex and locks candidates/cover evidence before final clock checks. No app command can take old EmailDelivery locks while holding these User locks. Known rolled-back deadlocks/natural-key races get at most three total attempts; unknown commit outcomes never cause blind retries.

After lock waits use databaseClock, not transaction-start now(). Recheck account/role, session expiry, reporting scope, actor leave and all operation boundaries. Reminder and leave/cover writes check the WAT day again after guarded writes; a changed day rolls back the unit and uses the known-rollback retry budget. Approval authority that changes during waits must be checked at the later instant. Hold permission locks through commit. No network/telemetry call belongs in the domain transaction.

Shared receipts extend spec 0013: key `(actorId, UUID)`, operation-specific SHA-256 over a fixed canonical ordered structure containing path/subject, normalized body and supplied preconditions. Require requestHash and NULL targetNotificationId for manager operations. Result version 1 contains operation, requestId, appliedAt, changed and safe created/affected ids only, with bounded arrays for batch results. Keep message bodies, snapshots and full entities out. Same hash/op replays the committed result; mismatch 409. Check fresh actor session/role before receipt lookup, then before new target permission rules. A settled receipt may replay after target freeze/leave/scope loss, without granting a new read/write. Return replayed separately. Never recalculate or repeat its effects.

Actor-bound client operations live above workspace/modal lifetime. Keep UUID, exact intent/precondition and pending/unknown state in memory, not browser storage. Uncertain commands block replacement intent until replay resolves them. Definite conflicts retain draft and offer Reload latest that explicitly discards it. Keep known save results separate from failed refreshes. Actor/role change or sign-out clears private state and invalidates callbacks, including after body decoding. Focusable busy controls reject duplicate activation. No stale permissions remain usable during foreground revalidation.

## Reporting outcomes and conversation

Human decisions may occur after freeze. In their transaction update only canonical task outcome/status and revision plus request state; preserve title/activity/dates, original submissionSnapshot, tracker context, roster and expected days. The request snapshot retains what was submitted. Existing Employee and manager reads/filters see the new canonical outcome and immutable decision at the next successful read. Do not recapture history or change attribution. Pending requests withdrawn by an Employee edit cannot be decided.

Current comments use TaskComment with real actor, text and database time. Well-formed Unicode plain text, trimmed, 1 through 4000 JavaScript string units, no NUL; render as text. Append does not increment task revision, alter content or withdraw a request. Frozen conversation is read only; the late-decision exception does not reopen comments. Owner leave does not prevent an authorized non-leave manager from adding a current comment, but work email to an away owner is suppressed. Actor leave prevents that actor's work writes.

## Event extensions to specs 0014 and 0015

Use the same typed transaction factory and newly inserted-event outbox hook. Never backfill old messages. Off/Preview/Catch-all/Live, frozen message content, firstUncertainAt, lease/retry and expiry rules remain intact. Extend the closed event, target and recipient-basis unions deliberately; unknown variants fail closed until their source feature is installed. No source invokes HTTP mail.

* WORK_REMINDER: recipient Employee, key `work-reminder:<employeeId>:<weekStartsOn>:<WAT-date>`, WorkWeek target. Title `Weekly tasks reminder`; body names the week and asks the owner to add tasks. In app target OWN_TRACKER with persisted week, only for current Employee owner; it selects Home without fabricating a tracker. Email class WORK; basis REMINDER_RECIPIENT freezes sourceUserId, sourceAssignmentId, requestingManagerId, businessId and workWeekId. Recheck current matching manager/business, expected/not-submitted/actionable current week, preference, leave and address. A different manager cannot bypass the same daily natural key.
* TASK_COMMENTED: recipient is the Employee owner for a manager comment. Feature 19 also notifies the current permanent manager for an Employee reply, and effective relief only when that task has the exact pending request, excluding the author and deduplicating recipients. Key `task-commented:<commentId>` per recipient. Keep task and exact pending approval references when applicable. Owner target is OWN_TASK; reviewer target is REVIEW_REQUEST when the message has an exact pending-at-event request, otherwise TEAM_TASK for a permanent manager. Spec 0019 defines these closed actions and fresh permission checks. Fixed message identifies commenter/task but does not email the comment body. Email WORK policy rechecks current ownership/permanent manager relationship, or exact active relief/pending request. Ended relief cannot receive a queued work email.
* APPROVAL_APPROVED/DECLINED: spec 0019 defines human outcome events and current owned target; no self alert for an automatic own-manager completion.
* Manager leave/RELIEF_ASSIGNED/ENDED: spec 0020 defines complete recipients, display snapshots and policy variants. Relief work routing does not rewrite permanent reporting or disclose private drafts.

Worker claim transactions may encounter source/recipient contention with domain writes. Keep their existing no-old-delivery-lock rule, bounded confirmed-rollback retries and no HTTP before a committed claim. Include real cross-domain contention in integration tests; do not remove source locks or retry unknown commits to mask a deadlock.

## Rationale

These are shared manager integration rules first needed by Dashboard. A small explicit boundary avoids copying Employee services with a bypass flag, mixing recorded reporting with current approvals, or inventing a second auth/notification system.
