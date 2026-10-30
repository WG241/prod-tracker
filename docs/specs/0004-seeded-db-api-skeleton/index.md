# 0004. Seeded local DB and API skeleton

**Date**: 2026-10-26
**Status**: Accepted

## Summary

Prove a browser list and write against the existing local PostgreSQL database. A development page lists Ada's seeded Week 44 work and saves short replies with safe retries. Keep this proof local and unavailable in production until the separate sign in and role features provide real access rules.

## Requirements

As a developer, you can demonstrate that the browser, Express, Prisma, and local PostgreSQL work together without replacing seeded records or building a complete role workflow.

1. **AC-1**: Reuse the existing Feature 3 schema, migrations, and repeatable seed. Local migration deployment and two seed runs succeed without resetting the database, duplicating fixtures, or deleting nonfixture comments. No migration or schema change is needed for this proof.
2. **AC-2**: The development proof page obtains Ada's eligible seeded Week 44 tasks from an actual HTTP request and PostgreSQL query. Display task title, activity, canonical status label, and date range. Use the fixed sample week starting 26 October 2026, explicitly labeled as a sample context rather than the actual current week.
3. **AC-3**: Selecting a listed task reads its persisted comments. Posting a reply creates a TaskComment attributed to the fixed fictional Ada identity. After success, a page reload and application restart retain the reply. A later seed run preserves it. No optimistic UI entry counts as proof of a successful write.
4. **AC-4**: Trim surrounding whitespace and accept between 1 and 500 Unicode code points. Reject invalid types, unknown body properties, malformed identifiers, and oversized requests without inserting a comment. Render content as text. The browser and API enforce the same length rule.
5. **AC-5**: Each submission has a UUID used to derive `TaskComment.id`. Retrying the same task and normalized body returns the existing record. Reusing that UUID with different content or another eligible task returns a conflict. Concurrent retries create exactly one row, and a failed or uncertain browser request remains safely retryable with the same identity.
6. **AC-6**: Proof APIs exist only in local development with a local database connection. Restrict requests to the configured loopback service and fixed fixture context; clients cannot select an actor, role, owner, week, or arbitrary task. Cross origin writes are rejected. Production returns the existing JSON API 404 for proof paths and includes no proof page or entry link in its browser assets.
7. **AC-7**: The approved development page is outside role navigation and does not depend on the unfinished Feature 4 shell. It uses prototype control styling and has accessible loading, empty, validation, saving, saved, failed, uncertain, and retry states. A failure preserves the draft and does not show success. Existing application entry behavior and health checks remain intact outside this page.
8. **AC-8**: Run lint, strict type checks, production build, `db:verify`, and `/check verify` on the real app. Verification covers persistence, repeated seed, concurrent retry, invalid and outside scope requests, local access checks, production exclusion, and database stop/restart. Record observed evidence and limitations before marking the feature complete.

## Decision

Use the existing Express 5, Prisma 7, PrismaPg, PostgreSQL, React, and Vite stack. Add a narrow development proof under `/__data-proof` and `/api/dev/data-proof`. This is a foundation integration proof, not the production task API or an authentication substitute.

The user selected task listing plus task comments, fixed fictional Ada context, development only access, an independent proof page, a 500 character limit, safe retries, a pinned sample week, and reuse of the existing comment primary key for retry identity. The unchanged model was shown and confirmed. The user requested no extra References section.

## Feature design

### Existing model and fixed context

Keep the accepted Feature 3 schema and seed semantics unchanged. No new entity, field, relationship, external service, package, credential, or environment variable is required.

| Record | Fields used | Relationships |
|---|---|---|
| User | `id`, `name`, `accountStatus` | Fixed actor `person-ada-okafor`; must exist and be Active |
| WorkWeek | `id`, `startsOn` | Fixed `week-2026-10-26`, starting `2026-10-26` |
| WeeklyTracker | `id`, `userId`, `weekId` | Fixed `tracker-ada-okafor-2026-10-26`, owned by Ada in that week |
| WeeklyTask | `id`, `ownerId`, `trackerId`, `title`, `activity`, `status`, `startsOn`, `endsOn`, `deletedAt` | Owner and tracker must match the fixed context; hidden tasks are excluded |
| TaskComment | `id`, `weeklyTaskId`, `authorId`, `body`, `createdAt` | Existing foreign keys reference the selected eligible task and fixed Ada actor |

