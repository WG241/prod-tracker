# 0019. Approvals

**Date**: 2026-11-03
**Status**: Accepted

## Summary

Let a Line Manager review exact submitted attempts for their team and pending work covered by an effective relief assignment. Commit decisions, outcomes and alerts together. Late review changes the reported result without rewriting frozen content. This Beta design authorizes no development.

## Structure

* [Review writes](0019-review-writes.md) defines authority, atomic decisions, batching, routing and event integration.
* [Reasoning](rationale.md) records the choices.
* [Manager foundation](../0016-line-manager-dashboard/0016-manager-foundation.md) supplies common clocks, guards, receipts and reporting distinctions.

## Requirements

As a Line Manager or effective relief reviewer, I want to make a clear decision on submitted work and preserve what was reviewed.

1. **AC-1**: Reuse the prototype's grouped Dashboard queue, per-Employee Review dialog, task drawer, decline reason, Approved/Declined and Blockers views. Add the approved Awaiting tab using those existing components. No new sidebar item or percentage workflow.
2. **AC-2**: Awaiting defaults to all pending workweeks, with optional person/week filters and 25-row pages. Group by Employee, show exact request counts, oldest wait and configured overdue status. The navigation badge counts distinct eligible Employees across weeks and refreshes on foreground plus visible 30-second summary checks.
3. **AC-3**: A permanent reviewer must still be the routed current manager of the Active Employee in the same business. Effective relief may cross business but grants only pending routed requests, submitted details and related conversation. No private manager drafts, unrelated tasks, general team history or leave records are exposed.
4. **AC-4**: Recheck fresh actor/session/role, current reporting, leave, exact request, revision and relief interval at decision time after lock waits. Actor leave pauses decisions and comments. End/cancel/return, expiry or lost role immediately removes relief authority for new actions.
5. **AC-5**: Approve/Decline records one immutable HUMAN decision for that exact attempt, with real actor and covered manager/relief assignment when relevant; ends the request; updates canonical task outcome/revision; and commits audit, owner notification, eligible email and receipt atomically. Decline requires 10 through 2000 trimmed characters and results in canonical DECLINED, with explicit Employee revision/resubmission.
6. **AC-6**: Permit a still-authorized pending review after week freeze. Preserve title, activity, dates, original submission snapshot, frozen reporting context and eligibility. Later reads and status filters report the actual latest outcome and decision instant, never a backdated approval.
7. **AC-7**: Approve all covers only the displayed exact request ids for one Employee, at most 25, with their supplied task revisions. All commit or none do. A stale, withdrawn, already-decided or unauthorized item rejects the whole batch; later arrivals and other pages are untouched.
8. **AC-8**: Current permitted comments persist with real authors and notify the relevant other party. Employee replies notify current permanent manager and effective relief for the exact pending request, excluding self/duplicates. Frozen conversation remains read only, independently of late decision permission.
9. **AC-9**: Actor-owned receipts protect individual/batch decisions and manager comments under response loss/retry. Conflicts retain the submitted intent; explicit Reload latest discards it. Poll counts without reordering focused lists. Scope changes invalidate target reads even on receipt replay.
10. **AC-10**: Beta tests, real development/production verification and distinct native accessibility evidence prove concurrency, revocation, rollback, reporting outcomes and in app/email integration. No live staff send is a test requirement; Feature 15 controlled verification prerequisites remain.

## Decision

Use existing ApprovalRequest/Decision and task revisions with explicit review scope, not the general historical task read policy. Extend SharedMutationReceipt for LM_APPROVE, LM_DECLINE and LM_APPROVE_BATCH. Reuse the shared event/outbox factory. Build one exact-request authority resolver for queue, detail, decisions and relevant email policy.

**Implementation skills**: installed `develop`, `test`, `check` and `sync`; existing authentication/accessibility/telemetry context. No new library, provider, secret or service.

## Rationale

See [rationale.md](rationale.md).

## Feature design

### UI and selection

