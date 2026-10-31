# 0008. Employee home and weekly board

**Date**: 2026-10-28
**Status**: Proposed

## Summary

Give Employees a clear view of their weekly work using the updated prototype's List and Card views. Read tasks, comments, review evidence, leave, and tracker controls from PostgreSQL. Use the real current week in Africa/Lagos and allow previous weeks, future weeks, and custom date ranges. Task changes stay in Feature 10.

## Context

Feature 9 is the first Employee journey feature. Its scope calls for the Employee's own tasks, clear empty and locked states, and prototype week navigation. The prototype pulled at commit `888d79d` renders Employee Home through the final `home()` function. That screen has List and Card views, a tracker status pill, and a Needs your attention section. Its older board function and metric cards are not the active Employee Home design.

The repository has the accepted data model and a working Express scaffold, but Features 4 and 6 remain unbuilt. Their specs already define the shared shell, components, authenticated identity, and role policies. Feature 9 may be designed now; implementation and signed in verification depend on those foundations. Do not silently build them in this feature or use a fictional actor as authentication.

The user confirmed the read only boundary, real WAT calendar, full date controls, separate weekly carry records, overlapping task dates for ranges, existing schema, two authenticated read endpoints, and a 366 day inclusive range limit. They approved minimal loading, error, Retry, and stale data states within existing surfaces. They also approved reusing the prototype pagination footer on Home and in the drawer, where those placements are absent from the prototype.

## Requirements

As an Employee, I want to inspect my work and its review context for a chosen period, so I can understand the week before changing tasks through Feature 10.

1. **AC-1**: A signed in Employee reaches `/employee/home` in their actual role shell. Home matches the final prototype Employee screen: greeting, week controls, tracker status, attention section when relevant, weekly tracker, List and Card switch, submission note, and support row. Do not restore superseded boards or metric cards. The fixed role navigation remains unchanged.
2. **AC-2**: Home reads only the caller's nonhidden persisted weekly tasks. List and Card show the same records, task count, canonical statuses, activities, dates, and carry flags. The attention section derives Blocked and Declined records and their actual reasons. No sample names, synthetic history, progress percentages, or fabricated approvals become live values.
3. **AC-3**: Initial Home and This week use the actual current Monday in Africa/Lagos. Previous and Next move seven calendar days. The date picker supports This week, Last 4 weeks, This month, custom From and To, Apply, Cancel, and Clear. A range includes tasks whose dates overlap it, retains each weekly record separately, and accepts at most 366 inclusive days. Invalid dates, reversed dates, and incompatible inputs are rejected clearly.
4. **AC-4**: Home distinguishes open planning, closed planning, frozen weeks, future weeks, custom range inspection, and effective current leave. Persisted cutoff and unlock evidence takes precedence for an existing WorkWeek. An absent week yields an empty tracker and calendar rules derived from settings, without creating rows on a read. Unlocks cannot open frozen or future weeks. A closed planning window still permits viewing tasks.
5. **AC-5**: Opening an owned task displays the prototype detail drawer with its status, title, owner, dates, activity, relevant blocker or decline reason, full task conversation with actual author names under the prototype's Manager comments heading, and actual approval evidence when present. Historical owner context uses the frozen snapshot. The drawer is read only in this feature; task creation, edits, status changes, comments, carry, deletion, and return from leave remain unavailable with clear explanations.
6. **AC-6**: Empty, loading, failure, and retry states are explicit. A same selection refresh failure may retain previously loaded tasks with a stale notice. It must not present an old period as the newly requested one. Session or authorization failures remove private cached content and follow Feature 6. Late responses cannot overwrite a newer selection or closed drawer.
7. **AC-7**: Both read endpoints enforce a current valid Employee session and task ownership on the server. Anonymous or unusable sessions receive 401, valid other roles receive 403, and missing, hidden, or someone else's tasks receive the same 404. Responses do not expose credentials, other staff records, raw snapshots, database errors, or invented role selectors. No domain mutation occurs through these endpoints.
8. **AC-8**: Home tasks and drawer comments use 25 records per page and the approved reuse of the prototype pagination footer. Counts and attention totals cover the entire authorized selection, not merely its current page. Keyboard, dialog focus, screen reader names, 320 CSS pixel layout, reduced motion, and 200 percent zoom follow the shared baseline.
9. **AC-9**: Lint, strict types, production build, and `/check verify` pass on the real database backed app in development and production. Verification covers seeded past weeks and the real current week, date and lock boundaries, denied access, empty and failure states, both task views, drawer evidence, pagination, and an actual visual comparison with the updated prototype. Neither this design nor a clean build alone completes Feature 9.

