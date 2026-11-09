# 0013. Shared profile

**Date**: 2026-11-03
**Status**: Accepted

## Summary

Every signed in role can view its own current account details, save its workflow email preference and change its password. Identity and reporting fields remain read only. Password changes end all sessions and create a security notification. This is an architecture decision only; development is not authorized by accepting this spec.

## Structure

* `0013-account-writes.md` defines authority, receipts, password changes and the concurrent sign-in boundary.
* `rationale.md` records the choices and integration findings.
* Shared notification consumption is spec 0014; email dispatch is spec 0015.

## Requirements

As a signed in Workforce person, I want to verify my current details and control my account without changing my employment record.

1. **AC-1**: `/profile` uses the inspected prototype for all five roles: identity card, Notifications & security, Change password dialog and End this session. Reach it through the existing account menu, with no new sidebar item.
2. **AC-2**: Display the authenticated person's current name, canonical email, role, business, unit or department label, manager and Active status from persisted records. Identity fields cannot be edited. Retain Contact HR copy. No user/role selector or credential metadata appears.
3. **AC-3**: The email toggle saves immediately and persists independently of identity/history timestamps. It controls all workflow email classes. In app notifications remain on; password-change security notices bypass this preference once email delivery is enabled.
4. **AC-4**: Preference writes require an expected revision. Reject stale saves without overwriting newer work. The same owned UUID and normalized preference request replays its committed result, including a no change result.
5. **AC-5**: Password change requires the current password, a different new password and matching confirmation. Use the existing approved 6 through 128 Unicode character policy, including an ASCII uppercase letter and number, valid Unicode and no NUL. Preserve the configured Better Auth hashing and verification implementation.
6. **AC-6**: One transaction changes the credential, revokes every existing session, creates one owner security notification, one audit and one receipt. Any persistence failure rolls back the entire action. Sign-in cannot issue a session based on a credential that changed during that sign-in.
7. **AC-7**: Successful password change clears private client state and returns to sign-in. Never retry an unknown password outcome automatically. Clear password fields and direct the user to sign in again, trying the new password first. No password or password-derived value enters receipts, logs, analytics, browser storage or URLs.
8. **AC-8**: Reads and writes require fresh persisted account, session and employment authority for the authenticated owner, for every role. Exact Origin/Fetch Metadata, strict bodies, limits, no store responses and sanitized errors apply. Neither profile preference nor notification operations bypass employment or History protections.
9. **AC-9**: Reuse approved loading/error, form error, Retry, explicit Reload latest and toast patterns. Retain nonsecret preference intent through same actor revalidation; erase password inputs on close, navigation, background revalidation and sign-out. Stale callbacks cannot affect another actor. Busy controls retain logical focus and block activation.
10. **AC-10**: Migration/seed repeats preserve credentials, historical snapshots, prior timestamps and evidence. Meaningful separate database tests and real development/production verification cover every role, conflicts, rollback, password/sign-in races and recovery. Actual NVDA/native zoom evidence remains distinct from automation.

## Decision

Reuse the current React/Express/PrismaPg/Better Auth stack. Add a separate `NotificationPreference` record and an append only `SharedMutationReceipt`. Use a narrow application command with the configured Better Auth password helpers so credential, session and business evidence share a PostgreSQL transaction. Do not expose the provider's unrestricted handler.

**Implementation skills**: existing `develop`, `test`, `check` and `sync` workflow skills; `better-auth-security-best-practices` at `.agents/skills/security/` and `email-and-password-best-practices` at `.agents/skills/emailAndPassword/`, from `better-auth/skills`.

## Rationale

Reasoning and approved choices are in `rationale.md`.

## Feature design

### Prototype and current identity

The source is `docs/workforce-prototype-updated.html`, Employee and Line Manager Profile and Change password states inspected live on 3 November 2026. The same composition is shared across roles. The new build must additionally inspect each remaining role before UI implementation and verify all five.

Read the Workforce User, its linked ready AuthUser and its one current open EmploymentAssignment in a Repeatable Read transaction. Recheck the persisted session and authority in that transaction. Use the database clock for `asOf`, assignment effectiveness and expiry. A changed role/context withholds stale content and resolves the session again.

