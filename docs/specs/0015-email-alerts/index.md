# 0015. Email alerts

**Date**: 2026-11-03
**Status**: In Progress

## Summary

Deliver new registered notification events as plain text email through Resend. Store a durable delivery record with the business event, then send outside its transaction through a bounded worker in the app process. Email defaults to Off, with explicit Preview, Catch-all and Live modes. This architecture does not connect a service, send mail or authorize development.

## Structure

* `0015-email-worker.md` defines claim ownership, retries, uncertainty, configuration changes and private operations.
* `rationale.md` records the provider comparison and approved choices.
* Specs 0013 and 0014 define account preferences, security events and the shared notification factory.

## Requirements

As a Workforce person, I want relevant workflow and security messages delivered to my configured address without unsafe test sending or duplicate mail under retry.

1. **AC-1**: For newly created registered events, persist one EmailDelivery per Notification in the same transaction as the domain event. Never send within that transaction. Notification/outbox persistence failure rolls back the domain change; provider failure after commit does not undo business work.
2. **AC-2**: Default to Off. Preview performs no external communication. Catch-all replaces every envelope recipient with one explicit test address. Live requires explicit arming, production configuration, an approved sender and allowed recipient domains. Seeded Suppressed deliveries and older notifications are never backfilled or sent.
3. **AC-3**: Plain text includes the exact immutable notification title/body and one Open Workforce link to the configured application's root. Password security text includes the owner notice defined in spec 0013. No new HTML design, action token, password reset, tracking pixel, attachment or recipient-supplied URL is introduced.
4. **AC-4**: The workflow toggle controls all workflow email. Suppress work alerts during effective leave, while leave updates and password security notices remain eligible. Security bypasses the workflow toggle; global Off still means zero external sends. In app messages are unaffected.
5. **AC-5**: Before every attempt, recheck active recipient, canonical frozen address, the recorded original recipient relationship, current event eligibility and applicable preference/leave rules. Suppress stale recipients instead of redirecting old content when no previous acceptance remains unresolved. Workflow alerts expire after 24 hours; password security notices after seven days.
6. **AC-6**: Snapshot the exact provider envelope/content before sending, with a stable delivery id/key and payload digest. Recover worker crashes through durable leases and ownership fencing. Retain durable evidence of any unresolved acceptance across later claims, rejections and policy changes. Retry identical Resend requests only within the bounded idempotency window; record Uncertain and stop when acceptance cannot be resolved safely. Do not promise unlimited exactly-once delivery.
7. **AC-7**: Run one worker loop in each existing long-running app process, with post-commit wakeups, startup recovery and periodic checks. Bound admission, concurrency, timeouts, attempts and shutdown. Multiple processes cannot persist outcomes for another claim; no database lock spans provider HTTP.
8. **AC-8**: Record Queued, Sending, Previewed, Sent, Failed, Suppressed and Uncertain distinctly. Sent means provider acceptance only. Signed delivery/bounce webhooks and proven inbox placement are explicitly deferred.
9. **AC-9**: Send/worker failures appear through fixed sanitized error monitoring and private delivery diagnostics. Keep addresses, names, bodies, provider raw errors, secrets and delivery ids out of telemetry. Safe retry commands never resend Sent/Previewed/Suppressed/Uncertain rows or bypass policy/window limits.
10. **AC-10**: Additive, atomic and repeatable schema/seed work preserves historical notifications, timestamps and existing delivery evidence. Beta tests cover actual database and provider-boundary faults; real Preview and controlled Catch-all verification demonstrate content, routing and failure visibility. No ordinary automated fixture run sends to real staff.

## Decision

Use Resend's HTTPS send API through Node's existing fetch support, without adding an SDK or a second hosted worker. Reuse PostgreSQL as the durable outbox (records waiting for a send). Reuse the shared typed notification factory so recipients and message content have one source. No browser send API exists.

**Implementation skills**: installed `develop`, `test`, `check` and `sync` workflow skills, with the existing auth/security and telemetry boundaries. Optional Resend Agent Skill/MCP discovery was deferred by the engineer; nothing is installed or connected by this design.