Eligible task ids are a fixed allowlist derived from the existing seed plan, not a caller supplied owner or arbitrary week query. The current plan has one Ada carry record: `task-2026-10-19-ada-okafor-prepare-next-month-s-hiring-plan-carry`, titled `Prepare next month’s hiring plan`. Its current tracker is Week 44 even though its stable id contains its source Week 43 date. Validate this allowlist against `prisma/fixtures/plan.ts` during implementation; do not derive the current week from the id text. Any mismatch between this draft and the actual plan must be corrected in the spec before building, rather than silently admitting additional tasks.

Every read and write also checks ownership, tracker, week, and `deletedAt`, even for an allowlisted id. Missing or inactive Ada, a missing sample week/tracker, a week whose persisted startsOn differs from the fixed date, or a tracker whose owner/week differs from the fixed context produces `FIXTURES_UNAVAILABLE`. A valid context with no visible eligible task returns an empty list. An unknown, hidden, or outside scope task returns the same 404. Do not leak which other task or user exists.

The context is deliberately pinned to the existing sample, which is not a simulated authenticated session. Do not apply the advancing wall clock to select another week or invent live planning, freeze, leave, approval, or relief rules in this proof. New comment creation times are real database event times, not the sample reference instant.

### HTTP surface

| Endpoint | Method | Inputs | Success | Important failures |
|---|---|---|---|---|
| `/api/dev/data-proof/tasks` | GET | Optional `page`, default 1 | 200 `{ actor, week, items, page, pageSize, hasMore }` | 400 invalid query, 403 request origin, 503 missing fixtures or database |
| `/api/dev/data-proof/tasks/:taskId/comments` | GET | Encoded task id, optional `page` | 200 `{ items, page, pageSize, hasMore }` | 400 invalid input, 404 outside scope, 503 unavailable |
| `/api/dev/data-proof/tasks/:taskId/comments` | POST | JSON `{ submissionId, body }` | 201 `{ comment, replayed: false }`; exact retry 200 `{ comment, replayed: true }` | 400 malformed JSON/input, 403 origin, 404 outside scope, 409 conflicting retry, 413 size, 415 media type, 503 unavailable |

All proof responses, including failures, use `Cache-Control: no-store`. Error bodies are `{ error: { code, message } }`, with fixed English messages and no exception text, SQL, connection detail, or request body. The existing health and unknown API response contracts stay unchanged.

Task items contain `id`, `title`, `activity`, `status`, `startsOn`, and `endsOn`. Status is the existing Prisma enum serialized as a string; the browser maps it to the labels from spec 0002. `actor` contains only `id` and display `name`; `week` contains only `id` and `startsOn`. Do not return emails, employment assignments, settings, approval evidence, or other people's tasks.

Comment items contain `id`, `weeklyTaskId`, `body`, `createdAt`, and `author: { id, name }`. Query comments only for the eligible selected task. Return original persisted authors if that task already has comments, with display name fallback `Unknown author` when User.name is null. Do not restrict the list to newly created proof comments or invent a comment count from local state.

Both lists have page size 20, read up to 21 rows to determine `hasMore`, and support positive decimal page integers from 1 to 10000. Reject repeated or unknown query parameters. Tasks sort by `startsOn` ascending then `id` ascending. Comments sort by `createdAt` descending then `id` descending. An out of range page returns an empty items array. After a successful reply, refresh comment page 1 so the newly saved record is visible. Offset pagination is acceptable for this small development proof; it is not a settled production API pagination contract.

Task route parameters must be at most 300 ASCII characters drawn from letters, digits, and hyphens, then pass the fixed allowlist. `submissionId` must be a canonical UUID v4, normalized to lowercase. Parse JSON with a 16 KiB body limit only on the proof router. Require `application/json`; reject null, arrays, unknown properties, and nonstring values. Reject U+0000 and any unpaired UTF-16 surrogate in the supplied text before normalization. Then normalize `body` with JavaScript `trim()` and count Unicode code points. Unsupported text, empty text, or over 500 produces `INVALID_INPUT`; valid surrogate pairs such as emoji remain accepted. Apply the same checks in the browser. Text remains plain text, including strings that resemble HTML. This preserves exact normalized text through PostgreSQL storage and later retry comparisons.

