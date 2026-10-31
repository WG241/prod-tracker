# Reasoning for 0006

## Context

Feature 4 defines a native shared UI foundation and basic focus/contrast behavior. Feature 6 adds real authentication and role access requirements. Both designs are approved, but the browser still renders the scaffold. The project needs a shared baseline that can be verified once components exist and then adopted by later role journeys.

The HTML prototype remains the visual contract. Accessibility work must not become a replacement design system or a false claim that all planned pages have been evaluated. Keyboard behavior, announcements and actual screen reader results need evidence beyond markup inspection.

## Options considered

### Manual verification only

This could cover nuanced screen reader and visual behavior without browser test dependencies. Repeated shared regressions would be easier to miss, and the same checks would need to be recreated manually for every change.

### Browser automation plus actual assistive technology checks

This combines repeatable markup/interaction checks with human observable behavior. It adds browser fixtures and manual review work. The user selected this approach and Chromium first (basis: user choices, official Playwright Library and axe integration documentation).

### A new component/form framework

Such a framework could supply additional accessible widgets. It would replace or restyle already agreed native patterns and introduce another dependency without a demonstrated missing component requirement. The selected design extends the existing shared controls instead (basis: spec 0003 and prototype contract).

## Rationale

The user selected Playwright Library and axe with the existing Node/tsx runner, actual NVDA checks in Chrome or Edge, and first invalid field focus after submit. No new error summary was selected. Optional tool discovery was declined; no package or browser was installed during design.

The baseline requires resolving known applicable A/AA failures rather than passing only on the absence of serious/critical axe findings. Tool impact is a triage label, not a substitute for the selected standards target. Incomplete and untested manual items remain visible and cannot silently turn into a complete baseline pass.

Shared patterns use the existing native dialog and disclosure models, with live regions placed inside the active modal when needed. Component fixtures provide reproducible states without inventing another role page or pretending a simulated action wrote to PostgreSQL (basis: Feature 4's approved preview and WCAG/APG guidance).

Feature 4's implementation is an explicit prerequisite. Other planned foundations are tracked as not built until they exist. Actual full page/process accessibility requires their own later verification, which is separate from the shared component baseline.

## Independent cross check

A second model reviewed the draft on 2026-10-28 without edits or external fetching. It found no new architecture choice and identified four drafting repairs: validation speech when the invalid field already has focus, preserving input focus for Enter submission, precedence over older live error wording, and priming modal announcement hosts before their first event.

The user approved all four recommendations. The build spec now defines the same-field fallback, current pending focus, root/modal empty host sequencing, and explicit validation announcement precedence. The related wording in specs 0003 and 0004 is reconciled without changing their domain rules. Actual NVDA scenarios cover the affected branches.

## References

**Project sources**: root AGENTS.md, scope Feature 7, specs 0003 through 0005, final HTML prototype, design token notes, typography notes and current global CSS.

**Verified official sources**:

1. [WCAG 2.2](https://www.w3.org/TR/WCAG22/), published recommendation and scope of conformance.
2. [Focus Visible](https://www.w3.org/WAI/WCAG22/Understanding/focus-visible), [Focus Not Obscured Minimum](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum), and [Focus Appearance](https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance), distinguishing required AA checks and AAA appearance.
3. [Target Size Minimum](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum), target size and exceptions.
4. [Resize Text](https://www.w3.org/WAI/WCAG22/Understanding/resize-text), [Reflow](https://www.w3.org/WAI/WCAG21/Understanding/reflow), and [Text Spacing](https://www.w3.org/WAI/WCAG22/Understanding/text-spacing), distinct adaptation checks.
5. [APG Modal Dialog](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/), interaction pattern guidance rather than proof of native implementation behavior.
6. [Playwright Library](https://playwright.dev/docs/library), programmatic browser lifecycle and distinction from Playwright Test.
7. [Deque axe integration packages](https://github.com/dequelabs/axe-core-npm), official Playwright analyzer package.
8. [NV Access accessibility testing training announcement](https://www.nvaccess.org/post/in-process-16th-october-2026/), confirms official testing guidance exists; it is not a verified compatibility matrix or a requirement to purchase training.

The local prototype file URL remains blocked in the in app browser. No visual reference inspection or actual accessibility testing was completed during this design step.
