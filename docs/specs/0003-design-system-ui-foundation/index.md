# 0003. Design system and UI foundation

**Date**: 2026-10-26
**Status**: In Progress

## Summary

Build the shared Workforce shell and core controls from the HTML prototype. Let developers preview all five role menus and exercise the controls without implementing the later role workflows. Keep the preview tools out of production, where the Employee shell is the temporary default until sign in arrives.

## Requirements

As a developer, you can reuse controls and layout without inventing a different look for each role. As a keyboard user, you can navigate the shell and use forms and overlays without losing your place.

1. **AC-1**: Root `design.md` documents the prototype tokens, typography, responsive shell, component variants, interaction states, accessibility rules, and reference screens. It describes the existing prototype rather than proposing a new visual direction.
2. **AC-2**: The shell matches the prototype sidebar, brand, topbar, breadcrumb, account menu, and responsive navigation. Each of the five roles has exactly the final effective prototype menu in its original order, including the later `Object.assign(navs, ...)` replacement. The development role selector changes the menu and fictional persona, resets to that role's first destination, and closes any open overlay.
3. **AC-3**: Selecting an unfinished destination changes the active item, breadcrumb, document title, and main heading, and shows `This feature is not built yet.` It performs no domain request or mutation. Full dashboards, sign in, notifications, profile forms, and role workflows remain with their existing scope features.
4. **AC-4**: Reusable buttons, icon buttons, labeled fields, text inputs, selects, textareas, checkboxes, status badges, avatars, cards, and semantic table frames match their prototype references. Controls support applicable disabled, required, error, and descriptive states without relying on color alone.
5. **AC-5**: Shared dialog and drawer frames use native HTML `dialog` with React. Opening moves focus inside, background controls cannot receive focus, Tab stays inside, Escape and a labeled close control dismiss, and ordinary dismissal returns focus to the opener when it still exists. Choosing a destination from More instead focuses the updated main heading. Titles and descriptions have accessible associations. Dialogs fit a narrow viewport and their content can scroll.
6. **AC-6**: A development component preview outside the role sidebar demonstrates every shared variant and the states in AC-4, plus dialog and drawer interactions. Production contains neither the preview page nor its entry controls or the role switcher. Production starts with the default Employee shell; requesting the development preview path in production falls back to that shell.
7. **AC-7**: Shared controls and navigation satisfy the Feature 4 accessibility baseline: visible focus, labels and accessible names, keyboard activation, current destination semantics, text and control contrast, reduced motion, and no content hidden beneath fixed chrome. At 320 CSS pixels the shell has no horizontal page overflow; tables may scroll inside their own region. Browser zoom at 200 percent remains usable.
8. **AC-8**: Lint, strict type checks, and production build pass. `/check verify` exercises the real app in development and production, records each criterion and prototype comparison, and reports any limitation. A build alone does not complete this feature.

## Decision

Use the existing React, Tailwind, and Lucide stack, with typed shared components and CSS derived from the prototype. Use native HTML dialog for both centered dialogs and side drawers. No new package, database model, API endpoint, environment variable, or external service is required.

The user chose the shell plus core controls, the prototype role switcher, a development component preview outside the sidebar, explicit unfinished destination messages, native dialogs, and development only preview tools. The user approved the component preview as an exception to the rule against new pages absent from the prototype. That exception covers the preview arrangement, not a new style for its controls.

## Feature design

### Design contract and inspection

The UI contract is `docs/workforce-prototype-updated.html`, including its later CSS overrides and final render functions. `docs/design-tokens.md`, `docs/typography-scale.md`, and `src/global.css` support that contract. The final prototype removes the sidebar encouragement note and displays footer version `v1.2`; do not copy the superseded shell unchanged.

Before implementing a surface, open the prototype in an approved viewer, select the relevant role and exact reference screen or overlay, and compare against it. Record screenshots where available. Source inspection has informed this draft, but visual inspection has not been completed: the in app browser rejected its `file:` URL. Resolve an approved visual reference before UI implementation; do not claim a visual match based on source alone.

