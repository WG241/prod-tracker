# Workforce design system

Source: `docs/workforce-prototype-updated.html`, final CSS and rendering functions at commit `888d79d`. Supporting notes: `docs/design-tokens.md` and `docs/typography-scale.md`. This file describes that prototype, not a new visual direction.

## Character

Calm internal workspace, white shell and cards, pale gray canvas, blue navigation, compact Inter typography, restrained borders, and Lucide outline icons. No stock imagery. The prototype wordmark and initials avatars supply identity.

## Build mandate

Use the final prototype screen for the exact role and destination. The shared foundation composes a development bar when enabled, sidebar or compact rail, topbar, content heading and approved unfinished content, account disclosure, and mobile navigation. Role workflows are separate features. Development previews use `Preview workspace`; authenticated placeholders use the actual role and `This feature is not built yet.`

Do not resurrect old prototype menus, encouragement notes, Employee metric cards or board layouts. The Employee Home contract uses its final List and Card views. This foundation builds only placeholders for those destinations. Final sidebar menus exclude Profile, HR Tracker controls and Audit log, and Executive individual performance records. Profile belongs in the account disclosure.

## Tokens and typography

Values live in `src/global.css` under `@theme` and `:root`. Component and shell rules live in `src/workspace.css`; `src/index.css` imports both. Do not duplicate theme values in components. Layout specific constants in the stylesheet preserve the prototype geometry.

Use Inter weights 400, 500, 600, and 700 with system fallback. The Google font import precedes Tailwind, eliminating the old import order warning. Body text is 14px, secondary text 12px or 13px, headings 18px and at most 28px. Headings use the final prototype's semibold weight. Retain the documented micro and caption sizes in shell details.

Use brand, neutral, status, avatar, radius, shadow, spacing, motion and layout tokens by name. `--color-control-border` is the accessible border for enabled outlined buttons and fields. Declined and On hold tokens preserve the original orange and purple status families. `--dialog-backdrop` defines the prototype's translucent dark overlay.

## Composition and responsive behavior

Desktop sidebar is 248px, 215px at widths up to 1200px, and a 74px named icon rail at widths up to 1023px. Below 640px hide the sidebar and use the 70px bottom navigation with safe area space. Roles with over five destinations show the first four and More. The More dialog contains the whole role menu. Its active group and selected destination remain identified.

Topbar is 72px on desktop and 60px on mobile. The 40px development bar contributes to shell offsets only when present; production has no empty offset. Main content uses the existing 1450px maximum, 32px desktop padding and narrower prototype padding. Main content reserves bottom space for mobile navigation. The topbar contains Workspace, the current destination, the accessible sample date, disabled notifications, initials avatar, persona and account disclosure. No fabricated unread or approval count is shown.

The temporary preview adapter uses component state. Role changes reset the selected destination and overlays. Authenticated destinations use ordinary same origin links from the fixed role table and session context, with the real staff name and current Africa/Lagos date. Preview selections never provide authenticated permissions.

## Components

| Module | Contract and reference |
|---|---|
| `src/components/ui/Button.tsx` | Native Button, default/primary/success/danger/ghost variants, normal/small sizes. Default button type is button. IconButton requires a label. Reference: Home and task dialog actions. |
| `src/components/ui/Field.tsx` | Field, InputField, SelectField, TextareaField, CheckboxField. Native attributes pass through. Stable associated labels, help/error ids and invalid state. Reference: Add a task and task reply fields. |
| `src/components/ui/Badge.tsx` | Known canonical task and account statuses, matching icon and text. Unknown status is neutral. Reference: Home, task detail and History. |
| `src/components/ui/Avatar.tsx` | Initials from first and last nonempty words; one word uses its first letter, an empty name uses ?. Blue/teal/lilac/sand tones. Decorative beside the person's visible name. |
| `src/components/ui/Card.tsx` | Optional heading, description, actions and composable body. Prototype 12px border radius and subtle border/shadow. |
| `src/components/ui/Table.tsx` | Native table, accessible caption and region, scoped column headers, caller supplied row headers and body. Scroll only the table region when narrow. No data operations. |
| `src/components/ui/Dialog.tsx` | Controlled native Dialog and Drawer with title, description, body, footer, close callback, optional initial focus and focus return refs. Dialog widths 540/400/920px; drawer 500px. Reference: Add a task, date picker, task detail, workspace More. |
| `src/components/layout/WorkspaceShell.tsx` | Role config, persona, selection callback and page content. Owns presentation navigation and account/More disclosure state. |
| `src/features/workspace/config.ts` | Typed final prototype menu order, icons and fictional personas. No session or server policy. |

