# Verify, sign in and role access

Updated 2026-10-30. Feature 6 remains in progress. The code, database, tests and review are in place. Browser acceptance is partially verified, with production and interrupted response checks still open.

## Completed evidence

- [x] The additive migration is applied to native local PostgreSQL. `db:verify` confirms 23 model tables, the four original history guards, fixture repeatability and 23 rejected writes rolled back. Existing Workforce ids and records were retained (AC-1).
- [x] Better Auth 1.7.13 is installed exactly. The private Prisma adapter enables transactions. A forced credential insertion failure proved identity and credential pair rollback (AC-1, AC-7).
- [x] The five local fictional identities are explicitly provisioned. Repeating auth fixture provisioning preserves credentials, readiness timestamps and active sessions. The normal seed remains independent of auth configuration (AC-1, AC-7).
- [x] `npm test` passes all 22 Node and HTTP tests, including strict TypeScript checks of tests and operator scripts. Tests require a separate named local database, reject ordinary database aliases and never reset the development database (AC-1 through AC-8).
- [x] Final lint, production build and `git diff --check` pass. Lint includes the tests. Git reports only its existing line ending conversion notice for the Prisma schema, not a whitespace failure (AC-10).
- [x] All five roles pass live development HTTP journeys: sign in, safe session context, own landing and Profile, foreign role denial, unknown page handling, fixed redirects, sign out and replay denial. Protected documents retain `no-store` through Vite (AC-2, AC-3, AC-5).
- [x] All five roles pass compiled production HTTP journeys, including route and cache checks, repeated credential fixture preservation, sign out and replay. Development tool APIs return 404 and tool bundles are absent from production assets (AC-2, AC-3, AC-5, AC-9).
- [x] A compiled application process restart on temporary port 3001 preserves the session and the accumulated email failure window. The next completed fifth failure still leads to 429 and Retry-After (AC-3, AC-8).
- [x] A real PostgreSQL stop produces 503 for health, session and protected Profile document requests without expiring the cookie. PostgreSQL is restarted in cleanup; the original session works afterward and can be signed out (AC-3, AC-4).
- [x] Compiled startup rejects invalid auth secret or origin configuration, names the variable and does not print its value. The trusted provisioning command refuses a noninteractive password prompt (AC-7, AC-8).
- [x] GPT-6.1 Sol reviewed the final code and approved it with no outstanding findings. See [review](../../reviews/2026-10-30-feature6.md) (AC-10).
- [x] Operator guidance, context files and the unreleased changelog are written (AC-10).
- [x] Final compiled smoke check after the last audit and navigation fixes passes all five roles, document cache headers, safe redirects, Profile, sign out, replay denial and tool exclusion. Browser assets contain neither the server auth secret nor the private fixture password (AC-2 through AC-5, AC-9).

## Regression coverage

The tests exercise persisted credentials for every role, host only HttpOnly SameSite=Lax cookies over the explicit local HTTP exception, independent sessions, revoked cookie replay, expired sessions, daily renewal and forwarded cookie headers. They commit role changes and deactivation in the test database, verify immediate access changes, and restore fixture state. Pending identities and an email mismatch revoke access; the mismatch test uses a fresh live session.

Policy checks cover own and foreign tasks, allowed and denied current team access, frozen history after reassignment, director business scope, Executive individual denial and own account access, HR access, and a real pending request temporarily routed through the seeded relief relationship. Relief start, end, early termination and leave cancellation boundaries are checked and restored.

Input checks cover unsupported methods, selectors, repeated query parameters, malformed or oversized JSON, media type, cross origin mutations, tampered cookies and unexposed provider endpoints. Password tests cover length bounds plus required uppercase and digit composition. Persistent email and IP limits, concurrent failure updates and database failures fail closed.

Provisioning checks cover pending activation failure, password verified resume, pair rollback, incomplete identity repair and refusal for ready, session bearing or previously activated identities. Audit and counter failure triggers prove no issued cookie or false completion on failed sign in, no claimed sign out when provider deletion fails, and retained requested evidence when a final outcome audit fails. Temporary failure triggers are removed; generated test people and append only audit evidence remain in the test database, with generated people deactivated afterward.

## Findings corrected before handoff

The review and runtime checks found defects that were reproduced and corrected: provider sign out could swallow deletion errors; current assignment scope could expose frozen tasks; test database aliases could bypass a literal host comparison; downstream serving could override cache or error status; an email mismatch test had reused a revoked session; and email counter cleanup occurred after sign in completion audit. Regression checks now cover these cases. Bare own role prefixes also redirect without a false access denial notice.

Initial compiled readiness briefly returned 503 while cold, then both services returned healthy status. The startup harness deadline was increased for module loading on this host. No successful readiness response was inferred from a startup log alone.

## Browser evidence, 2026-10-30

Chrome and the in app browser became available. The following checks were observed on the real app. Screenshots are local scratch evidence under `.local/verification/feature6/`, excluded from Git.