## Rationale

The provider comparison, documented guarantee boundary and confirmed answers are in `rationale.md`.

## Feature design

### Event scope and deployment boundary

Initial events are PASSWORD_CHANGED, APPROVAL_REQUESTED and LEAVE_RECORDED/CANCELLED/RETURNED from the producers already designed/built in Features 10, 12 and 13. Future decisions, comments, tracker controls/reminders and relief changes integrate when their owning workflows ship. No weekly opening/reminder scheduler or early manager/HR action is added here.

The enqueue hook runs only when the factory actually inserts a new registered Notification after this feature is deployed. Existing notification/replay paths do not repair a missing delivery by creating one retrospectively. Seeds remain Suppressed and never acquire a sendable snapshot. New events in Off receive a Suppressed delivery with MAIL_DISABLED; they are not later backfilled when mode changes.

The app keeps serving if Resend is unavailable. Invalid explicitly enabled mail configuration disables external dispatch and is visible through a fixed configuration diagnostic; new events retain a failed/configuration delivery record rather than sending or rolling back valid business work. A valid Off configuration is not an error. Missing required database storage remains a true transaction failure, not a mail configuration warning.

### Confirmed delivery model

Retain EmailDelivery's id, unique notificationId, recipientEmail, state, attemptCount, scheduledAt, lastAttemptAt, sentAt and failureCode. Add these fields:

| Field | Type/nullability and source |
| --- | --- |
| enqueuedAt | Timestamptz(3), nullable for legacy only; database instant for new rows |
| recipientBasis | JSON nullable for legacy only; immutable version 1 original recipient relationship and scope evidence defined below, including new Off/configuration-failed rows |
| messageSnapshot | JSON nullable for legacy/suppressed/unrenderable rows; fixed version 1 sendable envelope and text defined below |
| transportMode / provider | Nullable strings; fixed mode and `resend` or `preview` on new renderable rows |
| transportRevision | Nullable string; operator's nonsecret deployment revision, captured at enqueue |
| providerKey | Nullable string; `workforce/email/v1/<deliveryId>`, required for external sendable rows and immutable |
| payloadHash | Nullable char(64); SHA-256 of the canonical frozen send fields |
| firstAttemptAt | Nullable Timestamptz(3), set once at the first external attempt claim |
| firstUncertainAt | Nullable Timestamptz(3), set once on an ambiguous external outcome or expired external claim; retain it even after confirmed acceptance as historical evidence |
| leaseToken / leaseExpiresAt | Nullable UUID and Timestamptz(3), both present only on Sending |
| providerMessageId | Nullable string, set on confirmed provider acceptance |

Extend EmailState with SENDING, PREVIEWED and UNCERTAIN. New sendable rows require complete typed snapshots and coherent state/lease/attempt fields. Preserve existing Sent timestamp checks. A new external Sent row requires its acceptance id; legacy Sent rows without new metadata remain legacy evidence. Notification remains 1:0..1 delivery, with no new user-facing delivery model.

The immutable snapshot is `{ version:1, from, to, subject, text, workspaceUrl }`: canonical sender and actual destination mailbox strings, subject/text strings and the fixed app root URL. `recipientEmail` retains the logical recipient's canonical User.email even in Catch-all; `to` is the catch-all address in that mode. Freeze both. Recipient basis, mode/provider/revision/key/hash and notification identity cannot change after enqueue. Suppressed and configuration-invalid records may lack a sendable snapshot, and cannot be rendered/sent later through ordinary retries.

`recipientBasis` has `{ version:1, relationship, sourceUserId, sourceAssignmentId?, recipientAssignmentId?, businessId? }`, with exact closed variants. OWNER requires sourceUserId and no assignment/scope fields, covering password owner or leave owner. MANAGER requires all fields from the event's current source Employee assignment and resolved manager assignment/business. HR requires sourceUserId and the resolved HR recipientAssignmentId, with no business or sourceAssignmentId. ASSIGNED_REVIEWER requires all fields from the pending approval's current Employee assignment and its resolved permanent manager assignment/business. These are database identifiers, not text-derived guesses. If several relationships apply, choose OWNER, then MANAGER, then HR. The producer passes its already resolved basis to the enqueue hook in the same transaction; Feature 12's recipient resolver must retain this basis rather than return only collapsed ids. An event replay does not create or reconstruct a basis for old messages.