| Component | Prototype reference |
|---|---|
| Shell, role selector, desktop and mobile navigation | Each role's first destination, `prototype()`, `legacyRender()`, final `render()`, `navItems()`, `openMore()` |
| Button and icon button variants | Employee Home actions, History filters, task dialog actions and delete confirmation |
| Field, text input, select, textarea, checkbox | Add or edit task dialog, sign in fields for input styling, leave form and prototype selector |
| Status badges, avatars, cards, tables | Employee Home task statuses and cards, Employee History table |
| Centered dialog and mobile sheet | Add task, choose a date range, and confirmation dialogs |
| Side drawer | Employee task details |

`design.md` records actual token values or named CSS tokens, usage guidance, variants, states, component import paths, reference screens, and the permitted preview exception. Keep existing Inter weights 400, 500, 600, and 700, the 28px type cap, status colors, spacing rhythm, radii, shadows, and Lucide stroke conventions. Correct the existing font import ordering warning while retaining the font choice and system fallback. Do not introduce stock imagery, a new logo, or unrelated decoration.

### Role navigation and personas

| Role | Destinations in order | Fictional prototype persona |
|---|---|---|
| Employee | Home, History, Leave | Ada Okafor |
| Line Manager | Dashboard, My tasks, Team history, Approvals, Leave | Tunde Bakare |
| Business Director | Dashboard, Units, Performance records, Reports | Amara Bello |
| Executive | Dashboard, Businesses, Reports | David Cole |
| HR / Admin | Dashboard, Organisation, Employees, Leave & Relief, Performance records, Reports, Settings | Kemi Adebayo |

These are the final menus after the prototype's PRD 1.2 replacement, not its original `navs` declaration. This foundation only selects unfinished destinations; authorization and any denial rules belong to Feature 6 and the later role features. Tracker controls and Audit log remain planned scope features, without adding sidebar items absent from the final prototype.

The topbar profile button opens the prototype's account menu with `Profile & account` and `Sign out`. Selecting Profile & account closes the menu and opens the shared Profile placeholder for every role, without adding Profile to any sidebar. Sign out is a native disabled button with an accessible explanation that sign in and sign out are not built. Notifications are likewise disabled with an accessible explanation. Do not fabricate unread or approval counts.

Implement the account menu as a disclosure panel of ordinary buttons: its trigger exposes `aria-expanded` and `aria-controls`, Enter or Space toggles it, and Tab follows the visible controls. Escape closes and restores focus to the trigger. Clicking outside closes it without stealing focus from the clicked control. Profile selection focuses the updated main heading. Close this panel on destination or role change and when a modal opens. Match the prototype panel styling; do not add an ARIA menu role that would imply a different keyboard model.

In development the prototype bar identifies `Development preview`, with the same role selector arrangement and a component preview link. Omit prototype scenario switches, reset, and sign in preview because their workflows are outside this feature. At `/__ui`, the development preview shows component examples in simple labeled groups, with a return link to `/`. This path never becomes a sidebar entry.

At `/`, the initial role is Employee and the initial destination is Home. Use React state as the prototype does, with no router dependency or URL persistence for role and destination selection. Reload resets the preview. Change of role returns to its first destination and closes overlays. A destination outside the active role's menu and the shared Profile destination falls back to the active role's first destination. Browser Back does not traverse these temporary preview selections. Later route and session features can replace this adapter without changing the shell components.

The main content of an unfinished destination contains its destination heading and the exact message from AC-3. This explicitly approved placeholder is the only role page content in this feature. The header name, initials, and role are fictional prototype values, never presented as an authenticated session. Keep a visible `Preview workspace` indication in the placeholder, including production, until Feature 6 supplies a session. The topbar's sample date is `Mon, 19 Oct 2026`, labeled as a sample date for assistive technology; no clock or week calculation is introduced.

### Responsive shell

Use the prototype's final applicable rules, not a new breakpoint system. At desktop sizes the sidebar is 248px, with 215px at widths up to 1200px. At widths up to 1023px use its 74px icon rail with accessible item names. Below 640px hide the sidebar and use the 70px bottom navigation. Roles with more than five destinations show the first four and More; with the final menus only HR / Admin requires More. More opens the prototype's workspace navigation dialog with all role destinations. Selection closes More and updates the same active destination. While a destination available only through More is selected, More indicates the active group and the corresponding item inside its dialog exposes the current destination.

