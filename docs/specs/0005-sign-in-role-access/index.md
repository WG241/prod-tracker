# 0005. Sign in and role access

**Date**: 2026-10-26
**Status**: In Progress

## Summary

Add real password sign in, revocable sessions, and server enforced role access for Workforce Group. Preserve the existing people and reporting records while linking separate authentication records through the same person id. HR manages accounts; public registration and password recovery are excluded from this slice.

## Requirements

Staff can sign in and reach their own role workspace. Developers can prove that another role, person, or business cannot be selected through a URL, request body, cookie claim, or preview control.

1. **AC-1**: An additive migration introduces the confirmed authentication records without replacing existing Workforce User ids, assignments, fixtures, constraints, or historical records. Authentication identities have an explicit one to one database link to existing staff; matching email alone never creates a link.
2. **AC-2**: The prototype password sign in form authenticates each of five fictional local accounts against persisted credentials. Successful sign in enters the correct role landing route with the real person's shell. Invalid credentials, inactive accounts, unavailable services, validation and throttling have explicit states without exposing passwords or other people's account details.
3. **AC-3**: Sessions live in PostgreSQL, last seven days, and extend on authenticated activity after the daily refresh interval. Multiple device sessions are allowed. Sign out revokes the current session and expires its browser cookie; replaying that cookie cannot authenticate. Cookie caching and client supplied role claims cannot bypass revocation.
4. **AC-4**: Every protected request reads current account status and the effective current EmploymentAssignment from the database. Deactivation denies existing sessions on their next request. A role or reporting assignment change changes the next request's permissions and landing path without waiting for session expiry. Missing or inconsistent identity/assignment state fails closed.
5. **AC-5**: Separate role route prefixes and a shared Profile route are protected. Anonymous browser navigation reaches sign in; wrong role navigation reaches that person's own landing page with an access notice. Protected API requests return 401 or 403 as appropriate. The only new authenticated data surface is the caller's session context, with no arbitrary user, role, or business selector.
6. **AC-6**: Reusable server policies enforce own person, current team, historical team, business, aggregate Executive, HR, and narrow relief review scope using the accepted data model. Live database tests prove both allowed and denied cases. No general task or staff data API is added merely for demonstration.
7. **AC-7**: A trusted operator command provisions credentials for an existing eligible staff record using a hidden password prompt and audit evidence. A separate explicit local fixture command provides the five fictional accounts. Public registration, credential provisioning, password reset, email change, account deletion, OAuth, and impersonation endpoints are not exposed. Forgot password stays visibly disabled until a complete recovery path exists.
8. **AC-8**: Passwords accept 15 through 128 Unicode code points, including spaces, without composition requirements or silent trimming. Password verification and hashing use the maintained library implementation. Five completed incorrect password failures for an email within 15 minutes temporarily block further attempts; an independent persistent IP limit applies. Cross origin mutations are rejected and cookies have the required security attributes.
9. **AC-9**: Preserve the exact final prototype role navigation and sign in design. Development previews cannot establish a session or alter the real person's role. Unbuilt role destinations remain clearly labeled placeholders. Existing health behavior and the deliberately isolated Feature 5 local proof boundary remain unchanged.
10. **AC-10**: GA completion requires focused Node tests, live database and HTTP checks, `/check verify` on development and production, `/check review` using a model that did not implement the change, and `/document`. Record migration preservation, five role journeys, expiry/refresh, revocation, denied access, throttling, configuration failure, and browser evidence. Do not call the feature done before those gates pass.

## Decision