Do not add raw provider responses, credentials, password proofs, arbitrary headers or recipient arrays. Last-attempt and outcome fields are mutable only through the state machine. Add a due-state/schedule index and an expired-lease index.

### Message construction and eligibility

The factory reads policy facts in the domain transaction, coordinating with recipient User/preference locks from spec 0014. Build text from the immutable English Notification title/body, followed by `Open Workforce: <auth origin>/`. Subject is `Workforce weekly performance: <title>`. Use server-owned text only; bound subject to 200 Unicode characters and text to 8,000, with a 32 KiB serialized snapshot ceiling. Reject CR/LF/NUL in mailbox/header values and malformed Unicode. Render no HTML.

The URL is the existing canonical BETTER_AUTH_URL/AuthConfig origin plus `/`. It contains no notification id, identity, password, session token or action proof. Normal app sign-in/current role routing controls access; merely clicking email never marks an in app message read.

| Class | Preference/leave policy | Current recipient eligibility before sending |
| --- | --- | --- |
| SECURITY: PASSWORD_CHANGED | Ignore workflow preference and leave | Active owner of the notification, same canonical current email; ready auth email must remain consistent if present |
| WORK: APPROVAL_REQUESTED | Enabled preference, not effectively on leave | Recorded ASSIGNED_REVIEWER under the explicit initial permanent-manager resolver below; no relief retargeting |
| LEAVE: recorded/cancelled/returned | Enabled preference; leave itself does not suppress this class | Recorded OWNER, MANAGER or HR basis, satisfying the same relationship now under the rules below |
| Unknown/unregistered mail policy | No external send | Keep the in app message; no inferred broadcast or security bypass |

Use NotificationPreference, with the spec 0013 legacy fallback only if its row is absent. Do not require provisioned auth for an otherwise eligible domain-only HR/manager recipient, matching Feature 12, but a ready inconsistent identity is ineligible. Use the existing union of effective leave intervals and exclusive first-day-back date in Africa/Lagos. Conflicting leave evidence conservatively pauses work mail; it does not change stored leave.

For leave OWNER, require leave.userId = sourceUserId = recipientId. For MANAGER, require the source owner still Active with exactly one current effective Employee assignment, its managerId still the recipient, and both its business and the recipient's exactly one current Line Manager assignment matching the frozen businessId. For HR, require exactly one current effective HR_ADMIN assignment. A manager who becomes HR cannot qualify through the HR branch of an old MANAGER message. Assignment ids prove the original selection; a replacement assignment may qualify only through the same current relationship and frozen business scope. Do not require the leave still be ongoing for a recorded/cancelled/returned confirmation.

The initial approval-email resolver is independent of an approval action endpoint. Require the notification's exact approvalRequestId/task pair; request.state PENDING; no decision; assignedManagerId equal to recipientId; task.ownerId equal to request.submittedById/sourceUserId; task not deleted and status AWAITING_APPROVAL; and a matching owned tracker with a valid persisted WorkWeek. Require an Active source Employee with exactly one current effective assignment still reporting to that recipient, and one current effective Line Manager assignment for the recipient, both in the frozen businessId. A frozen tracker alone does not make a still-pending request ineligible, since review may follow freeze; this mail check grants no historical task read or approval power. Missing/corrupt source facts fail closed. A changed manager or business suppresses the original recipient, without adding a new one. Relief managers receive no APPROVAL_REQUESTED email from this initial producer; Feature 19 must explicitly extend the event/eligibility contract when its review and relief workflow exists. The destination remains unavailable until then, as defined by spec 0014.

