# 0016. Line Manager dashboard

**Date**: 2026-11-03
**Status**: Accepted

## Summary

Give a Line Manager a trustworthy view of their team, outstanding reviews and missing submissions. Reuse the prototype with real scoped data and manual reminders. This design authorizes no development or external email sending.

## Structure

* [Manager foundation](0016-manager-foundation.md) defines shared scope, calendar, command and event boundaries used by Features 16 through 20.
* [Reasoning](rationale.md) records the choices.

## Requirements

As a Line Manager, I want to see where my team needs attention and give an actionable next step.

1. **AC-1**: Match `/line-manager/dashboard` in the prototype: week/range controls, four metrics, grouped approval queue, six-week trend with chart data, missing submitters, blockers and recent activity. Keep role navigation unchanged.
2. **AC-2**: Only permanent direct Employee reports enter team reporting. Current weeks use current assignments; frozen weeks use valid recorded attribution. A relief assignment grants no general dashboard/team scope. Own manager tasks are excluded.
3. **AC-3**: Support a selected week or an inclusive range of at most 366 days. Range metrics cover whole overlapping workweeks. Use expected Employee participation and approved completion definitions from spec 0002, including full leave exclusion and zero denominators.
4. **AC-4**: Incomplete or unreliable frozen roster coverage makes the affected aggregate Unavailable, never a false zero or partial percentage. Preserve readable valid individual records and scoped availability feedback.
5. **AC-5**: Queue, missing-person, blocker and activity results are bounded, paginated and stably ordered. Counts cover the full selection. Links preserve the intended employee/week/request and recheck permission. No hardcoded people, percentages or event text is presented as live evidence.
6. **AC-6**: Remind creates one in app WORK_REMINDER and its eligible email delivery atomically with audit/receipt. Permit only a current expected direct report with no visible task who can still add one, including applicable unlocks. Do not remind during effective leave, after freeze, from a past selection or while the acting manager is on leave. Limit to one recipient/week/WAT-day across all senders and request keys.
7. **AC-7**: Blocker Comment opens a scoped current task drawer and appends an actual manager comment before freeze. It cannot edit Employee task content. Notify the Employee through the shared event contract. Manager leave pauses work writes; read access remains.
8. **AC-8**: Reads are consistent, private and side effect free. Commands use fresh persisted authority, safe receipts and atomic rollback under concurrent submission, reassignment, clock changes or response loss. A retry never sends another reminder or appends another comment.
9. **AC-9**: Use approved shared loading, empty, stale, error, Retry, explicit Reload latest and toast states, search/pagination and actor cancellation. Support keyboard/focus, chart text, small screens, native zoom and screen reader verification.
10. **AC-10**: Meaningful separate database and browser tests plus real development/production verification prove source values, scope, limits, rollback and recovery. Architecture completion does not close existing verification gates.

## Decision

Reuse React, Express, PrismaPg and the existing auth/calendar/snapshot services. Add small Line Manager projection and command modules, not a new reporting store or service. Share these manager boundaries through the child contract; preserve Employee routes and role checks.

**Implementation skills**: installed `develop`, `test`, `check` and `sync` workflow skills. Existing auth, accessibility and telemetry context applies. No new dependency, configuration secret or hosted service.

## Rationale

See [rationale.md](rationale.md).

## Feature design

### Prototype and selection

The live Line Manager Dashboard, My tasks, Team history, Approvals review/decline dialog and Leave screens were inspected on 3 November 2026. Source: `docs/workforce-prototype-updated.html`. Dashboard groups pending requests by Employee, its approval metric counts Employees, and its navigation badge is the same kind of person count. The prototype has sample inconsistencies; its data is not an authority source.

Default to the database current Monday. Previous/Next move the Monday anchor and clear a range; This week uses server time. Future selection is allowed for navigation but returns NOT_OPEN and no invented expected or missing people. Date range applies to whole Monday through Friday workweeks intersecting it; weekends alone select no workweek. Display the normalized included weeks with the existing supporting text. The trend contains six Mondays ending at the selected anchor, or last included range Monday, clipped to the current week.

Team members is distinct scoped Employee identities in the included weeks, including people on full leave. Submission trend is submitted expected person-weeks / expected person-weeks. Completion is approved / eligible tasks belonging to person-weeks with positive expected days. Eligible excludes hidden, Cancelled and Awaiting approval. In progress counts canonical IN_PROGRESS tasks, without conflating Declined. Round percentages to nearest integer; empty reliable denominator is zero. Individual unavailable weeks make combined metrics unavailable and produce gaps, not zero points, in the trend.

Current pending-review counts are operational, derived through spec 0019's current reviewer resolver, even for a frozen task week. Reporting scope and operational review authority are separate. The Dashboard selection restricts this preview; the Approvals page defaults to all pending weeks. Before Feature 19 is built, Review/View approvals can navigate to the existing scaffold with a clear unavailable action treatment; Feature 16 does not claim to implement decisions.

### Confirmed data model

| Record | Change / relationship |
| --- | --- |
| Notification | Nullable `workWeekId: String` FK WorkWeek.id, restrictive deletion, index. Required on new WORK_REMINDER, with no task/leave/relief/approval target. Other existing event rows remain unchanged. WorkWeek has many notifications. |
| SharedMutationReceipt | Extend allowed operations with LM_REMIND and LM_TASK_COMMENT. Existing `(userId,requestId)` key belongs to the actor; require nonsecret requestHash, targetNotificationId NULL. No new table. |
| Existing domain records | Read User, assignments, weeks, trackers, tasks, requests/decisions, leave and notifications. Append TaskComment/AuditEvent; no persisted derived counters. |

