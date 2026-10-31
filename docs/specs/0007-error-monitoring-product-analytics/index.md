# 0007. Error monitoring and product analytics

**Date**: 2026-10-28
**Status**: Proposed

## Summary

Capture application errors and a small set of product events in inspectable local files. Keep telemetry independent of business writes, exclude employee identities and work content, and expose only aggregate role counts. Build the foundation first, but leave this feature open until real Employee submission and Line Manager approval workflows demonstrate their events.

## Requirements

Developers can inspect client/API failures without exposing private data. Product owners can count visits, submissions and approvals by role without using telemetry as an employee history or authoritative performance report.

1. **AC-1**: A local JSON Lines sink stores validated error, product and sink health records outside Git and public browser assets. Inspection and aggregate summary commands work without PostgreSQL. No hosted provider, new service, analytics database table or transactional outbox is introduced.
2. **AC-2**: Unexpected API failures, database readiness failures, client render errors and unhandled browser errors/rejections reach the configured local sink through the documented capture paths. Expected validation/authentication/permission failures are not reported as unexpected crashes. Existing safe API responses and readiness behavior remain intact.
3. **AC-3**: The approved minimal render crash fallback shows a short message and Reload action, uses prototype card/button styling, contains no technical error details and remains keyboard accessible. Error collection failure never prevents the fallback. Recording a failure never claims that a request or business action succeeded.
4. **AC-4**: Persist only allowlisted codes, roles, route/page keys, timestamps, random event ids, counters and sanitized application file/line locations. Exclude person, task and approval ids, names, emails, task/comment text, raw error messages/stacks, request bodies, cookies, credentials, tokens, query strings, client IP and user agent from records. No analytics identity or persistent tracking cookie is created.
5. **AC-5**: Ordinary recording is best effort and nonblocking. Queue, record and stream buffering are bounded; drops and I/O failure are observable without recursive reporting. Telemetry errors never change a domain transaction, response outcome, authorization decision or mandatory audit requirement. Crash/restart delivery loss is acknowledged rather than hidden.
6. **AC-6**: Enforce 30 day retention and a 100 MB total managed file cap during operation. Rotate bounded segments and prune only this sink's managed files. Handle restart, partial lines, backpressure, disk failure and shutdown without unbounded growth or taking over unrelated files.
7. **AC-7**: `workspace_viewed` counts actual authorized page visits by the server derived role, not rerenders, session refreshes or development role previews. Before Feature 6 supplies real context, no fictional role is promoted into runtime analytics. Browser events remain diagnostic observations, not audit evidence.
8. **AC-8**: A newly committed approval request emits `task_submitted`. A newly committed approval emits one `task_approved` record with human/automatic method and late/on-time classification. Late means persisted decidedAt is at or after the original task week's stored freezesAt. Late counts are a subset, not an additional completed action. Failed writes, declines and idempotent replays do not emit a new approved action.
9. **AC-9**: Local probes and synthetic records exercise capture/privacy/failure behavior without being counted as real workflow proof. Final completion requires actual Employee/Line Manager integration through the owning workflows in Features 10, 17 and 19, including a late human approval and automatic manager completion. Until those routes exist and pass, Feature 8 stays in progress even if its instrumentation milestone is built.
10. **AC-10**: Focused regression tests, lint, strict type checks, build and real app verification pass. Evidence shows inspectable errors, privacy rejection, queue/retention behavior, production exclusion of probes, and the source of every product event. `/check verify` may report an intermediate milestone, but its final checkbox is not complete until AC-9 passes.

## Decision

