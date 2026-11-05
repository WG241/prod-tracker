# 0011. Leave writes and retry evidence

This child implements AC-2 through AC-9 and AC-11 in the parent. It changes no authentication mechanism and grants no manager/HR mutation permission.

## Migration

Add LeaveMutationReceipt with the parent model's fields and relations. Required columns are nonnull. Use a composite user/request UUID primary key, composite leave/owner FK with Restrict deletion, User FK with Restrict deletion, leave/owner index, operation CHECK for CREATE/CANCEL/RETURN, lower case hexadecimal SHA-256 hash CHECK, and a version 1 JSON object result shape requiring matching requestId/operation/leaveId and typed result fields. The service validates the complete saved result before replay. An append only trigger rejects UPDATE/DELETE, using existing security invoker/fixed search path conventions.

One additive PostgreSQL migration wraps the related DDL in a transaction. Guard table/index/constraint creation and recreate the trigger/function idempotently. Do not modify the intent of any applied migration, rewrite old leave timestamps, migrate legacy data opportunistically, alter source/audit/frozen roster guards, or add a time dependent unique index. Regenerate the client and verify the SQL twice on both targets, comparing preexisting evidence.

## Contract and identity

Operation kinds are CREATE, CANCEL and RETURN. Create dates are normalized validated YYYY-MM-DD strings; action ids use the existing 1..160 ASCII letter/digit/underscore/hyphen path rule. Cancel/return body must be an empty JSON object. The route derives target/actor; no client owner, state, timestamps or notification recipient is accepted.

Digest the normalized operation, canonical path, target and exact normalized body using SHA-256, following task receipts. The authenticated user and UUID are the receipt key. Shared UI surfaces retain the same key/operation until a definite result. Keys are generated for a new explicit intent, never changed merely because a response timed out.

Mutation result is `{ version: 1, requestId, operation, leaveId, appliedAt, changed, replayed, notificationWarnings }`. appliedAt is the fresh database decision instant, also used as receipt createdAt, for either a changed or no change result. A no change result does not invent the original return event's time from its date field. Warnings are a deduplicated array of MANAGER_UNAVAILABLE and HR_UNAVAILABLE in that order. No recipient ids, raw audit or snapshot data is returned. Persist the original committed result with replayed false; replay validates it and returns replayed true with all other values unchanged. No value from a stored result is interpreted as fresh current leave state.

For a new request, create and changed actions respond 200 after commit. A matching terminal no change also responds 200 with its receipt and no new domain event. Replay first rechecks current actor/session/role and request hash, then returns the saved result without revalidating old dates against today's horizon or changing recipients. A caller who is no longer a current Employee cannot replay through this API.

## Transaction and authorization

Use Read Committed, existing 5 second max wait/15 second transaction bounds and at most three complete attempts for natural key races/deadlocks/serialization failures or a day boundary retry. Use `databaseErrorCode` for nested driver codes. A retry obtains fresh locks, clock and facts. Never hold a transaction over a UI request, timer, telemetry or email operation.

Follow the existing owner first contract: lock User FOR UPDATE, the persisted internal session/AuthUser and dated assignments/leaves in stable id order. For a proposed actual change, explicitly lock source WorkWeek rows FOR SHARE in startsOn order using the same old/new Monday through Friday overlap predicate as the leave source trigger. Take these locks before final date validation, rather than letting a later trigger wait consume the permission clock. Reuse the auth locking helpers without weakening their checks. Validate the persisted session is still owned/unexpired and the principal is still an active provisioned Employee with exactly one current assignment. Leaving does not deactivate the account and active leave must not prevent these own leave operations.

Inspect/replay the owned receipt before evaluating fresh business date limits. For a new key, load and lock any target by both id and userId, then classify all unresolved owned periods under the same mutex. A conflicting create or a different newly created period must never be changed by an old action id. For any actual domain change, recheck authority and obtain fresh `databaseClock` time after all waits immediately before date/state validation and the leave write. The source BEFORE guard takes its own fresh clock after its locks; a refusal still rolls back the whole transaction.

An already cancelled CANCEL or already returned RETURN may commit a no change receipt even if a different current period now exists. Use that target's original evidence and no notification warnings, since this request creates no message. An opposite terminal event is LEAVE_CHANGED. Otherwise legacy ambiguity blocks changes with LEAVE_REPAIR_REQUIRED. A natural completed period without an explicit return event is not an early return target and yields LEAVE_CHANGED. No dates are revised to make an old form succeed.

## Changes

| Operation | Preconditions after locks | Domain change |
| --- | --- | --- |
| CREATE | No unresolved period; today <= start <= today+365; 1 <= return-start <= 366; valid real bounded dates | Create owned LeaveRecord with server createdAt and null terminal events. |
| CANCEL | Exact owned target, no terminal event, today < startsOn, no legacy ambiguity | Set cancelledAt to the fresh database instant and cancelledById to actor. Keep all date fields. |
| RETURN | Exact owned target, no terminal event, startsOn <= today < expectedReturnOn, no legacy ambiguity | Set actualReturnOn to today. Equal to start is valid. Keep original expected return. |

