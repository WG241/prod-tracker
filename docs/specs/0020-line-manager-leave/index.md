# 0020. Line Manager leave and cover

**Date**: 2026-11-03
**Status**: Accepted

## Summary

Let a Line Manager record their own leave and arrange dated review cover in one place. Preserve each cover arrangement and end its access promptly on replacement, revocation or return. Reuse the prototype and existing leave records with atomic evidence and safe retries. This design authorizes no development.

## Structure

* [Leave and cover writes](0020-leave-cover-writes.md) defines candidate, transaction, overlap and notification rules.
* [Reasoning](rationale.md) records the choices.
* Specs 0011, 0016 and 0019 supply owned leave, common manager commands and exact pending-review authority.

## Requirements

As a Line Manager, I want to take leave with clear cover and retain a trustworthy record of who could review for my team.

1. **AC-1**: Match `/line-manager/leave` Leave & cover, date/relief form, current leave summary and owned Leave history. Reuse approved Scheduled/Cancel, Edit cover/End cover, Previous cover and shared paged/search/failure controls beside the summary. Keep role navigation fixed.
2. **AC-2**: Record only own leave, without approval. Inherit today/future starts, start no more than 365 days ahead, exclusive return, 1 through 366 days initially, one coherent current/upcoming period, cancellation before start and I’m back from start with today as first day back. Same-day return records zero days. No Employee leave editing or new team leave list.
3. **AC-3**: Initial leave requires one eligible different Line Manager for the full interval, including cross-business cover. Candidate must be Active, have one current effective Line Manager assignment and no overlapping effective/planned leave. At most one officer covers a manager at an instant; an officer may cover several managers.
4. **AC-4**: A manager already covering another leave cannot book overlapping leave until that cover is replaced/ended. Validate both directions under locks, not only candidate search. Leave/role/account changes cannot leave a stale grant usable.
5. **AC-5**: Replacing cover ends the old arrangement and creates a new immutable arrangement atomically, with an expected current cover id to reject stale forms. New bounded cover may use a shorter remaining interval, defaulting to remaining leave and warning about uncovered dates. End cover revokes immediately even without a replacement and warns about the gap.
6. **AC-6**: Own cancellation/return ends related cover in the same transaction. Date expiry naturally removes authority even without a background job. Record actual actor/instant and retain prior cover/decisions. Never rewrite permanent manager relationships or approved decision evidence.
7. **AC-7**: Leave and cover changes atomically commit audit, owner/relief officer/current business director/active HR notifications, eligible email rows and owned receipt. Deduplicate recipients. Missing optional recipients warn while saving; a selected officer becoming ineligible before a new grant rejects it. Any storage failure rolls back everything.
8. **AC-8**: New manager leave/cover stores immutable display snapshots. Owned history shows actual dates/days, completion/cancellation/early-return status and paged cover evidence. Preserve coherent legacy records without inventing missing historical names or treating their old Approved sample label as a leave approval workflow.
9. **AC-9**: All operations enforce fresh persisted authority, current dates, incoming cover, source-history guards and receipt/precondition rules under concurrent changes, WAT midnight and response loss. Ambiguous legacy configuration uses explicit repair state, never arbitrary selection or source rewrites.
10. **AC-10**: Shared retained draft/Retry/Reload latest, actor cancellation, focus/announcements and truthful known-save warnings work in both app modes. Meaningful real database/browser tests and separate NVDA/native zoom proof cover leave, grants, revocation, history and notifications.

## Decision

Extend the existing owned leave service for Line Managers and use append/end ReliefAssignment records. Reuse LeaveMutationReceipt for own leave and cover commands, with expected cover identity instead of another revision column. Keep cover as narrow dated pending-review authority through spec 0019.

**Implementation skills**: installed `develop`, `test`, `check` and `sync`; existing auth/accessibility/telemetry boundaries. No new provider, credential, service or background job.

## Rationale

See [rationale.md](rationale.md).

## Feature design

### Prototype and visible state

The manager Leave & cover form and owned Leave history were inspected live on 3 November 2026; existing relief form/current/Previous cover markup supplies the reused controls. The engineer approved exposing those controls beside the summary and reusing scheduled/cancel treatments. Do not invent a separate relief sidebar or Employee leave editor.

No current period shows the form. A future period is Scheduled, with the tracker still active until startsOn and Cancel leave available. Active leave pauses own work and decisions and exposes I’m back. Current cover summary states Scheduled, Active, Ended/Expired or Uncovered from actual intervals. When no eligible candidate exists, explain that initial leave requires cover and direct to HR; do not insert a fake/default colleague. Candidate selectors start with an explicit choice, not automatic commitment to the first person.