Use Better Auth 1.7.13 with its Prisma adapter in the existing Node service. That version is identified by the checked official documentation. Install and lock the runtime package only during implementation; do not silently substitute a different release if its API or schema differs. The [official Prisma integration](https://better-auth.com/docs/adapters/prisma) supports the current database stack, and [server API calls](https://better-auth.com/docs/concepts/api) allow a small application owned HTTP surface.

Keep separate AuthUser, AuthAccount, AuthSession, and AuthVerification models, plus an application owned LoginThrottle model. AuthUser.id is both its primary key and a foreign key to Workforce User.id. The existing people remain authoritative for display, account state, organisation and roles. Use a private provisioning configuration of the same library only inside the operator process; the HTTP application never enables registration.

**Implementation skills**:

1. `better-auth-best-practices` (`better-auth/skills`, `.agents/skills/best-practices/SKILL.md`).
2. `better-auth-security-best-practices` (`better-auth/skills`, `.agents/skills/security/SKILL.md`).
3. `email-and-password-best-practices` (`better-auth/skills`, `.agents/skills/emailAndPassword/SKILL.md`).

These user approved skills are installed. Their setup examples do not override the agreed exclusions: do not enable registration, verification mail, recovery mail, or a second database provider. Use the selected version's API and generate any library schema example into a disposable file before merging it into the existing Prisma schema. Never overwrite that schema with a generator output.

## Feature design

### Preconditions and boundaries

Features 1 through 3 are implemented. Feature 4's approved shell and Feature 5's approved proof are still unbuilt. Feature 6 UI integration and verification require Feature 4's shell and controls to exist first; do not silently implement Feature 4 inside this run or claim that its design alone satisfies the dependency. Feature 5 is not an authentication prerequisite.

Keep the accepted native local PostgreSQL and PrismaPg architecture. No public registration, invitation delivery, password recovery, password change UI, MFA, SSO, or account administration page is introduced. Those exclusions are a scope decision, not a claim of certification or completion of those capabilities. The HR account administration feature must later consume the trusted provisioning boundary rather than create credentials through a public signup route.

### Data model

All ids are required strings. Existing Workforce ids remain unchanged. New event instants use `Timestamptz(3)`; nullable fields are marked `?`. Library credential/session values stay on the server.

| Model | Fields | Constraints and sources |
|---|---|---|
| Existing User | Existing fields only, with inverse optional auth identity relation | No new password or role column; authoritative email, nullable name, accountStatus and assignments |
| AuthUser | `id`, `name`, `email`, `emailVerified` default false, `image?`, `createdAt`, `updatedAt`, application owned `provisionedAt?` | `id` is PK and restrictive FK to User.id; unique canonical lowercase email; required nonempty name at provisioning; provisionedAt initially null |
| AuthAccount | `id`, `userId`, `accountId`, `providerId`, `password?`, `accessToken?`, `refreshToken?`, `accessTokenExpiresAt?`, `refreshTokenExpiresAt?`, `scope?`, `idToken?`, `createdAt`, `updatedAt` | Restrictive AuthUser FK; unique `(providerId, accountId)`; index userId; the only enabled provider is credential, accountId equals AuthUser.id; credential password contains only the library hash |
| AuthSession | `id`, `userId`, `token`, `expiresAt`, `ipAddress?`, `userAgent?`, `createdAt`, `updatedAt` | AuthUser FK, unique token, index userId and expiresAt; deleting a session revokes it; raw token is never an application JSON field |
| AuthVerification | `id`, `identifier`, `value`, `expiresAt`, `createdAt`, `updatedAt` | Library support schema, identifier index; no verification or reset flow populates it in this slice |
| LoginThrottle | `key`, `count`, `windowStartedAt`, `expiresAt`, `updatedAt` | key PK, count nonnegative, expiry after window start, expiry index; opaque email/IP keyed rows, no plaintext email or password |
| Existing AuditEvent | Existing actor, action, target and JSON evidence fields | Retain append only guard; no token, hash, password, cookie or credential request body is stored |

Use the adapter model names corresponding to Prisma client references (`authUser`, `authAccount`, `authSession`, `authVerification`), not physical SQL table names. The library supports [custom model names and id generation](https://better-auth.com/docs/concepts/database). In the private provisioning instance, its user id generator returns the explicitly validated Workforce user id. Account, session and verification ids use independent random identifiers. In the HTTP instance, user creation is disabled and a creation hook rejects any attempt.

`provisionedAt` is an optional database column owned by the application, not a writable library user input. The library need not return it to clients. An AuthUser without this timestamp cannot receive a usable application session. Do not store an independent application role on AuthUser or AuthSession.

Add these five models through a normal reviewed Prisma migration. Preserve all old constraints and append only evidence. Update the existing `db:verify` table inventory from 18 to 23 while retaining its original assertions and seed preservation probes. Do not reset a database, reinterpret existing dates, or overwrite an existing person's credentials when reseeding.

### Provisioning and local accounts

Add an explicit operator command, for example `npm run auth:provision -- --user-id <existing id>`. It starts no HTTP listener. Require an existing Active person with a nonempty name, a current effective assignment, and valid canonical email. Read and confirm the password from a hidden TTY prompt; never accept a real staff password as a command argument, print it, or save it in a profile field. Remote execution requires an explicit command flag acknowledging the configured remote database, preserving TLS validation.

The private library configuration allows only this command's server side `signUpEmail` call, disables automatic sign in and all mail, and forces the new auth user id/name/email from the validated staff record. It is not imported or enabled by an HTTP route. Use the library's normal credential creation and configured hasher; do not implement password cryptography or a second credential format.

Provisioning transitions are absent, pending (`provisionedAt` null), then ready. After the library creates a pending identity and credential, a bounded application transaction rechecks eligibility and a nonempty credential hash with matching userId/provider/accountId, sets provisionedAt from the database clock, and appends `auth.credential.provisioned` audit evidence. Those two writes commit together. A crash before activation leaves a pending, unusable identity. An explicit resume option accepts the staff id, requires the original password to pass the library's configured verifier against the pending credential, then completes the activation transaction. An existing ready identity is reported as already provisioned without changing its password, timestamps, or sessions. Never adopt a different AuthUser by email.

Verify the selected SDK/adapter's identity and credential pair creation transaction behavior during implementation. Do not assume a process interruption cannot leave an identity without a credential. If a pending AuthUser has no AuthAccount, no AuthSession, and no prior credential activation audit evidence, an explicit repair option may lock and recheck those conditions, append a System repair requested event and remove only that incomplete AuthUser in one transaction. Then run ordinary private provisioning again with a newly entered password and the same Workforce id. Do not delete or recreate the Workforce User. If any condition is not met, refuse repair; a pending identity with a credential uses password verified resume instead, and a ready or previously activated identity is never repaired this way. A crash after removal is safe to retry as ordinary provisioning. The repair event records intent, not successful activation.

Provisioning audit uses the existing System actor (`actorId: null`), action, `targetType: AuthUser`, the Workforce/auth id as targetId, and source `trusted-operator-command`. This records a trusted process action; it does not fabricate the identity of a signed in HR user. HR UI operations added later must use the actual HR actor. Reject connection query parameters named host, hostaddr or service (case insensitive) before classifying a target as local or remote, so a query override cannot evade either command's target check.

Add a separate `npm run auth:seed` for Ada Okafor, Tunde Bakare, Amara Bello, David Cole and Kemi Adebayo, using their existing `person-*` fixture ids. It requires an explicitly supplied ignored `LOCAL_AUTH_TEST_PASSWORD` that satisfies the policy. It runs only with a loopback database, a loopback auth origin and a nonproduction environment. Reject connection query host overrides, not just a nonlocal URL authority. No password is checked into Git or prefilled in the product login form. Repeated runs preserve ready credentials and active sessions. The base `db:seed` still works without auth configuration or an auth test password.

### Session lifecycle and cookie boundary

Use PostgreSQL sessions with `expiresIn: 604800`, `updateAge: 86400`, refresh enabled and cookieCache disabled. No secondary storage, JWT role cache or browser token storage is added. Protected request activity can renew the session once it is at least a day since the previous renewal; a renewed expiry is seven days after that renewal. Passive mouse movement is not activity for this rule. This is the selected seven day convenience policy, with the library's [documented session lifecycle](https://better-auth.com/docs/concepts/session-management).

Every session lookup forwards all library renewal Set-Cookie headers to the browser. A wrapper that refreshes the database row but drops the cookie headers does not satisfy AC-3. The library's [server API header contract](https://better-auth.com/docs/concepts/api) provides `returnHeaders` and `Headers.getSetCookie()` for this purpose. Do not serialize the SDK's raw session object or sign in token into application JSON.

Use HttpOnly, SameSite=Lax, path `/`, host only cookies with a Workforce specific cookie prefix. Secure is required on HTTPS and for any remotely accessible production origin. Explicit loopback HTTP is supported for local development and compiled production verification only; reject HTTP origins on a nonloopback hostname. Do not share cookies across subdomains, trust arbitrary forwarded origins, disable CSRF checks, or derive the public auth origin from an incoming Host header.

A successful sign in creates a fresh provider session; it does not reuse a caller chosen token. Multiple sessions may coexist. Sign out uses the library's current session revocation and cookie expiry. Repeated sign out after the cookie is gone is a successful no op. Expired or revoked sessions never receive a renewed session merely because a cookie was supplied.

### HTTP surface and application wrappers

Expose only these application owned routes. Call the library server API with validated values, headers and returned header forwarding. Do not mount an unrestricted Better Auth handler; this prevents unused library capabilities becoming public by accident.

| Route | Method | Input | Success | Failures |
|---|---|---|---|---|
| `/api/auth/sign-in` | POST | JSON `{ email, password }` | 200 safe session context, provider cookies | 400 invalid input, 401 invalid credentials, 403 unavailable account, 429 limited, 503 unavailable |
| `/api/auth/sign-out` | POST | Empty JSON object, current cookie | 204, revoke current session and expire cookie | 403 origin, 429 limited, 503 unable to complete |
| `/api/session` | GET | Current cookie, no selection parameters | 200 safe current context, any renewal cookies | 401 absent/expired/revoked or unusable staff context, 403 request origin, 429 limited, 503 unavailable |

The context is `{ user: { id, name, email }, role, businessId, unitId, landingPath, navigation, session: { expiresAt } }`. User data comes from Workforce User, with `Staff member` as the null/empty name fallback. Role is the existing Role enum. Nullable businessId/unitId come from the current assignment. Navigation entries and landingPath come only from the fixed table below. No session token, credential field, arbitrary role list or other person's identity is returned.

Reject unknown query/body properties, repeated query parameters, unsupported methods, malformed JSON, arrays and incorrect field types. Use an 8 KiB JSON body limit. Email is trimmed and lowercased, capped at 254 characters, then validated by the library. Password is not trimmed, case folded or truncated. Reject malformed Unicode and NUL. Count Unicode code points in application validation. Configure the library's own length bounds compatibly (minimum 15, maximum 256 UTF-16 code units), retaining the stricter application maximum of 128 code points so valid supplementary characters are not rejected inconsistently.

All authentication responses use no-store. Errors use `{ error: { code, message } }` with fixed English copy. `INVALID_INPUT` is 400, `INVALID_CREDENTIALS` 401, `ACCOUNT_UNAVAILABLE` 403 after a correct password, `SESSION_REQUIRED` 401 for session failure, `FORBIDDEN` 403 for a role/origin denial, `RATE_LIMITED` 429 with Retry-After seconds, and `SERVICE_UNAVAILABLE` 503. Map body size/media type errors to 413/415. Unknown APIs retain the existing JSON 404 contract. Do not forward arbitrary provider error objects or stack traces.

For unknown email and incorrect password, use the same invalid credential message and the library's normal verification/dummy work. Inactive, unprovisioned, or unassigned account detail is revealed only after correct password verification, through the session creation hook. Generic invalid input may identify the malformed field, without revealing whether a matching person exists.

Mutations require exact Origin matching the configured auth origin, JSON content type, and same-origin Fetch Metadata when present. Reject absent or null Origin for these browser mutation routes. Do not enable permissive CORS. GET session permits an absent Origin for same origin/navigation use but rejects conflicting Origin or explicit cross-site Fetch Metadata. Keep the library's origin/CSRF checks enabled as well; wrappers must enforce their boundary even when server SDK calls do not run an HTTP handler's middleware.

### Persistent throttling and audit

Use application owned PostgreSQL counters on the public wrappers, rather than assuming library HTTP handler limits run for direct server API calls. The email key is `email:` plus HMAC-SHA256 of normalized email using the auth secret; IP keys use the same keyed approach with `ip:`. IP comes from the direct socket by default. Ignore forwarded client IP headers unless a future deployment spec configures a specific trusted proxy boundary.

An email window starts with its first completed invalid credential failure and expires 900 seconds later. Atomically increment failures; five recorded failures deny subsequent attempts until expiry. A successful sign in clears the email failure window. Already in flight requests may finish, but updates must not lose failures. This is a temporary throttle, not an account deactivation. Database/service failures do not count as incorrect passwords.

Separately allow at most 100 sign in attempts per direct IP in a 900 second window, reserving/counting the attempt atomically before verification. A blocked request returns 429 and Retry-After, with the same behavior for existing and unknown emails. Reject invalid or oversized input before expensive hashing; still apply the IP boundary to accepted sign in attempts. Enabled development and test environments exercise the same limits. Counter read/write failure returns 503 and does not fall back to unlimited attempts or memory counters. Expired windows are replaced on next use. Add a documented manual prune command for expired sessions and stale throttle rows; do not introduce an unattended scheduler in this feature.

Also limit the exposed session and sign out wrappers together to 100 requests per direct IP per 10 seconds, using an `auth-ip:` HMAC key namespace in the same table. Count these before session lookup, including unauthenticated probes. This does not change the existing health endpoint's contract. Internal SDK calls do not count twice.

Use the existing append only AuditEvent for credential activation and authentication lifecycle evidence. Before a sign out or a forced revocation, persist a requested event identifying the session row id, then record a completed event after success. Never claim completion in a requested event. If the initial audit write fails, do not perform the mutation and return 503. If the provider mutation succeeds but its final outcome audit fails, retain the requested evidence, log a sanitized category and report the provider's actual result; do not restore a revoked session or fabricate an outcome entry.

For sign in, append `auth.signin.completed` before forwarding the newly issued cookies. If that audit write fails, do not forward those cookies, revoke the newly created session when possible, and return 503. A residual never issued session during database outage must not be described as a completed client sign in. Provisioning activation and its audit record have the stronger atomic transaction described above. Do not log attempted passwords, hashes, raw tokens, cookies, full login bodies or plaintext throttle keys.

### Current identity and role routes

Resolve each protected request from the provider session's auth user id, AuthUser.provisionedAt, matching Workforce User id and Active status, then the one assignment with effectiveTo null and effectiveFrom no later than the server request instant. Treat absent, duplicate, invalid or unsupported assignment context as unavailable. The assignment supplies role, business and unit. Do not accept these values from the caller, a preview selection or cached auth claims.

User.email must still equal AuthUser.email after canonicalization; a mismatch fails closed until an intentional HR email update synchronizes both records. Display name comes from User and can change independently. Account linking is disabled, and no public update-user/email endpoint can alter this mapping. Future HR email changes must preserve the explicit id link and synchronize emails in their write transaction.

An existing provider session whose staff context is inactive, pending, missing, unassigned or inconsistent is unusable. Revoke that session, expire its cookie, clear client context and return `401 SESSION_REQUIRED`; for an inactive person revoke their other sessions as well. The browser moves to sign in, not a guessed role landing, avoiding a denial redirect loop. These mutations follow the audit boundary above. If a required database/audit lookup or cleanup fails, return 503 with no protected content and no claim that cleanup completed. A changed but valid role retains authentication and receives its new route permissions. A database failure alone must not be treated as proof of inactivity or use stale role data. The sign in route's `403 ACCOUNT_UNAVAILABLE` remains specific to a correct password followed by failed staff eligibility.

| Role | Prefix and landing | Navigation suffixes in prototype order |
|---|---|---|
| Employee | `/employee`, `/employee/home` | home, history, leave |
| Line Manager | `/line-manager`, `/line-manager/dashboard` | dashboard, my-tasks, team-history, approvals, leave |
| Business Director | `/business-director`, `/business-director/dashboard` | dashboard, units, performance-records, reports |
| Executive | `/executive`, `/executive/dashboard` | dashboard, businesses, reports |
| HR / Admin | `/hr`, `/hr/dashboard` | dashboard, organisation, employees, leave-relief, performance-records, reports, settings |

Shared `/profile` uses the person's own shell and account menu. Preserve the final labels, including `Leave & Relief`; suffixes are URL identifiers rather than new product copy. There is no Profile sidebar item, Executive individual performance record route, or new HR Tracker controls/Audit log sidebar item. Future features must settle any missing prototype entry before adding it.

`/` resolves to sign in when anonymous and the role landing when signed in. `/sign-in` redirects an already valid session to its landing. Ignore arbitrary callback/return URLs; successful sign in always uses the server derived landing. Anonymous protected browser navigation redirects to `/sign-in`. A wrong role route redirects to the real person's landing with the existing prototype toast pattern (`You do not have access to that page.`), not a new denial page. An unknown suffix for that person's own prefix falls back to their landing with `That page is not available.`; it never adds a new placeholder route. Unrecognized browser navigation paths outside the defined routes resolve through `/`; unknown API and asset paths keep the existing 404 behavior. API authorization failures remain JSON, never sign in HTML.

Use ordinary same origin links for role destinations and a server guard before serving the SPA document for protected GET/HEAD navigation. No new client routing package is selected. The browser matches the same fixed route table to render the correct shell/placeholder. For notices, the server may append only fixed codes (`access-denied`, `page-unavailable`, `session-required`) to its own chosen redirect. The browser maps these codes to fixed copy and removes the flag; it never displays arbitrary query text or follows a query supplied destination.

Before the generic navigation fallback, explicitly preserve `/__ui` and `/__data-proof` only when their respective development features are installed and development mode enables them. They are tool exceptions, not real role workspaces. `/__data-proof` data requests still require Feature 5's separate local host/database guards. In production neither exception exists and neither tool is bundled; navigation follows `/` to sign in or the real role landing. Do not redirect an enabled development tool to the workspace merely because the generic route fallback runs first.

Do not render a role shell or cached private context while session resolution is pending or failed. The browser guard is for presentation; server guards and policies supply the actual security boundary. On 401 clear client context, navigate to sign in and use an existing banner/toast pattern to explain that sign in is needed. On 503 show a retry state and withhold protected content without deleting a potentially valid cookie. On a session read 429 withhold protected content and offer retry after the supplied delay; a sign out 429 does not claim sign out or clear the valid session. Return from background tab focus rechecks session context before showing cached protected content.

### Data scope policies and tests

The only new authenticated public data endpoint is `/api/session`. The following policies are implemented as typed server modules and exercised through real PostgreSQL queries in tests; they are not proof endpoints that expose the full dataset.

| Capability | Allowed source and scope |
|---|---|
| Own account/profile | Authenticated Workforce user id only, for every role |
| Employee work/history | Owner user id equals caller; exclude hidden tasks where applicable |
| Manager own work | Caller owner id, separate from their team capability |
| Manager current team | Current effective Employee assignments whose managerId is caller; eligibility and active state follow the named data model |
| Manager historical team | Frozen tracker contextSnapshot managerId equals caller; use recorded context instead of overwriting history with current assignments |
| Director records | Current business from caller assignment; current records use current assignments and frozen records use the recorded businessId |
| Executive | Organisation and business aggregates only; refuse individual employee/task/profile reads other than own account |
| HR / Admin | Workforce Group organisation, staff and historical records, under the single organisation boundary |
| Relief review | Only the pending request assigned to the covered manager, with effective leave and relief interval at the server instant; do not grant broad team/history access |

Use the source and interval conventions in spec 0002 and `server/data-model/calendar.ts`. Do not infer ownership from a URL, email, shared unit alone, or a task id prefix. Missing/malformed frozen context fails closed. Current role comes from the current assignment even when authorizing historical records. Relief never changes the person's primary role.

Place context/session code under `server/auth/`, policies in a small module there, browser sign in/context code under `src/features/auth/`, and operational commands under `scripts/`. Future handlers receive the server derived access context and must use the relevant policy when querying data. Unknown resources return the agreed denial/not found shape without first returning an unconstrained record.

### UI contract and development tools

Use the exact final prototype sign in screen, password visibility control, labels, art and form composition. Follow its later overrides, existing tokens, Inter weights and 28px type cap. No checked in demo password, simulated authentication, one click role sign in, or signup form is permitted. Keep Forgot password visible but disabled with an accessible explanation that recovery is not yet available, as approved by the user.

After sign in use the built Feature 4 shell, populated by the real context. Enable its existing account menu Sign out action and route Profile & account to the shared placeholder until Feature 13 exists. Full role pages remain their scheduled features. Use the existing prototype error banner, toast and loading patterns; do not design a new access denied screen.

Before UI implementation obtain an approved visual view of the exact sign in screen and shell states. The prior file URL attempt was blocked; source inspection alone is not visual verification, and the browser policy must not be worked around. If a required state has no prototype pattern, ask before creating it.

Real authenticated workspaces never expose an acting role selector. Feature 4's static role and component previews remain separate development tools, with no ability to mint sessions or access another person's data. Feature 5's fixed local proof retains only its explicit local development exception and is never enabled in production by signing in. Keep preview entry links within development tools rather than adding role sidebar items. Auth tests exercise real session routes, not preview state.

### Configuration and operations

Add server only `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL`. Require a nonplaceholder secret generated from at least 32 random bytes, represented as a string of at least 32 characters. Require a fixed origin URL without credentials, path, query or fragment; HTTPS is required except explicit loopback HTTP. Trusted origins contain only that origin. Keep secrets and database clients out of browser imports and VITE variables. The library's [options reference](https://better-auth.com/docs/reference/options) and installed security skill govern these controls.

Read auth configuration only for HTTP authentication startup and auth commands. Base database migrate/seed/verify commands keep working with the existing database configuration alone. Missing or invalid auth configuration fails app startup with the variable name and no value. Preserve public `/api/health` semantics, existing sanitized errors, database timeouts and shutdown behavior.

Production must not silently trust all proxies. Direct socket IP is the initial rate limit source; behind an unconfigured proxy the limit is shared by that proxy's IP. A hosting specific trusted proxy decision is required before enabling forwarded client IP. Document this operational limit and the local HTTP verification exception.

### Value sourcing

| Produced value | Source |
|---|---|
| Staff/auth identity link | Explicit existing User.id supplied to the trusted command, enforced by AuthUser primary/foreign key |
| Login lookup email | Validated normalized request email and the linked AuthUser credential account |
| Password verification | Exact supplied password and persisted library hash, through the configured library verifier |
| Provisioned status | Application owned AuthUser.provisionedAt, written atomically with activation audit |
| Session id/token/expiry/refresh | Library randomness, PostgreSQL session row, server time, explicit seven day/daily settings |
| Current active person and role | Provider user id, User.accountStatus, effective current EmploymentAssignment |
| Name/email/organisation in context | Workforce User and current assignment; explicit name fallback above |
| Landing and navigation | Fixed role route table above, never callbackURL or client role input |
| Current/history/relief scope | Current assignments, frozen snapshots, pending routing and dated leave/relief from spec 0002 |
| Throttle key/window/count | Auth secret HMAC, normalized email or direct socket IP, database clock and atomic counter state |
| Retry delay | Ceiling of stored window expiry minus database current time, minimum one second |
| Cookies and renewal headers | Library server response headers, security attributes from fixed auth origin |
| Audit actor/action/target | Resolved Workforce actor or System command, named lifecycle event and internal row id |
| Five fictional credentials | Existing named staff fixtures and explicitly provided ignored local test password |
| UI messages and view states | Prototype patterns and fixed copy in this spec, with server error categories |

### Critical verification scenarios

1. Preserve all existing ids and data, apply the additive migration, seed twice, provision five local identities twice, and confirm hashes/ready timestamps/sessions are not reset (AC-1, AC-7).
2. Sign in all five roles, inspect routes and actual browser cookies, reload, open a second session, sign out one, and prove the other remains valid and the revoked cookie fails (AC-2, AC-3, AC-5).
3. Set expiry/refresh timestamps on test sessions, then prove expired denial and daily renewal with forwarded cookies. Deactivate an account and change a role/manager in committed test data; prove the very next protected request uses the new state (AC-3, AC-4).
4. Attempt other role URLs, caller supplied role/owner/business fields, altered cookies, missing links, pending provisioning, inactive accounts, direct library signup/provisioning/reset paths and cross origin writes (AC-4, AC-5, AC-7, AC-8).
5. Query seeded own, foreign employee, manager team, historical reassignment, other business, Executive individual denial, HR and dated relief scenarios through the policies; ensure no unscoped fallback and no new public domain API (AC-6).
6. Check wrong and unknown emails, valid/invalid Unicode password lengths, spaces, concurrent counter updates, fifth email failure, IP limit, Retry-After, restart persistence and database failure while limiting (AC-2, AC-8).
7. Fail provisioning before activation and resume; inject an identity without a credential and exercise the explicit guarded repair, refusing it for a ready/previously activated or session bearing identity. Fail an audit write, interrupt sign in/out responses, stop/restart PostgreSQL, and verify fail closed behavior, truthful UI, no leaked credentials or stale role fallback (AC-2 through AC-4, AC-7).
8. Compare exact prototype states, use keyboard/password visibility/autocomplete/error announcements, verify disabled recovery and isolated previews, build and run production, then complete fresh review and documentation (AC-9, AC-10).

Use Node's built in test runner through the existing tsx tooling, as selected. Add an appropriate npm test command during `/test`, with unit and HTTP tests plus a dedicated local test database for mutating integration checks. Require an explicit test database URL, validate its locality and identity against the normal development database, and never reset or clean the developer's ordinary database. Test cleanup may touch only identified test data. Preserve audit rows under their append only rules. Real browser verification is a separate required check, not implied by HTTP assertions.

## Build plan

1. Confirm Feature 4 UI dependency and exact prototype references; build the sign in/context presentation to that contract without completing role features (AC-2, AC-5, AC-9).
2. Add the selected library and additive auth schema, preserve old data checks, and implement private provisioning plus explicit local fixture commands (AC-1, AC-7).
3. Implement the narrow HTTP wrappers, session/header handling, secure configuration, persistent throttling and audit behavior (AC-2, AC-3, AC-7, AC-8).
4. Wire fresh database context, role routes, shared Profile, policy modules and the real shell; isolate development previews and deny stale or outside scope access (AC-4 through AC-6, AC-9).
5. Run `/test`, `/check verify`, fresh `/check review`, and `/document`. Include production browser and live database evidence before marking done (AC-1 through AC-10).

## Consequences

The application gains maintained password/session machinery while retaining Workforce people and reporting history. Shared primary keys make the identity link explicit. Database checks make role and deactivation changes take effect without a cached token lifetime delay.

Separate auth records duplicate an email and initial display name, requiring deliberate coordination for later HR email edits. Every protected request performs database work. Seven day rolling sessions favor the user's convenience choice; cookie theft remains effective until expiry or revocation. The operator command is a temporary trusted administration surface, not a complete HR account UI or recovery service.

Fixed IP limits can affect a shared office or proxy. No MFA, SSO, email verification or self service recovery is claimed. GA here names the project's required verification workflow, not an independent security certification.

## Follow-up

Feature 4 must be built before Feature 6 UI completion. Feature 31 should integrate real HR provisioning and coordinate account/email/deactivation changes with auth records and sessions. A complete password recovery flow and its email provider remain deferred, as chosen, rather than simulated through the disabled control.

Capture the installed auth skill pointers and area conventions in `server/auth/AGENTS.md` when that new area is introduced, with a root context pointer. Better Auth's optional documentation MCP is deferred; it supplies documentation help, not application/database access. Existing Express and Prisma tool discovery stays deferred. A hosting specific trusted proxy configuration remains a deployment decision.

## Rationale

See `rationale.md` for alternatives, confirmed tradeoffs and checked sources.
