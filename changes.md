# Changes — 2026-10-31

## 1. Reviewed PR #2 for bugs and security

**What changed**  
Pulled [PR #2](https://github.com/WG241/prod-tracker/pull/2) (`codex/foundations-auth-progress`) locally and ran Bugbot, the security-review agent, and a vibe-security audit. Wrote the audit to `issues.md`. No critical auth bypass was confirmed; High/Medium/Low code issues were listed for fix.

**Why**  
The PR added the whole auth foundation. Reviewing before merge catches cookie, session, throttle, and dependency risks while the surface is still small.

**Findings (before fixes)**
- High: `forwardCookies` could mishandle multiple `Set-Cookie` headers
- Medium: forced `revoke()` did not verify like `signOut()`; session refresh could run before eligibility revoke; relief date math ignored shared WAT helpers
- Low: fragile sign-in token lookup; unbounded email failure counter; shared IP throttle behind a proxy; transitive `fast-uri` advisory

**Files edited**
- `issues.md`

## 2. Fixed High and Medium auth issues

**What changed**  
Cookie forwarding now appends each `Set-Cookie` individually. `revoke()` confirms targeted session rows are gone before returning clearing headers. Session eligibility is checked from the DB before Better Auth can renew an ineligible session. Relief review uses `watCalendarDay()` from the shared calendar helpers. Added focused validation tests.

**Why**  
These were the merge-blocking correctness and logout/eligibility gaps from the review.

**Files edited**
- `server/auth/router.ts`
- `server/auth/service.ts`
- `server/auth/policies.ts`
- `server/data-model/calendar.ts`
- `tests/auth/validation.test.ts`
- `tests/auth/integration.test.ts`

## 3. Fixed Low auth and dependency issues

**What changed**  
Sign-in session resolution falls back from response token → `Set-Cookie` → newest user session. Email failure counters cap at five. Added opt-in `TRUST_PROXY` (off by default) and `clientIp()` for throttle keys. Cleared the `fast-uri` advisory with `npm audit fix`. Documented env vars in `.env.example` and auth operations.

**Why**  
Closes the remaining Low findings without enabling untrusted proxy headers by default.

**Files edited**
- `server/auth/service.ts`
- `server/auth/throttle.ts`
- `server/auth/router.ts`
- `server/config.ts`
- `server/index.ts`
- `package-lock.json`
- `.env.example`
- `docs/auth-operations.md`
- `tests/auth/validation.test.ts`
- `issues.md`

## 4. Shared operator target for Neon seeding

**What changed**  
Added `server/auth/operator-target.ts` for shared fixture person ids and database/origin checks used by seed and auth operator scripts. `db:seed` and `auth:seed` can target Neon (not only loopback Postgres). Spec and ops docs updated. README lists the five fictional sign-in emails and that they share `LOCAL_AUTH_TEST_PASSWORD`.

**Why**  
This team develops against Neon. Hard “local database only” seed guards blocked real preview. Operator scripts needed one place for those rules.

**Files edited**
- `server/auth/operator-target.ts`
- `prisma/seed.ts`
- `scripts/auth-seed.ts`
- `scripts/auth-provision.ts`
- `scripts/auth-prune.ts`
- `package.json`
- `docs/specs/0005-sign-in-role-access/index.md`
- `docs/auth-operations.md`
- `prisma/fixtures/README.md`
- `README.md`
- `server/auth/AGENTS.md`
- `tests/auth/validation.test.ts`
- `.env.example`

## 5. Use Neon as the normal database (not a computer-local Postgres)

**What changed**  
Setup guides and agent rules now say: put your Neon database details in `.env` and work against that. Installing or starting Postgres on your own machine is no longer the normal path. The old local helper is marked optional / unused for this team.

**Why**  
This project always uses Neon in practice. Docs that said “install local Postgres first” were wrong for how we work and confused onboarding.

**Files edited**
- `AGENTS.md`
- `README.md`
- `.env.example`
- `docs/auth-operations.md`
- `docs/scope/index.md`
- `docs/scope/foundations.md`
- `docs/specs/0001-stack-and-architecture/index.md`
- `docs/specs/0005-sign-in-role-access/index.md`
- `prisma/fixtures/README.md`
- `scripts/local-db.mjs`
- `server/AGENTS.md`
- `server/auth/AGENTS.md`
- `server/data-proof/AGENTS.md`
- `server/data-proof/router.ts`

## 6. Removed the “acknowledge remote database” step

**What changed**  
Commands that seed data or manage sign-in accounts no longer ask for a special flag or env setting before writing to Neon. You can run them with normal Neon URLs in `.env`.

**Why**  
Neon is our everyday database. The extra confirm step only added friction; operators should be able to write without it.

**Files edited**
- `server/auth/operator-target.ts`
- `prisma/seed.ts`
- `scripts/auth-seed.ts`
- `scripts/auth-provision.ts`
- `scripts/auth-prune.ts`
- `tests/auth/validation.test.ts`
- `.env.example`
- `AGENTS.md`
- `README.md`
- `docs/auth-operations.md`
- `docs/specs/0001-stack-and-architecture/index.md`
- `docs/specs/0005-sign-in-role-access/index.md`
- `prisma/fixtures/README.md`
- `server/auth/AGENTS.md`

## 7. Hardened the database schema (indexes and safer guards)

**What changed**  
Added missing indexes on foreign-key columns so joins and deletes stay fast and safe. Tightened the auth email rule so it matches the main user email rule (must include `@`). Hardened the history-protection database functions so they use a fixed search path and are not callable by the public database role. Applied this as one additive migration on Neon.

**Why**  
A Postgres review (Supabase best-practice checks) found unindexed foreign keys, a weaker auth email check than the main user table, and trigger functions that were too open. Those gaps slow cascades and widen the attack surface if the database is ever exposed more broadly.

**Files edited**
- `prisma/schema.prisma`
- `prisma/migrations/20261031020959_postgres_security_fk_indexes/migration.sql`

## 8. Database work must be idempotent and atomic

**What changed**  
Project rules now require database migrations and multi-step writes to be safe to retry and to succeed or roll back as one unit. Prefer fixing the migration under review so it can re-run cleanly, instead of stacking a second “override” migration. The hardening migration above was updated to use `IF NOT EXISTS` / guarded constraint changes so a second run is a no-op.

**Why**  
Non-idempotent SQL breaks when someone re-applies or repairs a database. Override-only migrations clutter history. Clear agent rules keep future schema and seed work consistent with how we already treat fixtures (repeatable, transactional).

**Files edited**
- `AGENTS.md`
- `docs/specs/0002-data-model/index.md`
- `prisma/migrations/20261031020959_postgres_security_fk_indexes/migration.sql`
