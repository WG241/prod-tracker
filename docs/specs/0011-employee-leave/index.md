# 0011. Employee leave

**Date**: 2026-11-03
**Status**: In Progress

## Summary

Employees record their own leave without approval, cancel it before it starts, and record an early return from Leave or Home. The app preserves historical evidence and commits notifications, an audit and a retry receipt with each change. Missing notification recipients produce a warning rather than prevent leave from being recorded.

## Structure

* `0011-leave-writes.md` defines transactions, transitions, notifications, retries and the migration.
* `rationale.md` records the alternatives, confirmed choices and integration evidence.

## Requirements

As an Employee, I want to record time away and resume work without rewriting closed history or needing a separate approval.

1. **AC-1**: `/employee/leave` matches the inspected Employee prototype: Time to recharge, the two date fields and Confirm leave, a single current/upcoming leave card, and Take a proper break. Keep the fixed Employee navigation. No Employee past leave table, relief selector, reason, attachment, date editor or approval workflow is added.
2. **AC-2**: A new period starts on today through 365 days ahead in Africa/Lagos. Its expected return follows its start by 1 through 366 calendar days. Dates are real four digit year dates. Start is included and return is the first day back, excluded from time away. Weekend dates are valid and no holiday calendar or balance quota is introduced.
3. **AC-3**: Ordinary Employee writes allow only one uncancelled current/upcoming period. Future leave displays Scheduled and does not pause current work. The approved scheduled card explains that distinction and offers Cancel leave. Effective leave displays On leave and offers the prototype's immediate return action. Records naturally cease to be current on their exclusive return date without a background completion write.
4. **AC-4**: Cancellation records its actual server timestamp and actor only before start. Early return records today's WAT date once, on or after start and before expected return. Same day return is allowed and represents zero days away. The Home I’m back control uses this same operation. Return never grants a planning unlock or overrides freeze, and no task, review, permanent assignment or account status is changed.
5. **AC-5**: Each changed action atomically commits its leave event, one actor audit, notifications for the Employee, eligible current manager and eligible active HR admins, and its immutable receipt. Recipients are deduplicated. Missing manager/HR recipients yield fixed saved warning codes and notifications for available recipients. A notification insertion failure rolls back the whole action. The notification screen and email delivery remain Features 14 and 15.
6. **AC-6**: The same authenticated Employee and request UUID with the same normalized operation returns the committed result on retry. A different payload or target with that key conflicts. Competing tabs cannot create two current/upcoming periods or alter an unrelated period. A no change retry of an already recorded matching return/cancellation adds only its receipt, without another event or message.
7. **AC-7**: Persist all completed and cancelled records and immutable evidence. The existing historical source guards remain active. A change that would alter frozen eligibility is refused without partial work; no snapshot is recomputed, rewritten or bypassed. The additive receipt migration is atomic, idempotent and verified on Neon and the separate test database without changing old timestamps.
8. **AC-8**: Real current Employee sessions and fresh persisted authority are required. Every leave predicate includes the authenticated owner. Missing and other owned ids share one 404. Reject caller supplied owners, roles, return dates and cancellation timestamps, invalid fields, methods, selectors and origins. Responses are private and no store, and errors are fixed and sanitized.
9. **AC-9**: If legacy data has multiple current/upcoming periods or contradictory current evidence, show a repair warning and withhold new leave actions until HR resolves it. Home retains its existing combined leave pause and does not offer an ambiguous return target. Do not silently select, merge, cancel or repair those records.
10. **AC-10**: Use the approved existing form error region, shared loading/error banners, Retry, toast and explicit Reload latest treatments. Retain failed drafts, retry uncertain writes with their original identity, discard a conflict draft only on explicit reload, withhold private content during session revalidation, and reject stale callbacks for another actor/view. Shared keyboard, focus, mobile, reduced motion, announcements, NVDA and native zoom requirements apply.
11. **AC-11**: Lint, types/build, meaningful separate database tests and real development/production verification pass. Prove dates and midnight boundaries, create races, response loss, cancellation/return, legacy conflicts, notification gaps, atomic rollback, source protection and Home integration. Existing task and History regressions remain passing. Record any unobserved manual accessibility evidence as open.

## Decision