Use the existing Node, Express, React and TypeScript stack with native filesystem support. Write diagnostics and product events to separate rotating streams under `.local/telemetry/`, with CLI inspection and summaries. Native [Node streams](https://nodejs.org/download/release/latest-v24.x/docs/api/stream.html) require explicit backpressure handling; [filesystem operations](https://nodejs.org/download/release/latest-v24.x/docs/api/fs.html) must not modify one file concurrently. One Node process owns this sink directory.

The user chose local files rather than a hosted platform, aggregate visits/actions rather than people tracking, nonblocking best effort delivery, 30 days/100 MB retention, a minimal recovery fallback, separate human/automatic approval buckets, and sanitized locations without raw exceptions. The selected 100 MB cap is 100000000 bytes. There is no new significant library or provider to discover; existing deferred tool choices stay unchanged.

## Feature design

### Ownership, milestones and dependencies

This feature owns telemetry capture, validation, local transport, inspection and event integration contracts. It does not own employee submission, manager review, session authentication, business audits or a new product dashboard.

Features 4 through 7 are approved and unbuilt. Reuse their controls, context and accessibility patterns when they exist, without implementing them under Feature 8. Error capture and the file sink do not require authentication or a working database. Runtime role visits require Feature 6. Real submission and approval integration remains in Features 10, 17 and 19; their dependencies remain their own scope work.

The user explicitly kept the original Feature 8 completion gate: synthetic proof is useful for the local foundation, but is not a substitute for the real Employee and Line Manager loop. Build milestones may be ticked separately. Do not mark this feature done, or its final Verify it checkbox passed, merely because sample records can be written.

### Record schema and privacy boundary

Every managed record has `version: 1`, `id` (UUID), `observedAt` (server UTC ISO instant), `environment` (development/test/staging/production), `synthetic` (boolean), and a closed `kind`. Reject unknown external fields. Build internal records from fresh explicit projections; never spread or stringify an Error, request, response, session, domain record or arbitrary metadata object.

| Kind | Additional fields | Source and constraints |
|---|---|---|
| error | `code`, `source`, `locationKey`, `frames?`, `httpStatus?` | Fixed category/source keys; known page or route key; up to ten sanitized app locations; optional actual 5xx status. No role/person context is needed. |
| product | `name`, `occurredAt`, `role`, optional `pageKey`, optional `method`, optional `timing` | Three named events below; role is the existing five-role enum, never a browser supplied actor; conditional fields depend on event type. |
| health | `runId`, `queueDepth`, `written`, `dropped`, `invalid`, `writeFailures` | Random process/run id and numeric per-family counters, no request/actor data. Snapshot time is observedAt. |

UUIDs identify observations, not people. No distinct/unique person metric is supported. Environment comes from server configuration, not a request. `synthetic` is set only by controlled development/test emitters, never accepted on a runtime business/view request. All text values other than sanitized file identifiers are closed enumerations, not user entered descriptions.

Use fixed error codes such as RENDER_ERROR, REACT_RECOVERABLE, BROWSER_ERROR, UNHANDLED_REJECTION, API_UNAVAILABLE, API_INTERNAL_ERROR, DATABASE_UNAVAILABLE, STARTUP_FAILURE and PROCESS_FATAL. Map unknown exception types to a generic allowed code; never persist `error.message`, `cause`, arbitrary `name` strings or the first line of a stack. Expected 4xx outcomes and deliberate aborts are not unexpected error reports.

Optional frames are `{ file, line, column? }`. Accept only exact application file identifiers from the current server source/build inventory or browser asset/source inventory. A path prefix regex alone is insufficient because arbitrary text could fit it. Strip origins, query/fragment, absolute machine paths, function names and source text before matching. Omit unknown/malformed frames instead of copying a raw stack or discarding the useful fixed error code. Bound file length and numeric locations. Validate browser frames again on the server.

The source inventory is loaded/generated from known project source and built asset filenames, not from a collector request. This supports local source locations and production bundle locations without uploading source maps. A location can be missing; no full diagnostic fidelity is promised when sanitization cannot establish a safe application file.

Telemetry remains separate from the append only AuditEvent model and reporting metrics. Required business/security audits still succeed or fail according to their owning policy. Do not replace them with best effort telemetry, suppress their failure, or use telemetry counts as weekly participation/approved completion totals.

### Local writer, bounds and retention

Resolve the project root from the application composition (development source versus compiled server location) and pass the absolute `.local/telemetry/` directory to the writer. Test instances use an explicitly created temporary directory. Do not derive a directory from a request or silently write relative to an arbitrary working directory. Keep the directory outside dist/public serving; `.local/` is already ignored.

Only one serialized writer owns each active file. Errors and health share the diagnostic stream; product records use the other stream. A record is at most 4096 UTF-8 bytes including its newline. The application queue holds at most 256 records. Drop a newly offered record when full, increment the appropriate counter and return without throwing. Preserve ordering among accepted records. Do not let a stream's internal buffer become an unbounded second queue: use a 64 KiB high water mark and stop draining the application queue when write returns false until drain. Handle callback and stream error paths without double-counting one failure.

Use managed basenames such as `errors-YYYYMMDD-N.jsonl` and `events-YYYYMMDD-N.jsonl`. Dates are observedAt UTC dates; N is a validated numeric segment number. Rotate at a UTC day boundary or before exceeding 10 MiB, through serialized close/rename or close/new-file sequencing. Never concurrently append and rotate the same stream. On restart inspect existing managed segments to select a fresh safe segment; a trailing incomplete line is reported as incomplete by readers, never treated as a valid record.

Retain at most 100000000 bytes across managed files, pruning oldest closed managed segments before accepting further disk growth. The cap takes precedence over the 30 day window, so high volume can shorten retention. Prune an aged segment using its UTC segment day; deleting an entire aged segment can remove slightly newer records in it. Daily segments prevent one active file retaining arbitrarily old observations. Do not prune a currently open file; close/rotate it first when needed.

Run retention on startup and at a bounded maintenance interval while the process is alive, serialized with writer maintenance. A stopped process cannot enforce a wall clock retention deadline. Provide an explicit offline prune command for maintenance when the app is stopped; no OS scheduler is created. Include all managed stream bytes in the cap. Skip symlinks/unrecognized files and refuse a sink directory resolving outside the intended project/test directory. Pruning is individual managed file removal, never recursive deletion of a computed folder.

The writer may fail because of permissions, disk full or missing storage. Return no error into domain handlers. Pause/retry sink reopening with a bounded delay (one second minimum, no tight loop), keep the queue cap, and surface write failures and drops. A health snapshot is attempted at most once per 30 seconds and after recovery; inspection shows its as-of time rather than claiming it is live.

When the file sink cannot record health, emit a small sanitized stderr diagnostic with counters at most once per minute. Honor stderr backpressure by waiting to offer another diagnostic until drain; do not maintain another unbounded queue. A terminal diagnostic is the fallback when a file cannot be written. Counters are per process; they are not durable loss accounting across a crash.

Ordinary capture returns immediately after validation/queue offer, not after disk I/O. A 204 ingestion response acknowledges handling, not durable delivery. Best effort can lose accepted records on crash or shutdown, and no outbox retry guarantee is implied. Normal shutdown allows at most one second for telemetry draining within the existing application shutdown deadline, then counts/discards remaining entries without keeping the process alive indefinitely.

### Server and browser capture

Initialize the capture service before application startup work that can fail, with safe stderr fallback if file configuration is unavailable. Preserve the existing public health body, status/cache behavior, bounded PostgreSQL timeouts and sanitized API responses.

Replace isolated fixed console error sites with typed capture where appropriate: database pool/health failures, listener/startup failures, and unexpected Express failures. Express 5 sends rejected async handlers to error middleware; use its [error handling contract](https://expressjs.com/en/guide/error-handling/). Record an unexpected request failure once at its reporting owner and send the same generic safe response when headers are still writable. If headers have already been sent, use a controlled terminal handler to terminate the response/connection without appending exception details or handing the original exception to Express's default final handler/logger. Default Express logging can print raw messages and stacks even when the response has started. Keep the terminal path sanitized in development and compiled production, with no raw exception passed to console logging. Deliberate validation, denied access, invalid credentials and normal 404s do not become crash alerts.

Use React 19 root reporting callbacks as the owner of React caught/uncaught/recoverable reports. A small native class Error Boundary provides the fallback; other components remain function components. This is the React API exception to the normal component style, not adoption of a different framework. Do not also emit the same caught failure from componentDidCatch. The [React root API](https://react.dev/reference/react-dom/client/createRoot) exposes the reporting callbacks; the [boundary API](https://react.dev/reference/react/Component) describes its limits.

Also capture window error and unhandled rejection observations. A boundary does not catch ordinary event-handler or timer errors. Reuse an error object's observation id through a WeakMap/WeakSet where available so root/global handlers do not double-report the same object. When no object exists, use a bounded short-lived fingerprint of allowed code/location fields, never a raw message. Browser posts have a small bounded pending count (ten), a three second timeout, and no automatic persistent retry. A failed telemetry request is never itself captured or shown as a user action failure.

Application event handlers and API helpers deliberately normalize caught unexpected failures; they do not report every rejected promise that is already handled. Preserve original domain outcomes. Diagnostic observations of the same outage on server and client may be distinct records, and summaries must not claim unique root causes from their count.

For Node fatal uncaught exceptions/unhandled rejections, stop normal service and terminate unsuccessfully rather than continuing in an undefined state, as described by [Node process guidance](https://nodejs.org/download/release/latest-v24.x/docs/api/process.html). Emit at most one sanitized bounded stderr fatal record through the fatal guard; do not attempt new database work, file rotation or an unbounded async flush in that path. The guard must suppress default raw exception/rejection output while preserving unsuccessful termination. A monitor alone that leaves Node's default raw logging active does not meet this contract. Pending file records can be lost. Fatal stderr output is not claimed to be present in the JSONL sink. OS termination/power loss cannot be captured reliably by the application.

### Approved crash fallback

The user explicitly approved a minimal recovery surface absent from the prototype. Use a semantic main region, a prototype styled card, heading `Something went wrong`, text `Reload to try again.`, and a native `Reload` button. Render no stack, error id, employee/task details, technical diagnosis or promised save outcome. Reload performs a normal document reload and does not replay a business mutation.

Keep this fallback independent enough that a failure in the normal shell/providers does not prevent its rendering. Reuse reliable shared styling/tokens rather than requiring the broken subtree. Move focus to its heading when it replaces the crashed tree, with the explanation associated so the user can discover the action. Error capture is best effort and cannot block the fallback.

The boundary covers descendant render errors, not its own failure, a killed browser, SSR, or all async work. Root callbacks/global capture observe their supported paths; do not claim universal recovery. Before implementing styles inspect the exact prototype card/button reference in an approved viewer. The prior file URL block remains; source inspection alone is not visual evidence and the restriction must not be bypassed.

### Browser ingestion and availability

| Route | Input | Access/result |
|---|---|---|
| POST `/api/telemetry/error` | JSON id, allowed client code, locationKey, optional safe frames | Anonymous same origin, no session lookup; valid handled report 204 |
| POST `/api/telemetry/view` | JSON id and pageKey | Real current context from Feature 6; permitted role/page pair then 204 |

Browser error reporting uses credentials omitted. View reporting uses same origin credentials, but never puts a token or person in the body. Do not create a read/log download endpoint or product dashboard. Files are inspected only through trusted local CLI access.

The client error-code subset is RENDER_ERROR, REACT_RECOVERABLE, BROWSER_ERROR, UNHANDLED_REJECTION and API_UNAVAILABLE; the server derives the corresponding browser source rather than accepting it. A browser cannot claim a server fatal/database category. Use a dedicated reporting transport, not a business API helper that redirects on 401 or recursively reports 5xx. A telemetry response never signs the browser out, shows a failed action toast, or retries a business mutation; real session guards keep their independent responsibility.

Both routes reject unknown properties, invalid UUIDs, unsupported types/codes, oversize input and invalid origin. Use an 8 KiB JSON request limit, strict application/json and no permissive CORS. Require exact Origin from the configured app origin and same-origin Fetch Metadata when present. Reject null/missing mutation Origin. Server generated observedAt/environment are authoritative; no caller clock, role, person, source or synthetic flag is accepted.

Use bounded in-memory per-socket limits, ignoring forwarded headers unless a deployment spec establishes a trusted proxy: 30 error reports/minute/IP and 200 views/minute/IP. Hold at most 4096 limiter keys with expiry; never persist IPs. Return 429 with Retry-After on a limit. Bodies/types use 400/413/415, origin 403, unknown paths/methods the safe 404/405 behavior. An unauthenticated view returns 401; absent/unavailable real role resolver returns 503, never a guessed preview role. Sink failure still handles valid telemetry best effort with counters rather than changing a business response.

Maintain a bounded ten minute seen-id cache (maximum 4096 ids) for browser retries. It is per process and resets on restart. Summaries also deduplicate record ids within their read. This reduces repeats but is not an exactly once event guarantee. API middleware must not recursively capture failures of these ingestion routes as more browser/server reports.

When Feature 6 is unbuilt, composition supplies no real context resolver and view ingestion is unavailable; error ingestion remains independent of the database. After Feature 6 exists, use its fresh server context, route permissions and normal renewal/Set-Cookie forwarding. A supplied browser role or an acting preview cannot enable analytics. Only actual page keys allowed for that role are accepted, including shared own Profile.

### Product event contracts

| Event | Trigger and fields | Named source |
|---|---|---|
| workspace_viewed | One authorized page render per navigation; role and pageKey | Browser navigation id/page key, with role/page authorization resolved on receipt by the server; occurredAt is server receipt time |
| task_submitted | New approval request committed; role and method HUMAN/AUTOMATIC | ApprovalRequest.submittedAt and authorized initiating context; new Pending request means human review, new decided automatic request uses its Automatic decision |
| task_approved | New Approve decision committed; role, method and timing ON_TIME/LATE | ApprovalDecision.decidedAt/method plus the task's original WorkWeek.freezesAt and authorized initiating context |

Only Employee/Line Manager submission roles and Line Manager approval initiation are in the initial business event contract. A relief reviewer remains a Line Manager. Automatic own completion uses its initiating manager role, even though the stored automatic decision has no human actor. Workspace views support all five real roles. No freeform action, person, business/unit or record id is included.

Late is `decidedAt >= originalWorkWeek.freezesAt`, using persisted instants at the database's existing precision. The original week is the WorkWeek linked by the approval request's WeeklyTask tracker, not the earliest week of its TaskSeries/carry chain or the date embedded in an id. Do not use request age, overdueApprovalDays, task endsOn, server report time, current settings, or the week in which a late decision happens. Store one approval event with timing; `late approvals` is the LATE subset of approvals grouped by method, not a fourth completed-action event. Telemetry activity dates use the actual occurredAt; authoritative performance attribution to the original week remains in the business data model.

Server only emitters accept a typed committed result containing `newlyApplied`, occurrence instant, initiating role, method and, for approval, original freezesAt. The owning workflow constructs it after the transaction resolves successfully from its validated result, not from request analytics fields. If newlyApplied is false on an idempotent replay, emit nothing. A rollback, decline or button click emits no approved action. Do not query the database again after commit merely to reconstruct analytics values or make an action fail because telemetry returned dropped.

Each emitter offers one record with a random event UUID. It has no business id deduplication ledger or transactional outbox. Process death between commit and offer/write can lose the observation. Counts are best effort and must never drive payroll, approval truth or staff performance calculations.

For views, mount the hook in the real rendered workspace. A navigation instance keeps one UUID across Strict Mode effects, rerenders and session rechecks. A new real navigation gets another id. Do not emit for the sign in page, crash fallback, static component previews or role switch demonstrations. A page that never successfully renders does not count as a view.

### Inspection, configuration and probes

Add trusted `npm run telemetry:inspect` and `npm run telemetry:summary` commands. Inspect defaults to the most recent 20 matching records, with a validated limit of 1 through 500 and kind error/product/health/all. Summary reports counts by event/role/method/timing and error code/source, plus malformed/incomplete record counts and the latest health snapshot's age. By default it covers all retained records and reports their actual earliest/latest times, not an assumed complete 30 day window. Neither command needs a running app or database. They never add telemetry events about their own read.

Use streaming reads of managed JSONL files, validate record shape/line size and report damaged lines rather than treating them as zero-error success. Default summaries exclude synthetic records. Explicit `--include-synthetic` is labeled in output. Use `--from` and `--to` calendar dates interpreted as Africa/Lagos day boundaries (inclusive from, exclusive to), reusing the existing calendar convention; stored instants and segment days remain UTC. Apply product filters to occurredAt and diagnostic filters to observedAt. Do not present event counts as unique users or exact business totals.

`TELEMETRY_MODE` is local by default or off. Off unmounts collectors and records no observations; the recovery fallback still works. Existing managed files remain subject to retention maintenance, but do not create empty files solely for off mode. `TELEMETRY_ENV` optionally selects the closed environment enum; otherwise use the server's development/production mode. Invalid mode/environment values disable recording with a sanitized diagnostic rather than stopping business startup or inventing an environment. `TELEMETRY_ORIGIN` is an optional fixed origin: if absent use the existing validated BETTER_AUTH_URL when available, otherwise derive only from a configured loopback host/port. Never infer it from an incoming Host header. Conflicting configured app/auth origins, malformed origins or a remotely bound app with no known public origin disable browser ingestion with a sanitized diagnostic; they do not stop business startup. Do not include paths/credentials/query/fragment in the origin.

File failure or disabled browser ingestion remains visible through safe process diagnostics. No telemetry configuration value, directory or secret enters the browser. Do not add a VITE tracking credential. Hosted adapters, source map upload, dashboards, alert delivery and vendor accounts remain deferred.

When the Feature 4 preview exists, add clearly labeled development error exercises there, reusing the actual boundary/capture modules. A bounded loopback development probe (`POST /api/dev/telemetry-probe`, JSON scenario `api-error` or `product-sample`) may deliberately throw an API failure or offer a fixed synthetic product sample. It has no business writes or arbitrary payload. Require development mode, configured loopback host, a direct loopback socket and the same origin/body validation as ingestion; otherwise do not mount it. The server marks probe observations synthetic, not a caller supplied record field. There is no production probe route. Otherwise use an isolated test harness until the preview is built. Neither option fulfills the runtime business integration gate.

### Value sourcing

| Value | Source |
|---|---|
| Record version/id/observedAt | Fixed schema version, random UUID and Node UTC receipt/creation instant |
| Error category/source/location key | Fixed capture-site mapping and permitted route/page configuration |
| Safe frames | Sanitized locations matched to the actual app source/build inventory |
| Product role | Real Feature 6 context used by the authorized action, or fresh context for a received workspace view |
| Submission/approval occurredAt | Persisted submittedAt/decidedAt in the committed workflow result |
| Approval method/timing | Persisted decision method and original week freeze comparison |
| View page and dedup id | Actual successful navigation instance, checked against server role/page rules |
| Synthetic/environment | Internal controlled test emitter and server configuration, never client fields |
| Queue/drop/write health | In-process writer state with an explicit snapshot timestamp |
| Retention/cap/segment dates | Confirmed limits, managed file sizes and observedAt UTC segment day |
| CLI ranges | Explicit validated CLI dates and fixed Africa/Lagos boundary convention |
| Fallback copy/action | Fixed approved text and normal document reload |

### Critical verification scenarios and completion gate

1. On the actual app capture a descendant render failure and inspect the fallback plus error record; capture an ordinary async/browser rejection separately and verify one observation per supported reporting owner (AC-2, AC-3).
2. Stop/restart PostgreSQL and observe a sanitized readiness/API failure while the independent file sink remains inspectable; confirm expected invalid credentials/validation/404 outcomes do not flood crash records (AC-1, AC-2).
3. Inject canary text into raw error messages, request bodies, unknown fields, fake frame paths and thrown objects. Prove none persists; valid safe locations and fixed codes remain. Exercise Express failures both before and after headers are sent in development and compiled production. Capture stderr and client output as well as JSONL, and prove the canary/raw stack is absent from every output while the generic response or terminal connection behavior remains correct. Probe forged role/synthetic fields and cross origin/oversize requests (AC-2, AC-4, AC-7).
4. Exercise backpressure, full queue, write errors, rotation, old files, total cap, partial lines and restart. Observe drops/stale health/fallback stderr and prove ordinary actions do not await sink I/O (AC-5, AC-6).
5. Spawn child process uncaught exception and unhandled rejection failures with canary text. Confirm one sanitized fatal diagnostic, no default raw message/stack in stderr, and unsuccessful termination. Check bounded normal flush without claiming fatal file persistence (AC-2, AC-4, AC-5).
6. Verify real authenticated navigation emits once while rerenders/session refreshes/previews do not. Without auth context it remains unavailable rather than trusting a role parameter (AC-7).
7. Through actual Feature 10 Employee submission and Feature 19 human approval, compare committed database outcomes with runtime event records. Through Feature 17 own completion, verify automatic buckets. Approve an eligible older pending request to produce a real late human event. Replays/declines/rollbacks emit no new approval. Boundary-time classification tests can use fixtures, but cannot replace these workflow checks (AC-8, AC-9).
8. Run tooling, focused Node/tsx regression tests and real browser/production checks. Production includes recovery/capture but no development fault probe or synthetic UI. Record exact event sources and any absent workflow as pending (AC-10).

Use the already chosen Node test runner and tsx; no new test framework is needed. Tests of writer/collector/projection use temporary directories and controlled clocks. Real workflow tests use approved isolated local fixtures, never reset ordinary developer data, and preserve mandatory business audits. Browser verification can use the Feature 7 tooling when available, but no missing tool or workflow is silently counted as passed.

## Build plan

1. Implement validated record projections, independent bounded local writer, rotation/retention, health fallback and inspection/summary commands (AC-1, AC-4 through AC-6).
2. Integrate server/bootstrap/health/API capture and client root/global reporting; build the approved fallback and controlled local probes with the required accessibility behavior (AC-2, AC-3, AC-4).
3. Add guarded browser ingestion, the real-context view adapter, typed post-commit event interfaces and explicitly synthetic contract fixtures. Document wiring for the owning workflows without building them under Feature 8 (AC-4, AC-7, AC-8).
4. When Features 10, 17 and 19 exist, wire their actual committed results and verify runtime view/submission/human/automatic/late events (AC-7 through AC-9).
5. Run `/test` and `/check verify` with real app, privacy, failure and production evidence. Intermediate foundation results leave the final feature/Verify box open until the actual workflow gate passes (AC-1 through AC-10).

## Consequences

The foundation gives useful local visibility without a vendor account or collecting employee histories. Error storage remains usable during database outages, and telemetry I/O cannot decide whether a task or approval succeeded.

Best effort records can be lost or duplicated, and the cap can shorten retention. Local files need writable persistent storage and one owning process; they are not a hosted alerting service, an exactly once ledger or a supported shared multi-process log transport. The reduced diagnostic schema omits information that could have helped debugging. Sanitized bundle locations do not provide original production source maps.

Feature 8 remains open across later role work by the user's explicit choice. A passing formatter, synthetic probe or local sink milestone is not the completion of the real workflow requirement.

## Follow-up

Wire runtime role views with Feature 6 and post-commit events with Features 10, 17 and 19. Their own specs must preserve these trigger/value sources and idempotent replay behavior. Hosted monitoring/analytics providers, operational alerts, source map upload and durable outbox delivery remain future decisions, not silently enabled integrations. Preserve existing audit and authoritative performance reporting ownership.

## Rationale

See `rationale.md` for alternatives, confirmed tradeoffs and checked sources.
