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

### 1. Coding standards and tooling · done
Capture conventions for this stack so juniors and agents share one pattern (lint, format, how features are cut, where specs live).
**Done when:** root `AGENTS.md` reflects the real stack and workflow rhythm, and lint or format runs clean on the scaffold.
- [x] Capture conventions + tooling choices: `/audit`
- [x] Verify it: `/check verify coding standards and tooling`
code in `AGENTS.md` · `.agents/skills/` · `.editorconfig` · `.oxlintrc.json` · `tsconfig.*.json` · `package.json`

Verified 2026-10-26: `npm run check` passed (lint, strict type checks, production build). Temporary probes confirmed lint violations, implicit `any`, and Node globals in browser code fail their checks; the probes were removed. The app at `http://127.0.0.1:5173/` rendered the scaffold heading and stack description in a real browser. All nine skills and their agent metadata are present. The build still reports the existing font import order warning in `src/index.css`; product UI and database journeys are outside this feature.

### 2. Stack and architecture · done
Confirm how the React app, API routes, and Postgres (local migrate + seed, Neon ready) fit together for a single Workforce Group deploy.
**Done when:** the stack choice is recorded in a spec, local migrate and seed run, and a trivial authenticated or public health path proves UI can talk to API and DB.
- [x] Design it (spec): `/architect stack and architecture`
- [x] Build it: `/develop stack and architecture`
  - [x] Native local PostgreSQL, migration, and repeatable seed
  - [x] Express service, server database boundary, and production serving
  - [x] Browser health request and documented developer commands
- [x] Verify it: `/check verify stack and architecture`
spec [0001](../specs/0001-stack-and-architecture/index.md) · code in `server/` · `prisma/` · `src/main.tsx` · `scripts/`

Verified 2026-10-26: lint and build pass; initial migration and repeatable seed are live in native local PostgreSQL. Development and production browsers completed the health request. Database stop and restart, stalled queries, pool waiting, sanitized configuration errors, API 404 responses, browser routing, and browser bundle isolation passed. Evidence is recorded in [verify.md](../specs/0001-stack-and-architecture/verify.md). The existing CSS font import warning remains. Hosted Neon behavior is not part of this local verification.

### 3. Data model · done
Core entities every role needs: people and roles, business and unit hierarchy, weekly tasks and statuses, comments, leave and relief, tracker lock or unlock, settings, audit events, notifications.
**Done when:** schema and relationships support Employee through HR slices without a breaking rewrite; seed data mirrors the prototype cast and sample week.
- [x] Design it (spec): `/architect data model`
- [x] Build it: `/develop data model`
  - [x] Typed records, relations, and database constraints (AC-1 through AC-5)
  - [x] Additive local migration and retained foundation identity (AC-6, AC-7)
  - [x] Prototype fixtures and repeatable transactional seed (AC-1 through AC-6)
  - [x] Constraint and role projection verification (AC-1 through AC-7)
- [x] Verify it: `/check verify data model`

Verified 2026-10-26: 18 live model tables, retained foundation identity, 28 staff, 35 weekly tasks and 110 weekly rosters. Repeat seeding, five role projections, frozen history, 23 rejected invalid writes, real development and production browser readiness, lint, types and build pass. Evidence and the timestamp comparison limitation are recorded in [verify.md](../specs/0002-data-model/verify.md). Source corrections and synthetic scenarios are recorded in the [fixture manifest](../../prisma/fixtures/README.md).
spec [0002](../specs/0002-data-model/index.md) · code in `prisma/` · `server/data-model/`

### 4. Design system and UI foundation · in-progress
Shell, nav by role, type, color, spacing, and base components aligned to the prototype and WCAG 2.2 AA basics (focus, contrast, keyboard).
**Done when:** `design.md` covers tokens and components, role shell switches nav correctly, and base controls meet the AA bar for focus and keyboard.
- [x] Design it (spec): `/architect design system and UI foundation`
- [x] Build it: `/develop design system and UI foundation`
  - [x] Prototype inspection, tokens, and `design.md` (AC-1, AC-7)
  - [x] Final prototype role menus, responsive shell, and unfinished destinations (AC-2, AC-3, AC-7)
  - [x] Shared core controls and native dialog or drawer frames (AC-4, AC-5, AC-7)
  - [x] Development previews and production isolation (AC-2, AC-6, AC-8)
