# 0013. Account writes and password boundary

## Summary

Use the existing owner mutex and persisted sessions to serialize own account changes. Keep credentials, session revocation and business evidence in one transaction. An unknown password result leads to sign-in recovery, not secret replay.

## Authority and receipts

Use Read Committed transactions with the same Workforce User mutex as task/leave writes. Lock User first, then the initiating AuthSession, AuthUser, current assignment rows, credential account, and relevant preference row in a documented deterministic order. Password change takes update locks where it will write/delete; other reads may share locks. Holding the User mutex serializes task/leave/account commands for that person. Recheck session expiry, active account, ready canonical identity and exact current role after waits using the database clock. No caller supplies those values.

Timeouts follow existing database bounds; retry a transaction at most three total attempts only for known rolled-back deadlocks/serialization/unique races. Never repeat a transaction whose commit outcome is unknown. Current password verification may run again only after a confirmed rollback, never a network outcome.

Receipt keys are actor plus UUID. EMAIL_PREFERENCE hashes the fixed ordered structure `{ operation,emailRemindersEnabled,expectedRevision }` with SHA-256. Inspect a receipt after fresh authority and before applying revision rules. Same operation/hash returns the original safe result with replayed true; mismatch is 409. Under the mutex, an absent child preference has legacy value/revision zero. A changed value creates/increments the child revision; no change adds only its receipt. Audit a changed preference with before/after booleans and revisions, without changing User.updatedAt.

PASSWORD_CHANGE receipts have requestHash NULL and a fixed safe result. Do not store an HMAC, digest, encrypted copy or other password proof. A previously consumed password UUID is a 409 consumed command after fresh authentication, with no credential/session mutation. The client does not use this as a secret retry protocol. Uncommitted/rolled-back requests leave no receipt.

## Password transaction

1. Validate exact fields, UUID, body bounds and new/confirmation policy before expensive work. Do not trim passwords. Current password may be a well-formed nonempty string through 256 Unicode characters; it is a proof, not a new password policy check. Confirmation must match the new string exactly.
2. Obtain the configured `auth.$context.password` helpers, as the existing trusted provisioning boundary does. Compute the new hash using that helper, with a bounded hashing admission limit of two operations per process; excess work receives a fixed 503 before any domain write. Do not implement scrypt, import private provider route files or expose the unrestricted handler.
3. In the transaction acquire the locks above. Resolve the credential by providerId `credential` and accountId equal to the authenticated AuthUser id; also require its userId to match and password hash to be nonnull. Never select a latest/arbitrary account.
4. Verify the current password against the locked credential through the configured helper. Verify the proposed new password against that hash too, rejecting equivalent credentials, including library normalization equivalents. Recheck authority/clock after these awaits before the writes.
5. Update only AuthAccount.password using the new hash and its normal updatedAt. Delete every persisted AuthSession for the owner and confirm none remain in this transaction. An AuthUser update lock fences concurrent session FK creation while deletion commits. Do not change Workforce identity/assignment fields or provisionedAt.
6. Create one Notification with kind PASSWORD_CHANGED, recipient the actor, title `Password changed`, and fixed English body giving the WAT date/time, explaining all sessions ended and advising Contact HR if unexpected. No task/leave/relief target. Deduplication key `password-changed:<actor>:<requestId>`. Create `account.password.changed` AuditEvent targeting the credential account and a receipt in the same transaction. Audit only requestId, occurrence time, operation and session count, never credential data or tokens.
7. Once spec 0015 is installed, the same notification factory also inserts its eligible email row in this transaction. Provider delivery is never inside it. Before that feature exists, the notification still persists and is not backfilled later.
8. Commit before acknowledging. Return only the safe reauthentication result. Obtain maintained expiry-cookie headers through the configured Better Auth sign-out path after commit, without creating a session. If expiry-header generation fails after a known commit, keep the success/reauthentication meaning: database revocation already holds. Capture a fixed sanitized error, clear client state and redirect to sign-in. Never compensate by restoring sessions/passwords.

No provider account-update hooks currently exist. The narrow command intentionally owns the credential update, like trusted provisioning, while using the provider's configured cryptography. Compatibility tests must prove normal Better Auth login accepts the produced hash and all configured hashing overrides are respected. A future provider/hook change must review this boundary; it cannot silently introduce an account hook used only by another path.

## Sign-in fence

The current provider call verifies a password and creates a session before the application issues cookies. A password could otherwise change between those steps and leave an old-password sign-in usable after revocation.

Before calling signInEmail, capture the exact linked credential account id/hash in request memory for an existing canonical identity. Keep the provider's ordinary unknown-user verification/error behavior. Never log or persist the captured hash. Resolve only the exact newly issued token from the documented provider response or its issued cookie; remove the ambiguous newest-user-session fallback.

Before forwarding any cookie, the sign-in completion transaction takes the same User mutex, rechecks the exact session, current authority and captured credential identity/hash against storage, and commits its existing completion audit. A changed/missing credential or missing/expired session withholds cookies and revokes the exact unissued session through the existing cleanup policy. Return a fixed credentials-changed/retry failure. Do not revoke a different session found by date order.

If sign-in completion wins the mutex first, a subsequent password change deletes that session. If password change wins first, completion sees changed credentials or a revoked session and cannot issue it. Test both orders, plus provider session insertion waiting on AuthUser and a failing completion audit. No new auth/session version column is needed.

## Browser and failure rules

Use the existing password dialog's current/new/confirm fields with proper autocomplete. Required/policy/mismatch/current-password failures use ordered shared field errors; secret values are never announcement text. Keep Update password focusable while busy with a real duplicate activation guard. A definite field failure may retain the mounted form; any unknown outcome erases it and offers sign-in recovery only.

On 200 erase all actor stores and navigate to `/sign-in?notice=password-changed`. On a lost/5xx outcome clear secrets and use a fixed password-outcome-unknown sign-in notice. The notice contains no user id, password or request key. Background/session loss during a pending attempt uses this unknown meaning, not a false success claim. Never persist secret drafts or put them in a shared pending-operation store.

## Rationale

The standard provider changePassword operation updates credentials transactionally but does not include the application's audit/notification/receipt, and its revoke option creates a replacement session. A custom provider plugin could compose those concerns but adds a deeper adapter contract. The selected narrow command matches existing provisioning and satisfies atomic evidence plus all-session revocation without a new authentication system.
