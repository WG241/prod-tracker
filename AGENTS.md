# Workforce weekly performance (prod-tracker)

Internal weekly performance tracker for Workforce Group. Five roles: Employee, Line Manager, Business Director, Executive, HR / Admin.

## Stack

- **Language / Runtime**: strict TypeScript, Node 24, npm 11 (Vite 8)
- **Framework**: React 19 + Vite, Express 5 in one Node service
- **Key dependencies**: Prisma 7, PrismaPg, pg, Tailwind CSS v4, Lucide
- **Package manager**: npm
- **Database**: native local PostgreSQL 18.6 via PrismaPg; Neon uses the same PostgreSQL TCP adapter (spec `docs/specs/0001-stack-and-architecture/index.md`).

## Build approach

**Facade** (UI first, wired to a locally migrated database with seed mock rows so UI, API, and backend already work on live local data; harden from there).

**Role journey:** finish one user group before the next. Recommended default: Employee → Line Manager → Business Director → Executive → HR / Admin. Shared surfaces (profile, in app notifications, email alerts) land when the first role that needs them is in progress.

**Workflow depth (project default):** Alpha → after `/develop`, run `/check verify`. Features tagged `· Beta` or `· GA` in `docs/scope/` also need `/test` (and GA needs `/check review` + `/document`). This project still expects tests before you call a feature done when the feature has a `Test it` box or when the engineer asks for regression coverage.

## Commands

```bash
# Install
npm install

# Dev server
npm run dev

# Build
npm run build

# Lint
npm run lint

# Database
npm run db:setup
npm run db:start
npm run db:generate
npm run db:migrate
npm run db:seed
npm run db:studio

# Local data model checks, including rollback constraint probes
npm run db:verify
npm run db:stop

# Production (after build)
npm run start

# Test (explicit separate local TEST_DATABASE_URL is required)
npm run test:setup
npm test
```

## Coding conventions and tooling

Feature 1 records the existing scaffold conventions here. Use Node 24 and npm 11 (see `.node-version` and `package.json`).

- Use TypeScript with `strict` enabled and ESM imports. Prefer explicit domain types and `unknown` for untrusted values over `any`. Use `import type` for imports used only as types.
- Match the scaffold style: two spaces, single quotes in TypeScript, no semicolons, trailing commas in multiline lists, and double quotes for JSX attributes. `.editorconfig` records UTF-8, LF, indentation, and final newlines. No standalone formatter is installed yet.
- Use function components and hooks. Name components and their files in PascalCase, hooks as `useName`, and other functions and variables in camelCase. Keep related feature code together and extract shared code only when it has real consumers.
- `src/main.tsx` is the browser entry. Keep Node globals, database clients, and credentials out of browser imports. `server/db.ts` owns PrismaPg. `tsconfig.server.json` compiles server code, `tsconfig.node.json` checks tooling, and `tsconfig.app.json` checks browser code with Vite types.
- Change `prisma/schema.prisma` and regenerate the client instead of editing `src/generated/`. Generated clients, dependencies, build output, and local environment files stay out of Git. Only public configuration may use a `VITE_` prefix.
- Run `npm run lint` for Oxlint with warnings treated as failures. `npm run lint:fix` applies normal lint fixes. `npm run typecheck` checks all TypeScript projects and emits server JavaScript. `npm run check` runs lint and the production build, which includes type checking.
- A clean build is a tooling check. Feature acceptance still requires `/check verify` on the running app and any tests required by the scope. `npm test` type checks tests and operator scripts, then runs Node/tsx authentication tests against an explicit separate local test database.

## Specs

Stored in `docs/specs/`. Format: `docs/specs/NNNN-title.md`.
Owned by `/architect`. Do not invent load bearing design in chat; write or update a spec first.

## Scope

Living plan in `docs/scope/` (start at `docs/scope/index.md`). Status and next checkbox are the source of truth for what to build next.

## Design source of truth (no frontend drift)

**The HTML prototype is the UI contract.** Path: `docs/workforce-prototype-updated.html`.

Tokens and type notes (supporting, not a second design): `docs/design-tokens.md`, `docs/typography-scale.md`. When `design.md` exists, it must describe the prototype, not a new look.

### Rules every agent must follow before UI work

1. **Match the prototype screen.** Before implementing any page, panel, dialog, or component, open the prototype, switch to the correct **role**, navigate to the **exact screen** (and dialog or drawer if needed), and use that as the visual and interaction reference. Prefer a screenshot or live browser view of that screen beside the implementation.
2. **No visual freelancing.** Do not invent a new layout, color system, nav structure, or component style when the prototype already shows one. Spacing, type scale, status colors, and shell chrome follow the prototype and token docs.
3. **Missing UI = stop and ask.** If the feature has **no** matching screen, component, panel, dialog, or empty state in the prototype, **tell the user before creating anything new**. Wait for approval (or a prototype update) before designing from scratch.
4. **Role nav is fixed.** Use the prototype’s per role nav (`Employee`, `Line Manager`, `Business Director`, `Executive`, `HR / Admin`). Do not add sidebar items the prototype does not show unless the user approved an exception.

