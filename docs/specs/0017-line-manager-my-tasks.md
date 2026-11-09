# 0017. Line Manager my tasks

**Date**: 2026-11-03
**Status**: Accepted

## Summary

Let a Line Manager manage their own weekly deliverables with the existing task lifecycle. Completing their own work records automatic approval in one transaction. Other Line Managers and relief officers do not gain access to these private tasks. This is architecture only.

## Context

The manager My tasks route is a scaffold. Employee task reads, commands, carry behavior, conflict handling and historical snapshots already exist. Spec 0002 explicitly requires automatic manager completion, and the prototype explains leadership visibility. A sample lookup bug must not be copied into real ownership checks.

## Requirements

As a Line Manager, I want to keep my own work current without putting it in my team's human approval queue.

1. **AC-1**: Match `/line-manager/my-tasks`, the manager notice, List/Card views, week/range controls, Add/Edit/status/blocker/carry/delete controls and the owned drawer from the prototype and existing Employee components. Keep the approved status-only progress dialog and fixed navigation.
2. **AC-2**: Every own read and write requires task.ownerId and tracker.userId to equal the actor. No other manager, covered manager or relief officer can read private drafts through these routes. Current/frozen owner labels and availability follow specs 0008 through 0010.
3. **AC-3**: Inherit the existing task rules: current week only for new writes, captured planning/manual lock/unlock and freeze boundaries, actor leave pause, planning closure blocks create/title/date/carry/delete, and current Approved work allows conversation only. Future/range/history inspection remains read only.
4. **AC-4**: Completed atomically creates a numbered DECIDED request, immutable AUTOMATIC APPROVE decision and Approved task outcome, with audit and owned receipt. The request retains the manager's submission context, assignedManagerId is NULL and the decision has no human actor, covered principal or relief id. Never create a human pending queue item.
5. **AC-5**: Preserve all approved date/text/carry limits and independent continuation semantics from spec 0009. A carry appears immediately in the next week, and undo requires its full untouched definition. No new percentage or review bypass flag is accepted.
6. **AC-6**: Task revisions reject stale forms; same actor/key/hash replays the exact committed result. Comments do not change revision. Failure at any persistence step rolls back task, approval evidence, continuations, audit and receipt together.
7. **AC-7**: Manager completion creates no redundant self workflow alert. Real current own comments persist with the real author; manager-owned work does not notify unrelated managers or relief recipients. Leadership reads remain subject to their separately authorized role features.
8. **AC-8**: Reuse retained-draft Retry/Reload latest, actor-bound pending operations, cancellation, known-save versus failed-refresh handling and accessibility treatments. Secrets and private drafts never enter browser storage.
9. **AC-9**: Tests and real development/production verification prove automatic approval, ownership, planning/leave/freeze, carry, rollback and response loss without regressing Employee completion into auto-approval.

## Options considered

1. Duplicate Employee services and replace one status. Straightforward initially, but duplicated authority/lifecycle code can drift and miss automatic evidence.
2. Share the typed own-task core with explicit role-specific completion policy and separate protected routes. A small extraction is needed, but preserves one task lifecycle. Chosen.
3. Send manager work to another reviewer. Gives human sign-off but contradicts the accepted model and prototype.

## Decision

Reuse the Employee task lifecycle through a narrowly typed own-task policy for EMPLOYEE and LINE_MANAGER. Keep separate route authority and explicit completion behavior, never a caller-supplied role or autoApprove value. Follow [manager foundation](0016-line-manager-dashboard/0016-manager-foundation.md).

**Implementation skills**: installed `develop`, `test`, `check` and `sync`; existing shared accessibility/auth context. No dependency, secret or new hosted service.

## Rationale

Own task dates, carry and retries have already been settled and tested. Reusing that core is simpler than maintaining two implementations, while explicit completion policy prevents a manager role from accidentally bypassing Employee review. Automatic decisions remain real evidence rather than a cosmetic Approved badge.

## Feature design

### Confirmed model and state

No new entity or field is required. Reuse User/current assignment, WorkWeek, WeeklyTracker, TaskSeries, WeeklyTask.revision, TaskComment, ApprovalRequest, ApprovalDecision, AuditEvent and the owned TaskMutationReceipt FK/key. Manager roles already qualify for personal tracker snapshots. Do not author an empty schema migration; add indexes only if justified by the introduced query plan.

Working states and editability inherit spec 0009. On Completed, lock the current owned source and exact role, then create the next attempt with immutable version 1 title/activity/dates, ownerId/displayName, weekStartsOn and submitted state. Create DECIDED request and AUTOMATIC decision, set canonical task status APPROVED and increment revision once. For the submission snapshot record AWAITING_APPROVAL as the submitted evidence state, as with the existing attempt shape, while making clear no human review was requested. Method AUTOMATIC and actor/principal/relief NULL distinguish the outcome. Audit uses the authenticated manager as the command actor even though the decision reviewer is System. Use one database instant.