The dialog uses showModal and close, with one active shared modal at a time. Escape and the close control dismiss. Backdrop clicks do not dismiss. Opening focuses the requested target or close button. Closing restores the opener, or the current heading if the opener disappeared. Navigation from More overrides ordinary return and focuses the new heading. Dialog bodies scroll, footers stay available, and mobile dialogs become sheets. Drawer styling changes placement without losing modal semantics.

The account disclosure uses ordinary controls, aria expanded and controls, outside click dismissal, and Escape with focus return. It is not an ARIA menu. In authenticated workspaces, Profile links to `/profile` and Sign out revokes the current session. Preview sign out and Notifications remain natively disabled with accessible explanations.

## Accessibility and documented deviations

Enabled input borders and outlined button borders use the existing gray 500 color rather than the prototype's lighter border. This is the approved essential boundary adjustment required by spec 0003: gray 500 against white exceeds 3:1. Danger boundaries use the existing danger red. Card and shell separators are decorative and retain the prototype's pale border. Focus uses the existing 2px blue outline with 3px offset. The prototype sand avatar text measured 4.07:1 on its sand background; its foreground is slightly darker in the same brown family to exceed 4.5:1. Other measured enabled foreground/background and avatar pairs passed without changes.

Keep visible labels, native required and disabled states, and error associations. Field error text is not independently live; later form owners manage first invalid focus and announcements under spec 0006. Status includes text and icon rather than color alone. Decorative icons are hidden from assistive technology. Use a skip link, semantic landmarks, one page h1, scoped table headings and aria current for the selected destination. Every native dialog traps background focus. Reduced motion disables transitions and animations.

At 320 CSS pixels and 200 percent browser zoom, content and controls must remain usable without horizontal page scrolling. Tables may scroll in their own named region. No dark theme is introduced because the prototype defines only this light theme. No domain loading or error screen belongs to the foundation; the conditional preview module has a short loading announcement while it loads.

## Development preview and isolation

`src/dev/DevelopmentApp.tsx` owns the fictional role selector and `/__ui` component workbench. `src/dev/ComponentPreview.tsx` groups all control variants, labels, required/error/disabled states, status/unknown badges, avatar edge cases, semantic table, dialog sizes, long content, drawer, and removed opener example. The workbench arrangement is explicitly approved in spec 0003; individual control styles match the prototype.

`src/App.tsx` conditionally imports development code behind Vite's DEV flag, only at `/__ui` and `/__data-proof`. The workspace preview is `/__ui?view=workspace`. Production contains neither that module nor its preview links, role selector or examples; tool paths resolve through ordinary authentication navigation. Existing startup health remains unchanged. The preview bar never belongs to a real authenticated workspace.

## Authentication

`src/features/auth/` follows spec 0005 and the inspected final prototype sign in screen. Keep the two equal columns, pale blue illustration panel, Workforce wordmark, decorative weekly task card and 360px form. The art panel hides below 900px, as in the prototype. The agreed 28px heading cap applies. Use existing shared inputs, buttons, avatar and badge, plus the existing login shadow and a token for the prototype's art background.

The real form has no prefilled credential or role picker. Preserve Work email, Password, the show or hide password control, Forgot password and Sign in. Recovery stays disabled with its explanation. Validation focuses the first invalid field and uses the existing amber banner. Service failures withhold the role shell and use shared card, loading text, banner and Retry patterns. Rate limited controls show a countdown and remain disabled until retry is available.

Wrong role and unavailable page notices use the prototype's dark fixed toast pattern and fixed English copy. The URL notice flag is removed. Session checks on return from a background tab clear cached private context before resolving it again.

The prototype sign in reference was visually inspected on 2026-10-29 before implementation. Implementation browser verification is still pending; source inspection and HTTP checks do not establish visual conformance.

## Inspected references

On 2026-10-28 the user approved inspection through the existing development server at `/docs/workforce-prototype-updated.html`. The live reference was opened successfully. All five role landing shells and final menu orders, Employee Add a task form, Employee task drawer, account disclosure, and HR mobile More dialog were inspected before implementation. Visual screenshots and runtime checks for the implementation are separate verification evidence.

## Do and do not

Match the final HTML prototype and reuse shared controls. Keep field help associated, focus visible, navigation named, and production previews honest. Render strings as React text. Preserve English copy and one Workforce Group organisation.

Do not add routes to the sidebar, introduce a different palette, use fake approval counts, claim a preview persona is signed in, expose development selectors in production, import database code into the browser, or ship an unchecked visual match.
