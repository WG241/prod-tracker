# Feature 8 foundation verification

2026-11-02. Intermediate foundation result: passed. Full feature result: blocked on actual authenticated view proof and the owning workflows in Features 10, 17 and 19. This report records runtime verification, not an independent code review.

The first three build milestones now implement validated local storage, bounded capture, recovery, guarded ingestion, a real session resolver adapter and typed committed event contracts. No new database model, hosted provider, persistent tracking identity or business mutation was introduced.

| Evidence | Observed result |
|---|---|
| `npm run check` | Lint, strict type checks and production compilation passed. |
| Development `npm run test:telemetry`, loopback target 5182 | 29 passed, 0 failed. One off target case was intentionally skipped here and passed in its own matching server run. |
| Production selected render browser test, loopback 3000 | Passed actual app recovery, private transport, focused heading, keyboard Reload, mobile layout and targeted axe checks. |
| Production off target browser test, loopback 3000 | Passed recovery with no telemetry POST and absent ingestion. |
| GET `/.local/telemetry/<managed-name>` and `/@fs/<project>/.local/telemetry/<managed-name>` on the real dev app | Both 404 with only `{ "error": "Not found" }`. |
| POST `/api/dev/telemetry-probe` on production | 404 Not found. Development exercise text absent from compiled assets. |
| POST `/api/telemetry/view` without a session on production | 401 Sign in required. No guessed preview role. |
| POST `/api/telemetry/error` with an extra private message field on production | 400 Invalid input, no body echoed. |
| Controlled compiled app, unreachable loopback PostgreSQL, GET `/api/health` on 5183 | 503, Cache-Control no-store, existing unavailable body, completed in 580 ms. |
| `npm run telemetry:inspect -- --kind error --limit 2` after that outage | DATABASE_UNAVAILABLE, test environment, health key, 503, safe `dist-server/server/health.js` frame; no raw exception. |
| Normal Neon app GET `/api/health` on 5182 | 200, no-store, `{ "status": "ok", "database": "connected" }`. |
| Isolated compiled Express fixture before/after headers | Generic 500 before headers, terminal connection after headers, two sanitized records and empty stderr. |
| Compiled exception and rejection children | Each exited 1 with exactly one PROCESS_FATAL diagnostic, no canary or stack. |
| Final focused capture suite | 11 passed after checking that terminated partial responses omit an unsent HTTP status. Final compiled terminal proof also passed. |
| Offline `npm run telemetry:prune`, after verification servers stopped | Removed 0 files; 20289 managed bytes retained. |
| Typed event fixtures | Human/automatic and ON_TIME/LATE buckets work; equality is late; idempotent replay offers nothing. These are contract evidence only. |

Storage fixtures cover bounded queues, ordered backpressure, stream callback/error handling, terminal rate limiting/backpressure, restart, partial/oversized lines, source inventory safety, expiry, total cap, file rotation, symlink/junction rejection and off mode. CLI fixtures prove operation without a valid database URL and validate date/limit options.

The browser check exposed an initial render focus gap. Adding the mount focus path made the same regression pass. Runtime privacy checks exposed Vite development file serving and raw console forwarding. Early private storage rejection, explicit file exclusions and disabled raw forwarding now pass their regression checks. An initial browser run during development dependency restart did not complete; the final full configured run passed.

Normal telemetry mode keeps no browser identity or business ids. Root/global browser diagnostic exercises can appear in error counts through the actual capture path. Only the dedicated server probe marks its records synthetic. Neither kind of exercise proves a real submission or approval. Summaries state that counts are best effort observations rather than unique people or authoritative business totals.

No fixture password was retried, reset or provisioned. No ordinary developer data or business audit was reset. The outage used a separate unreachable connection configuration and left Neon untouched. Verification servers were started sequentially to keep one telemetry owner.

Spec maintenance note: the original statement that Features 4 through 7 are unbuilt is now historical. This implementation reuses the existing controls, auth context and accessibility modules. The spec body remains owned by architect; only its workflow status was changed.

Local artifacts: `.local/verification/feature8/production-api.json`, `compiled-proof.json`, `outage-health.json`, `recovered-health.json`, prototype reference and development/production recovery screenshots. Safe screenshot: [mobile recovery](assets/feature8-recovery-mobile.png).

Scope: first three Build it milestones checked. Build it, Test it, final Verify it and actual workflow integration remain open. Spec 0007 advances only to In Progress. Full acceptance needs the remaining items in [verify.md](../specs/0007-error-monitoring-product-analytics/verify.md).