## Options considered

### Option 1: One Home response containing all task details

The simplest client could load tasks, comments, and review evidence together. It avoids a drawer request and makes opening a task immediate. Its cost is fetching long comment histories and detailed evidence for tasks the Employee never opens, with a larger response and more complex pagination. (basis: the prototype task drawer and the accepted relational model)

### Option 2: Home projection plus a separate task detail read

Load the period summary and one page of task entries, then load details only for an opened task. This keeps ownership checks and response contents narrow. The drawer needs its own loading, failure, and race handling. (basis: specs 0002 and 0005, least privilege, and the user's endpoint choice)

### Option 3: Complete the task lifecycle alongside Home

Building all visible task actions would immediately provide a usable editing journey. It would also combine two independently scoped features and require write transactions, approval transitions, and additional verification before Home could land. The user explicitly kept those actions in Feature 10. (basis: `docs/scope/employee.md` and the one feature rule in `AGENTS.md`)

## Decision

Choose Option 2. Implement a read projection (a response shaped for this screen) and a separate read only task detail endpoint using the existing React, Express, PrismaPg, and PostgreSQL stack. Reuse Feature 4's controls and Feature 6's session context and own person policy. Introduce no package, schema change, credential, service, or environment variable. (basis: root `AGENTS.md`, specs 0002, 0003 and 0005, and confirmed design answers)

Keep UI selection in component state as the prototype does. Use native browser fetch with cancellation and a request sequence check rather than a new data library. Read related counts and rows in a short Repeatable Read database transaction (one consistent snapshot) so a concurrent task update does not produce internally contradictory counts. The alternative is independent reads, which are simpler but can disagree within one response. These are implementation recommendations for the confirmed read surface.

## Rationale

The updated Home is a task inspection surface. Matching it requires using its final rendering functions rather than copying old CSS selectors or scope wording about a board. Separate detail reads keep Home inexpensive while preserving a direct mapping from its task buttons to the existing drawer.

The accepted weekly model already preserves carry lineage and frozen context. Reusing it avoids a second task identity or a synthesized history. A real clock makes the shipped app behave correctly after the sample dates; fixed examples remain reachable through navigation. Empty current weeks should not become writes just because someone viewed Home.

## Feature design

### Preconditions and design contract

Before UI implementation, Feature 4 must provide the shared shell, controls, and modal focus behavior, and Feature 6 must provide a real session, Employee route, and server policies. Their existing verification gates remain their own work. Feature 5's isolated data proof is not a substitute for an authenticated role endpoint. Features 7 and 8 remain separately scoped; adopt their completed shared facilities when available without claiming their broader acceptance criteria here.

Use `docs/workforce-prototype-updated.html`, its final `home()`, `taskList()`, `taskDetail()`, `weekControl()`, `dateRange()`, `pagination()`, and final navigation overrides. Supporting tokens are `docs/design-tokens.md`, `docs/typography-scale.md`, and the built Feature 4 `design.md`. Select Employee, Home, both views, date range dialog, task drawer, empty, closed, and frozen scenarios in an approved visual viewer before implementing the matching surface.

Visual inspection is not complete. The browser tool rejected the prototype's `file:` URL. Source reading is evidence for this design, not a completed visual comparison. Obtain an approved visual reference before building UI and do not bypass the browser restriction.

The user approved only these new placements or states: loading text, error with Retry, stale data notice in existing tracker and drawer surfaces, and reuse of the existing pagination footer there. Keep their existing typography, borders, spacing, and button variants. Do not add a new screen, illustration, navigation item, or error layout. Other missing visual states require approval before implementation.

### Existing data model

All primary and foreign keys below are required strings unless explicitly nullable. No migration or new field is required. Full constraints remain in spec 0002 and the applied migrations.

| Model | Read fields | Relationships and constraints |
|---|---|---|
| User | `id`, nullable `name`, `accountStatus` | Current identity comes from the session's Workforce User; no email is needed in task responses |
| EmploymentAssignment | `id`, `userId`, `role`, nullable business, unit and manager ids, effective interval | Dated assignments belong to User; effective current assignment supplies authorization and unlock scope |
| WorkWeek | `id`, `startsOn`, `planningLocksAt`, `freezesAt`, nullable `manuallyLockedAt`, `lockReason` | Unique Monday; referenced by trackers and unlocks |
| WeeklyTracker | `id`, `userId`, `weekId`, `assignmentId`, `contextSnapshot`, nullable `snapshotAt` | Unique user/week; assignment owner matches user; task owner matches tracker owner |
| WeeklyTask | `id`, `trackerId`, `ownerId`, `seriesId`, nullable `carriedFromId`, title, activity, start/end dates, status, nullable blocker, carry flag, nullable `deletedAt`, `createdAt` | Unique series/tracker; owner matches tracker and series; only rows with `deletedAt = null` are visible |
| TaskSeries | `id`, `ownerId` | Carry records share the same series; no merge or extra task is invented |
| TaskComment | `id`, `weeklyTaskId`, `authorId`, `body`, `createdAt` | Author joins User for display name; comments remain attached to their original weekly task |
| ApprovalRequest, ApprovalDecision | Task id, attempt number, submittedAt, state, submission snapshot, decision kind/method, nullable actor/covered manager, reason, decidedAt | One decision per request, one pending attempt; return only selected display evidence, not the raw submission snapshot |
| TrackerSettings | Singleton id, timezone, lock day/time | Timezone is Africa/Lagos; existing weekly cutoffs are not recalculated |
| PlanningUnlock | Week, scope/target, grantedAt, expiresAt, nullable revokedAt | Match exactly the declared person, unit, business or Everyone scope; existing constraints govern target shape |
| LeaveRecord | User, startsOn, expectedReturnOn, nullable actualReturnOn and cancelledAt | Effective interval includes start and excludes return, per spec 0002 |

### Calendar, selection and tracker state

Capture one server `asOf` instant at the start of each read. Use it for current identity, current date, leave, and unlock evaluation. Calendar arithmetic uses date only values in Africa/Lagos, not the browser timezone. Current week starts Monday 00:00 WAT. Saturday 00:00 WAT is the freeze boundary; Saturday and Sunday still belong to that Monday's week but are frozen.

Initial selection is the server's current week. Previous and Next change the selected Monday by seven days. This week clears a range and returns to the server's current Monday. Previous or Next during a range clears the range and moves from the last selected week; applying a range does not overwrite that anchor. Clearing a range returns to that anchor. A boundary refresh keeps that selected Monday fixed, including one originally selected through This week, while updating currentWeekStart and whether the selection is past, current or future. It does not silently navigate to a different week. Selecting a new period resets both task and attention pagination to page 1 and closes the drawer. List is the initial view, switching to Card preserves selection and page, and reload resets selection as in the prototype. Do not add a router dependency or persist private records in local storage.

Week selection filters by the task's tracker WorkWeek start, not by overlap with the next week. A future selection displays only persisted tasks for that future tracker and remains read only. Never project carry flags into synthetic future records.

A range is inclusive, from `from` through `to`, at most 366 calendar days. It filters owned visible WeeklyTask rows by `startsOn <= to AND endsOn >= from`, including records whose tracker began before the range. Each id appears once; different ids from a carried series remain separate. This week preset is current Monday through Friday, Last 4 weeks is current Monday minus 21 days through current Friday, and This month is the actual first through last calendar date of the current WAT month. Do not retain prototype hardcoded October values.

Order tasks by tracker week start ascending, task start ascending, createdAt ascending, then id ascending. Return 25 per page with a total matching the complete filtered set. The main count is that total. Attention includes only Blocked and Declined tasks in the same set, ordered identically, with its own independent 25 item page and total. Reuse the approved footer if attention needs multiple pages. Dismissing attention is local to the selected period and resets on a period change; it does not update database records.

For an existing week use its captured planningLocksAt and freezesAt. Before freeze, planning is open if there is no effective manual lock and `asOf < planningLocksAt`, or if an applicable unlock has `grantedAt <= asOf < expiresAt`, is not revoked at asOf, and expires no later than freeze. Manual locks apply when manuallyLockedAt is at or before asOf. Resolve scoped unlock targets from the caller's current effective assignment. A missing week derives its lock instant from TrackerSettings lock day/time and its freeze from Saturday 00:00 WAT, with no manual lock or unlock evidence. Do not create WorkWeek or WeeklyTracker on GET. Missing or invalid settings, including a derived planning lock at or after freeze, are a 503, not guessed permissions.

Week state returns startsOn, planningLocksAt, freezesAt, planningOpen, pausedForLeave, and a nullable manual lock reason. Home and detail also return nextChangeAt. Compute it as the earliest future planning cutoff, freeze, applicable unlock grant/expiry, leave start/return, or Monday rollover that could change the displayed state. Always include the next Monday of the current WAT calendar, even for frozen or range selections, so currentWeekStart cannot remain stale indefinitely. Range inspection has no single week state and uses closed display state; individual task details still use their own persisted week.

Only a current week before freeze may be open. Future weeks are not open. Prior weeks and custom ranges are inspection contexts, so the status pill is closed and their task actions remain disabled. Effective current leave pauses the current tracker and renders the existing leave banner. Keep planning openness and leave pause as separate response facts; do not erase the underlying lock evidence. A range uses a gray read only notice; past weeks use the frozen record banner and future weeks use the Week not open banner. Use truthful dates in those existing patterns. The fixed `Good morning` greeting follows the prototype and uses the caller's first display name, with `Staff member` as the existing fallback.

For the leave summary, exclude records cancelled at or before asOf, use actualReturnOn when present and expectedReturnOn otherwise, and retain the accepted half open date intervals. Merge overlapping or adjoining intervals into continuous intervals. If the current WAT date falls within one, pausedForLeave is true and the banner shows that merged interval's final return date. Otherwise pausedForLeave is false. This is a read calculation only; do not merge or change stored rows. The next leave transition comes from these merged intervals, preventing one overlapping row's earlier return from falsely resuming the tracker.

### API surface

| Endpoint | Method | Inputs | Outputs | Auth | Errors |
|---|---|---|---|---|---|
| `/api/employee/home` | GET | Optional `week` as a Monday `YYYY-MM-DD`, or both `from` and `to`; optional positive integer `page` and `attentionPage`, default 1 | asOf, timezone, currentWeekStart, normalized selection, selected week state when applicable, leave summary, task and attention pages with totals | Feature 6 valid current Employee session | 400 INVALID_INPUT, 401 SESSION_REQUIRED, 403 FORBIDDEN, 503 SERVICE_UNAVAILABLE |
| `/api/employee/tasks/:taskId` | GET | Required opaque task id, optional positive integer `commentPage`, default 1 | asOf, task fields, own historical display context, week state, blocker/decline evidence, latest review evidence, comment page with total | Same session, task owner and tracker user both equal session user | 400 INVALID_INPUT, 401 SESSION_REQUIRED, 403 FORBIDDEN, 404 NOT_FOUND, 503 SERVICE_UNAVAILABLE |

Only those query keys are accepted. Reject duplicate query keys, `week` combined with either range key, incomplete ranges, nonreal calendar dates, nonMonday week inputs, malformed ids, arrays/objects, unsafe integers, and page values below 1. Accept calendar dates in years 0001 through 9999 only, rejecting navigation beyond that range; range length cannot exceed 366 inclusive days. Count first within the response's database snapshot. If a requested page exceeds `max(1, ceil(total / 25))`, return an empty page and the actual total without calculating or passing an offset to Prisma. Only in range pages calculate `(page - 1) * 25`. This applies independently to tasks, attention and comments. The previous page control on an out of range page targets the actual last page. It is not a different period selection. Each page size is fixed at 25, not caller controlled.

Responses have `Cache-Control: no-store`. Reuse Feature 6's error envelope `{ error: { code, message } }` and same origin GET policy. Never return stack traces or Prisma objects wholesale. A page object is `{ items, page, pageSize: 25, total }`. Calendar values are `YYYY-MM-DD`; event instants and asOf are UTC ISO timestamps, displayed in WAT. Return only fields used by this screen.

Home task entries include id, title, activity, startsOn, endsOn, canonical status, carryRequested, whether carriedFromId exists, tracker week start, and nullable display reason. Attention entries use the same safe shape. Home does not return all comments, staff emails, or approval snapshots. Derive a Blocked reason from blockerReason and a Declined reason from the latest decided decline for the task. The reason is nullable; if evidence is unexpectedly missing show the existing neutral dash rather than inventing a reviewer or reason.

Detail also returns the owner display name, latest review attempt state, and latest immutable decision's kind, method, reason, decidedAt, actual reviewer display name and covered manager display name when present. Latest means highest attemptNumber, with decision evidence joined to that attempt rather than borrowed from a different attempt. Return automatic approval as System rather than fabricating a human reviewer. For frozen tasks require snapshotAt and read the owner's display name and reporting labels from validated contextSnapshot version 1; current User labels cannot overwrite frozen context. A missing or invalid required historical snapshot returns 503. The prototype's Manager comments section displays the whole conversation attached to that weekly task, including Employee replies and previous or relief reviewers. Do not filter it by current manager or attempt to infer author role at posting. Comment author names come from the linked User with Staff member fallback. Comments order by createdAt then id ascending and paginate independently. Do not expose other comments or raw user records through this join.

### UI behavior and unavailable actions

Match the final Employee Home composition, keeping the sidebar owned by the shared shell. Both views open the same detail drawer. Carry flags reflect carryRequested or actual lineage and never imply that a continuation row has already been created. Status labels map directly from the existing TaskStatus enum; Approved alone is Approved, and Awaiting approval is not completion. There is no percentage value or metric calculation on this screen.

Keep Add task, edit, status, reply, carry, delete, and I'm back actions visibly unavailable where the prototype would show them, with an accessible description `Available when task changes are built.` Use a disabled native control; do not simulate a successful action. Approved tasks also keep their prototype restriction explanation. Attention View or Review task opens the read only detail drawer; its mutation buttons remain unavailable. The Leave support link uses the existing protected Leave route and its unfinished placeholder until Feature 12. Profile and notifications stay with their existing shared feature boundaries.

Use Feature 4's shared dialog for date selection and drawer for details. Preserve opener focus, Escape, close behavior and native modal semantics. Apply invalid range errors in the prototype form error region without clearing typed dates. Apply closes only on valid input; Cancel does not change selection. Use the approved existing footer for task, attention and comment pagination, without adding sidebar destinations. At small widths retain the prototype's card/list wrapping and modal scrolling.

### Failure, refresh and consistency

Use a cancelable request and sequence token for each Home or detail selection. A response may update only the still current selection, page and open task. Closing a drawer or changing periods cancels its pending read. Display loading text in the existing surface, with aria busy and a polite status announcement; do not render an empty success state while loading.

Initial failure shows a fixed English error and Retry inside the existing card or drawer. A failed refresh of the same selection may retain its previous successful rows, count and asOf together, marked stale. Never combine a new period label with old tasks. A changed period or page clears mismatched old data while loading and on failure. Retry reads again from the database and never writes domain data.

Revalidate session through Feature 6 on return to the foreground before exposing cached private content. A 401 or 403 clears Home, attention and detail data and follows the shared sign in or current role landing behavior. An unsuccessful session check withholds private content per Feature 6, even though a domain refresh failure after a successful session check may keep same selection data marked stale. Clear cached data on sign out or identity change. A 404 while opening a task shows the existing drawer error surface and allows Close or Retry without leaking whether another person owns it.

Requery on initial load, period/page change, explicit Retry, and return to the foreground after session revalidation. There is no polling, background worker, new read audit trail, or telemetry provider. Schedule a local timer at every returned nextChangeAt, including unlock grants, leave transitions and Monday rollover, then refresh Home and an open drawer. At a boundary, mark retained state stale and conservatively close planning until a successful read establishes the current state. Never optimistically open or unpause after a failed boundary refresh. A future selected week can therefore become current after successful refresh without navigation. Server reads always recompute permissions. Dispose timers on selection change or unmount and reschedule after a successful read. Detail and Home reads may represent different asOf instants; do not claim real time synchronization between them.

### Value sourcing

| Action | Displayed or produced value | Named source |
|---|---|---|
| Enter Home | User, role, shell, landing and own id | Fresh Feature 6 session context, User and current EmploymentAssignment; spec 0005 route table |
| Greet | First display name | Session's Workforce User.name, Staff member fallback |
| Select period | Current date, Monday and ISO week number | Server asOf converted to Africa/Lagos; ISO calendar calculation |
| Navigate or apply preset | Week anchor, range labels and date inputs | Last selected Monday, explicit inputs, and current WAT calendar as defined above |
| List tasks | Content, status, dates, carry flags, week | Owned visible WeeklyTask fields and its WeeklyTracker joined to WorkWeek |
| Count and paginate | Total, pages, current items | Same filtered snapshot query, fixed page size 25 and validated page input |
| Show attention | Entries, total, reasons | Full selection filtered to Blocked/Declined; blockerReason or latest declined ApprovalDecision |
| Determine lock | Planning state, freeze, reason, next change | Persisted WorkWeek and applicable PlanningUnlock; missing week uses TrackerSettings and specified Saturday boundary |
| Determine unlock scope | Person, unit and business match | Session user id and fresh effective EmploymentAssignment |
| Show leave | Paused state, return date and next transition | Union of caller's uncancelled overlapping or adjoining leave intervals, actual or expected return and current WAT date |
| Inspect history | Owner and reporting labels | Validated frozen WeeklyTracker contextSnapshot version 1 when snapshotAt exists |
| Inspect approval | Status, reviewer, automatic method, date and reason | Canonical task status and latest ApprovalRequest with its ApprovalDecision and referenced actors |
| Inspect comments | Body, author, time, total and page | TaskComment linked to the owned task, User display name, commentPage input |
| Show stale or failure | Loaded timestamp, stale flag, error and retry state | Last successful response asOf, current request result and fixed client English messages |
| Explain disabled action | Availability reason | Feature 9 read only boundary, plus prototype approved task restriction |
| Render controls | Layout, colors, focus, labels and pagination | Final prototype functions, supporting token docs, built shared components and explicit state exceptions |

### Key invariants and security model

Ownership is a database predicate on every task read, not a later client filter. Require both WeeklyTask.ownerId and WeeklyTracker.userId to match the session. Read counts, attention, review evidence and comments only through that scope. Changing a route, query, task id, preview role or supplied user id cannot change the principal. Reject unsupported selectors rather than accepting arbitrary user, role, business or unit parameters.

Use a consistent transaction snapshot for the rows and counts within one response, including authorization data where practical through the shared policy boundary. Do not hold a transaction while waiting for UI or another request. A stale browser payload is never permission for a mutation. Existing authentication session refresh behavior remains owned by Feature 6; these GET endpoints do not create weeks, trackers, tasks, comments, reviews, leave or audit events.

The surface contains private internal work records. It introduces no new regulated processing workflow, external transmission, service, public indexing, or secret. No public route or development actor bypass is added. Keep database clients and credentials on the server and project plain text fields into React text nodes. Do not copy prototype HTML interpolation into live untrusted data rendering.

### Critical test scenarios

1. Real Employee sign in, both views, seeded Week 43 and Week 44, task details and independent page changes. Compare exact current prototype surfaces in an approved viewer (AC-1, AC-2, AC-5, AC-8, AC-9).
2. WAT Sunday/Monday, Friday/Saturday, month/year and ISO week boundaries; presets, 366 versus 367 days, invalid/leap dates and mixed query inputs. Leave a tab foreground across Monday and ensure the selected Monday stays fixed while currentWeekStart and classification update (AC-3, AC-4).
3. An overlapping task whose tracker begins before a range is included. A carried series has separate weekly ids, hidden rows never appear, and future tasks exist only when actually persisted (AC-2, AC-3).
4. Scheduled lock, early manual lock, scoped person/unit/business/Everyone unlock, future grant, expiry, revocation and freeze; missing current week stays empty without any write (AC-4, AC-7).
5. Effective, future, cancelled, returned, overlapping and adjoining leave; full conversation including Employee and relief replies; real review reason, actual reviewer, automatic approval, missing optional reason and validated frozen owner context. Foreground unlock grants and leave transitions refresh, and failure cannot reopen or unpause stale state (AC-4, AC-5, AC-6).
6. Anonymous, revoked/inactive session, other roles, task id substitution, hidden task and cross site GET. Verify status codes and absence of private payloads (AC-7).
7. Failed initial read, same selection refresh failure, period change failure, delayed older response, closed drawer response, retry and sign out while a read is pending (AC-6).
8. At least 26 owned tasks, 26 attention tasks and 26 comments; totals across pages, empty pages beyond the end including Number.MAX_SAFE_INTEGER without an offset query, deterministic tie ordering and isolated attention pagination (AC-2, AC-5, AC-8).
9. All task and leave mutation controls are unavailable, every keyboard route works, modal focus returns, small viewport and zoom remain usable (AC-5, AC-8).

## Build plan

Project approach is Facade with real local data. Lead with the shared UI once its prerequisites exist, then connect it within the same feature. Do not hand over an in memory implementation.

1. Confirm Features 4 and 6 exist and obtain visual views of the exact updated Employee Home, both views, date picker and detail drawer. Preserve their shared boundaries and record any new missing UI before building it (AC-1, AC-5, AC-8, AC-9).
2. Compose Employee Home, period controls, List/Card entries, attention, drawer and approved states from the existing shared components. Define typed response contracts without adding sample live values or enabling task writes (AC-1 through AC-6, AC-8).
3. Add calendar selection, validation and tracker state projection using existing data model helpers and read only Prisma queries. Implement both guarded endpoints, all counts and pagination, comment/review projection, snapshot validation and sanitized errors. No schema migration is planned (AC-2 through AC-5, AC-7, AC-8).
4. Connect UI to those endpoints, handling cancellation, stale state, session changes, expiry timers and focus. Verify reads against the migrated seeded local PostgreSQL, including empty actual current weeks and actual historical rows (AC-2 through AC-8).
5. Run `npm run check` and `/check verify` on development and production with the critical scenarios above. Record visual and runtime evidence and leave Feature 9 in progress until its acceptance checks pass (AC-9 and verification of AC-1 through AC-8).

## Consequences

Employees receive a coherent view of actual work and review evidence without introducing a parallel model. The prototype stays the visual contract and no additional runtime service is needed.

The first release of Home cannot change tasks until Feature 10. Separate detail reads require extra loading and failure handling. Pagination can change while concurrent writes occur between requests; each response is internally consistent, but pages across different requests are not a frozen export. Custom ranges are capped at 366 days and can contain multiple weekly records from one series.

Implementation waits on the shared shell, authentication and an approved visual reference. This spec does not complete those dependencies, add a freeze worker, build task lifecycle, build History's separate page, or finish leave and shared profile/notification workflows. Existing historical snapshots are consumed as stored; Feature 9 does not invent missing frozen records.

## Follow-up

Feature 10 owns task writes and transactional week/tracker creation when required. Feature 11 owns the separate History page, Feature 12 leave writes, and Features 13 through 15 shared profile and notifications. These already exist in scope and require no duplicate enrollment.

Before implementation, reconcile any shared component differences caused by prototype commit `888d79d` within the owning Feature 4 work. Keep unfinished Features 4 and 6 visible as prerequisites and obtain the blocked visual inspection through an approved reference.

## References

**Project sources**:

1. `AGENTS.md` and `server/AGENTS.md`, stack, role order, ownership boundaries, UI contract and verification requirements.
2. `docs/scope/index.md` and Feature 9 in `docs/scope/employee.md`, feature boundary and Alpha workflow.
3. `docs/workforce-prototype-updated.html` at pulled commit `888d79d`, final Employee Home, task list, details, date controls and existing pagination footer.
4. `docs/design-tokens.md` and `docs/typography-scale.md`, supporting UI tokens.
5. Specs 0002, 0003 and 0005, existing data, shared UI and authentication contracts.
6. `prisma/schema.prisma` and `server/data-model/calendar.ts`, current model and calendar helpers.

**Practices**:

Least privilege, explicit ownership predicates, bounded reads, consistent response snapshots, cancellation of superseded requests, and plain text rendering of untrusted content.