| Display value | Source |
| --- | --- |
| Full name/avatar | Trimmed User.name, or existing Staff member fallback; shared initials helper |
| Email | Canonical Workforce User.email, consistent with AuthUser.email |
| Role | Current assignment.role, mapped through the existing role label table |
| Business | Linked Business.name; Workforce Group for group scope roles |
| Unit | Linked Unit.name; otherwise assignment.departmentLabel; otherwise the existing em dash placeholder |
| Line manager | Linked current assignment manager name for Employee; placeholder when not applicable |
| Status | Fresh accountStatus ACTIVE, required for access |
| Email toggle | NotificationPreference.emailRemindersEnabled, with revision |
| Password capability | A valid linked credential account is present; otherwise disable with Contact HR explanation |

Keep the existing identity labels. Correct demo-only session copy and the outdated eight-character password hint to describe the approved real policy. Sign out uses the existing verified sign-out operation.

### Data model and migration

| Record | Fields | Relationships and constraints |
| --- | --- | --- |
| NotificationPreference | `userId` string PK, `emailRemindersEnabled` boolean default true, `revision` integer default 0, `createdAt`, `updatedAt` Timestamptz(3) | Restrictive FK User.id, User 1:0..1 preference. Nonnegative revision; increment on an actual preference change, never wrap. |
| SharedMutationReceipt | `userId` string, `requestId` UUID, `operation` string, `requestHash?` char(64), `result` JSON, `createdAt` Timestamptz(3) | PK userId/requestId, restrictive User FK. Append only. Hash required for EMAIL_PREFERENCE and forbidden for PASSWORD_CHANGE. Fixed version 1 result shape. |
| Existing AuthAccount | Credential password and existing updatedAt only | Exact credential account/user binding; no new password column. |
| Existing AuthSession | Existing rows | Remove all owner sessions on password change; never mint a replacement. |
| Existing Notification/AuditEvent | Existing fields | Security notification and dated audit created atomically. No new preference/security history list. |

One additive, atomic, idempotent migration creates preferences and receipts. Initialize missing preferences from User.emailRemindersEnabled using insert-if-absent, preserving rows on repeats. The legacy User flag remains for schema compatibility and initial fallback only, and is no longer a preference write destination. Until a missing preference is created by a write, GET returns its legacy value with revision zero without writing. Future trusted user provisioning must initialize the child record; the same fallback remains safe for older writers.

Do not update User.updatedAt while saving a preference. History uses it as evidence about identity/account facts; moving preferences avoids changing that meaning. Never disable or rewrite source/snapshot/audit guards. Spec 0014 later extends receipts with read operations and an optional owned notification reference.

### APIs

All outputs are private and `Cache-Control: no-store`. No endpoint accepts an owner or role selector, query string, unknown field or If-Match header.

| Endpoint | Method and input | Success output | Key failures |
| --- | --- | --- | --- |
| `/api/account/profile` | GET, no body | `{ asOf, timezone: 'Africa/Lagos', person: { name,email,role,roleLabel,business,unit,manager,status }, preference: { emailRemindersEnabled,revision }, canChangePassword }` | 401 session, 403 context/account, 503 dependency |
| `/api/account/email-preference` | POST `{ emailRemindersEnabled: boolean, expectedRevision: integer }`, UUID Idempotency-Key | Version 1 receipt result with operation EMAIL_PREFERENCE, requestId, appliedAt, changed, preference value/revision and replayed | 400 input, 409 stale/key conflict, 429, 503 |
| `/api/account/password` | POST `{ currentPassword,newPassword,confirmPassword }`, UUID Idempotency-Key | `{ version:1, operation:'PASSWORD_CHANGE', requestId, appliedAt, changed:true, reauthRequired:true }` plus expiry cookies where available | 400 field/current-password error, 409 consumed key, 401/403 authority, 429, 503 unknown outcome |

Use strict JSON, an 8 KiB ceiling, existing secure cookie forwarding and fixed error codes. Preference limits: independent persistent 60/user/minute and 300/socket-IP/minute namespaces. Password limits: 5/user/15 minutes and 20/socket-IP/minute before hashing. Return Retry-After. Malformed bodies/methods/selectors are 400, oversized bodies 413, wrong media type 415. Password mismatch, invalid current password and reuse of the current credential are distinct safe field errors, never echoed input.