The topbar is 72px on desktop and 60px below 640px. The 40px preview bar contributes to fixed positioning only when present. Production has no unused 40px offset. Keep the documented content padding changes and safe area behavior, with enough bottom padding that mobile navigation never covers controls. Use existing max width tokens from `src/global.css`, reconciled against the prototype and token notes in `design.md` if they disagree.

### Component contracts

Keep browser components under `src/components/ui/`, the layout under `src/components/layout/`, role configuration under `src/features/workspace/`, and the development preview under `src/dev/`. `src/App.tsx` composes the shell and conditional development entry. Keep database imports outside all of these modules.

| Interface | Inputs and behavior |
|---|---|
| Button and IconButton | Native button attributes, explicit visual variant and size. Default `type="button"`; callers opt into submit. IconButton requires an accessible label. Native disabled behavior is retained. |
| Field and native form wrappers | Stable id, label, optional description and error. Connect label and help/error ids, set invalid state when supplied, and expose native required/disabled attributes. On adoption, spec 0006 governs validation announcements: associated text and first-invalid focus, one fallback when that field already has focus, and alerts for generic form errors. Do not make every field error independently live or announce on every render. |
| Badge and Avatar | Explicit status or visual tone and text/name from caller. Map known task statuses to prototype semantic colors; unknown text uses a neutral tone. Initials derive from the supplied display name, never a network image. |
| Card | Optional heading/actions and composable content, using the prototype card spacing and border. |
| Table frame | Native table, caption or accessible name, caller supplied headings and rows, explicit header scope, and an overflow container. No sorting, fetching, pagination, or domain filtering is added. |
| Dialog and Drawer | Controlled open state, title, optional description/footer, children, close callback, optional initial focus target. Drawer changes placement and dimensions, while retaining modal semantics. |
| WorkspaceShell | Role configuration, persona, selected destination, selection callback, and page children. Development controls are passed separately. |

Buttons include default, primary, success, danger, and ghost styles, plus normal and small sizes found in the prototype. Dialog supports its 540px default, 400px small, and 920px wide frames; drawer uses its 500px width constrained to the viewport. On mobile use the prototype's dialog sheet and drawer rules. Preview examples use existing prototype labels and fictional content, never fetched business records.

Use `showModal()` and `close()` synchronized with controlled state. Handle native cancel and close events so parent state cannot drift. Avoid opening a second shared modal while one is active; the initial foundation requires one active overlay only. A close or cancel button always works. Backdrop clicks do not dismiss, preventing accidental loss of future form data. Do not implement unsaved change rules, submission, or domain validation in these frames. When an opener disappears, restore focus to the current main heading. Navigation takes precedence over ordinary focus restoration: choosing a destination from More focuses its updated heading, while Escape or the close control returns to More. Role and destination changes likewise focus the updated heading. Ordinary component preview dialogs and drawers restore their opener.

### Accessibility baseline and failures

Use semantic header, aside, nav, main, headings, forms, and tables. Include a keyboard visible skip link to main. Active destinations expose `aria-current="page"`; compact rail items retain accessible names. Use visible focus outlines with sufficient contrast and offsets that fixed chrome does not obscure. Standard text contrast is at least 4.5:1, large text at least 3:1, and essential control boundaries and focus indicators at least 3:1 against adjacent colors. Verify the actual token pairs used, not all arbitrary palette combinations.

Prefer existing prototype semantic colors when contrast needs correction. Limit deviations to focus visibility, an essential border, or the text/background pairing required for this baseline, and document each in `design.md`. Preserve layout and color families. This is a shared control baseline; the comprehensive project accessibility review remains Feature 7.

Native controls retain keyboard behavior. Labels, descriptions, required state, and error text must remain perceivable without placeholder text or color alone. Support reduced motion. Small targets retain at least 24px by 24px or equivalent spacing, with the prototype's larger touch sizes where present. At narrow widths and zoom, wrap preview groups and scroll table containers rather than the whole page.

There are no domain requests or writes, so loading, retry, and database failure states are not introduced here. Keep the existing startup health request and server readiness behavior unchanged. A missing Inter web font uses the existing system fallback without hiding text. User supplied component strings are rendered as React text; no raw HTML injection is needed.

### State, data, and value sourcing

