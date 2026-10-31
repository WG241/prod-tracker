# 0006. Accessibility baseline

**Date**: 2026-10-28
**Status**: Proposed

## Summary

Make the shared controls and shell usable with a keyboard, screen reader, zoom and spacing adjustments. Extend the existing prototype based foundation with consistent validation, announcements and evidence that later features can reuse. Combine Chromium automation with actual NVDA testing, without treating an automated scan as proof that the whole product conforms.

## Requirements

People can understand and operate shared navigation, forms, tables and overlays without depending on a mouse, color alone or an assumed reading speed. Developers have a repeatable baseline instead of inventing accessibility behavior on each page.

1. **AC-1**: `docs/accessibility.md` defines the adopted shared patterns, relevant WCAG 2.2 A/AA checks, test coverage, browser/reader limits, and later feature adoption checklist. Root `design.md` points to it and records any necessary prototype token/interaction adjustments. The document distinguishes the scoped baseline from a full product conformance claim.
2. **AC-2**: All five shared role shells, compact/mobile navigation, account disclosure and HR More pattern have meaningful names, landmarks, headings, current destination state and logical keyboard order. The skip link, visible focus, no keyboard trap, and focus after navigation work on the rendered app. Role navigation remains the final prototype navigation.
3. **AC-3**: Shared fields have visible labels and programmatically associated help, required and error states. Initial validation occurs on submit, focuses the first invalid field, and identifies its error. If that field already has focus, one fallback announcement supplies the new error without a duplicate field live region. Only fields already invalid are rechecked during edits. Untouched typing does not trigger premature errors. Server/form errors and field validation have distinct focus/announcement behavior.
4. **AC-4**: Native dialog and drawer frames retain real modality, a clear name, contained keyboard focus, Escape and close behavior, sensible initial focus and correct focus restoration. More navigation focuses the updated main heading; ordinary dismissal restores its opener. A vanished opener has the established heading fallback. Account disclosure remains a disclosure, not a simulated ARIA menu.
5. **AC-5**: Shared asynchronous status and error announcements are perceivable once per meaningful event without taking focus unnecessarily. Messages inside a modal use an announcement host inside that modal, not an inert page region. Repeated renders and refreshes do not announce the same save repeatedly, and obsolete events do not replay after a context change.
6. **AC-6**: Used text/control color pairs, focus indicators, target size/spacing, narrow layout, browser zoom, text spacing, reduced motion and forced color behavior meet the stated baseline. Default visual layout follows the prototype; necessary limited changes are documented with measured evidence. Table scrolling is local and keyboard usable.
7. **AC-7**: Automated Chromium tests run through Node and tsx using Playwright Library and axe. They exercise required shared states and keyboard behavior on a real local app. All known applicable A/AA violations are failures regardless of axe impact label; unresolved manual items cannot become an overall baseline pass. Missing required controls, browser binaries or routes fail rather than silently skip.
8. **AC-8**: A real keyboard and NVDA pass in Chrome or Edge verifies names, roles, states, reading order, validation, root/modal announcements and focus changes. Record exact versions and actual outcomes, including real browser zoom and text spacing checks. An accessibility tree snapshot or axe result is not substituted for observed NVDA behavior.
9. **AC-9**: An explicit surface/state inventory separates required built shared patterns, any already built foundation pages, and planned pages. Built Feature 5/6 surfaces are included when present; unbuilt routes are recorded as not built, never passed. Production smoke checks cover actual reachable pages and show that development fixtures remain excluded.
10. **AC-10**: Lint, strict type checks, production build, automated accessibility tests and `/check verify` pass before completion. The user expressly requested regression checks, so this Alpha feature also carries a required `/test` box. Evidence reports what was tested and what remains outside coverage.

## Decision

Retain native HTML controls and the Feature 4 dialog/shell approach. Add small React patterns for form validation and announcements, using the current stack rather than a new form or component framework.