Edit cover defaults startsOn to max(today,leave.startsOn) and endsOn to exclusive leave return, then permits a narrower future/current interval within that remaining leave. Saving revokes the old arrangement immediately; a replacement starting later leaves an explicit warned gap. Dates before today and retroactive grant edits are prohibited. End cover revokes at the database instant, including scheduled cover, and does not end leave. When a gap exists show who can resolve it without claiming the absent officer still has access.

Owned leave history sorts startsOn/id descending, 25 per page, including completed/cancelled records. Days = max(0, actual/effective exclusive return minus startsOn), with cancellation before start = zero; count calendar dates, not working days. Status is Scheduled/On leave for current card and Completed/Returned early/Cancelled in history, derived from records, not a persisted approval flag. A history row displays recorded owner/role, last arrangement summary and arrangement count; reuse the Previous cover panel with pagination to inspect every arrangement. Do not silently display only the latest officer as if it were the entire leave's cover.

### Confirmed model and migration

| Record | Change / relationship |
| --- | --- |
| LeaveRecord | Nullable `contextSnapshot: Json`, immutable once set. Version 1 `{userId,displayName,role:'LINE_MANAGER',businessId,businessName}`. Required for new manager leave; NULL allowed on existing/Employee records. |
| ReliefAssignment | Nullable `contextSnapshot: Json`, immutable once set. Version 1 `{coveredManagerId,coveredDisplayName,reliefManagerId,reliefDisplayName,reliefRole:'LINE_MANAGER',reliefBusinessId,reliefBusinessName}`. Required on new cover. Existing leave/covered/officer FKs remain. |
| LeaveMutationReceipt | Extend operations for MANAGER_CREATE, MANAGER_CANCEL, MANAGER_RETURN, RELIEF_REPLACE and RELIEF_END, requiring existing actor/owned leave relationship and canonical hash. Result may include bounded new/ended cover ids and warning codes. |
| Existing records | Reuse date/terminal fields, notifications, immutable audits/decisions. No new table, revision or copied team membership. |

One additive atomic, idempotent migration adds snapshots, integrity guards and operation/index extensions. Snapshot ids must match their owning row/relationship; labels are safe bounded text. Do not backfill legacy labels from current User/business records, rewrite timestamps, modify decision FKs or remove history guards. Snapshot NULL is displayed as `Name not recorded`/`Role not recorded` where needed, with actual dates still readable. Current card/candidate labels may use current identity and are not represented as historical evidence.

Snapshot labels use trimmed well-formed plain text, no NUL, at most 240 Unicode characters per name/business label, with the existing Staff member fallback for an absent person name. Preserve full source identities by ids; truncate only display labels at a character boundary. Bound each snapshot to 8 KiB. Validate its version, enum, required fields and exact ids before reading it; invalid stored snapshots use the explicit unavailable-label treatment, never today's labels.

Relief identity, planned dates, linked leave and snapshots are immutable after insert; only first terminal endedAt/endedById may be set. Existing legacy rows remain coherent evidence. Normal writers serialize covered manager ownership and check effective overlap; no extension or nontransactional exclusion-index installation is required. Candidate availability checks also lock the officer so their overlapping own leave cannot win unnoticed.

### APIs

Prefix `/api/line-manager`, fresh own LINE_MANAGER authority, private no store. Own leave retains spec 0011's body/media/rate limits; cover uses the same guarded budget. All write inputs strict, UUID Idempotency-Key; no actor/covered-manager selector.

| Path | Method / input | Output / key errors |
| --- | --- | --- |
| `/leave` | GET no selectors | Clock/today, owned current period/card, current cover id/state/capabilities, repair state and warnings |
| `/leave/history` | GET `page` | 25 owned past periods with days/status/display snapshot, cover count/last summary |
| `/leave/:leaveId/cover-history` | GET `page` | 25 owned immutable arrangements, planned/effective dates and ended actor/time; common 404 |
| `/leave/relief-candidates` | GET `startsOn,endsOn,search,page` | Available Active Line Manager ids/names/business labels, 25/page, no private leave dates; 400, 401/403, 503 |
| `/leave` | POST `{startsOn,expectedReturnOn,reliefManagerId}` | Owned receipt/leave+cover ids/warnings; 400, 409 existing/incoming-cover/ineligible, 423 history protected |
| `/leave/:leaveId/cancel` | POST `{}` | Owned receipt and ended cover ids; 404, 409 transition, 423 history protected |
| `/leave/:leaveId/return` | POST `{}` | Owned receipt/first-day-back and ended cover ids; same errors |
| `/leave/:leaveId/cover` | POST `{expectedReliefId:string|null,reliefManagerId,startsOn,endsOn}` | Replacement receipt/new+ended ids/gap warning; 409 stale/unavailable, 404 owned target |
| `/leave/:leaveId/cover/end` | POST `{expectedReliefId:string}` | Receipt/end/gap warning; 409 stale/transition, 404 |

