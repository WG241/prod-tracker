# Employee leave rationale

## Context

The existing data model already stores leave without approval, exclusive return dates, cancellation and return evidence. Home already pauses task writes during effective leave, but its return control is disabled and the Leave route is unfinished. Feature 11 now protects historical assignment and leave contributions at the database boundary, so a new leave workflow must coordinate with capture and preserve those guards.

The Employee prototype was inspected live on 2 November 2026. It shows one two date form, one leave card and an immediate return action. Its future state and messages contain demo shortcuts: a future period is immediately called On leave, Employee success mentions a relief officer, and return promises a history table that the Employee page does not show. The confirmed design corrects these claims within the existing components.

The current worktree contains the earlier feature implementations without a new commit. This design uses that local scope and code. A Git refresh failed on a broken local Codex checkpoint reference; no history or checkpoint was repaired as part of feature design.

## Options considered

### Existing records with natural matching only

Use the current leave table and deduplicate by owner/dates/state. This is the smallest schema change, but a create retried after an early return could become a different new leave, and natural matching cannot prove which notifications already committed. This does not meet the requested response loss guarantees.

### Existing records with dedicated immutable receipts

Keep the established domain model and add the same evidence pattern as task mutations, scoped to leave. This makes ambiguous retries explicit and atomic with notifications and audit. It adds a small table and result validation but avoids a new lifecycle model, service or provider. This is the selected approach.

### Approval and editable leave requests

A pending/approved request model could support a broader HR process, but would contradict the confirmed direct recording flow and introduce review authority, queues and mutable date conflicts. Manager and HR workflows already have later scope features.

## Rationale

The user needs dependable absence recording, rather than another approval queue. One current/upcoming period matches the available Employee UI and makes the early return target unambiguous. The receipt carries request identity across both Home and Leave without adding an editable revision to a record whose only new transitions are permanent dated events.

User absence should not fail solely because an organisation notification recipient is misconfigured. Available recipients and the Employee still get durable rows, while a warning and audit preserve the missing manager/HR fact. Database insertion errors remain full failures, preventing partial communication evidence. New recipients are not silently retroactively added on a replay.

The existing date model cannot represent an afternoon return or part day absence. A same day return therefore produces an empty interval, as allowed by its existing constraints, while preserving both events. Returning removes only the leave pause; planning locks and freeze still decide task capabilities. Full leave weeks are excluded from expected participation, and partial weeks retain available days under the existing calendar helpers.

All writes use fresh database time after waits to agree with history source guards. Read Committed plus explicit locks follows the corrected task/capture design. A new broad Serializable convention or global User table fence would add contention and could preserve an older authorization snapshot across waits. Selected notification recipient rows are locked, and recipient discovery is explicitly a named snapshot rather than a promise to include later role changes.

No third party integration or new package is needed. Existing receipt/hash, auth guards, persistent rate limits, shared state treatments and source protection provide the required mechanisms. No separate References section is included, consistent with the preference used for the previous specs.

## Confirmed choices

* Start today through 365 days ahead; duration 1..366 calendar days with an exclusive return.
* One current or upcoming period. No Employee past leave table or date editor; retain every completed/cancelled record in the database.
* Cancel only before start; record today's WAT date as early return after start, including same day return.
* Use a Scheduled card adjustment and Cancel leave placement within the existing prototype components.
* Add LeaveMutationReceipt and retain the existing leave/notification/audit relationships. The assembled model was confirmed.
* Notify Employee, current manager and active HR for creation, cancellation and early return, atomically with each change.
* Save with explicit notification configuration warnings if manager/HR recipients are missing.
* Conflicting legacy periods show a repair warning and block ordinary leave changes; Home keeps its existing union pause.
* Reuse form errors, shared banners, Retry, toast and explicit Reload latest. Keep unknown outcomes tied to the original request.
* Enable Home's existing return control through the same operation. Do not grant an unlock, edit a task or change account status.

## Integration evidence

Independent review found a source-week lock wait after date validation could cross WAT midnight. On 3 November 2026 the engineer authorized completing the correction and proceeding into development. The write sequence now prelocks source weeks and checks clock/authority after the guarded source write, rolling back and retrying a changed day before evidence commits. The history guard itself remains unchanged. The reviewer found no other material design omissions. Content is confirmed; lifecycle remains In Progress until the build and required verification close.

The read only scout confirmed the integration points: `server/employee/write-context.ts` for owner/session locks, `reads.ts` for persisted principal checks, `calendar.ts` for combined leave pause, `write-router.ts` for request guards and limits, `writes.ts` for receipt/audit/notification composition, `server/db.ts` for nested driver codes and UTC sessions, and the Feature 11 source guard migration. The task receipt's composite task FK prevents reusing it for leave.

The existing Notification model already supports leaveId and recipient/deduplication uniqueness; seeded LEAVE_RECORDED rows establish the notification kind. Existing source triggers retain cancellation and actual return once set. No ordinary request may bypass those constraints. Employee eligibility remains active domain employment plus real session authority; being on leave is separate from deactivation.