Recheck policy immediately before each claim/attempt and after any relevant lock waits. The claim is the dispatch authorization point; a preference/leave/account change can prevent later claims but cannot recall an email already in progress. Never mutate a frozen address/content to make a stale delivery eligible. Expiry is measured from enqueuedAt, not the latest retry schedule. With no unresolved prior acceptance, mark stale/disabled/mode-incompatible messages Suppressed and expired messages Suppressed with EXPIRED. If firstUncertainAt is nonnull and same-key acceptance has not been confirmed, any terminal policy, age, configuration or attempt stop is Uncertain instead; a later rejection cannot erase earlier ambiguity. Report expired mandatory security notices as a fixed delivery failure in either case.

### Modes and configuration

| Variable | Rule |
| --- | --- |
| EMAIL_MODE | `off` default; explicit `preview`, `catch-all`, `live`; no unknown/coerced value |
| RESEND_API_KEY | Server-only secret required for Catch-all/Live; never VITE, stored in payload or logged |
| EMAIL_FROM | One canonical mailbox, required for renderable modes; use the fixed Workforce display name at presentation. Resend sender domain must be verified/approved. |
| EMAIL_CATCH_ALL_TO | One canonical explicit test inbox, required only in Catch-all; a leftover value blocks Live dispatch rather than being silently ignored |
| EMAIL_LIVE_ENABLED | Must explicitly equal `true` for Live |
| EMAIL_LIVE_ALLOWED_DOMAINS | Required exact domain allowlist in Live, no wildcards; operator-approved staff destinations only |
| EMAIL_TRANSPORT_REVISION | Required nonsecret revision in external modes; change when sender, provider account/key scope or delivery configuration changes |
| Existing BETTER_AUTH_URL / NODE_ENV | App root source; Live additionally requires NODE_ENV production and a nonloopback HTTPS auth origin |

Catch-all still validates the logical recipient and replaces the entire envelope destination; no CC/BCC or hidden original recipient is sent. It may use a Resend documented test address or an explicitly approved test inbox. A default/sample invalid address is never a live recipient. API host/path are fixed to Resend's send endpoint, not a user/configurable proxy that could receive the secret. Test transports are injected in test code only.

Preview writes only private artifacts under `.local/email-preview/`, outside public asset serving. Use strict owned filenames derived from delivery ids, atomic exclusive writes, matching-content replay checks, no symlink traversal and the established private storage guards. Retain at most seven days and 10 MiB of owned preview files; never prune unrelated files. Record Previewed only after the artifact is durable, never Sent. There is no new product preview page or notification administration screen.

### Interfaces and observability

| Interface | Input | Output/authority |
| --- | --- | --- |
| Transactional enqueue hook | Newly inserted registered notification, domain transaction and validated mail configuration | One owned delivery row; no network and no historical lookup/backfill |
| Worker wake / pass / stop | Trusted app lifecycle or new committed event | Bounded work; database lease ownership, no HTTP caller |
| Resend send adapter | Frozen snapshot and providerKey | Accepted provider id, known rejection, retryable rejection or unknown acceptance |
| `npm run email:inspect -- [--state STATE] [--limit 1..100]` | Private operator, existing DB configuration | Masked delivery status and fixed reasons, not message bodies/addresses/secrets |
| `npm run email:retry -- --delivery-id ID --apply` | Private explicit safe retry | Compare-and-set on known-not-sent retryable Failed only, within all original limits, with System audit; no forced replay |

No send, retry or outbox endpoint is public. Unapplied inspect/retry is diagnostic. Preview paths are private artifacts, not URLs. A separate reviewed operation would be needed to reconcile Uncertain mail; this feature supplies no unsafe force flag.

Add fixed server-only EMAIL_DELIVERY_FAILED and EMAIL_CONFIGURATION_INVALID categories at background/email-delivery. Existing anonymous browser ingestion must not be able to forge them. Emit after persisted outcomes, using the existing bounded best-effort writer. Database records remain the durable truth even if telemetry is off/full. Expected opt-out/leave suppression is not an operational error. Capture failures without raw provider text, recipient/source ids or PII.

