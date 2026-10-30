# Changelog

Notable changes to Workforce weekly performance are recorded here.

## Unreleased

### Added

- Password sign in with persisted sessions, current database role checks, fixed role destinations and Profile access (spec 0005).
- Trusted terminal credential provisioning, guarded recovery from interrupted provisioning and explicit local fixture credentials.
- Persistent sign in limits, session revocation audit evidence and database scope policies for ownership, reporting, business and relief access.
- A Node and HTTP authentication regression suite using a separate local test database, plus operator guidance in `docs/auth-operations.md`.

### Changed

- Real workspaces use authenticated staff identity. Fictional role and component previews remain separate development tools.
- Forgot password stays disabled with an explanation while recovery is unavailable. Role workflows remain their scheduled features.

Feature 6 verification remains in progress until its development and production browser checks pass.
