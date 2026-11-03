# Telemetry context

Root and server AGENTS.md apply. This area implements the foundation of [spec 0007](../../docs/specs/0007-error-monitoring-product-analytics/index.md). [Operations and integration](../../docs/telemetry.md) describe the supported commands and limits.

Use explicit closed record projections. Never persist arbitrary exception, request, response, session or domain metadata. Source locations must match the known source/build inventory. Unknown locations can be omitted without losing the fixed error category. Business audits remain independent.

One process owns `.local/telemetry/`. Run offline prune only while the app is stopped. Writer offers return immediately, never await disk I/O or decide a business transaction's outcome. Preserve the queue, record, stream, retry, retention and shutdown bounds. Tests use explicit temporary roots, never ordinary developer data.

Ingestion derives origin/environment and real role context on the server. Keep socket limiter keys only in bounded memory. Anonymous error reporting is independent of the database. A view never trusts a caller role or fictional preview. Cookie forwarding belongs to the existing session policy.

Future workflows emit only from newly applied committed results. Persisted occurrence times, initiating roles, decision methods and the original task week's freezesAt provide values. Replays, rollbacks and declines emit no new approval. Contract fixtures never fulfill the actual workflow gate.

Private storage must stay blocked before asset serving, including Vite filesystem paths. Keep raw browser console forwarding disabled. Fatal guards suppress raw Node exception output and terminate unsuccessfully. React root callbacks own render reporting, while the outer recovery boundary owns UI and focus.

History capture reports the trusted server category `HISTORY_CAPTURE_FAILED`, source `background`, location `history-capture`. Public browser ingestion cannot claim that source or category. Capture emits no submission or approval analytics, and diagnostics never decide its transactional audit outcome.

`npm run test:telemetry` uses Node/tsx. Browser cases require an explicit loopback TELEMETRY_BROWSER_URL and matching development/production/off target. Real authenticated/workflow checks remain distinct from resolver and event fixtures.