No persistent entity, migration, seed change, or data endpoint is added. Component examples are development only fixtures. Personas are fictional prototype values used by the development role shells and, temporarily, by the clearly identified Employee preview in production. The shell can later accept an authenticated caller supplied persona.

| Value produced or displayed | Source |
|---|---|
| Role names, nav order and icons | Final prototype `navs` after its PRD 1.2 `Object.assign` replacement, transcribed into typed configuration |
| Persona name and role | Prototype `identity()` and the table above |
| Initials | First letters of the first and final nonempty words in the supplied name; one word uses its first letter, empty name uses `?` |
| Active destination and breadcrumb | React state initialized and reset as defined above |
| Main heading and document title | Selected destination; document title is `<destination> · Workforce` |
| Preview notice and unfinished content | Fixed copy in this spec |
| Sample date | The explicit prototype sample date above |
| Preview availability | Vite `import.meta.env.DEV`; conditionally load the preview module only in development |
| Component preview view | Exact browser pathname `/__ui` in development; all other paths use the shell for now |
| Visual values and breakpoints | Final prototype CSS, constrained by existing token and typography notes |
| Status label and style | Caller supplied status and known prototype status mapping, neutral fallback |
| Form help, error, rows and headings | Caller props, with fixed prototype examples in the development preview |
| Dialog title, content and focus target | Caller props and captured opener; updated main heading takes precedence for navigation, with main heading fallback if the opener disappears |
| Account menu state and entries | Local disclosure state, fixed prototype labels and the disabled Sign out behavior above |

**Security model:** The preview selector changes presentation only. It creates no authenticated session and grants no server permissions. Do not expose seeded employee data through a public shell endpoint. Existing `/api/health` remains the only browser request required by this feature. Feature 6 replaces the temporary production default with real session and role checks.

**Critical test scenarios:**

1. Switch through five roles, select every destination and check the final effective menu order and persona. Exercise Profile & account for every role, disabled Sign out, account disclosure keyboard behavior, and close on outside click or role change (AC-2, AC-3, AC-7).
2. At desktop, icon rail, and mobile widths, compare the shell against each prototype role reference. Exercise HR More: destination selection closes and focuses the updated heading, while Escape restores More; check the active group indication (AC-1, AC-2, AC-5, AC-7).
3. Operate enabled controls with keyboard, inspect label/help/error associations, disabled behavior, contrast pairs and reduced motion (AC-4, AC-7).
4. Open and close dialogs and drawers repeatedly, use Tab, Shift+Tab, Escape, close button, long content, and a removed opener (AC-5, AC-7).
5. Build and run production. Check the Employee default and `/__ui` fallback; verify preview modules and role controls are absent from the production assets and UI (AC-6, AC-8).
6. Check narrow layout and 200 percent zoom, long labels, neutral unknown statuses, and font failure fallback (AC-4, AC-7).

## Build plan

1. Inspect approved prototype views, reconcile the existing tokens, fix font import order, and write `design.md` describing the contract and any necessary accessibility adjustments (AC-1, AC-7).
2. Build the typed role configuration and responsive shell, including desktop navigation, rail, bottom navigation and More, selection state, fictional personas, and explicit unfinished destinations (AC-2, AC-3, AC-7).
3. Build the core controls and native dialog/drawer frames against the named reference screens, with documented props and accessible states (AC-4, AC-5, AC-7).
4. Add the development role controls and component preview, conditionally isolated from production, and retain the default production Employee shell (AC-2, AC-6).
5. Run lint, type checks and build, then `/check verify` in the real development and production app. Record criterion evidence and visual comparison limitations before updating scope completion (AC-1 through AC-8).

## Consequences

Later features inherit one shell and control vocabulary rather than copying the monolithic prototype. This feature makes no claim that the five role workflows or authentication are implemented.

Native dialog avoids another dependency but leaves the team responsible for controlled state synchronization, focus restoration, responsive styling, and browser verification. The temporary selection adapter does not support deep links or browser history between role destinations. The development preview needs maintenance as shared controls change.

## Follow-up

Feature 6 supplies real sessions and role access, Feature 7 extends the accessibility baseline, and Features 9 onward implement the role destinations. These are already enrolled scope features. No new feature is enrolled by this spec.

## Rationale

See `rationale.md` for the alternatives and reasoning.