Live prototype review and decline dialogs were inspected on 3 November 2026. Approved exceptions are Awaiting tab reuse, bounded selectors/list pages and shared failure states. The prototype Approvals page currently shows decision history and blockers, not its pending Dashboard queue. The added Awaiting tab closes that gap without replacing the existing composition.

Awaiting is initial tab, week ALL, person ALL. The shared week selector contains All pending weeks and actual scoped Monday choices. Header week/range controls and selector are one selection state, not competing filters. A single-week header action sets that week; This week sets current Monday; clearing week returns ALL. A range selects overlapping workweeks, bounded to 366 days. Do not reset ALL to current on foreground revalidation.

Approved/Declined lists show immutable decision attempts, including earlier declined attempts after resubmission, with current-team or recorded historical scope as appropriate. A relief reviewer does not retain general decided-work scope after their pending decision. The result acknowledgement can name their newly created decision, but subsequent target/detail reads need fresh scope. Blockers use current permanent-team scope, never a relief-wide task list. Sort pending groups oldest wait/id, requests submittedAt/id, decided attempts decidedAt/id descending and blockers startsOn/id. Counts are full filtered totals.

Per-Employee Review dialog pages at most 25 pending requests. Approve all label says the displayed count; it is not an implicit whole-person/all-page operation. After any committed decision refresh that page and badge without losing focus. If the last item disappears, focus the existing dialog heading/empty treatment. Opening nested task/reason content uses the shared single-overlay coordinator and restores the logical initiating control or surviving heading.

Review title/activity/dates/owner come from immutable submissionSnapshot, with current routing labels explicitly current. Never replace submitted content with an Employee's newer draft. Show Employee note only from a real owner-authored TaskComment created no later than submittedAt, labelled as that comment; omit the section when absent. Do not present the prototype's fallback sentence as an actual Employee statement. Current conversation separately shows its persisted authors/timestamps.

### Confirmed model and migration

Reuse existing task/request/decision/comment/leave/relief records and immutable request/decision guards. No new approval entity or revision column. Receipt result is bounded and actor-owned, not task-owner FK based. One additive atomic idempotent migration extends the shared operation check/indexes without changing old receipts or evidence. Preserve original request assignment/submission fields and permit only its existing routing/state changes.

Decision changes only task.status to APPROVED or DECLINED and revision once, alongside its request state. The automatic method is forbidden on these HTTP routes. A HUMAN permanent decision uses actorId and NULL principal/relief. A HUMAN relief decision uses actorId, actingForManagerId and exact reliefAssignmentId. All fields use one fresh database decision instant. Existing unique(requestId) and one-pending-per-task constraints remain the final race protection.

### APIs

Prefix `/api/line-manager`, current LINE_MANAGER authority, common private/strict guards. See child for exact command semantics.

| Path | Method / input | Output / key errors |
| --- | --- | --- |
| `/approvals/summary` | GET no selectors | `{asOf,nextChangeAt,employeeCount,requestCount,routingUnavailableCount,workPaused}` for all currently scoped pending work; 401/403, 503 |
| `/approvals` | GET `tab,personId,week` or `from,to`, `page`; tab Awaiting default | Group/history/blocker page, totals, normalized selection and capability reasons; 400, 401/403, 503 |
| `/approvals/people` | GET same tab/period, `search,page` | Scoped person option page only |
| `/approvals/requests/:requestId` | GET `commentPage` | Exact submitted detail, current revision, authority mode, conversation and capabilities; common 404, 503 |
| `/approvals/people/:personId/pending` | GET optional week/range, `page` | Up to 25 currently eligible exact attempts with revisions for Review dialog; common 404 |
| `/approvals/requests/:requestId/approve` | POST `{expectedTaskRevision}`, UUID | Safe LM_APPROVE receipt; 409 stale/key/request, 423 actor leave, 404 unauthorized |
| `/approvals/requests/:requestId/decline` | POST `{expectedTaskRevision,reason}`, UUID | Safe LM_DECLINE receipt; 400 reason, 409/423/404 |
| `/approvals/approve-batch` | POST `{items:[{requestId,expectedTaskRevision}]}`, UUID | Safe receipt with request/decision ids and appliedAt; 400 duplicate/size/mixed-owner, 409 any stale, 404/423 |
| `/approvals/requests/:requestId/comments` | POST `{body}`, UUID | LM_TASK_COMMENT receipt with exact task/request binding; 400, 404, 409, 423 frozen/leave |

