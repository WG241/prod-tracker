# 0014. In app notifications

**Date**: 2026-11-03
**Status**: In Progress

## Summary

Enable the existing bell and unread notification tray for every signed in role. Messages belong to their recipient, and opening a target uses current permissions. Single-read and read-all actions are safe to retry without consuming later arrivals. This spec designs the feature; it does not authorize development.

## Structure

* `0014-events-and-read-state.md` defines the event registry, target rules, read transactions and shared receipt extension.
* `rationale.md` records the alternatives and confirmed choices.
* Spec 0013 owns initial shared receipts and account security events. Spec 0015 owns delivery of new events by email.

## Requirements

As a signed in person, I want one place to see messages addressed to me and open relevant work without gaining access through a notification.

1. **AC-1**: Match the inspected prototype bell, count, Notifications tray, clickable message rows, Mark all as read and all-caught-up empty state. Keep per-role navigation fixed. Add only approved existing pagination and failure treatments within the tray.
2. **AC-2**: Every role reads only its own available unread notifications, newest first, with total count and 25 rows per page. Failed reads are not zero/unread-empty results. Badge text caps at 99+, while its accessible name communicates the actual count.
3. **AC-3**: Refresh the summary on foreground/open and every 30 seconds while visible and authenticated, without overlapping requests or WebSockets. Hide private content during authority revalidation; ignore callbacks from old actors and after body decoding. Do not reorder a focused tray automatically through background list refreshes.
4. **AC-4**: Selecting a row marks that owned message read and then uses a freshly authorized target. Mark all includes every available unread row when the server processes the action, including other pages. ReadAt is set once; repeated requests retain the first result. A retry of read-all never consumes later arrivals.
5. **AC-5**: Previously delivered messages remain readable after role/reporting changes. A stored notification or its target id never grants current target access. Unsupported, deleted, inaccessible or not-yet-built targets use the approved unavailable treatment, while the read action still records the explicit selection.
6. **AC-6**: Existing completion requests, leave actions and password changes produce deduplicated notification rows in their domain transaction. Link completion alerts to the exact approval attempt. No GET, polling pass or notification read creates business events.
7. **AC-7**: Use one server-owned typed event factory/registry. Define contracts for later decisions, comments, tracker and relief producers, without developing those workflows or weekly reminder jobs here. In app notifications cannot be disabled through preferences.
8. **AC-8**: Read mutations share the authenticated owner mutex and immutable receipts from spec 0013. Missing/other recipient ids have the same 404; malformed inputs/selectors/methods, forged role/recipient fields and cross-origin writes fail safely. No message body, route or recipient is supplied by the browser.
9. **AC-9**: Support keyboard opening/closing, Escape and focus return, stable focus after list changes, accessible busy controls, scoped announcements and approved Retry/Reload latest states. Pending/unknown read intents survive same actor workspace revalidation and block conflicting read commands until resolved.
10. **AC-10**: Additive migrations preserve message text, existing read/creation timestamps and immutable domain evidence. Meaningful real database/browser tests prove ownership, pagination, retry races, changing target access and both app modes. Observe NVDA and native zoom separately before acceptance.

## Decision

Use the existing Notification table and shared controls. Extend its target relationship and the shared command receipt rather than introduce a separate inbox system. Keep the tray unread-only, consistent with the prototype. Count refresh is eventual; each list/read transaction is internally consistent.

**Implementation skills**: installed `develop`, `test`, `check` and `sync` workflow skills. Existing authentication and shared accessibility contracts apply without changing provider configuration.

## Rationale

Choices and source findings are in `rationale.md`.

## Feature design

### UI and refresh

The source is `notificationPanel()` and the bell in `docs/workforce-prototype-updated.html`, inspected live on 3 November 2026, including Mark all and the empty state. The engineer approved existing pagination, shared loading/error/Retry/Reload/toast treatments and visible 30-second summary checks. No notifications page or sidebar destination is added.

Use a labelled nonmodal region anchored to the bell, with its existing card geometry, a bounded scrolling body and existing pagination footer. Opening closes the account menu, fetches page one and focuses the tray heading. The bell has aria-expanded/controls. Escape, a second bell activation, outside pointer activation or focus moving outside closes it; Escape/explicit dismissal returns focus to the bell. Do not trap focus or make the workspace inert.

Mark all is unavailable when no unread rows exist. While busy, keep the initiating control focusable and reject duplicate activation. After it becomes empty, focus the tray heading, announce the result once and keep the empty state visible. Selection with an available target closes the tray and gives the destination/drawer focus precedence. With an unavailable target, retain the tray and focus a surviving row or heading after removal, with fixed explanatory text.

