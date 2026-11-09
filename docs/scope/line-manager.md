# Epic: Line Manager

Second user group after Employee. Approvals and team views depend on Employee task and leave data.

## Line Manager

### 16. Line Manager dashboard · done
Scoped team metrics, grouped review preview, weekly trend, missing submitters, blockers and activity. Manual reminders have a recipient/week/day limit; general relief browsing is excluded.
**Done when:** live current/frozen reporting uses trustworthy team scope and denominators, unavailable history is explicit, and actionable reminders/comments persist atomically with notifications and retry evidence.
**Pointer:** spec [0016](../specs/0016-line-manager-dashboard/index.md) · code in `src/features/line-manager/` and `server/line-manager/`.
**Progress:** Verified on 2026-11-09. The authenticated Dashboard uses scoped current and frozen reporting with atomic reminders and comments. The migration and seeded projections were confirmed in Neon development. Nine Dashboard tests, six email tests and 39 auth tests passed on separate PostgreSQL. Both app modes passed browser checks, including recovery after a lost response. Actual NVDA and native Chrome zoom at 200 percent passed. Local evidence is in `.local/verification/feature16/`. The engineer confirmed that search belongs to Approvals and Team history. Shared Features 14 and 15 retain their own verification gates.
- [x] Design it (spec): `/architect line manager dashboard`
- [x] Build it: `/develop line manager dashboard`
  - [x] Match Dashboard and approved shared states in the development preview. AC-1, AC-9.
  - [x] Add reminder week/receipt support and scoped current/frozen projections. AC-2, AC-3, AC-4, AC-8.
  - [x] Wire real sections, atomic reminders/comments and typed event integrations. AC-1 through AC-8.
  - [x] Prove reporting values, races, recovery and accessibility with meaningful tests and real app evidence. AC-1 through AC-10.
- [x] Verify it: `/check verify line manager dashboard`

### 17. Line Manager my tasks · done
Private own weekly work using the existing task lifecycle, with automatic approval evidence on completion and no human queue item.
**Done when:** the manager can manage owned tasks under planning/leave/freeze rules, completion atomically creates an Automatic decision, and other managers/relief cannot read private drafts.
**Pointer:** spec [0017](../specs/0017-line-manager-my-tasks.md) · code in `src/features/employee/`, `server/employee/` and `server/line-manager/router.ts`.
**Progress:** Verified on 2026-11-09. The authenticated My tasks route shares the weekly tracker and records automatic approval with the task, audit and receipt in one transaction. Eight My tasks database tests and 24 Employee lifecycle and client regression tests passed. Development and production browser checks verified recovery after a lost response and persisted replies. Native Chrome zoom at 200 percent and actual NVDA passed. Local evidence is in `.local/verification/feature17/`.
- [x] Design it (spec): `/architect line manager my tasks`
- [x] Build it: `/develop line manager my tasks`
  - [x] Match My tasks and reuse owned task controls/recovery. AC-1, AC-8.
  - [x] Share the minimum typed own-task core with explicit role policy and safe private reads. AC-2, AC-3, AC-5, AC-7.
  - [x] Implement automatic completion and preserve atomic carry/edit/receipt behavior. AC-4, AC-5, AC-6.
  - [x] Prove manager ownership and automatic approval without regressing Employee review. AC-1 through AC-9.
- [x] Verify it: `/check verify line manager my tasks`

### 18. Team history · done
Current and frozen team weeks with one Employee/week row, person and participation filters, task-status drill-in and recorded historical attribution.
**Done when:** the manager can inspect only their current or recorded team, zero-task records remain meaningful, unavailable capture is explicit, and exact week/task navigation retains trusted context.
**Pointer:** spec [0018](../specs/0018-team-history.md) · code in `src/features/line-manager/TeamHistoryPage.tsx` and `server/line-manager/team-history.ts`.
**Progress:** Verified on 2026-11-09. The roster and employee week drill-in use current or recorded team scope, preserve available rows during incomplete capture, and show late outcomes alongside captured task content and comments. Seven Team history API tests and nine Dashboard regression cases passed on separate PostgreSQL. Development and production browser checks passed, including recovery, keyboard focus and the narrow screen accessibility scan. Native Chrome at 200 percent and actual NVDA passed. Local evidence is in `.local/verification/feature18/`.
- [x] Design it (spec): `/architect team history`
- [x] Build it: `/develop team history`
  - [x] Match roster/drill-in and approved filters, Week column and shared states. AC-1, AC-8.
  - [x] Implement paged current/recorded reads and scoped availability without capture side effects. AC-2 through AC-5, AC-7.
  - [x] Wire exact week/task drill-in, current comment capability and safe back navigation. AC-4, AC-6, AC-8.
  - [x] Prove transfers, late outcomes, missing evidence and accessibility on real data. AC-1 through AC-9.
