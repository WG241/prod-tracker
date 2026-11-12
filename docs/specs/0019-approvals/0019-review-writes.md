# Exact request authority and decisions

## Summary

Review a specific immutable submission, not whichever task version happens to be latest. Scope, revision, decision evidence and side effects share a short database transaction.

## Authority resolver

Resolve the exact request/task/owner/tracker relation, latest attempt by attemptNumber, state PENDING, no decision, visible task with canonical AWAITING_APPROVAL and the supplied revision. A missing, withdrawn, hidden, stale-attempt or outside-authority detail is 404; a changed precondition on an otherwise authorized submitted command is 409. Never silently substitute another attempt.

Require an Active source owner with one current Employee assignment and an Active current Line Manager covered principal in the same business. request.assignedManagerId must equal that Employee assignment.managerId. Permanent actor is that principal, with current matching business. Relief actor has one current LINE_MANAGER assignment and may be in a different business. Require exact relief.coveredManagerId = routed principal; relief.leaveId owned by that principal; relief.createdAt <= asOf; WAT day within `[startsOn,endsOn)` and related effective leave; and asOf before endedAt/cancelledAt when present, with actualReturnOn taking precedence. Ambiguous overlapping effective cover is unavailable/repair, not an arbitrary first row.

Keep readable review scope separate from work capability. An actor on leave may still see their otherwise scoped pending records, with workPaused and disabled decisions/comments; no empty queue claim replaces that pause. A new decision/comment additionally requires the actor not effectively on leave. WORK email likewise applies its recipient leave suppression. Queue, detail, write and email use this same resolver with an explicit read/write/mail purpose, never unrelated copies of its scope predicate.

For pending reviews this resolver is independent of `canReadTask('historical')`. A newly assigned manager or effective relief reviewer can see the exact pending submission, even when another manager owns the frozen reporting week. It grants only its submission fields and linked review conversation. It does not expose the owner's other records or private manager work. Once pending authority ends, relief detail is denied. Current permanent/historical reporting reads remain separately scoped.

If the routing pointer disagrees with current reporting, fail closed and surface routingUnavailableCount and a scoped unavailable state for a provably current team pending item. Do not expose the unproven submitted text. Never mutate routing during GET or conceal the unavailable item as a reliable empty queue. The trusted `reroutePendingRequests` integration accepts a transaction, Employee id and newly valid assignment/manager. Future HR assignment writes must close/open assignments, update only pending assignedManagerId pointers, retain original submission fields and record routing audit in that same transaction. That owning HR feature must define its new routing-event producer and recipient policy; no historical request-email replay is implied here. Tests arrange transfers through this contract. No guessed latest manager, background blanket reroute or public repair API is added.

## Atomic command

1. Apply wrapper guards and normalize input. Hash operation/path, exact request ids, revisions and decline reason. Batch requires 1 through 25 distinct requests for one Employee; normalize item order by request id before hashing/locking. No body selects actor, decision method, covered manager or relief id.
2. Acquire source owner mutex then permission/session/assignment/week/task/request/relief locks in the foundation order. For a batch lock every task/request deterministically. Resolve fresh actor authority before receipt lookup; matching receipt returns original safe result without new effects. Key mismatch is 409.
3. Capture fresh database clock after waits. Resolve all current authority and preconditions. Actor leave blocks a new decision; Employee leave does not block another authorized review. Planning closure and week freeze do not invalidate review. Snapshot/source corruption prevents a confident decision rather than being repaired in place.
4. Create one immutable HUMAN decision per request, permanent or relief fields as specified. Set request DECIDED and canonical task APPROVED/DECLINED; increment each task revision once. Preserve every submitted/content/context field. Decline reason is trimmed well-formed Unicode, 10 through 2000 JavaScript string units, no NUL. No fake In progress/progress percentage is written.
5. Insert per-decision actor audit, deduplicated owner notification and eligible outbox record through the typed factory. Store one safe command receipt. Batch commits all items/evidence in one transaction. A failure anywhere rolls back all items. Same decision timestamp across the batch; actual decision ids remain distinct.
6. Recheck time-sensitive authority after any awaited permission/source work before commit. For relief, a lease/interval/session/leave boundary crossed during a wait rolls back rather than applying an old permission instant. Use at most three known-rollback retries, never an unknown commit retry. External mail and telemetry happen after domain commit only.

The safe result contains version, operation, requestId, appliedAt, changed and item mappings `{approvalRequestId,decisionId,taskId,taskRevision}`. An individual response is a one-item mapping; batch is at most 25. Never store target access, body text or full private records as a receipt result. After replay compute badge/target companions with fresh current scope, or return unavailable without undoing the committed decision result.

## Conversation and event checks

Permanent managers may comment on current direct-report tasks through the shared team command. Relief uses only an exact still-pending request comment route. Both require current week before freeze and actor not on leave. Read-only historical review conversation does not reopen after freeze. Reuse existing TaskComment, not an editable decision reason or invented Employee note record.

Manager comment recipients are the task owner. Every new Employee reply notifies the eligible current permanent manager, including on a current nonpending or Approved task. Additionally notify effective relief only for that task's exact pending request. Use recipient locks and canonical factory keys; exclude author/self and duplicate recipients. No manager-owned private task participates in this team recipient resolver. Replays of existing Employee comment receipts create no new events. Current producer integration adds notifications only to newly committed comments. The umbrella's REVIEW_REQUEST/TEAM_TASK/OWN_TASK mapping is the authoritative in app target contract, independent of email policy.

Approval email eligibility uses this exact pending authority predicate without requiring a provisioned auth session for an otherwise eligible domain recipient. Domain User/account/assignment/address consistency still applies. At dispatch evaluate current leave and preference, never a queued stored permission result. Outcome mail remains owner-only. Preserve spec 0015's sticky first uncertainty on every suppression/terminal stop.

## Rationale

Immutable attempt identity and task revision protect a reviewer's intent. A separate pending-review scope supports late review and temporary cross-business cover while keeping historical team reporting and private work protected. All-or-none batches are easier to recover than partially applied client loops.