The boundary is WAT midnight. Do not accept a return date in the request or allow ordinary backdating, extension, deletion, repeated event rewriting or account status updates. Existing linked relief remains stored; its effective access is already clipped by leave return/cancellation under the existing relief policy. This feature does not create, edit or remove cover arrangements or reroute approval requests.

For a proposed actual change, discover and lock notification recipients and source weeks before final actor/date/state validation. Then take the final database decision instant, revalidate and change the leave. Immediately after the guarded source write, obtain another database clock and recheck persisted session/authority. If its WAT day differs from the decision day, roll back the complete transaction and retry from fresh locks before committing any notification, audit or receipt. This covers subsequently inserted source rows or other trigger waits that prelocking could not eliminate. A retry may now reject cancellation after start or recompute today's return; it cannot commit yesterday's choice. Authority failures roll back and deny normally. After this check insert notifications, one audit and the receipt using the resulting event fields. Every domain insert/update is in this transaction. Any failure rolls it all back. Emit sanitized API diagnostics only after the failure; diagnostics cannot decide commit success. There is no submission/approval analytics event for leave.

## Notifications and audit

The Employee is always a recipient. The manager is the permanent managerId from the fresh actor assignment, eligible only if an active User has exactly one current open LINE_MANAGER assignment in the same business. HR recipients are active domain Users with exactly one current open HR_ADMIN assignment. These domain roles do not require an already provisioned login. Deduplicate ids before insertion.

Resolve eligible recipients within this transaction using the current assignment rule (effectiveFrom <= resolution instant, effectiveTo null). Acquire SHARE locks on selected recipient Users and their assignment rows in deterministic id order, then validate their eligibility after waits. The set comes from that recipient resolution query's database snapshot; newly eligible HR identities committed after discovery apply to later events and are not retroactively added to this one. Do not acquire a global User table lock. Actor assignment is protected by the owner mutex. If eligibility was lost while waiting, omit that recipient. A vanished/invalid manager yields MANAGER_UNAVAILABLE; zero eligible HR yields HR_UNAVAILABLE. Record that fact, not an invented delivery success. Recipient locks never replace final actor/date validation, and deadlocks retry the full transaction.

If a boundary changes the applicable action after notification discovery, validate again and recompute the event inputs before writing; never use a prewait leave permission. If discovery/validation cannot complete due to a database dependency, return sanitized 503, rather than treating that outage as a missing configured recipient.

| Event | Notification kind/title | Deduplication key |
| --- | --- | --- |
| CREATE | LEAVE_RECORDED / Leave recorded | `leave:<id>:recorded` |
| CANCEL | LEAVE_CANCELLED / Leave cancelled | `leave:<id>:cancelled` |
| RETURN | LEAVE_RETURNED / Return recorded | `leave:<id>:returned` |

Use the same key for every recipient; the existing unique key includes recipientId. Notification body is safe plain text containing the current Employee display name (trimmed User.name, falling back to Staff member) and stored start/expected return dates for create/cancel, or actual return date for return. Format dates in en-GB with explicit Africa/Lagos business dates. No email address, reason, arbitrary user metadata or delivery/read claim is added. Set leaveId, leave unrelated task/relief links null, and use the committed event timestamp as createdAt.

Audit actions are LEAVE_RECORDED, LEAVE_CANCELLED and LEAVE_RETURNED, actorId is the Employee, targetType LeaveRecord and targetId the owned leave id. Before/after whitelist the original dates and terminal event fields, request UUID, resolved recipient ids, resolution timestamp and fixed warning codes. Never store credentials, session ids, full request headers or raw Prisma records. Audit createdAt is the successful event's database instant. No change/replay adds no audit or notification.

Notification configuration warnings are part of the original stored result and audit. Retrying does not reclassify them or fill in missing recipients. A failure while inserting even one available recipient's row is an action failure, unlike an explicitly absent eligible recipient.

## History, conflicts and recovery

Keep the existing source guard as the final historical boundary. Its owner/week locks coordinate with capture and other ordinary writes. Do not disable it, force a source change, recapture a closed roster or invent a compensating snapshot. Recognized historical projection refusals map to fixed HISTORY_PROTECTED/423. Other integrity failures stay internal 503 unless already explained by explicit validation.

The owner mutex serializes new writes, including task writes and future HR leave writes that follow the contract. It is not a database claim that privileged direct SQL cannot insert conflicting source records. Existing or externally introduced conflicts are handled through the shared repair state; only a separately reviewed repair may correct them.

Tests must inject failures after leave mutation, available notification insert, audit and receipt; prove complete rollback; and race current task writes, create requests, cancellation/start midnight, early return and history capture. Exercise the actual nested PostgreSQL guard error shape and immutable receipt constraints. Use only the explicit separate test database for destructive fixture assertions. Historical setup may use the existing isolated fixture helper, never while testing behavior and never in runtime imports.
