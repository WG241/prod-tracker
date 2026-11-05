# Shared accessibility baseline

Feature 7 implements spec 0006 for the built shared controls and foundation pages. This scoped baseline is not a claim of full product WCAG 2.2 conformance. Future role workflows need their own checks. Required manual evidence remains open until actual keyboard, NVDA and browser zoom observations are recorded.

## Shared contracts

Use one main landmark, a clear page heading, descriptive document title and English document language. Preserve the prototype's role destinations. The skip link reaches main content; in place navigation focuses the updated heading. Routine data refresh does not move focus. Account actions remain ordinary disclosure controls, with Escape restoring their trigger and outside pointer dismissal preserving the clicked target.

Fields use visible labels, stable ids, native required/type semantics, and associated help and error text. Custom forms use `noValidate` to avoid competing browser bubbles. Initial errors appear on submit. After errors render, focus the first invalid field in document order. Field errors are not live regions. If that field already had focus, emit one alert containing its label and error for that submit attempt. Recheck only fields already invalid while editing; untouched typing produces no validation errors. Generic service errors retain logical focus and use a separate alert event. Domain validation belongs to its feature.

Temporary pending actions use `aria-disabled`, busy state and an activation guard, preserving the focused input or submit control. Permanent unavailability uses native disabled and readable associated explanation. Starting a request is never evidence of success.

Dialogs and drawers use native `showModal()`, an internal title, optional short description, and a meaningful initial target. Native modality prevents background interaction. Escape and close work. Ordinary close restores a connected, visible, enabled opener or the current main heading. More navigation gives the new heading precedence. Long structured content can focus its heading and scroll locally.

Announcement hosts start empty. Plain text events have a caller supplied id, status or alert intent, and context key. Root and modal scopes have separate hosts. An open modal owns its announcements; queued events for a closed scope are discarded. Repeating an event id cannot repeat speech. New deliberate actions use new ids. Context changes clear obsolete text and queued events. Completion after modal close can announce at root only after the close completes and the caller confirms relevance.

Tables use captions, row and column headers, and native structure. Their named scroll region is keyboard focusable only when it overflows. Avatars beside a visible name are decorative; a standalone identity avatar needs an explicit accessible name.

## Visual checks and coverage limits

Measure actual computed foreground/background pairs, including state backgrounds and gradients. Normal text needs 4.5:1, qualifying large text 3:1, and essential authored control boundaries and focus 3:1. The project keeps its visible 2px focus outline with 3px offset. Focus Appearance is AAA; it is not relabeled AA. Pointer targets meet 24px or a documented applicable exception. Preserve the prototype's larger targets.

Check 320 CSS pixels without page overflow, with local scrolling for necessary tables. Real 200 and 400 percent browser zoom are separate manual checks; CSS zoom and device scale emulation do not count. Test line height 1.5, paragraph spacing 2em, letter spacing .12em and word spacing .16em as user overrides. Reduced motion and forced colors emulation are reported as emulation.

Initial automation is Chromium with Playwright Library and axe through Node/tsx. All applicable WCAG 2.0, 2.1 and 2.2 A/AA findings fail regardless of impact. Incomplete results require human review, and advisory best practices are reported separately. Missing required routes, controls or browser binaries fail. An automated pass cannot close required manual evidence.

Actual NVDA with Chrome or Edge must check names, roles, states, reading order, validation, root and modal speech, More navigation and focus return. Record reader, browser and Windows versions and actual speech or Speech Viewer outcomes. Firefox, WebKit, Safari, mobile readers and untested Windows contrast themes remain outside this initial matrix.

## Later feature checklist

1. Inspect the exact approved prototype state and reuse shared controls.
2. Supply labels, stable associations and feature owned validation.
3. Provide meaningful event ids and context keys for announcements.
4. Preserve keyboard order, pending focus and modal restoration.
5. Extend the typed browser state inventory for every built route and meaningful state.
6. Check contrast, narrow layout, spacing, supported modes and actual role journeys.
7. Record actual assistive technology and production coverage without treating planned pages as passed.

## Running the checks

Run the real app with the normal private Neon configuration using `npm run dev`. Install the selected Chromium binary once with `npm run test:a11y:install`, then run `npm run test:a11y`. The command checks test types and runs Node/tsx with Playwright Library and axe. It does not install a browser on each run. Required routes and controls must exist. No second test runner is used.

`A11Y_BASE_URL` defaults to `http://127.0.0.1:5173` and accepts only a loopback HTTP or HTTPS origin. `A11Y_TARGET` defaults to `development`; select `production` against a compiled app started with `npm run start` and its matching auth origin. On PowerShell, set these variables with `$env:A11Y_BASE_URL='http://127.0.0.1:3000'` and `$env:A11Y_TARGET='production'` before the test command.

The checked in inventory is `tests/accessibility/surfaces.ts`. Reports and screenshots go to ignored `.local/verification/feature7/<target>/`. Timestamped reports preserve each run; `report.json` is the latest run only, including any explicit test filters. Reports contain URLs, modes, rule ids, selectors and versions, not passwords, tokens, raw storage state or full requests. No HAR or trace is enabled. The five real role checks require the existing fictional credentials in private `LOCAL_AUTH_TEST_PASSWORD`; they never spoof a role or reset a credential.

The development proof page is built, but its API is intentionally unmounted with Neon. A scan of its unavailable/retry presentation does not verify the local proof composer or a database save. Those consumer states remain explicit coverage debt until the approved proof fixture environment is available. Planned role workflows remain listed as not built.

The current evidence and open gates are recorded in [Feature 7 verification](specs/0006-accessibility-baseline/verify.md) and [the baseline review record](reviews/2026-11-02-feature7-accessibility.md).

## Sources

The accepted contract is [spec 0006](specs/0006-accessibility-baseline/index.md). Normative references are [WCAG 2.2](https://www.w3.org/TR/WCAG22/) and [WAI ARIA 1.2](https://www.w3.org/TR/wai-aria/). Implementation guidance uses [Playwright accessibility testing](https://playwright.dev/docs/accessibility-testing) and the [APG modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/).
