# Verify, accessibility baseline

Updated 2026-11-02. The implementation is built. Full Test and Verify gates remain open. The user explicitly deferred authenticated role checks after the saved local fixture password was rejected by Neon. Actual NVDA and native browser zoom were not tested because the Windows computer use helper was unavailable.

## Passed automated and visual checks

- [x] Opened the approved HTTP prototype and visually inspected all five role shells, Employee form, date range, task drawer, account disclosure, HR More and sign in before UI changes. Local reference captures are under `.local/verification/feature7/` (AC-1, AC-9).
- [x] Wrote `docs/accessibility.md`, the typed built/planned state inventory and later feature adoption checklist. Added the design document pointer and measured corrections (AC-1, AC-9).
- [x] Checked every role shell at 1280px, 800px and 320px with normative axe rules. Exercised exact menu order, skip link, account keyboard behavior, HR More navigation and heading focus, and responsive focus transfer (AC-2, AC-6, AC-7).
- [x] Exercised invalid form submission, first invalid focus, same field fallback announcement, associated help/errors, invalid field editing, and Enter submit focus during pending work. Temporary pending controls guard repeated activation. Generic service error injection retains focus and announces the error (AC-3, AC-5).
- [x] Exercised dialog sizes, long dialog, drawer and long drawer. Checked real native modality, keyboard boundaries, Escape, initial focus, visible opener restoration, vanished opener fallback and More heading precedence (AC-4).
- [x] Exercised root and modal event deduplication, immediate opening events, closure during a queued announcement, completion after closing, context reset and rejection of obsolete completion callbacks. This proves DOM/event behavior, not NVDA speech (AC-5).
- [x] Checked local keyboard table scrolling, spacing overrides, reduced motion and forced colors emulation, narrow layout and measured field/focus contrast. Visually inspected implementation screenshots. Real browser zoom and a real Windows contrast theme were not inferred from these checks (AC-6).
- [x] Required missing controls fail explicitly. Unsupported modes, origins and missing browser setup fail rather than silently skipping. Applicable axe findings fail regardless of impact; incomplete and advisory results are recorded separately (AC-7).
- [x] Built and exercised production sign in, its recovery dialog, invalid and pending forms, service failure presentation, narrow/spacing/mode states, and exclusion of component previews and the actual development proof API path (AC-9, AC-10).
- [x] Final lint, strict application/server/test checks and production build pass. Regression evidence and selected screenshots are recorded in [the verification record](../../reviews/2026-11-02-feature7-accessibility.md) (AC-10).

## Required checks still open

- [ ] Configure the existing fictional Neon credential privately, run the full inventory without an authenticated case filter, and inspect actual role shells, Profile, disclosure and sign out in development and production (AC-2, AC-9, AC-10). The user chose to keep these checks pending; do not change passwords or spoof a role to make them pass.
- [ ] Exercise the built proof composer in its approved fixture environment. Neon intentionally omits its development API. Current scans cover its unavailable/retry UI, not populated comments, composer validation or a retained database save (AC-3, AC-5, AC-9).
- [ ] Run actual NVDA with Chrome or Edge. Record exact Windows/browser/NVDA versions and observed speech or Speech Viewer output for names, roles, states, reading order, invalid field movement and same field fallback, root/modal messages, duplicate events, closed scopes and More focus return (AC-8).
- [ ] Check real native 200 and 400 percent browser zoom from an approximately 1280px content viewport, record resulting CSS dimensions, and verify focus visibility, text spacing, content and operations. Do not substitute CSS zoom, device scale, screenshots or a 320px emulation for actual browser zoom (AC-6, AC-8).
- [ ] Complete `/check verify` against every remaining acceptance item. Full product or future role conformance is not established by this shared baseline (AC-1 through AC-10).

## Reproduction

Start the actual app with Neon credentials and the matching `BETTER_AUTH_URL`. Run `npm run test:a11y:install` once and `npm run test:a11y`. The default target is development at `http://127.0.0.1:5173`. For production, build and start the compiled app, set `A11Y_TARGET=production` and the matching loopback `A11Y_BASE_URL`, then repeat.

The selected runs used development at port 5182 and compiled production at port 3000 with the existing private Neon configuration. A preexisting service at port 5173 retained its old local database configuration, so it was not the implementation verification target. No database schema or credential was changed for Feature 7. A short lived diagnostic throttle counter was used while diagnosing the initial Neon connection timeout.

The user approved saving this checklist beside the spec and running the suite to fix failures. Spec status stays In Progress. Test and Verify remain unticked until their complete required coverage passes.
