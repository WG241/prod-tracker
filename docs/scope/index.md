# Scope: Workforce weekly performance

Internal weekly performance tracker for Workforce Group. People plan and report work by week, managers approve it, leaders see participation and approved completion, and HR runs org structure, leave and relief, tracker lock or unlock, audit, and settings.

Five roles from the HTML prototype: Employee, Line Manager, Business Director, Executive, HR / Admin. First release covers all five role happy paths, in app and email alerts, and the shared journeys between them.

**Build approach:** Facade (UI first, wired to a locally migrated database with seed mock rows so UI, API, and backend already work on live local data; harden from there).
**Role order:** Journey one user group to completion before the next. Recommended default: Employee → Line Manager → Business Director → Executive → HR / Admin. If a run does not name the role, ask before building.
**Workflow:** Alpha (after `/develop`, run `/check verify` on the real app). Project default. `/architect` still applies when a feature needs a decision. Tag a feature `· Beta` or `· GA` only when it needs more rigor than Alpha.
**Build rhythm:** one feature per run; verify before calling done; on a new chat, read last commit and unstaged files plus this scope to resume. Handoff for juniors and AI IDEs: root `README.md` and `AGENTS.md` (prototype UI is the design contract; ask before inventing missing screens).

_These are recommendations to keep your build orderly, not requirements. Skip anything that does not fit: if you already know how to build a feature, use `/develop` and skip `/architect`. You decide when a feature is `done`._

**Source map:** clickable product map in `docs/workforce-prototype-updated.html`. Visual tokens in `docs/design-tokens.md` and `docs/typography-scale.md`.

## At a glance

| # | Feature | Phase | Status |
|---|---------|-------|--------|
| A | App scaffold | Existing | existing |
| B | Design token notes | Existing | existing |
| 1 | Coding standards and tooling | Foundation | planned |
| 2 | Stack and architecture | Foundation | in-progress |
| 3 | Data model | Foundation | planned |
| 4 | Design system and UI foundation | Foundation | planned |
| 5 | Seeded local DB and API skeleton | Foundation | planned |
| 6 | Sign in and role access | Foundation | planned |
| 7 | Accessibility baseline | Foundation | planned |
| 8 | Error monitoring and product analytics | Foundation | planned |
| 9 | Employee home and weekly board | Employee | planned |
| 10 | Employee task lifecycle | Employee | planned |
| 11 | Employee history | Employee | planned |
| 12 | Employee leave | Employee | planned |
| 13 | Shared profile | Shared | planned |
| 14 | In app notifications | Shared | planned |
| 15 | Email alerts | Shared | planned |
| 16 | Line Manager dashboard | Line Manager | planned |
| 17 | Line Manager my tasks | Line Manager | planned |
| 18 | Team history | Line Manager | planned |
| 19 | Approvals | Line Manager | planned |
| 20 | Line Manager leave | Line Manager | planned |
| 21 | Business Director dashboard | Business Director | planned |
| 22 | Units hierarchy | Business Director | planned |
| 23 | Business Director performance records | Business Director | planned |
| 24 | Business Director reports | Business Director | planned |
| 25 | Executive dashboard | Executive | planned |
| 26 | Businesses hierarchy | Executive | planned |
| 27 | Executive performance records | Executive | planned |
| 28 | Executive reports | Executive | planned |
| 29 | HR dashboard | HR / Admin | planned |
| 30 | Organisation admin | HR / Admin | planned |
| 31 | Employees admin | HR / Admin | planned |
| 32 | Tracker controls | HR / Admin | planned |
| 33 | Leave and relief admin | HR / Admin | planned |
| 34 | HR performance records | HR / Admin | planned |
| 35 | HR reports | HR / Admin | planned |
| 36 | Audit log | HR / Admin | planned |
| 37 | Tracker settings | HR / Admin | planned |

## Epics

| Epic | File | Status rollup |
|------|------|---------------|
| Foundations | [foundations.md](./foundations.md) | scaffold existing; 1 planned standards; 2 in progress; 3 to 8 planned |
| Employee | [employee.md](./employee.md) | 9 to 12 planned |
| Shared (all roles) | [shared.md](./shared.md) | 13 to 15 planned |
| Line Manager | [line-manager.md](./line-manager.md) | 16 to 20 planned |
| Business Director | [business-director.md](./business-director.md) | 21 to 24 planned |
| Executive | [executive.md](./executive.md) | 25 to 28 planned |
| HR / Admin | [hr-admin.md](./hr-admin.md) | 29 to 37 planned |

## Deferred

Out of scope for the current build pass, kept so the plan stays honest.

- **Multi company tenancy:** single Workforce Group only for this release.
- **Billing:** none.
- **Push or SMS alerts:** in app and email only for this release.
- **Extra languages:** English only.

## Legend

**The decision box.** Every feature carries exactly one, the sub task whose label ends with `(spec)`. Skills locate it by that `(spec)` suffix. Every other box is an execution box and `/architect` never ticks one.

**Feature lifecycle:** `planned` → `in-progress` → `done`, plus `existing` (pre workflow) and `dropped` (de scoped, kept for history).

- **Next step** = the first unticked box (always a command or a tracked milestone).
- **needs a decision** = run `/architect` first; otherwise straight to `/develop` (or `/audit` for standards and tooling).
- **Atomic build tasks live in the spec's `## Build plan`, not here.**
- **Approach tag** beside a heading overrides the project default; no tag inherits Facade.
- **Workflow tier tag** (for example `· Beta`) sets rigor above or below Alpha for that feature only.
- **Pointer line** (`spec <n> · code in <path>`): filled by `/architect` and `/develop` when those exist.