Use `playwright` as a development library with `@axe-core/playwright`, through the already selected Node test runner and tsx. The [Playwright Library documentation](https://playwright.dev/docs/library) supports programmatic browser use; the official [axe integration packages](https://github.com/dequelabs/axe-core-npm) provide the browser analyzer. Do not add a second `@playwright/test` runner. Install and lock dependencies and the Chromium binary during implementation, not this design step.

The user chose Chromium as the initial automated engine and actual NVDA with Chrome or Edge for manual acceptance. Firefox, WebKit, real Safari, mobile screen readers and other assistive technologies are not covered by that initial matrix. The user declined optional Playwright/axe skill and MCP discovery; use the checked official sources and existing tools.

## Feature design

### Boundaries and prerequisites

This is a buildable shared accessibility foundation, not only a policy document and not a redesign of every role page. Feature 4 is approved but unbuilt and must supply the actual shared shell/controls before Feature 7 can verify or complete. Do not silently build Feature 4 inside this run.

Features 5 and 6 are also approved but unbuilt. They are not prerequisites for the component baseline. If their pages exist when Feature 7 is implemented, include them as required built foundation surfaces; otherwise record them as not built and require their later feature checks to adopt this baseline. Never claim their complete workflows passed based on a component example.

There is no new database schema, persistent business state, server data API or domain permission. Do not change password/session policy, task validation limits, role navigation or prototype page composition. `design.md` remains the visual description owned by the Feature 4 build; the accessibility document supplements it rather than becoming a second design system.

### Reference surfaces

Use the final prototype and existing token notes as in spec 0003. Relevant references are each role's initial shell, Employee task list and task details, task/date range forms, the account disclosure, HR More, and the sign in form. Prototype source already contains field labels, form alerts, a polite toast, focus handling and reduced motion rules; retain the intended patterns while correcting gaps in their React implementations.

Before changing UI, obtain an approved visual view of the exact reference state. The prior in app browser file URL was blocked. Source inspection alone is not completed visual inspection, and another driver must not be used to bypass that restriction. Feature 4's approved development component preview remains the test surface; extend its existing groups and fixtures instead of adding another page or sidebar item. No new error summary component was selected.

### Standards and visual acceptance

Use [WCAG 2.2](https://www.w3.org/TR/WCAG22/) as the target for applicable A/AA criteria on the implemented baseline. A component subset does not justify a claim about full pages or complete processes that have not been evaluated.

| Check | Acceptance for the shared baseline | Evidence |
|---|---|---|
| Text and nontext contrast | Normal text at least 4.5:1; qualifying large text at least 3:1; essential authored control/state boundaries at least 3:1 against adjacent colors. Status has text/icon meaning as well as color. | Actual computed foreground/background pairs and ratios, including hover/focus/invalid states |
| Focus | Visible focus and logical order; no focused control hidden behind fixed chrome. Preserve Feature 4's stronger project preference for fully visible focus. | Keyboard traversal and focused control visibility at desktop, rail and mobile layouts |
| Pointer targets | At least 24 by 24 CSS pixels or a verified minimum spacing/other applicable exception. Keep the prototype's larger controls. | Target bounds/spacing and documented exceptions, not an assumed 44px AA requirement |
| Reflow and resize | No page level horizontal scrolling at 320 CSS pixels for the normal vertical layout; necessary two dimensional tables can scroll locally. Text remains usable at 200 percent browser zoom. | Automated 320px viewport plus actual browser zoom checks |
| User text spacing | No lost text or operation under 1.5 line height, 2em paragraph spacing, .12em letter spacing and .16em word spacing overrides. | Override styles, screenshots and manual content/interaction inspection |
| Motion and color modes | Reduced motion removes nonessential animation. Focus, labels and selected/error state remain perceivable under forced colors. | Emulation checks with the tested mode recorded, not a claim about untested real OS themes |

The [minimum focus criterion](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum) is AA; [Focus Appearance](https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance) is AAA. Do not relabel AAA geometry as an AA requirement. The [target size minimum](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum) includes spacing and other exceptions. Preserve stricter project focus tokens where already agreed.

The [reflow guidance](https://www.w3.org/WAI/WCAG21/Understanding/reflow) and [resize text guidance](https://www.w3.org/WAI/WCAG22/Understanding/resize-text) require different evidence. A 320px automated viewport is not a real browser zoom test. Manually check 200 percent zoom and 400 percent reflow on a browser window whose initial content width is about 1280px, recording resulting CSS viewport dimensions. Device scale factor or CSS zoom must not be described as actual browser zoom. Apply the published [text spacing values](https://www.w3.org/WAI/WCAG22/Understanding/text-spacing) without enforcing them as the default product design.

Prefer existing darker semantic or neutral tokens for a failing pair. Limit default appearance changes to necessary contrast, focus, hit area or adaptive overflow fixes, as already permitted by spec 0003. Record the original and replacement pair, reason and measurements in design.md. Keep type scale, color families, shell geometry and role nav. Use minimum heights and appropriate wrapping/scrolling to prevent enlarged text clipping rather than shrinking user text. Disabled controls can have applicable contrast exceptions, but their explanatory text still needs to be readable.

For the contrast check, qualifying large text is at least 24 CSS pixels at normal weight or approximately 18.67 CSS pixels in bold. Use a clearly bold 700 weight for this project's bold threshold; do not assume a 14px semibold badge qualifies. Measure the actual rendered state and composite background, including the worst relevant part of a gradient.

### Semantics, names and navigation

Keep `lang="en"`, descriptive page titles, one main landmark and a clear page heading. Use semantic native headings, buttons, links, labels, forms and tables. Decorative icons are hidden from assistive technology. Icon only controls have an explicit meaningful name; visible text remains part of a control's accessible name. Avatar initials must not duplicate an adjacent spoken person name; when the avatar is the only identity cue, use the caller supplied name.

Associate labels through stable ids such as React useId, retaining required/native input semantics. Do not use placeholders, tooltips or color as the sole label or error. Native disabled controls stay disabled; explain unavailable actions through associated accessible text or existing contextual help, not only a hover title. Password controls preserve autocomplete, password managers and paste. No cognitive test, custom keyboard model or additional authentication step is introduced.

Retain the skip link, `aria-current` for the actual destination, accessible rail labels, bottom navigation and HR More. For in place destination changes, focus the updated main heading after rendering. Full page navigation can use normal browser document focus, with correct title and heading. Routine data refreshes and status updates do not move focus. If a responsive change hides the currently focused nav control, focus its visible equivalent (More for a destination held there) or the main heading, without automatically opening a dialog.

Account disclosure uses an expanded trigger and ordinary buttons/links. Enter/Space operate its trigger, Tab follows the visible controls, Escape closes and restores the trigger, and outside pointer dismissal does not steal focus from the clicked control. Do not add ARIA menu/grid roles without implementing the corresponding widget behavior.

Tables retain caption or an accessible name, headings with correct scope, and real table structure. An overflowing region needs a meaningful name and keyboard scroll access. Make the region focusable when needed for scrolling; do not add an unnecessary tab stop to a table that does not overflow.

### Form validation contract

Add a small shared validation/focus helper or hook, not a new form library. Inputs are the caller's stable field refs/ids, ordered field errors, form error and submit state. Domain validation remains with the owning feature: for example, Feature 5's comment normalization and 500 code point bound, and Feature 6's password/credential policy are not redefined here. Development examples have explicitly labeled example validation rules and never claim a database save.

On an initial submit, compute errors, expose all known invalid fields with `aria-invalid` and associated error text, then focus the first invalid field in document order. The focused field's label/help/error association supplies its spoken explanation; do not simultaneously broadcast the same error through a second alert. Keep entered values. After an unsuccessful submit, revalidate only already invalid fields on edit and clear their error when valid. Do not move focus or repeatedly announce while editing, and do not validate untouched fields during initial typing.

If the first invalid field already has focus, such as when Enter submits from that input, calling focus again does not guarantee a new spoken description. After its error association is rendered, emit one concise fallback alert containing that field's label and error for this failed submit. Use a form instance/submit attempt event id so rerenders cannot repeat it, while a deliberate later submit can be announced again. The field error itself has no live region. When focus actually moves to the first invalid field, do not emit this fallback. Verify both branches with actual NVDA output.

For adopting consumers, this contract supersedes spec 0003's earlier live field error wording and spec 0004's general assertive validation instruction. Focus plus associated text is the ordinary field validation path, the same-field/no-transition case uses the single fallback, and generic form/service errors use the alert channel. Do not layer all three announcement paths together. This precedence changes no domain validation or API rule.

Use native constraints as inputs to validation when appropriate, but avoid a native validation bubble plus a duplicate custom error for the same submit. A form adopting the custom pattern suppresses the browser bubble while preserving required/type semantics. A concise existing prototype error area can show the form error; no new summary block is introduced.

A server field validation result follows the same field pattern. A generic credential, service or save error that identifies no particular field is a form error: retain current logical focus and announce it once using the alert channel. Do not mark a specific email/password field invalid just to reveal which credential was wrong. Errors that require action remain available until corrected or deliberately dismissed through an existing control.

During a temporary pending submit, preserve the currently focused element, including the submit button when it initiated submission. Do not move input focus merely because Enter started a valid submission. Use `aria-disabled`/busy state on the submit action plus a real activation guard for this temporary case, preventing mouse, keyboard and repeated submit events from duplicating work. This is distinct from permanently unavailable controls using native disabled. On completion keep focus unless validation, navigation or the caller's modal close workflow requires a change. Never claim success because a request merely started.

### Dialog and drawer contract

Keep native `showModal()` and controlled React state synchronization from spec 0003. Use a title inside the dialog as its accessible name. Associate a short description only where helpful; do not make a complex entire form/table one long description. Real modality, not an aria-modal attribute alone, prevents background interaction. Keep one active modal, backdrop nondismissal and a working close control.

Use an explicit caller supplied initial focus target where appropriate. Otherwise focus the first meaningful interactive control; for a long structured dialog, allow its heading/intro with tabindex -1 so the start remains understandable and visible. Tab and Shift+Tab stay in the active modal, Escape closes it, and scrollable content remains reachable. A form error can move focus to its first invalid field inside the modal.

Ordinary close returns focus to a still connected, visible enabled opener; otherwise use the current main heading. More selection instead focuses the new destination heading. This preserves the [APG modal interaction guidance](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) and the explicit navigation precedence already agreed in Feature 4. Do not add another JavaScript trap that conflicts with the native dialog's focus behavior.

### Status and alert contract

Provide shared announcement hosts for polite status and urgent alert events. Input is plain message text, an event id, and status/alert intent from the caller, not arbitrary HTML. Status includes saved, loading/retry or result updates that need no focus change. Alert is reserved for a blocking form/service failure or the defined same-field failed submit fallback where there is no new focus transition supplying the explanation.

Both root and modal hosts exist empty before an event updates their text. When a modal is active, use hosts mounted within that dialog, because the root page is inert. Do not mount a new host already containing its first message. If an event arrives during modal opening, queue it until the modal is open and its empty hosts have been exposed, then update the active host in a subsequent UI update. A modal that closes before delivery cancels that stale queued event rather than sending it through the inert root or replaying it later. Maintain one announcement path for an event; do not expose the same text both as a live visual toast and a duplicate hidden announcer. Preserve the prototype's visual toast/banner style while assigning its announcement to the correct active scope.

Meaningful events, not renders, trigger speech. Deduplicate a supplied event id across Strict Mode effects and subsequent result refreshes. A deliberate new action can have a new event id even if its wording repeats. Callers decide whether a response is still relevant and clear obsolete messages when actor/workspace context changes. Do not replay a closed modal's stale message later. For a completion after closing a modal, announce in the root only after that close has completed and the root is no longer inert.

The helper does not turn a failed request into a success, cancel a persisted write, or decide domain recovery. Existing Feature 5 uncertain/save states and Feature 6 session states remain their owners' responsibility. No private action text should be replayed after sign out or an actor change. Verify actual speech timing with NVDA; a DOM mutation alone is insufficient evidence.

### Shared interfaces and value sources

There are no storage entities or new HTTP endpoints. Small runtime interfaces are component props and ephemeral UI state; existing components keep their public domain behavior.

| Pattern/value | Inputs or source | Output |
|---|---|---|
| Accessible field | Caller label, id/ref, help, required state and feature validation error | Native control semantics, stable associations and readable error |
| Validation focus | Submit event, caller errors and rendered field order | First invalid field focus after errors render |
| Pending submit | Caller pending state and activation guard | Perceivable busy state without duplicate work or lost focus |
| Modal | Caller open/title/description/initial target and captured opener | Native modality, bounded focus and defined close/navigation restoration |
| Announcement | Caller event id, message, urgency and current active scope | One appropriate live update, no unsolicited focus movement |
| Context reset | Caller actor/workspace key or modal close | Remove obsolete announcement state without replay |
| Names/current destination | Existing visible copy, role config, caller person name and selected route | Accessible names and current/expanded state |
| Style evidence | Actual computed styles, token pairs, bounds and tested viewport/mode | Contrast ratios and inspectable visual evidence |
| Browser test state | Approved component preview fixtures and actual built routes | Reproducible controls/states without pretending a real API succeeded |
| Manual evidence | Actual keyboard/NVDA observation and exact installed versions | Recorded result, failure or not tested status |

### Automation and coverage inventory

Use a checked in typed state inventory, for example `tests/accessibility/surfaces.ts`. Each entry names a stable state id, route, setup action, expected controls/state, viewport/mode and whether it is required built baseline or a not yet built foundation. Tests use accessible roles/names and behavioral assertions, with stable test ids only when semantic selection is insufficient.

Required baseline entries include the five shared role shells, desktop/rail/mobile nav and HR More, account disclosure, field/help/invalid/disabled/busy states, semantic/overflow table, dialog sizes and drawer with long content, root and modal status/alert events, and reduced motion/spacing modes. Use the existing Feature 4 development preview and imports of actual shared components. Do not create a parallel accessible test implementation that product components do not use.

At implementation, inventory the real Feature 5 proof and Feature 6 sign in/session UI. If built, add their rendered surfaces and relevant error/busy states to required coverage using their normal fixture context. If not built, record that explicitly in the manifest and report. Do not discover a missing required control and skip its test. Later feature acceptance must add its own route/states and end to end checks; this baseline does not automatically certify future pages.

Add a dedicated `npm run test:a11y` using Node's runner via tsx and a normal local HTTP app URL. No new runner is needed. `A11Y_BASE_URL` is a test process setting, defaulting to `http://127.0.0.1:5173`; accept only a loopback HTTP/HTTPS origin with no credentials, query or fragment. `A11Y_TARGET` is `development` by default or explicitly `production`; it selects the corresponding coverage inventory, not a browser side feature flag. Record the actual server start/build command with the run so the claimed mode is inspectable. These are test settings, not new product or VITE configuration.

The command launches Chromium with isolated contexts and closes pages/contexts/browser in teardown. Missing browser binaries or unreachable/missing required states fail with a useful setup message. Provide an explicit Chromium installation command; do not download browsers silently on every test run. Ensure the test files are linted and strict type checked without injecting Node globals into browser source.

By default these checks use component fixtures and read/render behavior, not domain mutations. Built authenticated surfaces can reuse the approved local fictional account/test setup, with real authentication rather than a role spoof. Keep fixtures, sessions and credentials isolated from real staff and never include tokens, passwords, raw storage state or full credential requests in reports/traces. Do not enable broad HAR/trace recording by default. Record tool/package versions from the actual lockfile/run.

Use axe tags for the applicable WCAG 2.0, 2.1 and 2.2 A/AA rules supported by the installed version. Confirm the exact tag set when installing; unsupported tags are a configuration failure, not a reason to drop coverage silently. All returned applicable violations fail, including moderate/minor or unset impact. Impact labels help triage but do not redefine the AA target. Review incomplete results manually; document any verified false positive or not applicable result per state/rule with evidence. Do not disable rules, hide components, or use blanket exclusions to make the suite pass. Advisory best practice results are recorded separately from normative findings.

Supplement scans with behavior: navigate using Tab/Shift+Tab, activate buttons and disclosure, click labels to focus inputs, submit invalid forms, traverse and close native modals, verify focus restoration and background inertness, and inspect narrow/spacing/forced color states. An axe pass is not evidence of these interactions. Avoid tests that only assert a CSS token or ARIA attribute mirrors the implementation.

### Manual and production evidence

Run a full keyboard path through the shared shell and representative form/table/overlay states. Run actual NVDA with installed Chrome or Edge, recording OS, reader and browser versions. Check names/roles/states, reading order, error discovery, first invalid field, root/modal live messages, More navigation and focus return. Observe actual speech or NVDA Speech Viewer; an accessibility tree snapshot is not a spoken result. If the reader or an interaction cannot be exercised, mark it not tested and leave the required check pending, rather than asserting a pass.

Perform actual 200/400 percent browser zoom and text spacing inspection, visual contrast/focus review and keyboard scrolling. Automated reduced motion/forced color emulation is labeled as emulation. This initial matrix makes no claim about Safari, Firefox, mobile touch screen readers or a real Windows contrast theme not actually exercised.

Build and run production. Scan and navigate the actual reachable shared surface (the default Employee shell before Feature 6, or sign in/real role shell when Feature 6 exists). Verify no development component preview or test fixture entry ships. Do not claim a dialog/role was tested in production if it is reachable only in the development preview; record component test coverage and later adoption obligation instead.

Evidence lives in `docs/reviews/` with a short baseline summary and links to selected artifacts. Include surface/state, URL, expected behavior, actual result, criterion/rule, browser/AT/version, viewport/mode, date and unresolved items. An automation success can be reported as an automation success; the overall baseline needs the required manual checks as well. No known applicable A/AA failure can be waived simply because it has a low tool severity. An unresolved required item keeps the feature in progress.

### Later feature adoption

Document a short checklist: inspect the exact prototype state, use shared primitives, provide meaningful labels/errors/status events, preserve keyboard/focus behavior, test applicable viewport/modes, add required automation inventory entries, and run actual role journey checks. Authenticated features inherit the real access boundary; accessibility helpers never select an actor or bypass permissions.

Future complex widgets, drag interactions, charts, continuously moving content, timed workflows or media need their own applicable criteria and alternatives. They are not implicitly covered by this component baseline. When a necessary accessible interaction has no prototype pattern, follow the project rule and obtain approval before creating a new UI.

### Critical verification scenarios

1. Traverse all five shared role nav configurations with the keyboard at desktop, rail and mobile sizes. Exercise skip link, account disclosure, HR More, current item and logical focus after selection/viewport change (AC-2, AC-9).
2. Submit a representative invalid form from its button and separately by pressing Enter while the first invalid field is already focused. Hear one associated explanation or single fallback, respectively. Submit a valid form with Enter and confirm pending state does not move input focus to the button. Correct errors and confirm untouched typing and routine rerenders do not produce error speech. Simulate a labeled component form error without claiming a real server write (AC-3, AC-5).
3. Open native dialogs/drawer with short and long content, traverse both directions, close with Escape/button, remove an opener and navigate through More. Check background inertness and the correct restoration/heading precedence (AC-4).
4. Emit polite status and blocking form error events at root and inside a modal, including the first event immediately after opening. Repeat a render/event id, close during a queued event, and complete an operation after closing before changing context. Observe actual NVDA output for lost, duplicate or obsolete speech (AC-5, AC-8).
5. Inspect computed contrast, focus, hit areas, local table scrolling and content under spacing overrides, 320px width, real 200/400 percent zoom, reduced motion and emulated forced colors (AC-6, AC-8).
6. Run Chromium axe/behavior checks, deliberately point a required inventory entry at a missing control, and confirm the suite fails rather than skipping. Retain manual incomplete items and distinguish advisory results (AC-7, AC-10).
7. Run the actual production build, check reachable pages and preview exclusion, and record built/not built page states and exact versions. Ensure the report makes no claim about untested future pages or other browser/reader combinations (AC-1, AC-8 through AC-10).

## Build plan

1. Confirm the implemented Feature 4 dependency and approved reference states, inventory required built surfaces versus planned foundations, and write the shared contract/adoption checklist (AC-1, AC-9).
2. Harden the shared shell/control semantics, focus/navigation, validation and native overlay behavior against that contract, preserving prototype appearance (AC-2 through AC-4, AC-6).
3. Add scoped status/alert patterns and update built consumers/preview examples without duplicate or inert announcements; document measured visual corrections (AC-1, AC-5, AC-6).
4. Add Playwright Library/axe Chromium regression checks through the Node runner, strict checks and reportable state inventory; include real foundation pages that are built (AC-7, AC-9).
5. Run `/test`, actual NVDA/keyboard/zoom checks, production smoke verification and `/check verify`; record evidence and remaining coverage rather than certifying unbuilt pages (AC-1 through AC-10).

## Consequences

Shared patterns give later role features a consistent baseline and meaningful regression checks. Existing native controls and prototype visual language remain intact.

Browser binaries and test state fixtures add maintenance. Actual assistive technology, zoom, contrast and interaction checks remain necessary; automation cannot replace them. Chromium/NVDA on Windows is a declared initial coverage boundary. Changes to shared controls must keep test fixtures and real consumers aligned.

## Follow-up

Feature 4 must be built before this feature can complete. Features 5 and 6 adopt this contract when implemented, and each later role feature extends coverage for its own complete process. Broader browser/assistive technology coverage remains a future explicit choice. Optional Playwright/axe skill and MCP discovery was declined on 2026-10-28; do not offer it again unless requested.

## Rationale

See `rationale.md` for the choices and checked sources.