- [ ] Verify it: `/check verify design system and UI foundation`
spec [0003](../specs/0003-design-system-ui-foundation/index.md)

Design confirmed 2026-10-26. Shared shell, final role menus, controls, native overlays, `design.md`, and development previews were implemented on 2026-10-28 after the user approved the local HTTP prototype reference. The final project lint, types, and build pass. Complete Feature 4 runtime verification remains open; its [partial checklist](../specs/0003-design-system-ui-foundation/verify.md) records what remains.

### 5. Seeded local DB and API skeleton · done
Walking skeleton: migrations, seed mock data from the prototype, and thin API routes the UI can call for read and write of core entities.
**Done when:** `db:migrate` + seed loads people, tasks, and org sample data locally; at least one list and one write round trip works from the UI against the DB.
- [x] Design it (spec): `/architect seeded local DB and API skeleton`
- [x] Build it: `/develop seeded local DB and API skeleton`
  - [x] Confirm local connection, existing migrations, and repeatable fixtures (AC-1, AC-2, AC-6)
  - [x] Independent development proof page and database task list (AC-2, AC-3, AC-7)
  - [x] Local API guards, comment validation, persistence, and safe retries (AC-2 through AC-6)
  - [x] Browser retry recovery, saved refresh handling, and production exclusion (AC-3 through AC-7)
- [x] Verify it: `/check verify seeded local DB and API skeleton`
spec [0004](../specs/0004-seeded-db-api-skeleton/index.md) · code in `server/data-proof/`, `src/dev/data-proof/`, and `src/features/data-proof/validation.ts`

Verified 2026-10-28: live Week 44 task reads and replies, Unicode validation, concurrent same identity retries, local Host/Origin and fixture guards, browser reload recovery through a real database outage, app restart and reseed persistence, empty states, keyboard and 320px layout, production route/asset exclusion, lint, types, build, and `db:verify` passed. No schema change or reset was needed. Retained fictional reply ids, evidence and limits are recorded in [verify.md](../specs/0004-seeded-db-api-skeleton/verify.md). Feature 4's separate verification remains open.

### 6. Sign in and role access · in-progress · GA
Password style sign in as in the prototype; session; role gates so each user group only sees its nav and data scope. Single org: Workforce Group.
**Done when:** a user can sign in as each of the five roles (or seeded accounts), land on the right shell, and cannot open another role's routes or data.
- [x] Design it (spec): `/architect sign in and role access`
- [ ] Build it: `/develop sign in and role access`
  - [ ] Prototype sign in and integration with the built Feature 4 shell (AC-2, AC-5, AC-9)
  - [x] Linked auth schema, private provisioning, and local credential fixtures (AC-1, AC-7)
  - [x] Database sessions, secure wrappers, throttling, and audit evidence (AC-2, AC-3, AC-7, AC-8)
  - [x] Current role context, data scope policies, protected routes, and preview isolation (AC-4 through AC-6, AC-9)
- [ ] Verify it: `/check verify sign in and role access`
- [x] Test it: `/test sign in and role access`
- [x] Review it (fresh model): `/check review sign in and role access`
- [x] Document it: `/document sign in and role access`
spec [0005](../specs/0005-sign-in-role-access/index.md) · code in `server/auth/`, `src/features/auth/`, `scripts/auth-*.ts`, and `tests/auth/` · [verification](../specs/0005-sign-in-role-access/verify.md)