- [x] Compared the prototype Sign-in preview with the implemented desktop form, including the approved heading cap, empty credentials, disabled recovery explanation and absent role picker (AC-2, AC-9). Evidence: `sign-in-desktop.jpg`.
- [x] Exercised empty fields, password length focus, wrong password, password visibility, Tab and Shift+Tab, and username/current-password autocomplete (AC-2, AC-8, AC-9).
- [x] Signed in all five fictional roles in development and observed each real name, landing and menu order. Employee reload, Profile, foreign role redirect, fixed notice removal and sign out passed. Independent Chrome and in app browser sessions remained independent after signing one out. Cookie attributes were verified by live HTTP headers and tests, not by inspecting browser storage (AC-2, AC-3, AC-5).
- [x] Observed the email limit banner and disabled countdown after five completed wrong passwords. Evidence: `throttled-sign-in.jpg` (AC-8).
- [x] Temporarily deactivated the fictional Employee in the separate auth test database. Browser reload withheld the workspace and correct credentials showed the account unavailable message. The account was restored and signed in successfully through the in app browser. Evidence: `inactive-account.jpg` (AC-2, AC-4).
- [x] Stopped PostgreSQL and reloaded the HR Settings page. Only the service unavailable message and Retry rendered. After database restoration, Retry restored the original HR session and Settings page. Evidence: `service-failure.jpg` and `service-recovered.jpg` (AC-3, AC-4).
- [x] Checked real Chrome at 320 CSS pixels and native 200 percent zoom. A 408px mobile overflow was reproduced and fixed by changing the single grid column to `minmax(0, 1fr)`. The document then measured 320px. HR More navigation, dialog focus wrapping and Escape focus restoration passed. Evidence: `sign-in-mobile.jpg`, `hr-more-mobile.jpg` and `sign-in-zoom200.jpg` (AC-9).
- [x] Reran `npm run check` after the CSS correction. Lint and production build passed. GPT-6.1 Sol approved the sole CSS delta in the review addendum (AC-10).

Foreground role refresh was attempted using in app browser tab and panel transitions, but those controls did not produce a document visibility change. This is not recorded as a product failure or a pass. Temporary role changes were restored. Chrome control later disconnected, and native browser control stopped because it could not identify the current URL reliably. Production browser journeys, genuine foreground access changes, interrupted sign in and sign out responses, and the remaining combined checklist items below still need verification.

## Browser acceptance still required

The exact prototype sign in reference was visually opened before UI implementation and compared again with the implementation on 2026-10-30. The evidence above records the completed subset. Keep the combined items below open until every clause has passed.

Once the browser connection is available, resume these steps on the actual app:

- [ ] Open the approved prototype at `http://127.0.0.1:5173/docs/workforce-prototype-updated.html`, choose Sign-in preview, and compare the real `/sign-in` screen. Check the split layout, decorative card, type cap, fields, visibility control and button. Confirm no prefilled password or role picker (AC-2, AC-9).
- [ ] Use Tab and Shift+Tab through the form. Submit empty and malformed values, confirm first invalid field focus and associated errors, toggle password visibility, and check autocomplete and error announcements. Forgot password is disabled with its accessible explanation (AC-2, AC-8, AC-9).
- [ ] Sign in as each local role with the private fixture password, inspect its exact menu order and real name, reload, open Profile from the account disclosure, and sign out. Inspect actual browser cookie attributes and independent device behavior (AC-2, AC-3, AC-5).
- [ ] Navigate to a foreign role URL and an unknown own page. Check the fixed toast, chosen landing and removal of the notice flag. Return from a background tab after a role or account change and confirm private context is withheld during resolution (AC-4, AC-5, AC-9).
- [ ] Exercise incorrect password, correct password for an inactive account, throttling, service failure and Retry. Confirm countdown controls, no false sign out, no stale role shell during failed resolution and recovery after service restoration. Interrupt a sign in and sign out response and inspect truthful UI recovery (AC-2 through AC-4, AC-8).
- [ ] At 320 CSS pixels and 200 percent zoom, check fields, errors, account disclosure and HR More navigation without page overflow. Confirm focus behavior after navigation (AC-9).
- [ ] Repeat the main sign in, denied navigation, Profile, sign out and retry journeys against compiled production at `http://127.0.0.1:3000`. Confirm no preview controls and no reachable production proof tool (AC-9, AC-10).

## Completion state

The `Build it` UI integration and `Verify it` checkboxes remain open until the implementation is rendered and the browser steps pass. Tests, review and documentation are complete. The feature and spec must not be marked done or Accepted on HTTP and source inspection alone.

The governing design's precondition paragraph predates the built Feature 4 shell and completed Feature 5 proof. Current scope and code establish those dependencies; no design decision was changed by this implementation.

At this handoff, PostgreSQL is running and both local services are available at ports 5173 and 3000 for the pending browser checks. The final production process uses a loopback host and `BETTER_AUTH_URL=http://127.0.0.1:3000`; development uses port 5173. Recheck readiness when resuming. Private generated auth configuration and fixture credentials remain in ignored `.env`; no credential is prefilled in the UI or written into this record. No commit or push was made.
