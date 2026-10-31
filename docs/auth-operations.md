# Sign in operations

Feature 6 uses Better Auth 1.7.13 with PostgreSQL sessions. Workforce people and current employment assignments remain the source of identity, active status and role. See [spec 0005](specs/0005-sign-in-role-access/index.md).

HTTP startup requires private `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` values. Generate the secret from at least 32 random bytes. The URL is a fixed origin, without credentials, a path, query or fragment. Use HTTPS remotely. Explicit loopback HTTP is supported for development and compiled production verification. The normal local origins are `http://127.0.0.1:5173` and `http://127.0.0.1:3000`, respectively. Set the origin to the one being tested, since mutation requests must match exactly.

## Database target (Neon-first)

Development and deployment use **Neon PostgreSQL**. Put pooled `DATABASE_URL` and direct `DATABASE_URL_UNPOOLED` in `.env` (see `.env.example`).

Operator CLIs (`db:seed`, `auth:seed`, `auth:provision`, `auth:prune`, and similar) may write to Neon. Shared checks in `server/auth/operator-target.ts` still reject database connection query overrides for host, hostaddr and service. Retain PostgreSQL certificate validation. Prefer Neon’s current connection string from the console; if `pg` warns about `sslmode`, use the documented `uselibpqcompat=true&sslmode=require` form or `sslmode=verify-full`.

Database migrate, seed and verify commands do not require auth settings. Apply migrations and generate the client before starting the updated app:

```sh
npm run db:deploy
npm run db:generate
```

## Trusted provisioning

An operator can provision an existing Active Workforce person with a current assignment and canonical email. The command prompts twice for a hidden password in an interactive terminal. Passwords accept 15 through 128 Unicode characters, including spaces. Do not put a staff password in an argument or environment variable.

```sh
npm run auth:provision -- --user-id person-id
```

The command starts no HTTP listener. Registration is unavailable through the application. Provisioning never adopts an identity by email and never overwrites a ready identity, its credential or sessions. A pending identity cannot authenticate. Activation rechecks eligibility and commits its readiness timestamp and System audit event together.

After an interrupted activation, resume with the original password:

```sh
npm run auth:provision -- --user-id person-id --resume
```

If a pending identity has no credential, session or prior activation evidence, the guarded repair option records a System repair request, removes only that incomplete auth identity and runs ordinary provisioning again. It refuses ready or previously activated identities. The Workforce person is retained.

```sh
npm run auth:provision -- --user-id person-id --repair-incomplete
```

## Fixtures and tests

For the five fictional Ada, Tunde, Amara, David and Kemi accounts, explicitly supply an ignored `LOCAL_AUTH_TEST_PASSWORD`, then run `npm run auth:seed`. The command requires nonproduction and a loopback auth origin (so the local app at `BETTER_AUTH_URL` can sign in against Neon data):

```sh
npm run db:seed
npm run auth:seed
```

Repeating either command preserves ready credentials and sessions (or existing fixture rows). The base `npm run db:seed` remains independent of auth credentials.

Create a **separate** test database (Neon branch or another database name), owned for test use, and set an explicit private `TEST_DATABASE_URL` pointing to it. It must differ from the ordinary development database. The setup command deploys migrations and runs the normal idempotent fixture seed. It never resets a database.

```sh
npm run test:setup
npm test
```

The Node and HTTP tests mutate only that named test database. Test generated people and append only audit evidence are retained there; generated people are deactivated after the suite. Temporary failure triggers are removed in `finally` blocks. An interrupted test should be inspected before rerunning. Browser verification on the real app remains a separate completion gate.

## Sessions, limits and maintenance

Sessions last seven days and renew after a day of authenticated activity. Multiple devices can stay signed in. Sign out revokes only the current session. Deactivation denies the next protected request and revokes that person's sessions. Changes to valid current role or reporting assignments affect the next request.

Five completed invalid password failures for an email within 15 minutes block further attempts until the window expires. The stored failure counter is capped at five so a sustained attack cannot inflate the row. An independent IP counter permits 100 sign in attempts per 15 minutes. Session and sign out requests share 100 requests per IP per 10 seconds. Counters persist in PostgreSQL and expose Retry-After when blocked. By default the direct socket supplies the IP and forwarded headers are ignored. Behind an unconfigured reverse proxy, clients share the proxy's limit. After a hosting-specific decision, set `TRUST_PROXY` (for example `1` or `loopback`) so Express trust proxy and auth throttle keys use the client address from that boundary. Leave it unset or `false` until then.

Run maintenance explicitly to remove expired sessions and throttle windows. It does not remove audit history or active sessions:

```sh
npm run auth:prune
```

Only `/api/auth/sign-in`, `/api/auth/sign-out` and `/api/session` are exposed. Password recovery, registration, email changes, account deletion, OAuth and impersonation are unavailable. Forgot password explains that recovery is not yet available. HR account administration remains a later feature.

Development tools live at `/__ui`, `/__ui?view=workspace` and `/__data-proof`. They do not mint sessions or change the current person's role. The data-proof route only mounts when the configured database host is loopback (it was built as a local-engine guardrail); with Neon it stays off and authenticated product APIs are the path forward. Production excludes these tool bundles and routes them through ordinary authentication navigation.