Reuse React, Express, PrismaPg, Neon and the existing authentication, accessibility, audit and notification boundaries. Add one private read API, three explicit operation endpoints and a LeaveMutationReceipt table. No new provider, dependency, secret, approval state or background leave job is required.

**Implementation skills**: the installed `develop`, `test`, `check` and `sync` workflow skills in `.agents/skills/`, from `jsmastery-pro/skills`. Existing auth is consumed without changing its configuration or credential behavior.

## Rationale

Reasoning, alternatives and the confirmed conversation are in `rationale.md`.

## Feature design

### Confirmed model

| Record | Fields and relationships | Rules |
| --- | --- | --- |
| LeaveRecord | Existing id, userId, startsOn, expectedReturnOn, actualReturnOn?, cancelledAt?, cancelledById?, createdAt | User 1:N leaves. Existing date/actor constraints and source triggers remain. No new editable fields or revision column. |
| LeaveMutationReceipt | userId string, requestId UUID, operation string, requestHash char(64), leaveId string, result JSON, createdAt Timestamptz(3) | Composite primary key userId/requestId. FK to User and composite FK leaveId/userId to LeaveRecord id/userId. Operation is CREATE, CANCEL or RETURN. Append only. |
| Notification | Existing recipient, kind, title/body, leaveId?, deduplicationKey and timestamps | User 1:N notifications; leave 1:N notifications. Existing unique recipient/deduplication key. |
| AuditEvent | Existing actor, action, LeaveRecord target, before/after JSON and timestamp | Existing append only evidence. A changed action has one audit in the same transaction. |

A leave keeps its original start/expected return forever through these APIs. Cancellation and actual return are mutually exclusive terminal events for ordinary writes. One current/upcoming period is enforced under the shared owner mutex, rather than a time dependent unique index. Future HR writers must use that mutex and rule too. The date model and history guard already support same day return equal to start.

### Derived state and read API

Use one shared pure classification for reads, fresh writes and Home capabilities. `today` comes from the response's server instant converted by `watCalendarDay`, never the browser's timezone.

An unresolved candidate has no cancellation effective at asOf and exclusive effective end (`actualReturnOn ?? expectedReturnOn`) after today. Query at most two owned candidates, ordered by start/id, to detect ambiguity without returning a history list. More than one candidate is REPAIR_REQUIRED, even if adjacent and not overlapping. A candidate with a future recorded return/cancellation, invalid dates, or both terminal events is also REPAIR_REQUIRED. Past records are retained and do not block a new period. New length/horizon limits do not retroactively invalidate a coherent legacy period.

With no candidate: NONE, canCreate true. With exactly one coherent period and no terminal event: SCHEDULED if today < startsOn, otherwise ON_LEAVE. SCHEDULED canCancel true and canReturn false; ON_LEAVE canReturn true and canCancel false. A period ending today is no longer current. Same day early return ends immediately and is not another unresolved candidate.

GET `/api/employee/leave` accepts no query, body or owner selector. Use the existing Repeatable Read/fresh Employee principal pattern. It produces:

* ReadClock: asOf, timezone Africa/Lagos, currentWeekStart, nextChangeAt.
* today, defaults `{ startsOn: today, expectedReturnOn: today + 7 days }`, and bounds `{ latestStartOn: today + 365 days, maxDays: 366 }`. Use checked date arithmetic; clamp generated default/bound dates to 9999-12-31. If no valid future return exists, canCreate is false with a fixed date unavailable reason.
* state NONE, SCHEDULED, ON_LEAVE or REPAIR_REQUIRED; canCreate boolean and fixed reason code nullable.
* current null, or `{ id, startsOn, expectedReturnOn, state, canCancel, canReturn }` for the one coherent unresolved period. Do not return arbitrary current HR/manager identities, other people's records, raw receipts or raw audits.

For REPAIR_REQUIRED, current is null and every capability false. The page shows the approved repair banner and Contact HR copy. Home retains leaveSummary's existing union pause/returnsOn; add an optional unambiguous return target/capability and repair indication from the same classifier. These fields do not change historical task permissions. Only the current Home view can show its return action.

The reason code is LEAVE_REPAIR_REQUIRED for repair, LEAVE_CONFLICT for an existing coherent period, DATE_UNAVAILABLE at the terminal date boundary, and null when creation is allowed. No caller supplied clock affects those values.

