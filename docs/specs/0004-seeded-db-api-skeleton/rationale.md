# Reasoning for 0004

## Context

Features 2 and 3 already provide local PostgreSQL, migrations, coherent fixtures, and a public readiness request. The browser still renders the scaffold. Feature 4 has an approved design but no implementation, and the user explicitly requested moving to Feature 5.

The remaining foundation requirement is a visible list and write through the actual service and database. Authentication is a later feature. A broad unauthenticated entity API would create a new access surface without the required role rules, while building the complete Employee task workflow would cross the one feature boundary.

## Options considered

### List tasks and append a reply

This demonstrates a real relation and persisted write using the accepted model, with no migration. It does not prove multi record task creation or production authorization.

### List tasks and create a draft task

This would exercise task series, tracker and task writes together. It also requires task creation and planning rules that belong to the later task lifecycle feature, increasing the scope of a foundation proof.

### Create initial APIs for all core entities

This could prepare many later screens at once. It would require a large collection of validation, authorization and workflow decisions before those journeys are being implemented, and could expose unauthenticated data if shipped prematurely.

### Wait for authentication and the shared shell

This would allow the proof to use the final session and UI contracts. It would postpone the requested Feature 5 work and would not satisfy the user's chosen independent development proof.

## Rationale

The user chose task listing and comments on a development only proof page with a fixed fictional Ada identity. The sample is pinned to Week 44 rather than the current clock, so a foundation demonstration does not expire or silently select another week. Real comment timestamps still come from the database.

The confirmed 500 character bound is smaller than the initial recommendation. Safe retries reuse the existing TaskComment primary key, avoiding a new receipt entity for this narrow tool. Conflicting UUID reuse is rejected instead of updating a previous reply.

The custom proof page is an explicit user approved exception to the prototype page rule. It is separate from role navigation and must retain prototype control styling. The page and routes are local development tools, so they do not imply that role access or a complete production API has been implemented.

No extra References section was requested. Existing stack and data model decisions remain in specs 0001 and 0002. The local file browser restriction remains an outstanding visual inspection prerequisite before UI implementation.

## Independent cross check

A second model reviewed the draft on 2026-10-26. It confirmed the fixed carry identity, compatibility with repeat seeding and `db:verify`, and the primary key retry design. It found two technical gaps: PostgreSQL query host overrides can defeat a hostname only locality check, and NUL or unpaired surrogates cannot reliably round trip as the exact submitted PostgreSQL text.

The user approved rejecting host overrides for proof availability and rejecting unsupported text in both browser and API, while retaining valid emoji and the chosen length bound. The revision also makes inactive/mismatched fixture errors and unknown proof route errors explicit. Existing CLI guard hardening is recorded as deferred; the proof's verification validates the connection before invoking those tools.