Positive safe pages, size 25. Extend person selectors and week choices using existing paged/search controls. Validate selectors once, reject unknown/duplicate fields, no public actor/manager/relief authority inputs. Shared 32 KiB command ceiling and rate budgets apply. Store supplied revision in canonical receipt hash, even if stale. Response includes safe committed ids and fresh separately authorized capability/count companions, never a frozen authorization grant in a receipt.

### Event and email integration

Human decision creates APPROVAL_APPROVED or APPROVAL_DECLINED for task owner, key `approval-decision:<decisionId>`, task and exact request link. Title identifies outcome; body names submitted task, actual decision and, for decline, the recorded reason. Fixed text fits Notification bounds. Method/actual reviewer appears accurately in detail; no notification says relief became the permanent manager.

After a frozen-week decline, the old record remains Declined and cannot be edited/resubmitted in that closed week. Any further work belongs in an editable current-week record under the existing task rules. Do not promise that a late decision reopens planning or creates a continuation automatically.

Email WORK owner basis requires current Active owner/address, own task relationship, workflow preference and no effective leave. A read notification does not cancel eligible email. Do not notify the deciding actor about their own action. Provider sends remain outside the domain transaction, with spec 0015's new-events-only and uncertainty rules.

Extend the completion producer to also address the effective relief reviewer when a new APPROVAL_REQUESTED event is created during active cover, using its exact reliefAssignmentId and the existing per-recipient request natural key. The permanent manager retains their in app row; their work email is suppressed on leave. Never replay old request events when cover starts. RELIEF_ASSIGNED supplies the new arrangement notification and the live pending queue exposes existing work.

This feature explicitly extends spec 0015's initial permanent-only approval-mail contract with RELIEF_REVIEWER basis: sourceUserId, sourceAssignmentId, businessId, coveredManagerId and exact reliefAssignmentId. At every mail claim require the same pending attempt/routed covered manager, current Employee reporting and active effective cover/officer; no general historical-read permission is inferred. Existing assigned-manager basis keeps its current checks. Ended cover suppresses unsent work mail, or stops Uncertain if prior acceptance remains unresolved.

### In app notification actions

Extend spec 0014's closed action union with `REVIEW_REQUEST {requestId,taskId,week}` and `TEAM_TASK {taskId,week}`. Week is the persisted tracker WorkWeek Monday, never parsed from title/body. Selection still marks only the owned message read; target permission is a fresh companion on every response/replay and again at the destination read.

| Recipient/event | Action and current checks |
| --- | --- |
| APPROVAL_REQUESTED to manager/relief | REVIEW_REQUEST for the notification's exact request/task pair, only while pending and within the current read-purpose review resolver |
| TASK_COMMENTED addressed to task owner | OWN_TASK, through the fresh Employee/Line Manager own dispatcher from spec 0017 |
| TASK_COMMENTED addressed to a reviewer, with exact request reference | REVIEW_REQUEST under that same exact pending scope; never substitute a later resubmission |
| TASK_COMMENTED addressed to permanent manager without request reference | TEAM_TASK, using current direct-team or validated frozen recorded-manager task scope; relief grants no fallback |
| APPROVAL_APPROVED/DECLINED addressed to owner | OWN_TASK with exact persisted task/week; no review permission granted |

REVIEW_REQUEST creates a short actor/role-bound open intent, navigates to `/line-manager/approvals` with Awaiting and the persisted week, fetches `/approvals/requests/:requestId`, verifies matching task/week and opens the existing task detail drawer with its exact approve/decline capabilities. It does not depend on finding the request in the first list page. The detail supplies the safe owner id for the person selection. A currently paused actor may read with disabled actions. A withdrawn/decided request, unproven legacy link or lost scope returns UNAVAILABLE with fixed text, without disclosing denied target data or opening a later attempt.

