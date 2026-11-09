# 0015. Email worker and failure handling

## Summary

Keep durable attempts in PostgreSQL and external HTTP outside database transactions. Use leases to coordinate workers, stable provider keys to handle duplicate network requests and explicit uncertainty when that guarantee is no longer usable.

## State machine

* A new factory event becomes QUEUED when renderable/eligible, SUPPRESSED for expected policy/Off reasons, or FAILED for an explicitly enabled but invalid mail configuration.
* QUEUED → SENDING atomically increments attemptCount, sets lastAttemptAt, an owned random lease token and expiry. First external claim sets firstAttemptAt once.
* SENDING → SENT only on accepted Resend id, setting sentAt and providerMessageId. SENT does not mean delivered/read.
* Preview SENDING → PREVIEWED only after private artifact persistence. Preview never calls Resend and does not set sentAt/providerMessageId.
* A known transient rejection returns to QUEUED with the next scheduledAt. Known permanent rejection becomes FAILED, and expected lost eligibility becomes SUPPRESSED, only if no earlier acceptance remains unresolved.
* An ambiguous external outcome sets firstUncertainAt once with the database clock, atomically with its outcome transition. It may return to QUEUED for the exact key/payload while the safe window and attempt budget remain. When they do not, it becomes UNCERTAIN and never automatically retries.
* Before policy/expiry evaluation, expired external SENDING claims record firstUncertainAt if absent: a crash cannot prove that no HTTP request escaped. Recover using the same frozen provider key and payload. Never reset firstAttemptAt, generate a fresh key or increment attempts merely to finalize a confirmed old result.

firstUncertainAt is durable first evidence, never cleared or overwritten. A subsequent explicit rejection, new claim or policy/configuration change does not prove that an earlier request was not accepted. Only a confirmed acceptance for the identical key/payload resolves the uncertainty through SENT; retain the timestamp as history. No provider reconciliation endpoint is assumed. While unresolved, a terminal rejection, lost eligibility, expiry, attempt cap or configuration stop becomes UNCERTAIN rather than FAILED/SUPPRESSED. Do not perform a policy-forbidden replay solely to resolve an unknown outcome. A preview filesystem error cannot create provider-acceptance uncertainty because Preview performs no external call.

Every outcome write compares id, SENDING state and exact leaseToken. A stale worker cannot change state after another claimant takes over. Terminal Sent/Previewed/Uncertain/Suppressed records cannot be requeued by ordinary code. The private safe-retry command accepts only known-not-sent retryable Failed states with firstUncertainAt NULL, before expiry, below the same attempt cap and with unchanged configuration/payload. It adds System audit and a conditional state update atomically; repeating it while already Queued is no change.

## Loop, claim and locks

Use one scheduled loop per app process, no overlaps. Wake after a newly applied domain commit, at startup and every 30 seconds. A pending wake coalesces rather than spawning a pass. Stop new admission immediately on shutdown. Admit at most 10 deliveries and 20 seconds of work per pass; one active provider request per process, at least one second between external starts. Bound HTTP to eight seconds and claim/finalization transactions to existing database limits. A shutdown grace of 12 seconds permits the current bounded attempt to finish; otherwise leave its durable claim for recovery.

Scan due valid new-schema rows and expired claims using indexed deterministic schedule/id order and SKIP LOCKED. Never sweep old notifications, seed Suppressed rows or legacy deliveries without enqueuedAt/sendable metadata into the sender. Derive each due decision from fresh database time. A pass with no usable mail configuration does not create or alter business events.

Within a short claim transaction lock the selected delivery, its recipient User in share mode, current assignment/preference and relevant policy rows in deterministic order. Recheck policy after waits and establish dispatch authorization, then commit the claim. Profile/leave writers coordinate on that User, so a policy change is ordered before or after authorization. They must not mass-update existing delivery rows while holding the User mutex; the worker applies suppression, avoiding reverse lock order. Read the immutable notification/message snapshot without acquiring a notification row lock merely to render it.

Before external dispatch, verify claim ownership/live lease and the original retry/expiry/configuration boundary. Release all DB locks before HTTP. Changes after dispatch authorization cannot recall that in-flight send; later claims see them. A DB outage prevents a new send if ownership/policy cannot be established. After an HTTP result, persist only with the owned lease comparison. If persistence fails after acceptance, the stored SENDING claim is intentionally recovered using the original key.