- [x] Verify it: `/check verify team history`

### 19. Approvals · done · Beta
Exact pending submissions across workweeks, grouped by Employee, with narrow dated relief, individual decisions, atomic displayed batches, comments and current notification destinations.
**Done when:** authorized permanent/relief decisions atomically persist outcomes and alerts, later review preserves frozen content/context, stale batches apply nothing, and revoked scope cannot be reused through reads or notifications.
**Pointer:** spec [0019](../specs/0019-approvals/index.md) · code in `src/features/line-manager/ApprovalsPage.tsx`, `server/line-manager/approval-reads.ts` and `server/line-manager/approval-writes.ts`.
**Progress:** Verified on 2026-11-09. The Approvals queue and review dialogs use exact submitted attempts and current permanent or dated relief scope. Individual decisions and batches commit their task outcome, audit, notification, email outbox record and receipt together. The migration was applied to Neon development and reapplied successfully on separate PostgreSQL. All 41 database tests passed on a fresh seed, including seven Approvals cases. Development and production browser runs verified recovery after a lost response. Native Chrome at 200 percent and actual NVDA passed. Local evidence is in `.local/verification/feature19/`.
- [x] Design it (spec): `/architect approvals`
- [x] Build it: `/develop approvals`
  - [x] Match Review/reason/history/blocker views and compose the approved Awaiting tab. AC-1, AC-9.
  - [x] Extend receipts and implement one exact-request scope/capability resolver with paged projections. AC-2, AC-3, AC-4.
  - [x] Build atomic individual/batch decisions and post-freeze outcomes. AC-4 through AC-7.
  - [x] Integrate replies, typed alerts, email eligibility and exact review/team task targets. AC-3, AC-5, AC-8, AC-9.
  - [x] Prove races, revocation, rollback, recovery and real app behavior. AC-1 through AC-10.
- [x] Verify it: `/check verify approvals`
- [x] Test it: `/test approvals`

### 20. Line Manager leave · done
Owned leave and recorded cover history, with required full initial cover, safe bounded replacements, immediate revocation and truthful uncovered-date warnings. No Employee leave editor.
**Done when:** leave/cover transitions persist atomically with owner/officer/director/HR alerts, overlapping incoming commitments are protected, access ends on date/return/cancellation/revocation, and history preserves actual arrangements.
**Pointer:** spec [0020](../specs/0020-line-manager-leave/index.md) · code in `src/features/line-manager/ManagerLeavePage.tsx`, `server/line-manager/leave-reads.ts` and `server/line-manager/leave-writes.ts`.
**Progress:** Verified on 2026-11-09. The migration is applied to Neon development and replays cleanly on separate PostgreSQL. The leave API tests covered overlapping commitments, replacement and immediate revocation, immutable history, recipients, and rollback. Development and production browser tests covered lost response recovery and stale cover. Native Chrome at 200 percent with NVDA passed. Local evidence is in `.local/verification/feature20/`.
- [x] Design it (spec): `/architect line manager leave`
- [x] Build it: `/develop line manager leave`
  - [x] Match Leave & cover/history and approved scheduled, cover and recovery controls. AC-1, AC-10.
  - [x] Add immutable display snapshots and safe receipt/guard extensions. AC-8, AC-9.
  - [x] Implement owned reads, paged candidates/history and atomic leave plus initial cover. AC-2, AC-3, AC-4, AC-7.
  - [x] Implement replacement/end/cancel/return and source/history protection. AC-5, AC-6, AC-9.
  - [x] Integrate alerts and prove overlap, revocation, retry and accessibility behavior. AC-1 through AC-10.
- [x] Verify it: `/check verify line manager leave`
