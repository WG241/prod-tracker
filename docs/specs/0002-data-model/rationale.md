# Workforce data model, decision record

## Context

Features 1 and 2 established tooling, Express, PrismaPg, native local PostgreSQL, an initial User table and a health check. The product still needs the shared persistence structure before Employee work begins. Feature 3's scope requires support for the five role journeys and a sample cast matching the prototype.

The prototype stores names, tasks and controls in mutable arrays and local browser storage. It preserves useful UI and behavior intent, but has duplicate task ids, contradictory approval labels, and sample organisation assignments that cannot all be valid relational references. Persisting those arrays without a clear model would make reporting history and carry work unreliable.

## Confirmed business answers

The user chose linked weekly records for carry work; pending approvals follow a newly assigned manager; late approval counts in the original task week with its actual decision date retained. They confirmed one primary role per account, a unit's single business parent, correction of inconsistent sample assignments, and deactivation that preserves history.

For partial leave, an employee remains expected if at least one Monday to Friday workday is available. The user explicitly chose task presence as submission, including automatic carry work. That differs from a suggested first manual update rule and is reflected in the model.

The user reviewed and approved the logical record preview before this spec was written. The live prototype independently states that leave requires no approval, manager owned completions are auto approved, updates need no separate Submit button, and schedules use Africa/Lagos.

After independent review, the user approved complete frozen rosters, attribution to the final assignment before freeze (current assignment while open), and part day assignment overlap counting as a workday. They also approved composite owner references, retained unlock renewal history, and immutable submitted content snapshots. These close gaps found in the first draft; they do not add new public workflows to this feature.

## Options considered

### One mutable task and current reporting fields

This is close to the prototype and needs fewer tables. It is easy to implement initially, but changing a manager, title, dates or carry state can rewrite the apparent history. Supporting the confirmed weekly history rules would later require a structural rewrite (basis: prototype arrays and the user's history answers).

### Linked weekly records with dated assignments and separate decisions

This preserves context while keeping current state convenient to query. It needs more joins and explicit transaction rules, but represents carry, reassignment and late decisions without replacing old evidence. This is the chosen approach (basis: confirmed model preview and dated history requirements).

### Store everything as event JSON and rebuild views

An event based model could preserve every change and replay it. It adds replay, event versioning and projection complexity to a small internal app. The current need is better served by typed relational entities plus audit snapshots, without a complete event sourcing platform (basis: existing PostgreSQL/Prisma architecture and the limited release scope).

## Rationale

The important boundary is between an identity and its historical context. Dated assignments and weekly snapshots preserve old reporting without granting a former manager current team permissions. Pending request routing remains mutable while original submission and decision evidence remain separate.

A series links the same work across weeks; the weekly task keeps its own content and outcome. Approval requests record attempts, and immutable decisions identify the real reviewer or automatic policy. This makes the user's late approval rule representable without making old task content editable.

Some data is necessarily captured rather than recomputed. A frozen week's eligibility and organisation labels must not change when HR later edits a person or leave. Open week eligibility and rates remain derived from authoritative rows. There is no stored boolean that can contradict whether a person's tracker has work.

Keep proven PostgreSQL features in migration SQL rather than opting into a Prisma preview feature solely for partial indexes. Prisma 7 supports preview partial index declarations, but native unique indexes and row CHECK constraints are already available in the chosen database. Cross row role and overlap rules need transactional checks; ordinary CHECK expressions cannot prove another row's state.

## Prototype source observations and seed normalization

Inspect the running prototype's current v1.2 screens and later function overrides, not only the original declarations near the start of the HTML file. Employee Home, Line Manager Dashboard, HR Employees, HR Leave & Relief, HR Settings and Employee Leave were viewed during design.

The source defines 23 base tasks and two extra v1.2 tasks. The extra tasks reuse ids 10 and 11. Preserve all their distinct titles and owners with unique fixture ids. Approved and Completed are inconsistently used by rate functions; use Approved as the single successful outcome, with a separate automatic method for manager work. Legacy percent values do not become a progress field.

Some `pendingRoster` people are assigned to Outsourcing but use Recruitment or Assessment, which belong to Workforce Resourcing. The seed manifest will map those assignments to an existing Outsourcing unit while preserving business and manager. The prototype also shows Damilola in both the awaiting approval queue and the missing submission roster. Task presence is authoritative under the user's answer, so that person cannot remain missing when their task exists.

Emeka is the Outsourcing director in the organisation screen but is also hardcoded as a relief option. Keep the director role as his current primary role; use an eligible Line Manager for conflicting cover fixtures and identify that correction in the seed manifest. Named people appearing only as a role identity or historical relief officer still need User identities so references are real.

Week 43 dates and the live settings screen are fixture sources. Supporting historical and next week records use explicit synthetic dates and actors where the prototype only simulates them. Those are reproducible examples, not statements about real employees.

## References

### Project sources

`AGENTS.md`, scope Feature 3 in `docs/scope/foundations.md`, the accepted architecture spec 0001, `prisma/schema.prisma`, and the live `docs/workforce-prototype-updated.html` establish the stack, boundaries and sample data. The model preview in `.tmp/data-model-preview.md` was confirmed during design; this spec is the durable record.

### Verified official documentation

- [Prisma index documentation](https://www.prisma.io/docs/orm/v7/prisma-schema/data-model/indexes) explains index declarations, including preview partial indexes.
- [PostgreSQL 18 partial indexes](https://www.postgresql.org/docs/18/indexes-partial.html) supports the selected database unique predicates.
- [Prisma unsupported database features](https://www.prisma.io/docs/orm/prisma-migrate/workflows/unsupported-database-features) explains customized migrations for database features outside schema declarations.
- [PostgreSQL constraints](https://www.postgresql.org/docs/18/ddl-constraints.html) documents foreign keys, uniqueness, CHECK behavior and the cross row limitation.
- [Prisma schema reference](https://www.prisma.io/docs/orm/v7/reference/prisma-schema-reference) documents native PostgreSQL field mappings.
- [PostgreSQL date and time types](https://www.postgresql.org/docs/18/datatype-datetime.html) explains calendar dates and timezone aware event timestamps.