## Rules

- **One feature per run.** Build a single scope feature (or a single milestone under it) per agent session. Do not batch unrelated features.
- **One role group at a time.** Complete the current user group’s planned features (and required shared deps) before starting the next role. If the user did not name a role or feature, **ask** which role to continue, using the recommended order above as the default suggestion.
- **New chat = resume from git + scope.** At the start of every new session, before building: (1) `git status` and recent `git log` (last commit + unstaged/uncommitted files), (2) read `docs/scope/index.md` At a glance for the first non-done, non-existing feature in the active role, (3) open that feature’s spec under `docs/specs/` if it exists. Continue from the first unticked checkbox. Do not restart a finished foundation.
- **UI then API on seeded DB.** Implement against real local migrations and seed data; do not leave screens on in memory fake data when the skeleton exists.
- **Verify before done.** For Alpha features: `/check verify` must pass on the real app before offering `done`. When a feature has `Test it` or the user requires regression tests, `/test` (or the project test command) must pass before handover. Do not mark `done` on failing verify or tests.
- **Modular boundaries.** Prefer small modules per feature area (UI route/page, API handlers, Prisma models touched). Avoid drive by refactors outside the feature’s code pointer.
- **Workflow skills required.** If `/develop`, `/architect`, `/scope`, `/check`, `/test`, `/audit`, `/sync`, `/debug`, `/document` (or the equivalent skill files) are missing for this IDE, install the full workflow set from `https://github.com/jsmastery-pro/skills` before building product features. See README “Install workflow skills”.
- **English only** product copy for this release.
- **Single org:** Workforce Group only (no multi tenant product surface).

## Agent skills

Install from [`jsmastery-pro/skills`](https://github.com/jsmastery-pro/skills) (Agent Skills format). After install, skills typically live under `.agents/skills/` and/or `.claude/skills/` depending on the IDE.

Expected workflow skills: `scope`, `audit`, `architect`, `develop`, `check`, `test`, `document`, `sync`, `debug`.

Installed on 2026-10-26 from `jsmastery-pro/skills` (`main`). The shared copies live in `.agents/skills/`; their MIT license is in `docs/third-party/jsmastery-skills-LICENSE.txt`. Codex discovers these skills on the next turn. You can also read each file directly during the current turn.

- [scope](.agents/skills/scope/SKILL.md): `jsmastery-pro/skills`, maintain the feature plan.
- [audit](.agents/skills/audit/SKILL.md): `jsmastery-pro/skills`, capture project conventions.
- [architect](.agents/skills/architect/SKILL.md): `jsmastery-pro/skills`, record decisions in specs.
- [develop](.agents/skills/develop/SKILL.md): `jsmastery-pro/skills`, implement one feature.
- [check](.agents/skills/check/SKILL.md): `jsmastery-pro/skills`, verify the app or review changes.
- [test](.agents/skills/test/SKILL.md): `jsmastery-pro/skills`, add regression coverage.
- [document](.agents/skills/document/SKILL.md): `jsmastery-pro/skills`, document completed work.
- [sync](.agents/skills/sync/SKILL.md): `jsmastery-pro/skills`, reconcile context with the code.
- [debug](.agents/skills/debug/SKILL.md): `jsmastery-pro/skills`, diagnose and fix failures.

Additional technology specific skills and MCP discovery for Express, PrismaPg, and PostgreSQL were deferred during Feature 2.

```bash
# Cursor / generic Agent Skills clients
npx skills@latest add jsmastery-pro/skills

# Claude Code
npx skills@latest add jsmastery-pro/skills -a claude-code
```

Commit the installed skills folder when the team should share the same workflow.

## Git

- `integration: off` by default (agent does not auto branch or auto commit unless the user asks).
- Always inspect `git status` and recent commits when resuming work.

### Push and pull requests (required)

**Never push commits or documentation directly to `main` or `staging`.** Protected integration branches are merge-only via PR.

When the user asks to push committed changes (code, docs, or anything else):

1. **Create a new branch from `staging`** (fetch/update `staging` first if needed). Do not branch from `main` unless the user explicitly says otherwise.
2. **Push that feature branch** to the remote (`git push -u origin <branch>`).
3. **Open a pull request with `staging` as the base** (not `main`).

If the user is already on `main` or `staging` with local commits, move those commits onto a new branch off `staging` before pushing; do not push the protected branch. If they ask to push to `main` or `staging` directly, refuse and follow this flow instead.

## Context files

<!-- Nested AGENTS.md files are listed here as they are created -->

- [server/AGENTS.md](server/AGENTS.md): Express serving, server only database access, and readiness behavior.
- [server/data-proof/AGENTS.md](server/data-proof/AGENTS.md): fixed local development proof, request guards, and reply retry semantics.
- [server/auth/AGENTS.md](server/auth/AGENTS.md): linked credentials, sessions, current role context, policies, limits, audit and trusted provisioning.

_Human curated handoff for junior developers and AI coding agents. `/audit` and `/sync` should flag rather than overwrite intentional prose in Rules and Design source of truth._
