# Local development data proof

Root `AGENTS.md` and `server/AGENTS.md` apply. This area implements spec [0004](../../docs/specs/0004-seeded-db-api-skeleton/index.md).

`access.ts` determines whether the proof router may be mounted and checks direct socket, Host, configured port, Origin and write Fetch Metadata. It accepts only approved loopback database hosts and rejects database URL host, hostaddr and service query overrides. Forwarded headers never replace those sources. With Neon (the project default), the proof router stays unmounted; authenticated product APIs are the path forward. Production and unsafe configurations omit the router and retain the main API fallback.

`router.ts` exposes only the fixed fictional Ada Week 44 allowlist. Every read, insert and replay revalidates actor, tracker, week and visible task scope. Page size is 20 with a 21st row probe and page range 1 through 10000. Do not broaden this into a production task API or accept caller supplied actor, role, owner or week.

The shared pure text rules live in `src/features/data-proof/validation.ts`. Proof JSON is limited to 16 KiB. Replies are trimmed and limited to 1 through 500 Unicode code points, excluding null characters and unpaired surrogates. The existing TaskComment primary key stores `proof-comment-` plus the normalized UUID v4. A uniqueness failure ends its transaction before a fresh scoped replay lookup. Matching author, task and body are all required. Never update a replayed row.

Keep each proof transaction's wait and timeout bounded to 5000 ms. Sequence reads on its transaction connection. Return fixed error envelopes and log only sanitized categories. This proof writes TaskComment only, with no task updates, lifecycle audit, email or notification side effect.

The UI is a conditional development module under `src/dev/data-proof/`. Its unresolved tuple lives in namespaced sessionStorage before sending. Unknown outcomes retry the same identity. Confirmed saves survive a failed read refresh. Storage failure blocks a fresh write. Page and API code stay out of the production browser bundle.

Verification helpers are `scripts/check-proof-context.ts`, `scripts/verify-data-proof.ts` and `scripts/check-proof-persistence.ts`, run with the existing local `tsx` binary. Validate the complete local connection rule before migration or seed commands. Test replies are retained; temporary fixture probes roll back. Evidence and the two browser reply markers used for the persistence check are recorded beside the spec.

_Drafted by /sync from the introducing change, worth a quick human pass._