Register literal candidate/history routes before dynamic ids. Selector and write dates use strict real ISO date-only validation, Africa/Lagos and exclusive ends. Future candidates must cover the requested interval; exclude self, inactive/inconsistent role and overlapping leave, not a colleague's different business. Search bounds 120 characters. Do not expose emails, unrelated leave dates, private tasks or credentials in candidates. A domain-only eligible officer may be selected before auth provisioning, but return a fixed HR provisioning warning if not login-ready; no usable session/role bypass is created.

The current cover token is the one coherent latest unended arrangement attached to the owned current/upcoming leave, including a scheduled or naturally expired arrangement. No arrangement means NULL. More than one unended candidate is REPAIR_REQUIRED; do not pick one by newest date. Ended arrangements remain in history. The server rechecks this token under the owner mutex before any new replacement/end; receipt replay precedes new transition rules.

### Value sourcing

| Action | Value | Named source |
| --- | --- | --- |
| Own card | Scheduled/active, dates, cancellation/return capability | Existing owned leave classifier, database WAT date, terminal fields |
| Candidate | Identity/business and interval availability | Current Active User/assignment, current/planned effective leave and incoming cover locks |
| Grant | Covered manager, officer, full initial dates | Authenticated owner, validated candidate and committed leave interval |
| Replacement/revoke | New identity, expected token, immediate end, gap | Locked unended arrangement, supplied expected id/dates and databaseClock |
| History | Original names/role, days/status, cover count | Immutable snapshots, real leave date/terminal and related arrangement rows |
| Alerts | Recipients, event keys, content and warning gaps | Current locked owner/officer/director/HR resolution and successful domain event |
| Recovery | Safe original result, conflict and known save | Owned immutable LeaveMutationReceipt and retained actor-bound intent |

### Critical test scenarios

* Initial full cover, no candidate, same/different business, self, multiple covered managers, incoming cover overlap and simultaneous reciprocal selection/leave. AC-2 through AC-4.
* Replacement races with decision/end/another tab, same officer/new arrangement, shorter interval/gap, future replacement and immediate revocation. AC-5, AC-6, AC-9.
* Scheduled cancellation, same-day/early return, exclusive natural return, partial/full weeks and source history protection at midnight. AC-2, AC-6, AC-9.
* Missing director/HR/provisioning warning versus selected officer lost eligibility; failures at leave/cover/audit/notification/outbox/receipt; lost response replay. AC-7, AC-9.
* Snapshots/legacy fallbacks, multiple cover history pages, unchanged earlier decision attribution, no Employee editor or relief history leak. AC-1, AC-8.
* Retained failed draft, explicit stale reload, actor callback cancellation, both app modes and actual native accessibility. AC-10.

## Build plan

- [x] Match Leave & cover/history and compose approved cover, scheduled and shared state controls. AC-1, AC-10.
- [x] Add safe snapshot/receipt/guard migration while preserving old data and evidence. AC-8, AC-9.
- [x] Implement owned reads, paged history/candidates and atomic leave plus full initial cover. AC-2, AC-3, AC-4, AC-7.
- [x] Implement replacement/end/cancel/return with fresh scope, history guards and revocation. AC-5, AC-6, AC-9.
- [x] Integrate event/email policy, recovery and meaningful database/browser verification. AC-1 through AC-10.

## Consequences

Leave remains self service, but initial manager leave requires available cover and incoming commitments must be resolved first. Ending/replacing cover can deliberately create an uncovered interval with a warning. Immutable rows preserve the actual review authority timeline and require a small schema extension. Ambiguous legacy configuration needs explicit repair; this feature cannot silently rewrite it.

## Follow-up

* HR leave/relief administration is Feature 33. It must use the same locking, history and immutable evidence rules.
* Future HR assignment/deactivation writers must close affected cover when a covered principal or officer loses the required active Line Manager role, with audit and terminal events in that transaction. Current read/write resolvers already fail closed on lost eligibility, without waiting for that writer.
* No leave approval, team leave editor, auto-reassignment chain or automatic reminder job is introduced.
* Provider sending remains governed by Feature 15; no setup or external send occurs during architecture.
