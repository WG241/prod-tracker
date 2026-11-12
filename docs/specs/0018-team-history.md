# 0018. Team history

**Date**: 2026-11-03
**Status**: Accepted

## Summary

Let a Line Manager inspect the current team week and reliable frozen records. Keep each Employee and week distinct, and retain the manager recorded at freeze. Reuse existing history evidence and controls instead of reconstructing past teams from today's reporting lines. This is architecture only.

## Context

The prototype has a Team history roster and Employee-week drill-in. Scope requires person/status filtering, while the sample has only search and dates and uses inconsistent participation flags. Existing immutable roster capture already supplies historical identity, scope and expected days, including zero-task weeks.

## Requirements

As a Line Manager, I want to review a person's week in its correct reporting context without changing their work.

1. **AC-1**: Match `/line-manager/team-history`, its search/week/date controls, roster table, View week and back navigation. Use approved person/participation filters, Week column for multiweek rows, 25-row pagination and shared availability/failure treatments.
2. **AC-2**: Default to the current week and include valid frozen weeks. Current rows are current permanent direct Employee reports; frozen rows belong only to the recorded manager. Reassignment does not move old records to the new manager. Relief grants no history scope and other managers' private tasks never enter results.
3. **AC-3**: One row is one Employee/workweek, including valid zero-task and excluded/full-leave cases. Participation uses persisted task presence and expected days, not the prototype's notSubmitted flag. Rates follow the common reporting contract.
4. **AC-4**: Support person/search, participation status and bounded date/week selection. Drill-in supports all canonical task statuses. Counts, labels, tasks and filters use the same current or recorded source within a transaction; invalid/outside-scope selectors never disclose people.
5. **AC-5**: Never treat missing/corrupt history as no submission. Valid snapshots remain readable during catch-up. Affected frozen aggregates/percentages are unavailable until coverage is reliable; banners expose only scoped availability.
6. **AC-6**: Drill-in shows the exact person's persisted week and owned tasks, captured context, latest decision and conversation. It has no create/edit/delete/carry/status controls. Current comments may use the authorized manager comment command; frozen conversation remains read only. A later decision changes the reported outcome without altering captured content/context.
7. **AC-7**: Reads create or repair nothing. Preserve all snapshot/audit/source guards, use current session authority, private no-store responses and common scope-safe errors.
8. **AC-8**: Preserve filters/back position through same actor revalidation, cancel old requests and close stale drawers on selection/authority changes. Failed reads retain clearly stale same-selection data, never an empty success. Provide keyboard/focus, announcements and native accessibility proof.
9. **AC-9**: Real separate database/browser tests and development/production verification cover scope transfers, zero-task history, late decisions, capture failure, ranges, filtering and navigation.

## Options considered

1. Filter old tasks by today's direct reports. Small query but reassigns past responsibility and can disclose the wrong team.
2. Current assignment for current rows, validated frozen context for history, with one person/week row. Reuses existing capture and preserves attribution; needs availability handling. Chosen.
3. Copy all history into a manager report table. Faster dedicated reads later but duplicates evidence and adds synchronization/repair work without a measured need.

## Decision

Reuse the [manager foundation](0016-line-manager-dashboard/0016-manager-foundation.md) and spec 0010's snapshot validation. Extend scoped reads, not the data model or capture lifecycle. No new schema migration is required unless an additive index is justified by the scoped query.

**Implementation skills**: installed `develop`, `test`, `check` and `sync`, shared auth/accessibility context. Existing stack, configuration and providers remain sufficient.

## Rationale

The engineer chose current plus frozen weeks, recorded historical manager scope, Employee-per-week rows, participation filtering followed by task filtering, and unavailable rather than partial historical rates. These choices preserve zero-task evidence and avoid mixing incompatible units or weeks into one row.

## Feature design

### Model and selection

Read existing User, assignments, WorkWeek, WeeklyTracker snapshot fields, WeeklyTask, exact review evidence and comments. No history record is duplicated. Capture remains spec 0010's app worker, never a GET side effect. Future weeks are NOT_OPEN, not missing submitters. Do not invent pre-tracking weeks.

The default anchor is current Monday; Previous/Next/This week follow the shared week control. A date range selects whole workweeks whose Monday through Friday overlaps the range, capped at 366 inclusive days. Person filter is an exact scoped User id; existing Search matches safe recorded/current display name and unit, case insensitive, bounded to 120 characters. Participation values are ALL, SUBMITTED, NOT_SUBMITTED, ON_LEAVE, NOT_EXPECTED. Positive expected days plus any visible task means Submitted, otherwise Not submitted. Zero expected days with full leave means On leave; other zero-day cases mean Not expected. An unavailable row has no fabricated participation/rate and does not become a status-filter match; availability remains visible regardless of status filter.