Lease expiry is two minutes, longer than the bounded HTTP and database outcome work. Multiple app processes coordinate through the database; worker-local flags alone are not exclusion. A process paused past its lease must revalidate before dispatch or finalization. Do not represent this as an absolute exactly-once guarantee under arbitrary process suspension or provider expiry.

## Retry boundary

At most five provider attempts. After transient outcomes use delays of 30 seconds, two minutes, ten minutes and one hour, respecting a provider Retry-After if longer. A Retry-After beyond the safe deadline is not a reason to cross it. The key is `workforce/email/v1/<deliveryId>`, and payloadHash uses a fixed canonical encoding of the frozen from/to/subject/text/workspaceUrl send fields.

Never start an external attempt at or beyond firstAttemptAt plus 23 hours, or the message's age expiry, whichever is earlier. The 23-hour cap leaves margin within the provider's documented 24-hour idempotency period. A provider idempotency-in-progress conflict is transient; a same-key payload conflict is an integrity failure requiring review, not a reason to rotate keys. Classify responses through a fixed adapter allowlist: 429 and known 5xx are retryable; validation/authentication/sender rejection is permanent; connection loss/timeouts with unknown acceptance retain unknown semantics. Do not parse arbitrary provider messages into logs.

Once attempts/deadline are exhausted, any unresolved earlier ambiguity or expired external claim becomes UNCERTAIN, regardless of the latest rejection. With no uncertainty evidence, exhausted explicit rejection becomes FAILED; expiry or lost policy becomes SUPPRESSED with its fixed reason. A queued never-attempted row past its age limit becomes SUPPRESSED/EXPIRED, with a required-security expiry diagnostic. Do not claim that an Uncertain message was never sent.

## Configuration and mode changes

The snapshot, recipient basis and transport mode/revision are immutable. Sender, catch-all, application origin, provider account/key scope or delivery configuration changes require a new EMAIL_TRANSPORT_REVISION. Never send an old catch-all snapshot as a new live message. Mismatched configuration suppresses a row with no unresolved acceptance; a potentially attempted unresolved row becomes Uncertain for review instead of using a new provider scope. Recover an expired external claim into uncertainty evidence before making that choice.

Global Off pauses dispatch of existing claims/queues and suppresses newly created events. It cannot cancel a request already in flight. Before rotating provider account/key scope, pause admission and resolve attempted rows or let their safe window close; provider deduplication cannot be assumed across credential/account changes. The operator must bump the transport revision when changing that scope. No API key is stored to make a different-scope retry appear safe.

An invalid enabled configuration fails closed for mail, emits a fixed diagnostic and retains failed delivery metadata for new events. No fallback from catch-all/live to another external mode is allowed. Missing queue tables or failed delivery inserts are database failures and roll back the owning domain transaction. No attempt is silently dropped because monitoring is disabled.

## Provider and operator boundary

Use only the fixed Resend HTTPS send endpoint, an Authorization secret from server configuration and the stored idempotency key. Persist the typed returned email id as acceptance proof. No browser-controlled endpoint/from/to/headers, no raw provider response storage and no signed webhook endpoint in this feature.

Private diagnostics report a bounded page of delivery ids, state, kind, attempt/time and fixed reason; mask addresses and omit content. Preview artifacts can be inspected privately by the operator through their filesystem permissions, never downloaded through app HTTP. Retain the existing .local and Vite filesystem denial rules and test both development/production access paths.

Safe retry is explicit and has no force flag. It uses conditional state/attempt/firstUncertainAt checks and one idempotent System audit key per delivery/attempt counter. No retry of a seed, pre-feature row, Sent, Previewed, Suppressed, Uncertain, unresolved-acceptance, expired, changed-payload or changed-transport row is provided. A separate reviewed reconciliation would be needed for those cases.

## Rationale

Leases prevent conflicting database outcomes but do not undo an already accepted network request. Keeping one frozen request and key permits bounded recovery without inventing a stronger provider guarantee. Terminal uncertainty and restricted operators protect against duplicates after the guarantee expires, while the outbox preserves business success during provider failure.