One additive atomic, idempotent migration adds the week link, receipt operations and required indexes/guards. Preserve messages, readAt, snapshots and old receipts. New field is nullable for legacy rows, with no backfill. Seeds preserve existing notification/delivery history and never send mail.

### APIs

Use `/api/line-manager` with fresh LINE_MANAGER authority and no store headers. The foundation defines common guards and envelopes.

| Path | Method / input | Output / key errors |
| --- | --- | --- |
| `/dashboard` | GET `week` or paired `from,to`; optional `approvalPage,missingPage,blockedPage,activityPage` | `{asOf,timezone,currentWeekStart,nextChangeAt,selection,metrics,trend,availability,approvals,missing,blocked,activity}`; 400 selectors, 401/403, 503 |
| `/team-tasks/:taskId` | GET `commentPage` | Scoped task, owner/week, latest review, conversation page, comment capability; common 404, 503 unavailable history |
| `/team-tasks/:taskId/comments` | POST `{body}`, UUID key | Safe shared receipt with commentId; 404, 409 key/scope conflict, 423 frozen/leave |
| `/reminders` | POST `{employeeId,week}` real Monday, UUID key | Safe receipt with notificationId, changed, suppression/already-reminded result; 404 outside current team, 409 no longer actionable, 423 closed/leave |

All pages default 1, size 25; only documented parameters once each. Dashboard sections may initially present the prototype's small preview, but shared pagination makes every matching record reachable. Count before safe offset calculation; out of range has no offset query. All source/count/page queries in a Repeatable Read transaction run sequentially.

Queue groups sort oldest submittedAt, then Employee id; requests retain exact attempts. Missing people sort normalized name/id. Blockers sort startsOn/createdAt/id. Recent activity combines immutable ApprovalDecision events for the selected team scope and addressed leave notifications whose target owner/week is in that scope, sorted occurrence time/id descending. Use fixed summaries from request submissionSnapshot and immutable notification text, not raw AuditEvent JSON or invented sample activity. Read and unread notices both qualify; account/security notices do not. Date attribution for leave is its overlap with included workweeks, with createdAt as the occurrence instant.

The team detail read initially supports current direct reports and is extended by spec 0018 for frozen context. A current manager view never renders the prototype's false frozen banner for an open record. The drawer reuses existing components and has no Employee edit/status/delete/carry controls.

### Value sourcing

| Action | Value | Named source |
| --- | --- | --- |
| Period | Monday, cutoffs, asOf, next boundary | Database clock, WorkWeek, settings and existing calendar helpers |
| Scope/labels | Person, unit/business/manager | Current effective assignment or validated frozen tracker context |
| Cards/trend | Membership, submission, completion, In progress | Scoped person-weeks, expected days, visible tasks and canonical reviewed outcome |
| Queue | Group count, task count, oldest wait/overdue | Exact eligible pending requests, submittedAt, current overdueApprovalDays; elapsed complete 24-hour days |
| Missing/blockers | Names, no-submission status, reason | Expected days, absence of visible tasks, task.status/blockerReason |
| Activity | Summary and occurrence | Persisted decision/submission snapshot or owned leave Notification snapshot |
| Reminder | Target week, daily boundary, content/key | Validated current week, database WAT day, fixed template and recipient/week/day natural key |
| Comment/retry | Author/time/id/result | Authenticated actor, database clock, inserted comment and immutable receipt |

### Critical test scenarios

* Current/frozen reassignment, full/partial leave, carried and Cancelled work, reliable zero, incomplete roster and future periods. AC-2 through AC-4.
* Mixed ranges, six-week gaps, distinct members versus person-week rates, independent pagination and out of range pages. AC-1, AC-3, AC-5.
* Same/different reminder UUIDs, transferred manager, submission/leave/unlock/midnight races and no second event on response-loss replay. AC-6, AC-8.
* Scope-substituted task id, manager leave, frozen comment, comment rollback and owner-only alert. AC-7, AC-8.
* Keyboard/chart data, focused list stability, stale actor responses, production/development and actual native accessibility evidence. AC-9, AC-10.

## Build plan

1. Match Dashboard and approved shared states from the live prototype. AC-1, AC-9.
2. Add the week relationship/receipt extension safely; implement shared manager authority/reporting projections. AC-2, AC-3, AC-4, AC-8.
3. Wire real cards, trend, scoped sections and detail reads. AC-1 through AC-5.
4. Implement atomic reminder/comment commands and notification policy integrations. AC-6, AC-7, AC-8.
5. Prove values, boundaries and recovery on the real app and separate test database. AC-1 through AC-10.

Follow Facade ordering, then finish on migrated seeded PostgreSQL. Do not accept simulated reminders or fixed metrics as completion.

## Consequences

One consistent scope/calendar layer supports later manager features. Historical aggregates may be unavailable until roster capture finishes, while valid rows stay readable. Reports can change when late decisions arrive, without rewriting their recorded context. Manual reminders add durable evidence and policy checks, but no scheduler.

## Follow-up

* Features 17 through 20 extend this foundation in separate builds. Feature 19 enables review actions; Feature 20 provides cover management.
* Automatic reminders, exports and broad relief team browsing remain outside scope.
* Existing open native accessibility gates are not waived.