Known failure codes are `INVALID_INPUT` (400), `FORBIDDEN_ORIGIN` (403), `TASK_NOT_FOUND` (404), `NOT_FOUND` (404 for an unknown proof resource), `METHOD_NOT_ALLOWED` (405), `SUBMISSION_CONFLICT` (409), `PAYLOAD_TOO_LARGE` (413), `UNSUPPORTED_MEDIA_TYPE` (415), `FIXTURES_UNAVAILABLE` (503), and `DATABASE_UNAVAILABLE` (503). Unexpected server failures use `INTERNAL_ERROR` (500). Unsupported methods on a known proof resource return 405 with Allow. Unknown resources inside the mounted proof router return the structured proof error with code `NOT_FOUND`. Outside that router, and for all proof paths in production when it is absent, retain the existing API fallback body `{ error: 'Not found' }`. Register the proof router before that fallback.

### Local access boundary

Register proof routes only when `readConfig().development` is true, configured server host is one of `127.0.0.1`, `localhost`, or `::1`, and the parsed database hostname is loopback (`127.0.0.1`, `localhost`, or `[::1]`). Also require the connection URL to contain no query parameter named `host`, `hostaddr`, or `service` (compare names without case sensitivity). The installed PostgreSQL connection parser can honor a query host override even when the URL authority says localhost; checking URL.hostname alone is insufficient. Reject these overrides for proof availability rather than adding another dependency or accepting a remote effective destination. Otherwise omit the proof router entirely. Never use this feature to seed or write to Neon. The developer can still run the existing server without exposing the proof when these conditions are not met.

Within the router, require the direct socket remote address to be loopback, including IPv4 mapped loopback. Require the HTTP Host to identify a loopback name and the actual configured port. Do not trust forwarded host/address headers or enable proxy trust for this proof. Reject an Origin header that differs from the actual request's HTTP origin. GET may omit Origin. POST requires an exact same origin header, JSON content type, and, if `Sec-Fetch-Site` is present, the value `same-origin`. Send no permissive CORS response or preflight access grant. These checks limit a fixture tool; they do not authenticate a person or secure a future production API.

The browser uses relative same origin paths. Requests cannot contain `authorId`, `ownerId`, `weekId`, a role selector, or alternate fixture ids. Reject such query or body fields rather than ignoring them. Existing PostgreSQL connection limits and query timeouts remain in `server/db.ts`. Use bounded transactions (`maxWait` and transaction timeout no greater than 5000 ms each). Sanitize logs to fixed categories, without comment text or database addresses.

### Comment persistence and retry identity

The comment id is `proof-comment-` followed by the normalized submission UUID. This namespace is separate from seed comment ids. The existing primary key supplies the uniqueness guarantee; do not add a receipt table or an expiry window.

In one bounded database transaction, validate the fixed actor and task scope, then create the comment with the derived id, task id, fixed author id, normalized body, and the existing database creation time default. If uniqueness reports an existing id, end the failed transaction and read that id in a new valid query. Return replay success only if author, task and normalized body all match. Otherwise return 409 without exposing the conflicting record. Revalidate task scope on replay. A duplicate attempt must never update an existing comment. Compare the full key tuple, not body alone.

Disable repeat submit while a request is pending, but keep server uniqueness as the guarantee for multiple tabs and concurrent requests. Generate the UUID with browser `crypto.randomUUID()` before the initial request. Keep the unresolved task id, normalized body, and UUID in a namespaced sessionStorage entry so a same tab reload can recover them. Save this pending entry before sending. If sessionStorage fails, block submission with an explanatory error rather than sending an unrecoverable request.

Pending text is a local fictional proof draft, never a credential. Clear its entry only after confirmed success or a definitive validation/scope/conflict rejection. On a timeout, network failure, or 5xx, preserve the entry and show `Save not confirmed. Retry this reply.` Retry sends the same tuple. While outcome is uncertain, keep that tuple fixed and disable switching task or starting another reply. Recovery after reload shows the unresolved reply with its Retry control. Other page content may still refresh.

