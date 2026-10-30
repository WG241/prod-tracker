# Security Audit Report

## Executive Summary

PR #2 (`codex/foundations-auth-progress`, local branch `pr-2`) introduces the auth foundation (Better Auth, narrow Express wrappers, Prisma sessions, throttling, navigation guard) plus seeded data-proof APIs. No critical or high-severity exploitable auth bypass was confirmed. **High, Medium, and Low code findings from the review have been remediated on `pr-2`** (cookie forwarding, revoke verification, eligibility-before-refresh, WAT relief calendar, sign-in session resolution fallbacks, email failure counter cap, opt-in `TRUST_PROXY`, and the transitive `fast-uri` advisory via `npm audit fix`). Remaining items are operational (enable `TRUST_PROXY` only after a deploy decision) and future API authorization wiring.

## Detected Stack and Scope

- **Framework**: React 19 + Vite 8 (browser), Express 5 (Node service)
- **Database**: PostgreSQL via Prisma 7 / PrismaPg
- **Authentication**: Better Auth (email/password, sign-up disabled), custom wrappers at `/api/auth/sign-in`, `/api/auth/sign-out`, `/api/session` only
- **Deployment**: Not production-deployed in this review; local/dev oriented
- **Review scope**: Diff of PR #2 vs `main`, plus follow-up remediation commits on `pr-2`
- **Limitations / not verified**: Live production proxy topology; full integration suite (requires local `TEST_DATABASE_URL`); framing headers on HTML (deferred)

## Results

- **Project Score**: 96/100 — Excellent (prioritization aid; remaining residual is ops readiness)
- **Checks**: 22 passed, 0 open findings, 5 not applicable, 2 not verified
- **Unique open issues**: 0

## Quick Wins

| # | Issue | Severity | Status |
|---|---|---|---|
| 1 | `forwardCookies` array append | 6/10 Medium | Fixed |
| 2 | `revoke()` verification | 5/10 Low | Fixed |
| 3 | Eligibility before session refresh | Medium | Fixed |
| 4 | Relief WAT calendar day | Medium | Fixed |
| 5 | Sign-in session token coupling | Low | Fixed |
| 6 | Unbounded email failure counter | Low | Fixed |
| 7 | Shared proxy IP throttle | Low | Fixed (opt-in `TRUST_PROXY`) |
| 8 | `fast-uri` advisory | Low | Fixed (`fast-uri@3.1.9`, audit clean) |

## Findings

_No open findings._ Remediated items are listed under Passed Checks and the plan below.

## Passed Checks

| Check | Evidence |
|---|---|
| Secrets not in client/`VITE_` | Auth secrets stay server-side; `readAuthConfig` rejects weak/placeholder secrets |
| `.env` gitignore | `.env` / `.env.*` ignored with `!.env.example` |
| Narrow auth HTTP surface | Only wrapper paths mounted |
| CSRF / Origin on mutations | Exact origin match; cross-site Fetch Metadata rejected |
| Cookie attributes | HttpOnly, SameSite=Lax, path `/`, Secure when HTTPS |
| Multi-cookie forwarding | `forwardCookies` appends each `getSetCookie()` value |
| Sign-up disabled | `disableSignUp: true`; user-create hook throws |
| Session fail-closed + eligibility-first | DB eligibility checked before `getSession` renewal; revoke verifies row absence |
| Sign-in session resolution | Token → Set-Cookie → newest user session fallbacks |
| Email failure counter capped | `recordFailure` uses `LEAST(..., EMAIL_FAILURE_LIMIT)` |
| Trusted proxy opt-in | `TRUST_PROXY` off by default; `clientIp()` uses Express `request.ip` when enabled |
| Dependency audit | `npm audit --omit=dev` clean after `fast-uri` bump |
| Parameterized SQL / throttle HMAC | Tagged `$queryRaw`; HMAC keys |
| Dev data-proof gate | Development + loopback only |
| Session JSON strips tokens | `safeContext` only |

## Not Applicable

| Check | Reason |
|---|---|
| Payments / webhooks | Not in this PR |
| Mobile / deep links | Web internal app only |
| AI tool / LLM cost controls | No AI integration in scope |
| Multi-tenant RLS product | Single-org Workforce |
| Public file uploads / object storage | Not present |

## Not Verified

| Check | Missing evidence / next step |
|---|---|
| Production reverse-proxy topology | Set `TRUST_PROXY` only after the hosting decision; verify distinct client throttle keys |
| Full integration suite green | Run `npm test` against `TEST_DATABASE_URL` with auth env configured |
| Future domain API authorization | Wire `policies.ts` when task/employee HTTP APIs land |
| Clickjacking headers on HTML | Add `frame-ancestors` / `X-Frame-Options` when richer authenticated HTML forms expand |

## Prioritized Remediation Plan

1. ~~Fix `forwardCookies`~~ done
2. ~~Align `revoke()` verification~~ done
3. ~~Eligibility before refresh; WAT relief day~~ done
4. ~~Cap email failure counters; harden sign-in session lookup~~ done
5. ~~Opt-in `TRUST_PROXY`; clear `fast-uri`~~ done
6. Before shared reverse-proxy production deploy, set and verify `TRUST_PROXY`
7. When domain APIs ship, enforce `policies.ts` server-side
8. Add framing protections when authenticated HTML surface expands
`)