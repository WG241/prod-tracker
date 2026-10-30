# Workforce weekly performance (`prod-tracker`)

Internal app for **Workforce Group**: people plan and report work by week, managers approve it, leaders see participation and approved completion, and HR runs organisation structure, leave and relief, tracker lock or unlock, audit, and settings.

This repo is set up so a **junior developer + AI coding IDE** can build feature by feature without inventing product or UI. Durable state lives in files (scope, specs, `AGENTS.md`), not in chat history.

## Who this is for

- You are implementing the product against an existing HTML prototype and a living scope.
- Your AI agent should follow `AGENTS.md` on every session (resume, one feature, prototype UI, verify before done).

## Quick start

On a fresh Windows x64 clone, use PowerShell:

```powershell
# 1. Create configuration if it does not already exist
if (-not (Test-Path .env)) { Copy-Item .env.example .env }

# 2. Install dependencies
npm install

# 3. Install and initialize native local PostgreSQL
npm run db:setup

# 4. Apply migrations, generate the client, and seed
npm run db:migrate
npm run db:generate
npm run db:seed

# 5. Privately configure BETTER_AUTH_SECRET and BETTER_AUTH_URL in .env.
# For fictional account credentials, explicitly set LOCAL_AUTH_TEST_PASSWORD,
# then run the separate command. See docs/auth-operations.md.
npm run auth:seed

# 6. Run Express and Vite together at http://127.0.0.1:5173
npm run dev
```

For later sessions, run `npm run db:start` and then `npm run dev`. `npm run db:stop` stops PostgreSQL and preserves its data. `npm run db:status` reports whether the local database is running. The helper uses PostgreSQL 18.6 on `127.0.0.1:5433`, verifies the official EDB archive checksum, and keeps its binaries, data, credentials, and logs in ignored `.local/`. It creates separate `prod_tracker` and `prod_tracker_shadow` databases, with a dedicated role that has no superuser or database creation privilege.

`db:setup` writes local credentials to `.env`. It preserves an existing Neon configuration in ignored `.env.neon.local` without overwriting an existing backup. On other platforms, install native PostgreSQL, create a development database and a separate shadow database, then fill `.env` using `.env.example`. Keep all database credentials outside browser code.

Use Node 24 and npm 11. `.node-version` records the Node major version.

Other useful commands:

| Command | What it checks |
|---------|----------------|
| `npm run lint` | Oxlint on browser, server, seed, scripts, and configuration files; warnings fail the command |
| `npm run lint:fix` | Apply normal lint fixes |
| `npm run typecheck` | Strict checks for browser and tooling, plus compilation of server JavaScript |
| `npm run build` | Type checking and the Vite production build |
| `npm run check` | Lint and the production build together |
| `npm run db:studio` | Open Prisma Studio |
| `npm run db:verify` | Check fixture repeatability, five role projections, and rejected invalid writes against local PostgreSQL |
| `npm run start` | Serve the compiled browser app and API in one production Node service |
| `npm run preview` | Run the same production service after a build |
| `npm run auth:provision -- --user-id person-id` | Provision an existing eligible person through a hidden terminal prompt |
| `npm run auth:seed` | Explicitly provision the five fictional local accounts |
| `npm run auth:prune` | Remove expired sessions and throttle windows |
| `npm run test:setup` | Migrate and seed the separate local authentication test database |
| `npm test` | Type check the tests and run the Node and HTTP authentication suite |

Coding conventions are in `AGENTS.md`. `.editorconfig` supplies editor whitespace defaults. There is no standalone formatter. The Node test runner uses tsx and requires a separate explicit local `TEST_DATABASE_URL`. `npm run check` checks tooling; `/check verify` still exercises feature behavior in the running app.

Sign in configuration, trusted provisioning, recovery from interrupted provisioning, local test setup and proxy limits are documented in [auth operations](docs/auth-operations.md). Real workspaces use the person's current database role. Development previews remain at `/__ui`, `/__ui?view=workspace` and `/__data-proof` and cannot establish a session.

## Architecture and connection check

The accepted architecture is recorded in [spec 0001](docs/specs/0001-stack-and-architecture/index.md). `server/` holds Express and the PrismaPg database client; `src/` holds browser code. The data model is recorded in [spec 0002](docs/specs/0002-data-model/index.md). `npm run db:seed` preserves existing rows and inserts missing sample identities and evidence in one transaction. It provides 28 staff identities, 35 weekly tasks and 110 weekly roster records, plus the inactive foundation identity. Dates are fixed to October 2026. See the [fixture manifest](prisma/fixtures/README.md) for source corrections and synthetic scenarios. Sample email deliveries remain suppressed. `npm run db:verify` checks the real local database and rolls back its constraint probes.

The browser makes a health request on startup and logs its connection result. `GET /api/health` returns `200` with `{ "status": "ok", "database": "connected" }` after querying the migrated table, or `503` with unavailable values if the database cannot be queried. It exposes no employee information or configuration. Unknown `/api/*` routes return JSON 404 responses.

For a production check, run `npm run build` then `npm run start`. It defaults to port 3000 and host `0.0.0.0`; use `HOST=127.0.0.1` for local verification and `PORT` to select another port. For example, in PowerShell:

```powershell
$env:HOST = '127.0.0.1'
$env:BETTER_AUTH_URL = 'http://127.0.0.1:3000'
npm run start
```

Neon deployments use the same PrismaPg connection path: set `DATABASE_URL` to the runtime connection and `DATABASE_URL_UNPOOLED` to the direct migration connection, with the documented TLS settings in `.env.example`. Build with development dependencies available, apply committed migrations using `npm run db:deploy`, and start the compiled service. The local database helper is for development. Hosting vendor setup and hosted Neon verification remain future deployment work.

## Install workflow skills (required for agents)

Product work uses the JS Mastery engineering workflow skills (`/scope`, `/architect`, `/develop`, `/check`, `/test`, and related).

Repo: [https://github.com/jsmastery-pro/skills](https://github.com/jsmastery-pro/skills)

All nine workflow skills are installed in `.agents/skills/` and can be shared through Git. Each includes its supporting guides and agent metadata. The copy was installed from `main` on 2026-10-26. Its MIT license is preserved in `docs/third-party/jsmastery-skills-LICENSE.txt`. Local agent state remains ignored. Codex discovers the installed skills on the next turn; agents can read their `SKILL.md` files directly now.

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

### 6. Push and pull requests

**Do not push directly to `main` or `staging`.** Those branches are updated only by merging pull requests.

When you (or the agent) are ready to push committed work — code, docs, or other files:

1. **Create a new branch from `staging`** (update local `staging` first if needed).
2. **Push that branch** to the remote.
3. **Open a PR with `staging` as the base** (not `main`).

Example:

```bash
git fetch origin
git checkout staging
git pull origin staging
git checkout -b your-feature-branch
# ... commit your work if not already committed ...
git push -u origin your-feature-branch
gh pr create --base staging --title "…" --body "…"
```

Agents must follow the same rules in [`AGENTS.md`](AGENTS.md) (refuse direct pushes to `main` / `staging` and open PRs against `staging`).

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

- Foundation: React, Vite, Express, PrismaPg, and native local PostgreSQL, with Neon deployment configuration supported.
- Product UI: not built yet; the clickable map is the HTML prototype under `docs/`.
- Scope: written under `docs/scope/`.
- Specs: architecture in spec 0001; create later feature specs with `/architect` as you take each `needs a decision` feature.

## License / internal use

Internal Workforce Group tool for this release (single organisation, no billing).