Keep the current page while merely polling the badge. Fetch a list on open, page selection, explicit Retry or a completed read action. After removal, clamp a now-empty page to the last valid page through a fresh request. Background summary updates neither move focus nor replace a list currently being read. A list read error retains known rows as stale with Retry; initial errors do not show all-caught-up.

Store nonsecret read intents above the disposable workspace, bound to actor/role, without localStorage. Preserve UUID/op on uncertain outcomes; Retry resolves that operation rather than creating a new read-all. Clear on sign-out or actor/role change. Do not claim committed read failure if the subsequent list refresh fails.

### Data model and migration

| Record | Change | Constraints |
| --- | --- | --- |
| Notification | Add nullable `approvalRequestId` | Optional FK to the exact ApprovalRequest and its weeklyTaskId; a nonnull request requires the matching task. Add necessary composite uniqueness/FK indexes. |
| SharedMutationReceipt | Add nullable `targetNotificationId`; extend operation check to NOTIFICATION_READ and NOTIFICATIONS_READ_ALL | Owned composite FK `(targetNotificationId,userId)` to Notification `(id,recipientId)`. Required only for single-read. Nonsecret canonical request hash required for read operations. |
| Existing message/read fields | No replacement model | Recipient/dedup uniqueness remains. Content/recipient/targets/createdAt are protected from ordinary edits; readAt changes only NULL to its first valid timestamp. |

One atomic, idempotent migration adds the relationships, receipt constraints/indexes and ordinary-write guards. Preserve all old message/read times. Fill a missing approvalRequestId only where the existing domain-owned key `approval-requested:<requestId>`, task id and assigned recipient prove that exact request; leave ambiguous legacy links NULL. A guarded normalization may fill this field once from NULL using that same proof, including a repeated migration after an older writer; it cannot replace a nonnull link or alter other content. Do not derive navigation from arbitrary text.

Do not delete delivered messages or reset read state. Unknown legacy kinds remain safe text messages with a generic icon and unavailable target, and are not automatically emailed by spec 0015. No new weekly reminder or manager/HR business data model is introduced here.

### APIs

All routes require current real session authority for the authenticated recipient in every role and no store responses. Read transactions use Repeatable Read, fresh persisted authority and a database `asOf`. Available unread means recipient matches, readAt is NULL and createdAt is not after asOf; future-dated legacy rows are not presented before their recorded creation instant.

| Endpoint | Method/input | Success | Key failures |
| --- | --- | --- | --- |
| `/api/notifications/summary` | GET, no selectors/body | `{ asOf, unreadCount }` | 401/403 authority, 503 dependency |
| `/api/notifications` | GET `page` safe positive integer, default 1 | `{ asOf, unreadCount, items:[{id,kind,title,body,createdAt,icon}], page,pageSize:25,total,totalPages }` | 400 invalid/duplicate/unknown query, 401/403, 503 |
| `/api/notifications/:id/read` | POST `{}`, UUID Idempotency-Key | `{ result: safe single-read receipt, unreadCount, target: fresh action }` | 404 missing/other recipient, 409 key conflict, 429, 503 |
| `/api/notifications/read-all` | POST `{}`, UUID Idempotency-Key | `{ result: safe batch receipt, unreadCount }` | 400 input, 409 key conflict, 429, 503 |

Register literal read-all before any overlapping dynamic path. Read receipt result is `{ version:1,requestId,operation,appliedAt,replayed,changed,notificationId,readAt }`; batch result replaces single-item fields with `changedCount`. Fresh unreadCount and target are response companions, not frozen receipt authorization. An out-of-range page has empty items without an unsafe offset; clients may recover by clamping. Counts and rows share one transaction.

Use strict JSON, an 8 KiB write ceiling and independent persistent 60/user/minute and 300/socket-IP/minute write limits. GET accepts only the documented page field, exactly once. Methods/body/origin/media failures use the existing 400/401/403/413/415/429/503 policy. No public create/update/delete notification API is added.

### Targets and event integration

`0014-events-and-read-state.md` is authoritative for the registry and mutations. A target is a server-computed discriminated action: PROFILE, EMPLOYEE_LEAVE, OWN_TASK with taskId/week, or UNAVAILABLE with a fixed reason. It is not a stored arbitrary URL. The client dispatches only these actions through existing routes/drawers. Target checks run again even on receipt replay.