A request has a 12 second browser timeout. After confirmed success clear the composer, show the returned persisted record as saved, and refresh page 1. If that refresh fails, retain the saved confirmation and offer `Refresh replies`; do not repost. No automatic write retry is required. Manual same tuple retry survives application restart because the database key remains persisted. Recovery after closing the browser tab is outside this proof's guarantee; document that limitation rather than promising durable draft storage.

The write changes only TaskComment. It does not update task status or timestamps, create a submission, send a notification or email, or write task lifecycle audit events. Those behaviors remain with the later workflow features. Existing seed code already preserves nonfixture rows; add no automatic cleanup, reset, or comment deletion endpoint.

### Browser proof surface

Use `/__data-proof` only when Vite `import.meta.env.DEV` is true. Conditionally import its module so production cannot contain the page, its sample labels, or its entry link. In development add one clearly labeled `Data proof` link to the existing scaffold, outside any role sidebar. Returning to `/` restores the existing scaffold. Production navigation to `/__data-proof` receives the normal scaffold through the existing browser fallback, with no proof UI.

The user explicitly approved this page despite there being no equivalent prototype page. Its arrangement may be a simple integration tool. Its buttons, fields, badges, cards, and table styling still follow the prototype's Employee task list, task detail reply form (`Reply`, `Post reply`), and token notes. Do not require the unfinished Feature 4 shell, write its root `design.md`, or mark any Feature 4 checkbox complete. Any small proof controls stay local to this feature until shared consumers exist.

Before implementing control styling, obtain an approved visual view of the exact prototype controls. The earlier in app browser attempt to open the prototype's `file:` URL was blocked; source reading alone is not completed visual inspection. Do not work around that browser policy or claim the comparison passed without visual evidence.

The page identifies `Development data proof`, `Fictional actor: Ada Okafor`, and `Sample week: 26–30 October 2026 (Week 44)`. It contains a task list, selected task heading, paginated replies, labeled reply textarea, character count, Post reply, explicit retry/reload actions, and a return link. It displays only returned database values for tasks and saved replies. Calendar dates remain `YYYY-MM-DD` values rather than timezone shifted event instants. Format reply event timestamps with an explicit Africa/Lagos timezone and an accessible full date and time.

Select the first returned task on initial successful load. A selection fetches its replies; ignore or abort stale reads when selection changes. A task list or comment list can be loading, loaded, empty, or failed. Empty tasks disable composition and say `No sample tasks are available.` Empty replies say `No replies yet.` Missing fixtures explain that local migration and seed commands are needed. A failed read offers a retry without submitting a write.

Use semantic headings, a labeled task selection action, native buttons and form controls, explicit current selection, keyboard focus, associated errors and descriptions, and a polite live region for save/read state. On adoption, spec 0006 governs validation announcements: use first-invalid focus with associated text, its single fallback when the field already has focus, and an alert for a generic form/service error. Do not add a second assertive announcement to a field error that its focus change already explains. Keep failed drafts, prevent duplicate form submission, and make table overflow local at 320 CSS pixels. This proof is English only. Its error and empty states are included in the approved development page exception.

### Value sourcing

| Produced or displayed value | Named source |
|---|---|
| Actor id and sample week/tracker | Fixed ids in this spec, checked against persisted User, WorkWeek and WeeklyTracker |
| Eligible task id | Existing Ada Week 44 carry id from `createSeedPlan()`, explicitly allowlisted above |
| Actor/author name, task text, dates and status | Selected persisted columns, with the explicit null name fallback |
| Current sample scope | Fixed `2026-10-26` week, never inferred from the clock or task id prefix |
| Comment text | Validated, trimmed POST body, then persisted TaskComment.body |
| Submission identity and comment id | Browser UUID v4, normalized and namespaced on the server |
| Comment creation instant | Existing database default, returned as an ISO timestamp |
| Local display timezone | Explicit Africa/Lagos constant from the accepted data model |
| Read page, size and hasMore | Validated page, fixed size 20, and the 21st result probe |
| Save or replay result | Completed insert or an exact database tuple match after uniqueness conflict |
| Draft and uncertain state | Form state plus the namespaced pending sessionStorage tuple |
| API/page availability | Existing server development configuration, loopback checks, and Vite development constant |
| Error and empty text | Fixed copy and code/message contract in this spec |
| Labels, status colors and control styling | Final prototype task list/reply form and existing token notes |