Implemented 2026-10-30 against the built Feature 4 shell. The additive auth migration, private provisioning, persisted sessions, current role policies and protected routes are in place. All 22 Node and HTTP tests pass; GPT-6.1 Sol approved the final code and the subsequent mobile grid correction. Five role development and production HTTP journeys, seed and restart persistence, and actual PostgreSQL outage recovery passed. Browser checks now cover five development roles, prototype comparison, form controls, 320px and zoom layout, throttling, inactive account denial and outage Retry recovery. Production browser journeys, genuine foreground access changes and interrupted responses remain open after browser control stopped. UI integration, Verify it and overall Build it remain open. See verify.md for evidence and remaining steps. No public signup or password recovery is enabled.

### 7. Accessibility baseline · in-progress
Project wide WCAG 2.2 AA target: focus order, labels, dialogs, live regions, contrast. Applies to every later screen.
**Done when:** shared patterns for dialogs, forms, and nav meet AA checks; later features inherit rather than reinvent.
- [x] Design it (spec): `/architect accessibility baseline`
- [ ] Build it: `/develop accessibility baseline`
  - [ ] Shared contract, prototype references, and built surface inventory (AC-1, AC-9)
  - [ ] Keyboard, names, validation, navigation, and native overlay behavior (AC-2 through AC-4, AC-6)
  - [ ] Scoped announcements and measured visual/adaptation corrections (AC-1, AC-5, AC-6)
  - [ ] Chromium Playwright/axe regression checks through the Node runner (AC-7, AC-9)
- [ ] Test it: `/test accessibility baseline`
- [ ] Verify it: `/check verify accessibility baseline`
  - [ ] Actual keyboard/NVDA, zoom/spacing, and production coverage evidence (AC-8 through AC-10)
spec [0006](../specs/0006-accessibility-baseline/index.md)

Design confirmed 2026-10-28 after official standards/tool checks, an independent model cross check, and user approved repairs. The user selected Chromium automation with Playwright Library and axe through Node/tsx, actual NVDA with Chrome or Edge, and first-invalid-field validation. Test it is required by the requested regression coverage despite the Alpha default. Feature 4 must be built first; built Feature 5/6 pages join the coverage inventory, while unbuilt pages are never recorded as passed. Implementation and accessibility verification have not started. Optional Playwright/axe skill and MCP discovery was declined.

### 8. Error monitoring and product analytics · in-progress
Error monitoring for failed API and client crashes; product analytics for submit, approve, late approval, and role usage. English only product copy.
**Done when:** errors are visible in a monitoring sink in local or staging config; key product events fire for the Employee and Line Manager loop at minimum.
- [x] Design it (spec): `/architect error monitoring and product analytics`
- [ ] Build it: `/develop error monitoring and product analytics`
  - [ ] Validated records, bounded local files, retention, and inspection commands (AC-1, AC-4 through AC-6)
  - [ ] Sanitized server/client capture, recovery fallback, and isolated development probes (AC-2 through AC-4)
  - [ ] Guarded ingestion, real context adapter, and committed event contracts (AC-4, AC-7, AC-8)
  - [ ] Real Features 10, 17 and 19 event integration, including human, automatic and late approvals (AC-7 through AC-9)
- [ ] Test it: `/test error monitoring and product analytics`
- [ ] Verify it: `/check verify error monitoring and product analytics`
  - [ ] Real app error capture, privacy, failure bounds, and production isolation evidence (AC-1 through AC-6, AC-10)
  - [ ] Actual authenticated views, submission and approval workflow evidence, no synthetic substitute (AC-7 through AC-10)
spec [0007](../specs/0007-error-monitoring-product-analytics/index.md)

Design confirmed 2026-10-28 after official documentation checks, an independent model cross check, and the user approved privacy repair. Local JSON Lines files provide best effort error capture and aggregate role events, with 30 day retention and a 100000000 byte total cap. Business audits remain separate. Focused regression tests are required by the approved spec. Implementation has not started. The foundation can land first, but the feature and final Verify it box remain open until real workflows in Features 10, 17 and 19 pass. Runtime role views require Feature 6; visual prototype control inspection remains required before the approved recovery fallback is built.