For OWN_TASK, the current Employee owner opens the existing Home/History task drawer under its current/frozen read contract. A short actor-bound pending-open intent selects the task's persisted week, then opens its id after Home is ready. Clear it on acknowledgement, navigation supersession or authority change. Do not copy task content into the intent. Other role task/approval/leave destinations remain UNAVAILABLE until their owning features provide a real handler.

The first producers are PASSWORD_CHANGED from spec 0013, APPROVAL_REQUESTED from Feature 10 and LEAVE_RECORDED/CANCELLED/RETURNED from Feature 12. Keep their existing dedup keys and receipt semantics. Later domain features add their producers and target/policy handlers through the same registry. Their business actions, automatic reminders and role pages are not implemented by this feature.

### Value sourcing

| Action | Value produced/displayed | Source |
| --- | --- | --- |
| Badge | Exact count and 99+ display cap | Owned available unread count; fixed cap 99; accessible name uses full count |
| Tray rows/order | Message, icon, date, ordering | Immutable Notification fields; known-kind icon registry; createdAt descending then id descending |
| Date label | Today/time or dated WAT label | createdAt and response asOf in Africa/Lagos, existing English formatter style |
| Pagination | Total/pages/offset | Owned unread count, size 25, validated safe page; never offset when outside range |
| Single/batch read | First readAt, count, replay | Locked recipient, database action instant, conditional updates and immutable receipt |
| Open target | Safe action/unavailability | Current role/ownership/scope, exact related domain records and implemented handler registry |
| Create event | Recipient, content, kind and key | Successful domain command and closed event constructor; never browser input |
| Feedback | Loading/stale/unknown/success | Actual fetch/receipt state and actor generation with shared announcements |

### Security and observability

Owning a notification permits its retained message, not a current task/person read. Always include recipientId in notification predicates and receipt FK checks. Recheck permission after a role/reporting change. Do not echo target records in denied results. Titles/bodies are text, never HTML; new constructors bound titles to 160 and bodies to 4,000 Unicode characters and reject malformed/NUL text. Invalid legacy content uses a fixed unavailable-message treatment rather than executable markup.

Read receipts supply retry evidence; no business audit or product-analytics event is invented for marking messages read. Domain notifications remain atomic with their existing audits. Capture only fixed API error categories. Do not log notification contents, private ids/addresses or raw request/response bodies.

### Critical test scenarios

* All roles, cross-recipient ids, old-role messages, duplicate/unknown selectors, huge pages and corrupt/unavailable targets. AC-2, AC-5, AC-8.
* 26 unread rows, exact stable order, independent summary, page repair, future timestamps and equal-createdAt ties. AC-2 through AC-4.
* Same UUID replay, payload mismatch, no change single read, read-all response loss followed by a new arrival, simultaneous producers and role change during target replay. AC-4, AC-5, AC-8.
* Existing domain rollback/dedup, exact approval attempt link and legacy normalization preservation. AC-6, AC-7, AC-10.
* Pending read on close/reopen, read success plus failed refresh, old callback during JSON decoding, Escape/focus, 320px, announcements, NVDA and native zoom. AC-1, AC-3, AC-9, AC-10.

## Build plan

1. Inspect the bell/tray in every role and compose its approved states/pagination using existing controls. AC-1, AC-9.
2. Extend targets, receipt relations and guards in one safe migration, preserving existing messages and dates. AC-4, AC-6, AC-8, AC-10.
3. Build the typed factory/registry and integrate only the current producers transactionally. AC-5 through AC-8.
4. Implement owned reads, summary, read actions, receipt replay and target dispatch. AC-2 through AC-5, AC-8.
5. Wire foreground/polling cancellation, focus and recovery; run database/browser tests and real app verification. AC-1 through AC-10.

The Facade build leads with the exact tray but finishes on seeded, migrated PostgreSQL. A fixed unread badge or simulated read state is not complete.

## Consequences

Unread messages disappear after selection, matching the prototype; there is no read-message archive surface. Numeric pages can shift as unread data changes, so list refresh is deliberate and page repair is required. Typed event/target boundaries add integration work for later features, while preventing a message link from bypassing current permissions.

## Follow-up

* Features 16 through 37 implement their own business actions, producers and authorized destinations using the child contract.
* Feature 15 consumes newly created registered events only; it does not backfill this tray.
* A read archive, weekly reminder scheduling, real-time transport and notification administration remain outside this feature.
* Manual accessibility evidence is required independently of the prior open gates.
