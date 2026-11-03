# Employee History read journey

## Summary

Use the prototype's Employee History screen to browse owned frozen task records. Valid history stays available while missing or uncertain snapshots are prepared or repaired.

## Screen and selection

The exact Employee History page, frozen task drawer and date dialog were inspected live on 2 November 2026. Preserve its heading `Your work, week by week`, supporting copy, Week selector, Date range button and Week/Task/Status/Dates table. Reuse the history dialog's status selector in the toolbar, as approved. Reuse the current shared table, pagination, field, date dialog, drawer, banner and button treatments. Add no search, metrics, export, role navigation or new record editor.

Use canonical domain statuses, including Approved rather than the sample table's inconsistent Completed label. A completed Employee action is Awaiting approval, as already decided in spec 0009. Offer All statuses and all eight persisted TaskStatus values. Week labels include ISO year and week, and use the Monday date as the identity. All weeks means all qualifying stored history, not the sample's eight week limit.

Include weeks with an owned tracker or dated assignment overlap, even when they have zero tasks. Only frozen weeks qualify. Also represent missing weeks within persisted automatic coverage when the caller's assignment overlaps them. Never infer earlier missing weeks before trackingStartsOn. Week options are newest first. A valid own snapshot is AVAILABLE; an uncaptured but reconstructable candidate is PENDING; a corrupt or unsafe candidate is REPAIR_REQUIRED. These states use the same pure checks as the worker. Global rosterCapturedAt does not restrict this Employee's valid history.

Week, status and date filters intersect. Date ranges use inclusive task startsOn <= to and endsOn >= from, and the shared real date validation in years 0001 through 9999 with at most 366 inclusive days. The existing presets use the response's server calendar. A current or future date range can legitimately have no frozen results. Do not add current records to make a preset nonempty.

Filter choices reset the page to 1, close a drawer and retain the other filters. Clear range clears only the range. Keep the view in AuthApp per user across foreground session checks, as for Home; a changed identity or role clears it. No private records or drafts enter browser storage. This does not add another routing library or require filter state in the address bar.

Rows use real task text/status/dates and the captured owner name. Sort by week.startsOn descending, then task.startsOn, createdAt and id ascending. Each weekly carry record stays distinct. Exclude deletedAt records. Show full filtered counts, 25 rows per page and stable keyboard row activation through a real task button/link within the existing row style. Use the existing page offset guard for huge or out of range pages. Repair the UI to the final valid page when a refreshed result shrinks.

## API

Add GET `/api/employee/history`. Accept only `week`, `status`, `from`, `to`, `page`, once each. No request body or additional selector. Omitted week/status mean all; otherwise week is a real Monday and status is one canonical enum. from/to must occur together. page is a positive safe integer. An unknown, future or uncaptured week selector must not expose another user's records: return an empty result with its applicable own availability, or empty not available when no own membership exists.

Return a safe typed object:

* Read clock: asOf, timezone Africa/Lagos, currentWeekStart and nextChangeAt.
* Normalized selection: week nullable, status nullable, range nullable, page.
* records: items, page, pageSize 25 and total. Each item has id, title, status, startsOn, endsOn, week and ownerName only.
* weeks: own candidate Monday dates and AVAILABLE/PENDING/REPAIR_REQUIRED states, including valid zero task weeks.
* availability: pendingWeeks and repairWeeks for the selected week/date window, plus captureInitialized from persisted trackingStartsOn. A status filter does not hide unavailable weeks whose task statuses cannot be known reliably.
* selectedWeekState: null for All weeks; otherwise AVAILABLE, PENDING, REPAIR_REQUIRED, NOT_FROZEN or NO_RECORD. NOT_FROZEN means the selected known or normal coverage week has not frozen. NO_RECORD means there is no own tracked membership/record or the absent historical week is before coverage. An unknown covered frozen own week uses PENDING or REPAIR_REQUIRED according to the same creation and evidence checks as capture.

All availability counts and week options are scoped to the current owner. Do not disclose another person's capture failures, global roster counts, raw snapshots or diagnostic ids. Task totals count only available records, with the availability banner clearly identifying incomplete coverage. Validate snapshots before both counting and paging; never count corrupt rows as accessible or allow one corrupt tracker to remove unrelated valid history.

Week options cover all own frozen candidate weeks regardless of the current status/date filter. For availability counts, apply the explicit week selector first. With no date range, consider every remaining own candidate. With a date range, include a candidate if either its Monday through Friday date interval overlaps the range or any owned visible task in it has an overlapping startsOn/endsOn interval. This conservative union includes unavailable long tasks whose owning week precedes the range, and missing/zero task weeks within it. Ignore status when counting unavailable coverage. Task totals themselves still use actual task date and status filters.