TEAM_TASK similarly navigates to `/line-manager/team-history` with the authorized detail's owner/week and opens the existing team task drawer after a fresh `/team-tasks/:taskId` read. Bind the intent to actor generation; clear on acknowledgement, superseding navigation, sign-out or authority change. Check generation after body decoding. No stored message URL, automatic approval/comment or private browser persistence is allowed. If destination access changes after the read action committed, preserve the read acknowledgement and show unavailable/Retry according to the actual result.

### Value sourcing

| Action | Value | Named source |
| --- | --- | --- |
| Queue/badge | Scoped Employees/requests and grouping | Pending exact requests through current permanent/relief resolver |
| Wait/overdue | Days and overdue flag | Database asOf minus submittedAt in whole 24-hour periods; current TrackerSettings.overdueApprovalDays |
| Review | Submitted text, owner/date/week and optional note | Immutable request snapshot; real owner TaskComment before submittedAt |
| Authority | Permanent versus relief, expiration and pause | Current assignments, assignedManagerId, related leave and exact relief interval, actor leave/session |
| Decision/batch | Outcome, actual actor/principal/relief, instant, revision | Validated input/preconditions, fresh locked records and databaseClock |
| Outcome/history | Canonical reported status and immutable decision | Same transaction's task outcome and request/decision evidence |
| Retry/feedback | Original safe result, fresh scope/count, conflict | Shared actor receipt, current authorized reads and operation lifetime |
| Message target | Exact review/team/own action and destination | Owned Notification relationships, persisted tracker week, fresh scoped resolver and actor-bound open intent |

### Critical test scenarios

* Current manager, reassignment, stale routing, cross-business relief, unrelated task/draft, owner inactive and relief scope expiry. AC-2 through AC-4.
* Two reviewers, same/different keys, Employee revise/withdraw/resubmit race, unchanged comment versus changed content, exact attempt rather than latest substitution. AC-4, AC-5, AC-9.
* Atomic 25-item batch, duplicate/mixed-owner/26th item, stale middle item, later arrival and lost response. AC-7, AC-9.
* Late decisions after freeze update original week/status filters without any content/roster change; frozen comments denied. AC-5, AC-6, AC-8.
* Cover end/return/cancellation or actor leave during lock waits; failures injected into each task/request/decision/notification/email/audit/receipt step. AC-4, AC-5, AC-10.
* Visible polling does not reorder focused rows; correct Employee messaging/replies, restored dialog focus, both app modes/native accessibility and controlled mail modes. AC-1, AC-8 through AC-10.
* Message selection/replay opens an exact request outside page one, handles withdrawal/decision/role change, routes ordinary nonpending replies to team detail and never gives relief a team-task fallback. AC-3, AC-8, AC-9.

## Build plan

1. Match Review/reason/drawer and decision/blocker views, then compose approved Awaiting tab and shared states. AC-1, AC-9.
2. Extend receipts safely and implement one exact-request permanent/relief resolver plus paged projections. AC-2, AC-3, AC-4.
3. Build atomic individual/batch decisions and post-freeze outcome behavior. AC-4 through AC-7.
4. Integrate comments, replies, request/outcome events, email policies and current targets. AC-3, AC-5, AC-8, AC-9.
5. Run Beta database/browser tests and real app verification, including live integration with available safe email modes. AC-1 through AC-10.

## Consequences

Pending work remains reviewable across weeks and transfers, while frozen reporting ownership stays recorded. Relief is intentionally narrower than permanent team access. Batches are predictable but reject as a whole when one item changes. The queue, email worker and writes must share one explicit authority contract without turning GET into repair.

## Follow-up

* HR assignment writers must call the trusted pending-routing contract in their assignment transaction; no unrestricted reroute endpoint is added here.
* Feature 20 supplies manager cover changes. Until then current dated seed arrangements can be read/reviewed through the same resolver.
* Beta requires `/test` and `/check verify`; manual accessibility/provider prerequisites remain explicit when unavailable.
