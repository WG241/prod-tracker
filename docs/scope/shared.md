# Epic: Shared (all roles)

Cross role surfaces. Build once; every user group uses them. Prefer finishing in app notifications with the first role that needs alerts (Employee or Line Manager), then email once those events exist.

## Shared

### 13. Shared profile · done
Profile page for the signed in person: read only identity, role, business, unit and manager; persisted workflow email preference; authenticated password change.
**Done when:** every role sees its own current identity, preference changes persist with revision/receipt protection, and password change atomically ends all sessions and records its security notice.
**Pointer:** spec [0013](../specs/0013-shared-profile/index.md) · code in `src/features/profile/`, `server/account/` and `src/dev/ProfilePreview.tsx`.
**Progress:** verified on 2026-11-07. All five signed in roles can read their own account, save email preferences, and change their password. The Neon migration is applied. Lint, build, 32 authentication tests, both app modes, lost response recovery, repeated migration and seed, native Chrome 200 percent zoom, and actual NVDA announcements passed. Local browser and speech evidence is in `.local/verification/feature13/`.
- [x] Design it (spec): `/architect shared profile`
- [x] Build it: `/develop shared profile`
  - [x] Match Profile/password dialog and approved shared states for every role. AC-1, AC-2, AC-9.
  - [x] Add isolated preferences/shared receipts and own profile/preference APIs. AC-2, AC-3, AC-4, AC-8, AC-10.
  - [x] Build atomic password/session/security evidence and concurrent sign-in protection. AC-5, AC-6, AC-7, AC-8.
  - [x] Wire recovery and secret erasure; prove database/browser behavior with meaningful tests. AC-1 through AC-10.
- [x] Verify it: `/check verify shared profile`

### 14. In app notifications · in-progress
Shared unread tray for existing completion/leave and account security events, with contracts for later decisions, comments, tracker and relief producers in their owning features.
**Done when:** each role sees only its messages; selection and read-all are safe under retry; current permissions govern targets; real producers commit deduplicated rows atomically.
**Pointer:** spec [0014](../specs/0014-in-app-notifications/index.md) · code in `src/features/notifications/` and `server/notifications/`.
**Progress:** built on 2026-11-09. All five roles passed browser checks in development and production, including pagination, safe read retries, current target access, keyboard focus, NVDA and native Chrome zoom at 200 percent. The notification migration is applied in Neon development. Authentication and notifications, Employee task lifecycle, and Leave suites passed on isolated PostgreSQL. Verification remains open because two checks in the broader Employee History suite fail. The local evidence is in `.local/verification/feature14/`.
- [x] Design it (spec): `/architect in app notifications`
- [x] Build it: `/develop in app notifications`
  - [x] Match the bell/tray, pagination, focus and approved failure states. AC-1, AC-9.
  - [x] Add exact approval/owned receipt relations and the typed event/target registry. AC-4, AC-5, AC-6, AC-7, AC-8, AC-10.
  - [x] Implement owned reads, safe read mutations and current target resolution. AC-2, AC-4, AC-5, AC-8.
  - [x] Wire refresh/cancellation/recovery and prove arrival, authority and accessibility behavior. AC-1 through AC-10.
- [ ] Verify it: `/check verify in app notifications`

### 15. Email alerts · in-progress · Beta
Resend email for newly created registered events, using a durable outbox and app worker. Off by default, with explicit Preview, Catch-all and Live modes. Later workflows add their own producers; historical events are not backfilled.
**Done when:** eligible new events deliver matching plain text to the frozen authorized recipient or controlled catch-all, current policy is rechecked, retries retain uncertainty safely, and send/worker failures are visible. Sent means provider acceptance.
**Pointer:** spec [0015](../specs/0015-email-alerts/index.md) · code in `server/email/` and `scripts/email-operator.ts`.
**Progress:** the outbox migration is applied to Neon development. New password, completion approval and leave notifications enqueue transactionally, with delivery Off by default. Private Preview passed in both app modes, and invalid configuration retained a failed delivery with a fixed server diagnostic. The automated email and producer regression suites passed on isolated PostgreSQL. Controlled Catch-all delivery still needs an approved Resend sender, API key and test inbox. Failure diagnostics use bounded server logs in this checkout.
- [x] Design it (spec): `/architect email alerts`
- [ ] Build it: `/develop email alerts`
  - [x] Compose final plain text and explicit safe configuration modes, beginning with private Preview. AC-2, AC-3, AC-4.
  - [x] Add durable delivery snapshots, original recipient basis and transactional enqueue policy. AC-1 through AC-6, AC-8, AC-10.
  - [x] Build bounded claims/worker/provider recovery, durable uncertainty and private diagnostics. AC-6, AC-7, AC-8, AC-9.
  - [ ] Prove real Preview/controlled Catch-all and sanitized failure monitoring. AC-1 through AC-10.
- [ ] Verify it: `/check verify email alerts`
- [ ] Test it: `/test email alerts`
