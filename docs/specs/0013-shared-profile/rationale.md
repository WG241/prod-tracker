# Shared profile reasoning

## Context

The prototype supplies the shared Profile and password dialog. Current authentication already links Workforce User to a ready Better Auth identity, while `/profile` is a protected placeholder. Employment labels and identity are authoritative business records; the Employee must not change them here. The engineer explicitly requested architecture for Features 13 through 15, with no development.

History reconstruction treats User.updatedAt as evidence that identity/account facts may have changed. Reusing the existing email flag as a write destination would make an unrelated preference edit invalidate uncaptured history. The separate preference record avoids that coupling without altering frozen records or the meaning of the existing timestamp.

## Options considered

1. Keep User.emailRemindersEnabled as the mutable setting. This is smallest but introduces false uncertainty into History and gives a general User timestamp inappropriate conflict semantics.
2. Separate preferences and shared command receipts. This adds schema and a temporary legacy fallback, but provides isolated revisions, immutable retries and unchanged identity evidence. Chosen.
3. Use the provider's stock password-change route followed by application evidence. This uses a maintained lifecycle but cannot guarantee atomic business evidence or the requested absence of a replacement session.
4. Add a custom Better Auth plugin for the complete transaction. This can work but adds adapter/plugin coupling. The existing configured password-helper/provisioning pattern is narrower for this app.

## Rationale

Own profile and notification state are shared across roles but not a new role switch or HR editor. The engineer chose current-password change, all-device revocation, mandatory owner security notices, stale preference rejection and sign-in recovery on uncertainty. These choices intentionally avoid storing password material in retry infrastructure.

The read only source review confirmed configured password.hash/verify on auth.$context, the exact credential uniqueness rule, disabled cookie cache and the stock route's separate transaction/replacement-session behavior. The sign-in fence is necessary because a provider session can be created before the application forwards its cookie. Direct writes are limited to the existing credential/session models with maintained verification, never custom cryptography.

## Confirmed model and UI choices

The engineer confirmed the assembled preference/receipt/notification/delivery model on 3 November 2026. Preference records are initialized from the old flag, shared receipts contain no password proofs, and later read receipts may reference an owned notification. Existing form, error, loading, retry, reload and toast treatments are approved; unknown password outcomes are the explicit exception to automatic retry.

All framework, database, role, cookie, origin, secret and prototype choices are inherited. The approved password policy remains in force despite the older prototype hint. No new provider, public registration, forgotten-password flow, image upload or personal identity editor is inferred.
