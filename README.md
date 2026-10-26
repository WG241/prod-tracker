# Workforce weekly performance (`prod-tracker`)

Internal app for **Workforce Group**: people plan and report work by week, managers approve it, leaders see participation and approved completion, and HR runs organisation structure, leave and relief, tracker lock or unlock, audit, and settings.

This repo is set up so a **junior developer + AI coding IDE** can build feature by feature without inventing product or UI. Durable state lives in files (scope, specs, `AGENTS.md`), not in chat history.

## Who this is for

- You are implementing the product against an existing HTML prototype and a living scope.
- Your AI agent should follow `AGENTS.md` on every session (resume, one feature, prototype UI, verify before done).

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. Configure database (copy and fill)
cp .env.example .env
# Set DATABASE_URL and DATABASE_URL_UNPOOLED (Neon or local Postgres)

# 3. Generate Prisma client and migrate when schema is ready
npm run db:generate
npm run db:migrate

# 4. Run the app
npm run dev
```

Other useful commands: `npm run build`, `npm run lint`, `npm run db:studio`.

## Install workflow skills (required for agents)

Product work uses the JS Mastery engineering workflow skills (`/scope`, `/architect`, `/develop`, `/check`, `/test`, and related).

Repo: [https://github.com/jsmastery-pro/skills](https://github.com/jsmastery-pro/skills)

If your IDE does not already have these skills:

```bash
# Cursor and most Agent Skills clients
npx skills@latest add jsmastery-pro/skills

# Claude Code
npx skills@latest add jsmastery-pro/skills -a claude-code
```

Install **all** workflow skills from that repo that your IDE supports. Then restart or reload the agent so `/develop`, `/architect`, `/check`, etc. resolve.

**Agent rule:** if those skills are missing at the start of a session, install them before writing product code.

## Where the truth lives

| What | Where | Owner skill |
|------|--------|-------------|
| What to build (order, roles, status) | `docs/scope/` → start at [`docs/scope/index.md`](docs/scope/index.md) | `/scope` |
| How to build a feature (decisions, acceptance criteria, build plan) | `docs/specs/NNNN-title.md` (created as you run `/architect`) | `/architect` |
| Agent + team conventions | [`AGENTS.md`](AGENTS.md) | `/audit` seeds; you curate; `/sync` maintains |
| **UI design contract** | [`docs/workforce-prototype-updated.html`](docs/workforce-prototype-updated.html) | human + every UI build |
| Tokens / type notes | `docs/design-tokens.md`, `docs/typography-scale.md` | support the prototype |
| Design system writeup (when created) | `design.md` at repo root | `/develop` / design work |

Claude Code users: `CLAUDE.md` only points at `AGENTS.md`. Edit `AGENTS.md`, not a second copy of the rules.

## Recommended skill / prompt style

Work in **small, named commands** (one phase each). Prefer these over a vague “build the app” prompt:

```
idea → /scope → /audit → /architect → /develop → /check verify → /test → /sync
```

| When | Run |
|------|-----|
| See where you are / replan | `/scope` (bare) |
| Seed or refresh project conventions | `/audit` |
| Decide stack, data model, or a screen | `/architect <feature name from scope>` |
| Implement one feature from its spec | `/develop <feature>` |
| Prove it in the real app | `/check verify <feature>` |
| Add regression tests | `/test <feature>` |
| Something broken | `/debug` |
| After merge / catch drift | `/sync` |

**Project workflow depth:** **Alpha** by default (develop → verify). Some scope rows are tagged `· Beta` or `· GA` and need more. Still: do not hand off a feature as done if verify (and required tests) failed.

**Build approach:** **Facade on seeded local DB** — UI first, but talking to migrated + seeded Postgres, then harden. Details in `AGENTS.md` and the scope header.

## How to build (human + agent)

### 1. Start every new chat by resuming

Before coding, the agent (and you) should:

1. Run `git status` and look at the latest commit (`git log -5 --oneline`).
2. Open `docs/scope/index.md` and find the first feature that is not `done` / `existing` / `dropped` in the **current role group**.
3. Open that feature’s section in the matching epic file under `docs/scope/`.
4. Open its spec in `docs/specs/` if the pointer exists.
5. Continue from the **first unticked checkbox**.

Do not re-scaffold finished foundations. Do not skip ahead to another role while the current role’s planned features are still open (unless the user explicitly redirects).

### 2. Pick what to build (role by role)

- Finish **one user group** before the next.
- Default order: **Employee → Line Manager → Business Director → Executive → HR / Admin**.
- If the user does **not** say which role or feature: **ask**, and recommend the next open row in that order.
- **One feature per agent run** (modular). Finish or clearly park it before starting another.

Shared features (profile, in app notifications, email alerts) are in `docs/scope/shared.md`. Build them when the first role that needs them is active.

### 3. Frontend: prototype only (no drift)

1. Open `docs/workforce-prototype-updated.html` in a browser.
2. Switch to the **same role** you are implementing.
3. Navigate to the **exact screen** (and open the same dialog, drawer, or panel).
4. Prefer a **screenshot** or side by side browser view while implementing.
5. Match layout, copy hierarchy, controls, and empty / locked states from that screen.
6. **If there is no screen, component, or panel in the prototype for the feature:** stop, tell the user, and wait for approval before inventing UI.

Tokens in `docs/design-tokens.md` support the prototype; they do not replace it.

### 4. Backend pattern

- Prefer **UI + API + DB** working together on **local migrations and seed mock data**.
- Do not ship “pretty UI on fake memory” once the seeded skeleton exists.
- Keep changes inside the feature’s module boundaries; avoid unrelated refactors.

### 5. Done means verified

Before calling a feature done or handing off:

1. `/check verify` against the running app (Alpha default).
2. `/test` (or project tests) when the scope has `Test it`, the feature is `· Beta` / `· GA`, or the user asked for regression tests.
3. Update scope checkboxes / status (via the skill or carefully by hand).
4. Prefer a fresh chat (`/clear` or new agent session) for the next feature so the next run re-reads files from disk.

## Role map (from the prototype)

| Role | Main areas (prototype nav) |
|------|----------------------------|
| Employee | Home, History, Leave, Profile |
| Line Manager | Dashboard, My tasks, Team history, Approvals, Leave, Profile |
| Business Director | Dashboard, Units, Performance records, Reports, Profile |
| Executive | Dashboard, Businesses, Performance records, Reports, Profile |
| HR / Admin | Dashboard, Organisation, Employees, Tracker controls, Leave and relief, Performance records, Reports, Audit log, Settings |

Full feature list and statuses: `docs/scope/index.md`.

## Suggested first prompts for your AI IDE

After skills are installed and `AGENTS.md` is present:

```text
Read AGENTS.md and docs/scope/index.md. Check git status and the latest commits.
Tell me which feature we should build next and which role it belongs to. Ask me to confirm before starting.
```

```text
Open docs/workforce-prototype-updated.html, switch to Employee, go to Home.
We will /architect then /develop the Employee home and weekly board. Match that screen exactly. If anything is missing from the prototype, stop and ask me.
```

```text
Resume from the last commit and unstaged files. Continue the first unticked box on the current in-progress feature. One feature only. Run /check verify before marking done.
```

## Repo status (honest)

- Scaffold: React + Vite + Tailwind + Prisma + Neon wiring.
- Product UI: not built yet; the clickable map is the HTML prototype under `docs/`.
- Scope: written under `docs/scope/`.
- Specs: create with `/architect` as you take each `needs a decision` feature.

## License / internal use

Internal Workforce Group tool for this release (single organisation, no billing).
