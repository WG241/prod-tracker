# Epic: Foundations

Ground every role slice. Facade still needs a real local database with migrations and seed mock rows so UI, API, and backend work on live local data from the first wired screens.

## Existing

### A. App scaffold · existing
Pre workflow Vite + React + TypeScript + Tailwind + Prisma + Neon stub. Hello screen only; not product UI.
code in `./` · `src/App.tsx` · `prisma/schema.prisma`

### B. Design token notes · existing
Colors, type, radius, and shell notes taken from the HTML prototype for the design system feature.
docs in `docs/design-tokens.md` · `docs/typography-scale.md`

## Foundations

### 1. Coding standards and tooling
Capture conventions for this stack so juniors and agents share one pattern (lint, format, how features are cut, where specs live).
**Done when:** root `AGENTS.md` reflects the real stack and workflow rhythm, and lint or format runs clean on the scaffold.
- [ ] Capture conventions + tooling choices: `/audit`

### 2. Stack and architecture · in-progress · needs a decision
Confirm how the React app, API routes, and Postgres (local migrate + seed, Neon ready) fit together for a single Workforce Group deploy.
**Done when:** the stack choice is recorded in a spec, local migrate and seed run, and a trivial authenticated or public health path proves UI can talk to API and DB.
- [ ] Design it (spec): `/architect stack and architecture`

### 3. Data model · needs a decision
Core entities every role needs: people and roles, business and unit hierarchy, weekly tasks and statuses, comments, leave and relief, tracker lock or unlock, settings, audit events, notifications.
**Done when:** schema and relationships support Employee through HR slices without a breaking rewrite; seed data mirrors the prototype cast and sample week.
- [ ] Design it (spec): `/architect data model`

### 4. Design system and UI foundation · needs a decision
Shell, nav by role, type, color, spacing, and base components aligned to the prototype and WCAG 2.2 AA basics (focus, contrast, keyboard).
**Done when:** `design.md` covers tokens and components, role shell switches nav correctly, and base controls meet the AA bar for focus and keyboard.
- [ ] Design it (spec): `/architect design system and UI foundation`

### 5. Seeded local DB and API skeleton · needs a decision
Walking skeleton: migrations, seed mock data from the prototype, and thin API routes the UI can call for read and write of core entities.
**Done when:** `db:migrate` + seed loads people, tasks, and org sample data locally; at least one list and one write round trip works from the UI against the DB.
- [ ] Design it (spec): `/architect seeded local DB and API skeleton`

### 6. Sign in and role access · needs a decision · GA
Password style sign in as in the prototype; session; role gates so each user group only sees its nav and data scope. Single org: Workforce Group.
**Done when:** a user can sign in as each of the five roles (or seeded accounts), land on the right shell, and cannot open another role's routes or data.
- [ ] Design it (spec): `/architect sign in and role access`

### 7. Accessibility baseline · needs a decision
Project wide WCAG 2.2 AA target: focus order, labels, dialogs, live regions, contrast. Applies to every later screen.
**Done when:** shared patterns for dialogs, forms, and nav meet AA checks; later features inherit rather than reinvent.
- [ ] Design it (spec): `/architect accessibility baseline`

### 8. Error monitoring and product analytics · needs a decision
Error monitoring for failed API and client crashes; product analytics for submit, approve, late approval, and role usage. English only product copy.
**Done when:** errors are visible in a monitoring sink in local or staging config; key product events fire for the Employee and Line Manager loop at minimum.
- [ ] Design it (spec): `/architect error monitoring and product analytics`