Sort rows week descending, then normalized captured/current display name and User id. Show Task count including visible Cancelled work, while completion uses only eligible tasks and expected participation. For reliable empty eligible denominator display zero; excluded participation uses the prototype's Excluded treatment. Person/week counts remain full selection counts. Selecting a row opens that same week, not the latest week or today's assignment.

### APIs

Prefix `/api/line-manager`, fresh role authority, Repeatable Read and no store.

| Path | Method / input | Output / key errors |
| --- | --- | --- |
| `/team-history` | GET `week` or `from,to`; `personId,search,participation,page` | Clock/normalized selection, roster page, availability and reliable summary; 400, 401/403, 503 |
| `/team-history/people` | GET same period, `search,page` | Scoped person option page `{id,label,unit}`, total/pageSize 25; no global directory |
| `/team-history/:personId/weeks/:week` | GET `status,page,attentionPage` | Exact authorized person-week context, tasks/attention pages and availability; common 404, unavailable evidence 503 |
| `/team-tasks/:taskId` | GET `commentPage` | Extend Feature 16 detail with valid historical context and latest review; common 404, 503 |

Only documented single parameters; ISO Monday/date/status validation and safe positive pages. All task predicates bind tracker owner and task owner. A forged person/week combination is indistinguishable from missing scope. Context remains frozen even if the current account is inactive or has moved; the viewer must still hold a valid Line Manager role. Current reads require current Employee scope. Historical detail checks the exact frozen tracker manager, not a broad current-person helper.

Person selectors use approved search/native selection and shared pagination, keeping selected id/label visible while paging candidates. Selector results derive only from reliable accessible records; they reveal no uncertain global people. After a filter change reset pages and close detail. Back restores the originating roster selection/page; session revalidation retains nonprivate selection but withholds old private data.

For a missing candidate snapshot, return a scoped unavailable placeholder only when historical membership is independently trustworthy under spec 0010's evidence rules. Otherwise show week-level availability without naming a guessed person. rosterCapturedAt is needed for reliable aggregate completeness; individual valid rows remain accessible without it. Corrupt data does not borrow current names, units or manager relationships.

### Value sourcing

| Action | Value | Named source |
| --- | --- | --- |
| Scope | Current or recorded manager/person membership | Effective assignments or validated tracker.contextSnapshot managerId/role |
| Roster | Name, unit, role, week, expected days | Current assignment/calendar or immutable context/expected-day snapshot and WorkWeek |
| Participation | Submitted, missing, leave or excluded | Positive expected days, visible task presence, trustworthy leave evidence; unknown stays unavailable |
| Completion/status | Approved/eligible and latest outcome | Canonical task status and exact latest immutable request decision, common denominator |
| Drill-in | Task text/dates, conversation, recorded owner | Exact owner/tracker/week relation and validated context; no sample lookup |
| Availability | Individual versus aggregate reliability | Snapshot validation, rosterCapturedAt, trackingStartsOn and capture evidence |
| Navigation | Page, filters, focus/back intent | Normalized server selection and actor-bound client state |

### Critical test scenarios

* Old manager retains frozen week after transfer; new manager sees current week but not the old frozen record; relief and same-business peer are denied. AC-2, AC-7.
* Captured zero tasks, full leave, partial leave, Cancelled submission, inactive historical owner and unknown/corrupt snapshots. AC-3, AC-5.
* Multiweek rows, one person in several units/weeks, person/status intersections, huge pages, reliable empty versus unavailable and late decisions. AC-1, AC-4 through AC-6.
* Exact week drill/back, stale filter response, role change during decode, frozen comments and both app modes/native accessibility. AC-6 through AC-9.

## Build plan

1. Inspect roster and exact Employee-week drill-in; compose approved filters/Week column/shared states. AC-1, AC-8.
2. Implement current and recorded scope/availability reads and paged person choices without capture writes. AC-2 through AC-5, AC-7.
3. Wire exact week/task drill-in, current comment capability and safe back/actor lifetime. AC-4, AC-6, AC-8.
4. Test and verify historical scope, outcomes and accessibility against real seeded data. AC-1 through AC-9.

## Consequences

History keeps recorded responsibility and supports empty weeks. More than one row per person may appear in a range, making the workweek explicit. Unreliable frozen aggregates remain unavailable rather than misleading. No new capture job, export or manager editor is introduced.

## Follow-up

* Approved/declined decision evidence arrives through Feature 19; no review mutation belongs in a history GET.
* Relief and team leave administration remain outside history scope.