### Critical verification scenarios

1. List the fixed seed task through the browser, submit one reply, reload, restart the app, and seed twice. Confirm the same persisted comment and unchanged fixtures directly in PostgreSQL (AC-1 through AC-3).
2. Submit empty, whitespace only, 500 code point, 501 code point, valid emoji, U+0000, unpaired surrogates, HTML shaped text, malformed JSON, extra properties, wrong media type, and oversized body inputs. Check response codes and absence of rejected rows, and replay valid emoji text without changing the stored body (AC-4, AC-5).
3. Send concurrent requests with one UUID and identical text, then retry after a lost response and after app restart. Confirm one row and stable id/time. Reuse that UUID with changed text and confirm 409 without an update (AC-5).
4. Exercise another owner's task, a historical Ada task, a hidden task, spoofed actor/week fields, a nonloopback Host, and cross origin or missing Origin writes. Check proof omission for nonlocal or host overridden database URLs without connecting to those destinations. Check inactive/missing actor, mismatched tracker/week, and unknown proof resource error contracts. Confirm no outside scope read or write and no sensitive error detail (AC-6).
5. Stop and restart PostgreSQL, interrupt a write response, reload with an uncertain pending reply, and fail the read after a successful save. Check preserved text, same identity retry, recovery and absence of false success (AC-3, AC-5, AC-7).
6. Exercise keyboard navigation and narrow layout, compare the named prototype controls, run production and request every proof API/page, and inspect built assets for excluded proof modules (AC-6 through AC-8).

## Build plan

1. Confirm the configured database meets the complete local connection rule above before running migration or seed commands. Confirm existing migrations and fixture identities, apply any outstanding existing migrations without reset, and run the seed twice. Confirm the allowlisted carry id and unchanged schema (AC-1, AC-2, AC-6).
2. Build the small browser proof surface with loading, selection, draft and result states and prototype controls. Wire reads to the local database API as it lands; do not leave a fake data implementation at handover (AC-2, AC-3, AC-7).
3. Add local access guards, paginated task/comment reads, strict JSON validation, bounded comment persistence and the existing primary key retry guarantee (AC-2 through AC-6).
4. Finish the browser integration, pending submission recovery, timeout/retry behavior, saved refresh handling, and development only module isolation (AC-3 through AC-7).
5. Run tooling, existing `db:verify`, and real development/production verification. Check invalid writes and concurrent retries, persisted replies after app restart/reseed, origin/scope denial, database recovery and production exclusion; record evidence (AC-1 through AC-8).

## Consequences

The browser proves a real PostgreSQL list and write without broadening the task lifecycle or exposing unauthenticated production data routes. No data reset or schema change is required.

The proof uses a fixed actor, week, and narrow task allowlist. Its route names, pagination, draft storage, and local request guards are not a production API contract. Later authenticated task APIs must implement their own role scope and workflow rules. A same tab uncertain submission can recover across reload, but closing the tab can lose its pending identity.

Verification comments are retained as local development records. Do not delete them automatically or modify seed fixtures to simulate persistence. Repeated verification can create additional replies; use unique submission IDs and record the specific ids used as evidence.

## Follow-up

Feature 4 remains design approved and unbuilt. Feature 6 provides sign in and role access, and Features 9 and 10 own Employee task UI and lifecycle behavior. This proof does not complete those features. Technology specific skills and MCP discovery remain deferred, as previously chosen; no new technology is selected here.

The existing seed and `db:verify` scripts also use hostname only connection guards. Their broader CLI guard hardening is deferred, rather than silently included in this feature. Feature 5 verification must validate its actual connection against the full proof rule before invoking them.

## Rationale

See `rationale.md` for the alternatives and reasoning.