Read with the existing Repeatable Read pattern, fresh Employee principal check, consistent count/page projection and both owner predicates. A valid snapshot requires the version 1 shape, matching owner, required historical role/context ids and safe labels, a valid tracker assignment relation, expected days in 0..5 and snapshotAt at or after that week's freeze. Do not compare captured labels to today's names. Reuse one validation helper across History, detail and capture so the same evidence does not become valid on one surface and invalid on another. Preserve the existing detail API's supported Employee/Line Manager personal task roles.

The assignment relation check confirms the stored assignment belongs to the tracker owner; it does not replace captured context by rederiving it from today's mutable source fields. General roster snapshots support all five roles, while a displayed personal task retains the existing Employee/Line Manager role contract. Snapshot accountStatus is ACTIVE when activeAt(User, freezesAt minus one millisecond) is true, otherwise INACTIVE. Department is the selected assignment's departmentLabel. Employee context requires business, unit and manager ids and names; Line Manager requires business and unit with null manager; Business Director requires business with null unit/manager; Executive and HR/Admin have null business/unit/manager context. These mappings govern new capture and structural nullability validation, not recomputation of captured expected days.

Reuse GET `/api/employee/tasks/:taskId?commentPage=...` for the drawer. It returns captured context, latest review and paginated conversation. Always pass inspection mode from History. A frozen record exposes no Employee write controls. A valid late approval changes its status and review at the next successful read, while captured context stays unchanged.

Responses use Cache-Control no-store. Preserve the existing real session wrapper, cookie forwarding, origin and Fetch Metadata checks. No owner/role input, preview role authority or unauthenticated endpoint. Fixed errors retain the existing envelope: 400 INVALID_INPUT, 401 SESSION_REQUIRED, 403 FORBIDDEN and 503 SERVICE_UNAVAILABLE. The detail route retains its common 404 and missing snapshot 503. Unsupported methods fail without mutations.

## Availability, refresh and failure

Use the approved shared banner to distinguish records still being prepared from those requiring historical repair. Retry performs only another read. It never starts capture or modifies history. A selected unavailable week must not say that the Employee submitted no tasks. Use `Historical records for this week are unavailable.` when coverage is unavailable, `No tasks in this week.` for a valid empty week, and `No tasks match these filters.` for a valid filtered empty result.

Use `This week has not closed yet.` for NOT_FROZEN and `No historical record is available for this week.` for NO_RECORD. Neither means zero submission. AVAILABLE, PENDING and REPAIR_REQUIRED follow the per owner snapshot/evidence rules above, independently of whole roster completion.

Missing baseline initialization can be explained with the same shared treatment while valid stored history remains readable. A total database/read failure uses the normal error and Retry state. Do not turn an outage into an empty success.

Use the existing cancellation, sequence and session invalidation mechanisms. A changed selector clears old period data; same selection refresh failures may retain its original result and asOf with a stale notice. A late older response cannot change a newer selection or closed drawer. Closing and reopening a drawer fetches the current authorized record.

nextChangeAt is the next future persisted week freeze relevant to the candidate coverage, bounded by the next normal Saturday WAT freeze for a not yet created week. It causes the same known boundary refresh as Home. Do not add general polling; pending capture and later decisions can be refreshed with Retry or foreground revalidation. Preserve filter/anchor state while withholding private content during that revalidation.

## Critical checks

* Render real table, all status filters, combined week/date/status filters, dates across ISO years, empty captured weeks, distinct carries and multiple pages. AC-1, AC-2.
* Prove overlap includes a task beginning before the range, total counts match the entire filtered set, hidden rows disappear and huge pages cannot overflow offsets. AC-2.
* Open a historical Employee and historical Line Manager personal task with current and changed owner labels, review/comment evidence, late approval and no Employee mutations. AC-3, AC-8.
* Mix valid, pending and corrupt own snapshots. Keep valid rows visible, report scoped coverage accurately, and never label an unavailable week as zero submission. AC-6.
* Deny anonymous, revoked, inactive, role changed and substituted owner/target requests; reject extra/duplicate selectors, invalid dates/statuses, unsupported methods and conflicting origins. AC-8.
* Exercise keyboard row/menu/dialog behavior, first invalid focus, scoped announcements, stale/failed/late reads, filter retention, 320 pixel layout, axe, reduced motion, actual NVDA and native 200 percent zoom. AC-9, AC-10.
