# Authentication context

Root and server `AGENTS.md` apply. This area implements [spec 0005](../../docs/specs/0005-sign-in-role-access/index.md) using Better Auth 1.7.13 and PrismaPg. [Operations](../../docs/auth-operations.md) documents configuration and trusted commands.

Only the three application wrappers are public: POST `/api/auth/sign-in`, POST `/api/auth/sign-out`, and GET `/api/session`. Never mount the provider's unrestricted handler or import `provision.ts` into an HTTP handler. Public registration and recovery remain disabled.

`AuthUser.id` explicitly references Workforce `User.id`. Email never creates a link. Pending identities cannot create usable sessions. `context.ts` reads current Active status, canonical email consistency and the current effective assignment on every protected request. Browser previews do not provide authority.

`policies.ts` is the reusable data boundary. Use caller ownership for own work, current assignments for open records, recorded context for frozen records, business scope for directors, aggregates for Executive, organisation scope for HR and dated pending request scope for relief. A current scope query must not reinterpret a frozen task through a later assignment.

Sessions live in PostgreSQL, expire after seven days and renew daily through provider headers. Forward every Set-Cookie header. Sign out must verify that the session row is absent, since the provider catches deletion failures. Never issue expiry cookies or completed audit evidence based only on its success response.

Persistent PostgreSQL counters use HMAC email and direct socket IP keys. Do not trust forwarded IP headers or replace failures with memory counters. Mutations require exact configured Origin and JSON. Session reads reject conflicting Origin or cross site Fetch Metadata. Ordinary page navigation can arrive from an external link. Document cache headers stay `no-store` through Vite and production serving.

Audit requested evidence precedes revocation and sign out. Successful email counter cleanup and sign in completion audit commit together before cookies are forwarded. Activation and its System audit event commit together. Tokens, hashes, cookies, passwords and request bodies never belong in app JSON or logs.

`provision.ts` is a private operator boundary. Keep its pending, ready, verified resume and guarded repair behavior. Preserve ready credentials and sessions during reseeding. Normal database commands do not require auth configuration. Operator CLIs share `operator-target.ts` for connection validation (Neon allowed); `auth:seed` also keeps a loopback `BETTER_AUTH_URL` and nonproduction env so local preview can sign in against Neon data.

## Agent skills

- [better-auth-best-practices](../../.agents/skills/best-practices/SKILL.md): `better-auth/skills`, provider and adapter conventions.
- [better-auth-security-best-practices](../../.agents/skills/security/SKILL.md): `better-auth/skills`, sessions, cookies, origin and limit guidance.
- [email-and-password-best-practices](../../.agents/skills/emailAndPassword/SKILL.md): `better-auth/skills`, maintained password hashing and verification.

The optional Better Auth documentation MCP is deferred. Installed package source governs version specific behavior. The chosen exclusions override setup examples that enable signup or mail.

Tests use Node/tsx and an explicitly configured separate `TEST_DATABASE_URL` (Neon branch or another database name). The ordinary development database must have a different decoded database name, even through host aliases. Never reset the ordinary database or remove append only audit evidence. Browser checks remain separate from HTTP assertions.

_Maintained by /sync from the introducing change._