nextChangeAt is the next WAT midnight, also considering any earlier future cancellation event in legacy evidence. Refresh at that boundary, on explicit Retry and through existing foreground session revalidation. No general polling and no GET writes. The page needs no pagination because it exposes one current/upcoming state, not a list.

### UI and integration

Use the exact Employee Leave screen inspected live on 2 November 2026 in `docs/workforce-prototype-updated.html`. The engineer approved the Scheduled card adjustment, shared failure treatments and Home return integration. No new navigation or layout is approved or needed.

The form uses server date defaults only when no actor draft exists. Start changes do not silently overwrite a return date already entered. Preserve the two values on validation failure, definite save failure and same actor revalidation. Keep draft state and pending operation identity above the disposable workspace, scoped to user id/role; do not persist private drafts in localStorage. Show no private content while session authority is unresolved, and clear actor bound operations on sign out or actor/role change.

During a pending write disable competing leave actions in both surfaces. Unknown outcomes retain the exact operation/key and block a replacement intent until Retry resolves it. Navigation must not turn an unknown result into another create. A definite conflict retains the draft and offers Reload latest; that explicit action discards it and fetches current state. After a committed result, refresh the active read. A failed refresh says the action was saved but the latest state is unavailable, with a read Retry; do not call an acknowledged write a failure or send it again as a new intent.

No new confirmation dialog is added: the prototype confirms leave through its form and returns through the immediate I’m back button. Cancellation uses the approved same card button. Correct misleading prototype messages: Employee confirmation never mentions a relief officer, and return never promises a nonexistent Employee leave history table. Describe full leave weeks as excluded and partial weeks as retaining their available workdays. Do not claim a planning unlock or notification delivery/read receipt.

After a changed result, use the existing toast plus the shared warning banner when `notificationWarnings` is nonempty. Text explicitly says leave was saved and identifies manager and/or HR notification configuration gaps. Available notification rows remain committed. No retry button resends a committed event to newly configured recipients; that recovery belongs to later notification operations.

### API and security

| Endpoint | Method and input | Output | Authority and main failures |
| --- | --- | --- | --- |
| /api/employee/leave | GET, no selectors | Current read above | Current Employee; 401/403, 400 invalid request, 503 dependency |
| /api/employee/leave | POST `{ startsOn, expectedReturnOn }` | Mutation result | Current Employee; 400 dates, 409 existing/repair period, 423 history protected |
| /api/employee/leave/:leaveId/cancel | POST `{}` | Mutation result | Owned target; 404, 409 no longer cancellable, 423 history protected |
| /api/employee/leave/:leaveId/return | POST `{}` | Mutation result | Owned target; 404, 409 invalid transition, 423 history protected |

Every POST requires a UUID Idempotency-Key. No If-Match revision is needed because dates cannot be edited and terminal events are immutable. Unknown fields, duplicate selectors, body selectors, arbitrary effective dates and unsupported methods are rejected. Use existing exact Origin/Fetch Metadata policy, JSON validation and 32kb body ceiling, plus independent leave write namespaces using the existing 300/IP/minute and 60/user/minute limits. Apply no store headers to successes and failures; forward renewed cookies through existing auth policy.

Known statuses: 400 INVALID_INPUT with safe field messages, 401 SESSION_REQUIRED, 403 FORBIDDEN, 404 NOT_FOUND, 409 LEAVE_CONFLICT / LEAVE_REPAIR_REQUIRED / LEAVE_CHANGED / IDEMPOTENCY_CONFLICT, inherited 413 body size and 415 JSON media type failures, 423 HISTORY_PROTECTED, 429 with Retry-After, and 503 SERVICE_UNAVAILABLE. Missing, other owned and malformed-but-valid-format target ids are indistinguishable 404; invalid path syntax is 400. Map only recognized history guard refusals to HISTORY_PROTECTED. Other database failures stay sanitized 503, never raw SQL errors. Failed reads do not imply an empty leave state.

The data is internal absence scheduling, with no medical reason or benefit entitlement calculation. No compliance certification or new legal retention claim is made. Existing immutable evidence retention remains authoritative.

### Value sourcing

