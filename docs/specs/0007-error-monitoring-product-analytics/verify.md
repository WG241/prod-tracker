# Verify: Error monitoring and product analytics, spec 0007

Last exercised on 2026-11-02. Foundation verification passed. Full feature verification remains open for real authenticated views and Features 10, 17 and 19. No credentials were reset or provisioned. The earlier instruction to keep authenticated checks pending remains in effect.

## Foundation checks

- [x] Inspect the Employee Add task card and buttons in the HTTP prototype before implementing the approved recovery surface. Reference: `http://127.0.0.1:5182/docs/workforce-prototype-updated.html`, `.local/verification/feature8/prototype-card-button.png`. AC-3.
- [x] Run the real development app, exercise render recovery, timer errors and unhandled rejections, and receive sanitized 204 reports. The fictional preview emits no workspace visits. AC-2, AC-3, AC-4, AC-7.
- [x] Fail the real app's initial render with a browser canary fixture. Confirm the focused heading, explanatory text, keyboard Reload, no horizontal overflow at 320 pixels, no canary in UI/console/report bodies, and zero targeted axe violations. Both development and production passed. AC-2, AC-3, AC-4.
- [x] Reject forged role, synthetic, source and message fields; reject bad UUIDs, invalid origins/Fetch Metadata, incorrect types and oversized bodies. Ignore forwarded addresses for rate limits. Invalid frames are omitted. AC-4, AC-7.
- [x] Exercise the real role adapter with isolated resolver fixtures. Verify 401/403/503, server derived role projection and cookie forwarding. These fixtures do not prove an actual authenticated visit. AC-7.
- [x] Verify bounded queues, accepted record order under stream backpressure, single stream writes, disk failures, retry delay, terminal backpressure and bounded shutdown using temporary storage. AC-5.
- [x] Verify restart with partial lines, size/day rotation, 30 day expiry, the combined cap using smaller test limits, unrelated file preservation, and directory/junction safety. AC-6.
- [x] Verify fixed error categories survive removal of an old bundle from the current source inventory, while unverifiable frames are omitted. AC-2, AC-4.
- [x] Inspect and summarize without a valid DATABASE_URL. Verify Lagos date boundaries, occurrence versus observation filtering, UUID deduplication, synthetic exclusion, latest health age, and malformed/incomplete line counts. AC-1, AC-4, AC-6.
- [x] Verify the real app cannot download managed files through normal or Vite filesystem URLs. Both return generic JSON 404 responses. AC-1, AC-4.
- [x] Disable Vite raw console/error forwarding. A browser canary timer produces a sanitized record without forwarding raw text over its WebSocket or exposing it in the browser console. AC-4.
- [x] Exercise Express terminal failures before and after headers in source and compiled server fixtures. Generic 500 or terminated connection, no raw message/stack in stderr or records. AC-2, AC-4.
- [x] Spawn uncaught exception and rejection children against source and compiled guards. Each exits 1 and produces one fixed fatal diagnostic. No raw canary appears. No fatal file persistence is claimed. AC-2, AC-4, AC-5.
- [x] Launch an isolated compiled app on port 5183 with an unreachable loopback database. GET `/api/health` returns 503, no-store and the existing safe unavailable body. Inspect DATABASE_UNAVAILABLE with only a safe compiled source frame. This does not stop or modify Neon. Restart the normal Neon app and confirm 200 connected readiness. AC-1, AC-2.
- [x] Verify the actual compiled production probe returns 404, the anonymous view endpoint returns 401, private input returns 400, and the bundle excludes development exercise strings. AC-4, AC-7, AC-10.
- [x] Run production with TELEMETRY_MODE=off. HEAD discovery returns 404, recovery still renders and accepts keyboard focus, and no telemetry POST occurs. Existing file retention remains independently covered. AC-3, AC-6.
- [x] Verify typed committed result contracts with isolated fixtures: replay omission, human/automatic buckets, persisted occurrence time, and equality at freezesAt classified LATE. No fixture substitutes for the workflow gate. AC-8.

## Commands and evidence

- [x] `npm run check`: lint, strict types and production build passed.
- [x] `TELEMETRY_BROWSER_URL=http://127.0.0.1:5182 npm run test:telemetry`: 29 passed, 0 failed; the off target case was excluded for this configuration and passed separately below. Windows uses PowerShell environment assignment.
- [x] Production target, selected `real app render` browser test against port 3000: 1 passed.
- [x] Off target, selected `off mode` browser test against port 3000: 1 passed.
- [x] `node .local/verification/feature8/compiled-proof.mjs`: compiled terminal checks and both fatal exits passed. Result: `.local/verification/feature8/compiled-proof.json`.
- [x] `npm run telemetry:inspect -- --kind error --limit 2`: includes the actual isolated outage record with no malformed/incomplete lines. `npm run telemetry:summary` remains usable independently of PostgreSQL.
- [x] Final focused capture regression: 11 passed after ensuring a terminated partial response does not claim an unsent HTTP 500 status. Final lint, build, test type check and whitespace check passed.
- [x] Stop verification servers on 3000, 5182 and 5183, then run `npm run telemetry:prune`: removed 0 files, 20289 managed bytes retained.

Runtime evidence is recorded in [the verification report](../../reviews/2026-11-02-feature8-telemetry.md). Local artifacts are ignored. The safe mobile recovery screenshot is retained in `docs/reviews/assets/feature8-recovery-mobile.png`.

## Remaining gates

- [ ] Use privately corrected fixture credentials to exercise actual authorized navigation. Prove one workspace_viewed event across rerenders, session rechecks and navigation, with no preview promotion. Current authenticated checks are pending by user instruction. AC-7.
- [ ] Integrate and exercise newly committed Employee submissions through Feature 10. Replays and rolled back submissions emit nothing new. AC-8, AC-9.
- [ ] Integrate Feature 19 human approvals, including an eligible older pending request that produces a real late approval. Verify declines, failed writes and replays emit no approved action. AC-8, AC-9.
- [ ] Integrate Feature 17 own completion and demonstrate real automatic submission/approval buckets, preserving mandatory business audits. AC-8, AC-9.
- [ ] Complete the whole feature's Test it and Verify it gates after these real workflows exist. AC-9, AC-10.

## Conformance

AC-1 through AC-6: foundation behavior exercised, with the documented best effort and recovery limits. AC-7: adapter and preview exclusion exercised, actual authorized visit proof pending. AC-8: contract fixtures exercised, actual workflow integration missing. AC-9: owning workflows are not built. AC-10: foundation tooling/runtime evidence passed, final workflow gate remains open. This is an intermediate milestone result, not a full feature PASS.