### Value sourcing

| Action | Value produced | Source |
| --- | --- | --- |
| Enqueue | Event/notification identity and logical recipient | Newly inserted Notification, domain's resolved recipient and User.email |
| Policy | Original/current relationship, class, opt-out/leave/role/age decision | Frozen recipientBasis from the domain resolver, current preference/assignment/leave/exact approval facts, enqueuedAt and database clock |
| Render | Subject/body/link/from/to | Notification snapshot, fixed templates, validated config; Catch-all replacement |
| Retry | Same payload/key/window | Stored immutable snapshot/key/hash and firstAttemptAt |
| Claim/finalize | Attempt count, lease, first uncertainty, state/time/acceptance id | Conditional database transitions, database clock, typed provider result and durable firstUncertainAt |
| Preview | Artifact and Previewed | Private exclusive filesystem persistence of the frozen message |
| Failure visibility | Fixed reason/category and operator status | Persisted typed outcome, never arbitrary exception metadata |

### Critical test scenarios

* Existing Notification/seed rows never enqueue retrospectively; producer replay and failure at any DB step preserve atomicity. AC-1, AC-2, AC-10.
* Off produces no provider traffic; Preview is private/bounded; Catch-all never includes an original recipient; Live cannot arm with bad origin, missing allowlist, catch-all leftovers or unsafe config. AC-2, AC-3.
* Preference and leave suppression, mandatory security exception, OWNER/MANAGER/HR basis, manager-to-HR change, changed reporting/business, pending approval after freeze, absence of relief retargeting, exact body/link and age boundaries including WAT midnight. AC-3 through AC-5.
* Two workers, claim expiry, crashes before/after HTTP acceptance, failed outcome persistence, same-key replay, payload mismatch, provider 429/5xx/timeouts and retry/window exhaustion. Timeout followed by explicit rejection, opt-out, stale address, configuration change or expiry retains first uncertainty and ends Uncertain unless acceptance is confirmed. AC-6 through AC-8.
* Private CLI idempotency, forbidden retries, sanitized telemetry, disabled/full monitoring and provider configuration failure without losing business events. AC-9.
* Migration/seed twice on test/Neon; actual app Preview plus controlled provider Catch-all against authorized test addresses; positive and negative evidence, no real-staff fixture sending. AC-10.

## Build plan

1. Compose the plain text template from real registered events and the approved safety modes, using Preview for the first visible proof. AC-2 through AC-4.
2. Extend the delivery schema in one atomic, repeatable migration and preserve all old evidence. AC-6, AC-8, AC-10.
3. Add the transactional enqueue hook and explicit policy/snapshot validation to current producers. AC-1 through AC-5.
4. Implement the bounded app worker, provider adapter, claim fencing, recovery and private operations. AC-6 through AC-9.
5. Run meaningful Beta tests, real app Preview/Catch-all verification and sanitized failure monitoring. No live staff send is a test prerequisite. AC-1 through AC-10.

The Facade variant uses previewable final message content before enabling real delivery. A fake Sent result or sample Suppressed row is not provider integration proof. Feature 15 requires `/test` and `/check verify`; actual external Catch-all verification remains open if operator setup is unavailable.

## Consequences

Resend's bounded idempotency improves safe retry but cannot prove inbox delivery or unlimited deduplication. Durable snapshots retain private notification content and need protected storage/access. Running in the app avoids another service, while requiring a long-running host and shared worker budgets. No delivery occurs while that app is down; queued eligible work catches up after restart within the stated age/window limits.

## Follow-up

* Operator prerequisites before external verification: approved Resend account, verified sender domain, API key, authorized test inbox, canonical app URL and Live allowlist/arming. Architecture creates none of them.
* Optional Resend Agent Skill/MCP research is deferred at the engineer's request. No search/install/connect work is implied.
* Signed delivery/bounce/complaint webhooks, inbox-delivery claims, email preference links, reset/invitation mail, digests and scheduled reminders need later designs.
* Future domain features register complete policy/source/target constructors before adding their email events.