| Action | Produced value | Source |
| --- | --- | --- |
| Authorize | Actor, current role and internal session | Existing real auth wrapper plus fresh persisted Employee principal/session after locks |
| Default/validate dates | Today, bounds, duration, lifecycle state | Server clock, Africa/Lagos calendar helpers, validated input and stored exclusive date interval |
| Render page | Form/current card, labels, capabilities | Inspected prototype, approved adjustments and shared classifier |
| Render Home | Combined pause/end and safe return target | Existing leaveSummary plus the shared owned candidate classification |
| Save/replay | Leave id, operation, appliedAt, changed/replayed and warnings | Committed domain result and validated immutable receipt |
| Notify | Recipient set and gaps | Fresh actor assignment, eligible manager and current HR resolution inside the write transaction, defined in the write child |
| Audit | Actor, target, dated before/after and notification outcome | Same transaction's actor, stored leave row, server instant and actual recipient resolution |
| Refresh/failure | Draft, pending identity, stale/error state and focus | Per actor view/operation state, actual HTTP outcome and existing shared accessibility helpers |
| Protect history | Whether a write may alter prior workday coverage | Existing database source guards using fresh database time and persisted/covered freeze windows |

### Critical test scenarios

* Today/future create, horizon exactly 365, duration exactly 366, invalid/overflow dates, weekends, WAT midnight and exclusive return. AC-2, AC-3, AC-11.
* Concurrent creates with same/different UUIDs, reused key with changed dates/target, response loss and replay after the leave has ended. AC-5, AC-6.
* Cancel scheduled, reject cancellation after midnight/start, return today from both pages, same day zero interval, natural completion and no implicit unlock. AC-3, AC-4.
* Missing manager/HR warnings, duplicate recipient collapse, eligible recipient role changes, and failures injected into leave, notification, audit and receipt writes. AC-5, AC-8.
* Multiple legacy periods and contradictory events with correct Home union pause and no ambiguous mutation target. AC-9.
* Held owner/source lock crossing midnight/freeze, immutable terminal events, no historical snapshot changes and no source guard bypass. AC-4, AC-7.
* Anonymous, revoked, inactive and role changed sessions, substituted ids, exact payloads, CSRF/origin, body/rate limits and private responses. AC-8.
* Loading, network failure, retained draft, unknown result Retry, conflict Reload latest, committed save plus failed refresh, stale actor callbacks, keyboard and 320 pixel layouts. AC-1, AC-10.
* Migration twice on Neon/test, seed repeat, all task/History/auth regressions and actual app modes. Manual NVDA and native 200 percent zoom are distinct evidence. AC-7, AC-11.

## Build plan

1. Compose the inspected Leave form, current/scheduled cards and approved shared states using the final domain contracts. Reuse the Home return placement. AC-1, AC-3, AC-10.
2. Add the one receipt migration and regenerate Prisma, preserving old domain evidence. Verify the migration and seed twice on the separate database before Neon. AC-6, AC-7, AC-11.
3. Implement the shared classifier/read API and three guarded atomic operations, notification resolution, audits and receipt replay. AC-2 through AC-9.
4. Connect both UI surfaces, actor bound drafts/operation identity, refresh boundaries and focus/announcements. AC-1, AC-3, AC-4, AC-9, AC-10.
5. Add meaningful real separate database/browser regressions, run existing checks, apply/verify Neon, and drive development and production flows. Record manual gaps explicitly. AC-1 through AC-11.

The project's Facade variant leads with the prototype composition but wires final controls to the migrated, seeded database before calling the build complete. No final in memory fake state or new role journey is introduced.

## Consequences

Leave becomes a real Employee journey with truthful current work eligibility and safe retry behavior. The receipt table and current period rule add transactional work to each action. Missing recipient configuration may leave some people uninformed, but the Employee receives a warning and the audit preserves the gap. A date only model records no partial days, including same day return as zero.

## Follow-up

* Features 14/15 own notification browsing, delivery and any recovery for previously missing recipients. No email is sent here.
* Manager/HR leave and relief writers remain their existing scoped features. They must coordinate on the owner mutex, preserve immutable events/history guards, and explicitly design any date correction or extension.
* Any reviewed repair for conflicting legacy periods remains outside ordinary Employee APIs.
* Existing manual accessibility gates remain open until observed; do not mark this feature done solely from automated checks.