### State, recovery and security

Preference state: loaded → saving → committed or rejected/uncertain. An uncertain nonsecret request keeps its original value/revision/UUID and blocks replacement intent until replay resolves it. Stale rejection retains the intent; Reload latest explicitly discards it. Keep the toggle focusable with aria-disabled and an activation guard while busy. A read failure cannot be rendered as a saved/default preference.

Password state: open → submitting → reauthentication required, definite field failure, or unknown outcome. Keep secrets only in the mounted dialog/request lifetime. Never place them in a global operation store. A global store may retain only actor, request UUID and operation state. An unknown result clears fields and uses the existing sign-in recovery placement, without Retry. A duplicate consumed password UUID returns 409 and performs no new mutation; it does not claim that a differently supplied password was applied.

The authenticated owner is the only subject. Leave does not block own account security/preference actions. No HR editing, email change, photo upload, public signup, forgotten-password recovery, MFA or account deletion is added. No new secret/configuration is required here.

### Value sourcing

| Action | Value produced | Source |
| --- | --- | --- |
| Read identity | Fields and applicability above | User, linked AuthUser, current assignment and existing labels |
| Load/save preference | Boolean and revision | Child preference; legacy flag/revision zero only when absent; validated intent |
| Save/replay | UUID, digest, appliedAt, changed/replayed | Request key, canonical nonsecret body, database clock, immutable receipt |
| Change password | New credential hash | Configured Better Auth password.hash, verified old credential under locks |
| Revoke | Session absence and reauthentication | Same committed transaction's owner session deletion |
| Notify/audit | PASSWORD_CHANGED text and request correlation | The committed account action, actor id and database instant; no password material |
| Recover | Conflict/unknown/field state | Actual HTTP result, actor generation and the explicit state rules above |

### Critical test scenarios

* All five real roles show correct current fields; selectors, inactive users, stale roles and missing credential capability fail safely. AC-1, AC-2, AC-8.
* Preference default migration/fallback, repeat seed, no change/replay, stale concurrent saves, retained conflict and unchanged User/history timestamps. AC-3, AC-4, AC-10.
* Wrong current, mismatch, Unicode, normalization-equivalent old/new, length/policy bounds and field focus. AC-5, AC-9.
* Inject credential/session/notification/audit/receipt failures, concurrent password changes, sign-in crossing a password change and an aborted response after commit. AC-6, AC-7.
* Current/other sessions are unusable afterwards; old credentials fail, new credentials work; cookie-clear failure cannot restore revoked authority. No secrets in artifacts. AC-6 through AC-10.
* Development/production, 320px, keyboard, announcements, actor changes during body decoding, actual NVDA and native 200 percent zoom. AC-1, AC-9, AC-10.

## Build plan

1. Inspect each role's Profile/dialog and compose the approved shared states, using the existing shell and controls. AC-1, AC-2, AC-9.
2. Add preferences/receipts in one safe migration and repeat migration/seed checks before Neon. AC-3, AC-4, AC-10.
3. Implement the own profile read and revision/receipt preference command against the real database. AC-2 through AC-4, AC-8.
4. Implement the atomic password command, security event and exact-session sign-in fence from the child spec. AC-5 through AC-8.
5. Wire secret erasure, sign-out, reauthentication and recovery; run tests and real app verification. AC-1 through AC-10.

This follows the project's Facade variant: prototype composition first, then final wiring to migrated and seeded PostgreSQL. A stub preference or simulated password success is not a completed build.

## Consequences

Preferences gain a separate source of truth and receipt storage, preserving History evidence at the cost of an additive migration and a legacy fallback. Password security spans the existing sign-in boundary and requires careful concurrency tests. Signing out every device makes unknown-outcome recovery less convenient, while avoiding storage or replay of password proofs.

## Follow-up

* Feature 14 consumes security notification rows. Feature 15 adds email for newly created events only; earlier security messages are not mailed retrospectively.
* Future HR/user provisioning must use the child preference contract. Remove the legacy User flag only through a later reviewed migration.
* Keep forgotten-password recovery and other unapproved security surfaces deferred.
* Accepting this design does not authorize development or close existing manual accessibility gates.
