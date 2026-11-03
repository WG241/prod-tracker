# Local telemetry

Feature 8 stores diagnostic observations and aggregate product events in `.local/telemetry/`. The first three build milestones in [spec 0007](specs/0007-error-monitoring-product-analytics/index.md) are implemented. Actual submission and approval integration remains in Features 10, 17 and 19. These files never replace business audits or authoritative performance reports.

## Running and inspecting

One application process owns this directory. Run development and production verification sequentially. Shared storage between simultaneous processes is unsupported. Stop the application before the offline prune command.

```sh
npm run telemetry:inspect
npm run telemetry:inspect -- --kind error --limit 50
npm run telemetry:summary
npm run telemetry:summary -- --from 2026-11-01 --to 2026-12-01
npm run telemetry:summary -- --include-synthetic
npm run telemetry:prune
```

These commands need no PostgreSQL connection or running server. Inspect keeps the latest 20 matches by default, with limits from 1 through 500. Kinds are error, product, health or all. Dates use Africa/Lagos midnight, with an inclusive from and exclusive to. Product filters use the persisted event occurrence time. Diagnostics use observation time. The summary reports its actual retained time range and the age of its latest health snapshot.

Synthetic records are excluded unless requested explicitly. Duplicate UUIDs count once per read. Damaged and incomplete lines are counted without echoing their content. Exit code 2 means damaged or incomplete data was found. Invalid options or inaccessible storage return 1. A normal report returns 0. Missing historical bundle locations are omitted without losing the fixed error category.

## Storage and failure behavior

The writer accepts at most 256 queued records, each at most 4096 bytes with its newline. It serializes stream work, uses a 64 KiB stream high water mark, and waits for callback completion and drain before taking another record. Error and health records share diagnostic segments. Product records use separate event segments. Segments rotate at a UTC day change or before 10 MiB.

Startup and 30 second maintenance prune recognized, closed segments older than 30 days. The 100000000 byte combined cap takes priority and can shorten retention. Unrecognized files and links are skipped. Storage ancestors must remain inside the explicit project or temporary test root without traversing links. `.local` stays ignored and is blocked before browser asset serving, including Vite filesystem URLs.

Offers do not await disk I/O. A full queue drops the new record. A failed append drops that observation because the line may be partial. Reopening waits at least a second. Health snapshots attempt to expose counters at most every 30 seconds, including after recovery. If recording fails, a fixed diagnostic with numeric counters is offered to stderr at most once a minute, respecting terminal backpressure. Shutdown allows at most one second for draining. Health, delivery and loss counts are per process. A crash can lose accepted records and counters.

## Configuration

`TELEMETRY_MODE` defaults to local, or accepts off. Off unmounts ingestion and browser collectors while still maintaining existing managed files. The recovery screen remains available. No empty files are created solely for off mode.

`TELEMETRY_ENV` optionally selects development, test, staging or production. Its default follows the app's development flag. Invalid mode or environment disables recording and emits a fixed diagnostic, without stopping business startup.

`TELEMETRY_ORIGIN` is optional. Otherwise the server uses the validated `BETTER_AUTH_URL`, or a configured loopback host and port. Conflicting origins, credentials, paths, query strings, fragments or a remote bind without a known public origin disable browser ingestion. Request Host headers never establish trust. No configuration values, directories or tracking credentials are sent to the browser.

The client discovers whether ingestion exists through the existing HEAD method response on `/api/telemetry/error`, before installing global listeners. This adds no configuration endpoint. Discovery failure disables collection for that document. Delivery is best effort, with at most ten pending reports, a three second request timeout, no persistent retry, and no response that changes an auth or business action. Early global errors before discovery completes can be lost. Root reporting callbacks still protect render recovery.

## Capture and privacy

Composition initializes capture before startup work. Pool errors, readiness failures, unexpected auth service failures and terminal Express failures use fixed categories. Error responses remain generic; a response that already sent headers is destroyed without forwarding its exception to Express's default logger. Expected validation, denied access, invalid credentials and ordinary missing routes are excluded.

React root callbacks own render reporting. The outer boundary owns recovery and focus, without a second report from componentDidCatch. Global handlers observe timer errors and unhandled rejections. Shared Error objects are deduplicated. Primitive observations use bounded, short lived fingerprints of fixed fields. Caught auth transport failures are normalized separately, while deliberate cancellation stays unreported.

Records contain only approved categories, roles, page keys, random observation UUIDs, timestamps, counters and safe source locations. They exclude identities, work content, business ids, raw messages or stacks, headers, bodies, query strings, IPs and user agents. Server source locations are matched against the current source/build inventory. Browser reports currently omit frames, preserving the fixed category without claiming original source fidelity or uploading source maps. Readers revalidate locations.

Vite's raw browser console/error forwarding is disabled. Fatal Node exceptions and rejections produce at most one fixed stderr diagnostic and exit unsuccessfully, without Node's default raw exception output or an asynchronous flush. Fatal diagnostics are not claimed as file records.

## Product integration

The real AuthenticatedWorkspace owns the visit hook. A document navigation keeps one UUID across Strict Mode effects, remounts and session rechecks. Ordinary document navigation creates a fresh instance. Sign in, recovery and fictional role previews do not emit visits. `/api/telemetry/view` resolves fresh Feature 6 context, checks the role/page pair, and forwards normal renewal or clearing cookies. Browser bodies cannot supply roles, actor ids, timestamps or synthetic flags.

Future workflow owners call `committedEvents(writer.offer.bind(writer), environment)` only after a successful transaction. `submitted` takes a newly applied result, persisted submittedAt, initiating Employee or Line Manager role and stored method. `approved` takes a newly applied approval, persisted decidedAt, initiating Line Manager role, stored method and the original task tracker's WorkWeek.freezesAt. Replays return false without an event. Rollbacks and declines never call the approval emitter. No additional database lookup reconstructs telemetry after commit.

An approval at or after freezesAt is LATE. Earlier decisions are ON_TIME. Summary keys group one approval by role, method and timing. Late is a subset of approvals, not another completed action. Emitters contain no business ids or outbox. A failure or dropped record must not change the committed action's response.

## Verification

```sh
npm run check
npm run test:telemetry
```

The Node suite uses temporary storage, controlled clocks, bounded stream failures, HTTP fixtures, child processes and CLI invocation. No ordinary database reset or credential provisioning is involved. Browser cases are enabled with `TELEMETRY_BROWSER_URL` set to an explicit loopback origin. Set `TELEMETRY_BROWSER_TARGET` to production or off for those corresponding runs. Only run the matching target against its actual server configuration.

Development `/__ui` contains clearly labeled render, timer and rejection exercises. The bounded loopback `/api/dev/telemetry-probe` accepts only api-error or product-sample. Its server records are synthetic. Neither that route nor the exercise UI exists in production. Browser exercises use the real diagnostic path and can appear as ordinary error observations, but never supply product workflow proof.

See [the checklist](specs/0007-error-monitoring-product-analytics/verify.md) for the runtime evidence and pending authenticated/workflow checks.