An already Approved completion cannot create another attempt; same key returns the original receipt. An inconsistent legacy pending request on manager-owned work returns a fixed repair/conflict state rather than manufacturing a human or erasing evidence. No auto-repair GET or retroactive auto-approval of old records.

Own task comments cannot grant team review authority. Other Line Managers are denied even if they share business/unit, and relief never expands to the covered manager's work. Later director/HR reads use their existing business/org policy, not this own endpoint. The UI must not repeat the prototype bug where a clicked own task resolves an Employee record with a colliding sample id.

Extend the notification OWN_TASK dispatcher to use fresh current role and ownership: Employee Home for EMPLOYEE, My tasks for LINE_MANAGER, otherwise unavailable until an authorized own handler exists. Retain exact persisted task week/id and the frozen detail contract. This supports a former Employee reading their own retained task outcome after promotion without exposing another manager's work.

### APIs

Prefix `/api/line-manager`, fresh LINE_MANAGER authority, no store. Reuse the exact normalized input and If-Match revision contract of spec 0009 for own task commands, plus UUID Idempotency-Key.

| Path | Method / input | Output / key errors |
| --- | --- | --- |
| `/my-tasks` | GET `week` or paired `from,to`, `page,attentionPage` | Server clock/selection, current permissions, tasks/attention pages, leave/availability; 400, 401/403, 503 |
| `/my-tasks/:taskId` | GET `commentPage` | Owned detail, current/frozen context, latest immutable decision and conversation; common 404, unavailable snapshot 503 |
| `/my-tasks` | POST title/activity/dates/carry, per spec 0009 | 201 owned receipt; 400, 409 key, 423 planning/freeze/leave |
| `/my-tasks/:taskId/edit` | POST approved editable fields + revision precondition | 200 receipt; 409 stale, 423 |
| `/my-tasks/:taskId/status` | POST canonical working status or Completed action + blocker where required, revision | 200 receipt including automatic request id when completed; 409/423 |
| `/my-tasks/:taskId/carry` | POST carry flag + revision | 200 receipt/continuation id; 409 stale/in-use, 423 |
| `/my-tasks/:taskId/delete` | POST empty body + revision | 200 receipt with hidden source; 409/423 |
| `/my-tasks/:taskId/comments` | POST body | 200 receipt/comment id; 400 text, 404, 423 |

Do not silently rename Employee route paths when extracting common code. Role wrappers remain separate even if command functions are shared. Use the current Employee body/rate bounds and strict schemas, including its treatment of unsupported methods/media/fields. All list pages contain at most 25 rows, with safe offsets.

### Value sourcing

| Action | Produced/displayed value | Source |
| --- | --- | --- |
| Own list/detail | Text, dates, status, flags, review and labels | Owned task/series/tracker, exact latest attempt/decision, current or validated recorded context |
| Calendar/permissions | Selected Monday, planning/leave/freeze, next boundary | Database clock, persisted week/settings/unlocks and leave union |
| Edit/carry | Revision, continuation identity/dates, untouched state | Existing spec 0009 rules, source task and immediate next week's natural series/tracker key |
| Complete | Attempt number, snapshot, System approval and canonical Approved | Locked current task/assignment, next max attempt + 1, configured automatic policy and database instant |
| Feedback/retry | Safe original result and known/unknown state | Owned immutable receipt and actor-bound operation lifetime |

### Critical test scenarios

* Direct id substitution across managers, Employees, shared business and active relief; matching both ownership predicates. AC-2, AC-7.
* Concurrent Complete, changed role/session while waiting, stale revision, all automatic decision fields, injected evidence failure and response-loss replay. AC-4, AC-6.
* Planning closure, scoped unlock, leave/return, freeze, 366-day dates, independent carries and untouched undo. AC-3, AC-5.
* Employee still creates PENDING human requests, manager never does; legacy inconsistent request fails safely. AC-4, AC-9.
* Own dialog/drawer composition, retained drafts, stale callbacks, both app modes, keyboard/NVDA/native zoom. AC-1, AC-8, AC-9.

## Build plan

1. Inspect exact My tasks controls/drawer and compose with existing owned UI. AC-1, AC-8.
2. Extract the minimum typed own-task services while preserving Employee routes and guards; wire real owned reads. AC-2, AC-3, AC-5, AC-7.
3. Implement atomic automatic completion, receipts and audit with unchanged carry/edit contracts. AC-4, AC-5, AC-6.
4. Wire recovery and run separate database/browser regression plus real app verification. AC-1 through AC-9.

## Consequences

There is one task lifecycle with two explicit completion policies. Automatic approval is observable/auditable and does not create team queue noise. The extraction must retain Employee behavior and current historical snapshot rules. Private manager drafts remain outside other managers' and relief scope.

## Follow-up

* Feature 20 connects own leave controls; until then use the existing route/scaffold with truthful unavailable behavior.
* No human manager reviewer, custom percentages or leadership report page is introduced here.
