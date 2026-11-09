# Owned manager leave and cover writes

## Summary

Record leave, grant/end cover and persist notifications as one unit. Serialize incoming and outgoing commitments so simultaneous managers cannot assign unavailable cover or retain expired authority.

## Candidate and overlap rules

Use effective date intervals `[startsOn,endsOn)` with database Africa/Lagos date. A new officer is a different Active person with exactly one current effective LINE_MANAGER assignment, canonical identity consistent if provisioned, and no effective or planned leave overlapping the requested cover interval. Cross-business officers are allowed. Candidate discovery is only a hint; command validation under locks is authoritative.

An incoming assignment matters only where its original linked leave, planned cover and terminal evidence can confer cover. Clip to effective leave/actual return and explicit endedAt; cancellation removes future cover. Check existing/future incoming commitments when creating the officer's own leave. Allow an officer to cover multiple managers, but reject overlapping effective arrangements for the same covered manager. Current ambiguous leave/cover evidence is repair state rather than arbitrary selection.

Discovery fixes candidate ids, then locks selected User/assignment and related leave/relief rows in deterministic order before reevaluation. Own leave and officer availability writers coordinate on the same User mutex/locks. Concurrent reciprocal selections can deadlock; bounded confirmed-rollback retries must lead to one valid winner or a safe conflict, never two overlapping unavailable commitments. Do not add a broad User table lock or infer a colleague's leave details into a candidate response.

## Transaction and receipts

1. Normalize exact input/key and operation-specific hash. New manager leave includes reliefManagerId in its intent; replacements include supplied expectedReliefId, candidate and date interval. Keep these separate from existing Employee operation hashes. Reuse actor/UUID owned LeaveMutationReceipt and restrictive leave FK.
2. Acquire owned manager User mutex, fresh persisted session/identity/assignment, selected permission/candidate locks and affected leave/relief/source-week locks. Follow spec 0011's source-week prelocking before the final date checks. Include incoming cover sources; never suspend history guards.
3. Check a matching receipt after fresh actor authority and before new transition/time rules. Replay returns the original safe result/warnings without another grant/end/event. Key mismatch is 409. A prior no-change matching cancellation/return has only a receipt, with no repeated terminal event.
4. Capture fresh databaseClock after waits. Recheck one coherent owned current/upcoming period, candidate availability, incoming obligations, horizon/span, expected cover token and exact current date. Initial cover is the full leave interval. If the owner is currently on leave, own cover/return actions remain permitted; their work/approval actions stay paused.
5. Create manager leave and its immutable display snapshot plus initial full cover and snapshot in one transaction. A missing selected officer is a hard conflict, not an optional recipient warning. For replacement, set the old row's first endedAt/endedById to the current instant, then create the new row; require startsOn >= today, endsOn > startsOn, within remaining leave and <= expected return. New grant cannot be backdated before createdAt: effective authority always also requires createdAt <= asOf. An identical existing officer/interval may return no change with a receipt instead of manufacturing a new arrangement.
6. End cover sets only first terminal time/actor and never changes leave. Cancellation before start and return from start use the existing exclusive-date semantics, setting leave terminal evidence and ending all coherent associated unended cover in the same transaction. Natural date expiry needs no mutation to revoke access. Preserve planned interval and actual terminal time separately.
7. Resolve and lock recipients, insert typed notifications/outbox and one command audit recording before/after leave/cover ids, snapshots, request id, actual instant and fixed warning codes. Insert one owned receipt. Recheck clock/day and time-sensitive authority after guarded writes; WAT day change rolls back and retries the whole known-rollback unit, at most three attempts.
8. Commit before acknowledging/waking mail or emitting fixed telemetry. Provider failure cannot undo committed leave. Missing actual storage/audit/receipt/notification/outbox is a transaction failure, not a saved warning.

Result version 1 includes operation, requestId, leaveId, appliedAt, changed, current cover id/new id and ended ids, actualReturnOn where applicable, and warning codes. Arrays are bounded by the coherent one-current-arrangement model. Do not put raw snapshots, addresses, session data or current permissions in receipts. On replay a fresh read supplies current card/access independently.

## Notifications and email eligibility

For each changed event resolve owner, relevant new/ended officer, current business director and active HR, deduplicating User ids. Initial leave's LEAVE_RECORDED message includes its granted officer/dates and links the leave plus cover; do not add a redundant second initial assignment alert. Cancel/return use LEAVE_CANCELLED/RETURNED and include ended cover context. Independent cover create/replacement uses RELIEF_ASSIGNED, and ended/replaced old arrangement uses RELIEF_ENDED. Keys are the existing leave event key or `relief:<arrangementId>:assigned|ended`; recipient uniqueness gives retry safety. Replacement emits old-ended and new-assigned evidence as separate real events. Notify both old and new officers where distinct.

All are workflow LEAVE class: obey email preference but do not suppress solely because the recipient is on leave. Freeze exact message/address and create only for new events, never re-email seeded/history records. Initial full-cover selection must remain eligible; unavailable optional director/HR or ended officer yields fixed saved warning codes. Domain-only recipients can receive in app rows; login readiness warnings do not create credentials or bypass auth.

Extend the spec 0015 recipient-basis registry with closed variants, keeping version 1:

* MANAGER_LEAVE_OWNER: sourceUserId = leave.userId = recipient; matching leave ownership/current Active address. Own manager Leave target requires current LINE_MANAGER role; otherwise target unavailable.
* BUSINESS_DIRECTOR: freeze sourceUserId, sourceAssignmentId, recipientAssignmentId and businessId. Recheck source's current business and recipient's sole current BUSINESS_DIRECTOR assignment match that business. Do not redirect a queued old message after transfer.
* RELIEF_OFFICER: freeze sourceUserId, exact reliefAssignmentId and recipientAssignmentId. Recipient must still match that immutable officer relationship and Active address. Assigned notices require the related arrangement not ended/cancelled or past return at claim; ended/cancelled/returned notices validate the immutable terminal event instead of demanding still-active authority. A revocation message does not grant review access.
* HR: retain the existing HR basis, current effective HR role and original recipient identity. Owner scope proof comes from the exact leave/arrangement record.

Recipients/labels always come from locked persisted records, never request names or email values. Message title/body use fixed English event text, recorded owner/officer labels and actual dates, within Notification bounds. Director/HR destinations remain unavailable until their owning role features provide authorized handlers. Officer target is their own Approvals queue, with fresh current role and exact dated authority for any linked request; a scheduled/ended notice alone opens no covered records.

No automatic per-request backfill occurs when cover starts or changes. A new assignment notice plus current queue exposes outstanding eligible work. New completion events during active cover are routed by spec 0019. Before every email attempt recheck current eligible recipient basis/address/preference; if sending must stop after unknown acceptance, preserve firstUncertainAt and use Uncertain, not false Suppressed/Failed.

## History and authority

Current cards/candidates use fresh labels. Historical snapshot fields are immutable once inserted, nullable only for legacy/other-role rows, and never reconstructed silently. An ended arrangement cannot be edited or deleted because decision evidence may reference it. Inspecting past cover gives no current team access.

Every review read/command uses the spec 0019 effective resolver, including createdAt <= asOf, related leave, half-open dates and early end/return/cancellation. Hold covered/officer permission locks through decisions so an earlier decision is valid and a later one is rejected. HR writers must follow the same lock/evidence order. No stale browser capability or already-read notification can extend access.

## Rationale

Immediate explicit revocation is a stronger operational boundary than editing an old interval. Retaining each arrangement preserves who could act and which exact row justified a decision. Owned leave receipts and expected cover identity provide recovery without another table or revision field.
