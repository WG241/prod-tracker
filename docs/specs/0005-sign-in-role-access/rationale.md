# Reasoning for 0005

## Context

The service and domain model exist, but there are no passwords, sessions, sign in handlers or role guards. Features 4 and 5 have approved designs and remain unbuilt. The user requested designing Feature 6 next, with its GA workflow requirements.

The existing User model is referenced throughout reporting history, tasks and audit evidence. Replacing its ids or treating email as an implicit account link would undermine that identity boundary. Roles belong to current EmploymentAssignment rows, not to the browser or an authentication plugin's role field.

## Options considered

### Maintained authentication library in the current service

This keeps sessions and credentials beside the existing PostgreSQL data and reuses the same origin deployment. It leaves the team responsible for configuration, upgrades, rate limits, operations and proving its application specific policy. The user selected Better Auth after checking its official Express/Prisma integrations (basis: official integration documentation and current stack).

### Hosted identity provider

A hosted service could operate a larger authentication lifecycle and simplify future corporate identity integration. It introduces an external identity and operational configuration while the selected slice is password authentication on the current stack. A provider and linking model would still need explicit selection. It was not selected in this run.

### Custom password/session implementation

It could fit the exact current schema with fewer library tables. It would also make this project responsible for credential cryptography, session lifecycle and their security maintenance, without an established need to own them. This was rejected in favor of maintained library behavior.

## Rationale

The user selected Better Auth, separate authentication tables with an explicit one to one Workforce link, seven day rolling sessions, multiple devices and immediate database based account/role checks. The shared primary key uses the library's documented id customization without rewriting people or relying on automatic email linking (basis: official database model and id generation documentation).

HR managed provisioning has no public signup. The operator command is a separate process with private credential creation capability; the HTTP configuration stays closed. A pending timestamp separates initial credential creation from audited activation. The library remains responsible for the password hash format and verification (basis: installed general, security, and email/password skills, plus official server API).

The user approved 15 through 128 character passphrases, no composition rules, five failed email attempts per 15 minutes plus an IP limit, PostgreSQL counters, and no password recovery yet. The exact code point/UTF-16 boundary is made explicit so the application and library do not disagree about valid supplementary characters.

Role prefixes and a session context only public surface were chosen over adding a demonstration task API. Policy tests use real seeded relationships while preserving the later role features' ownership. A fresh role lookup adds database cost but reflects the selected immediate deactivation and role behavior.

The three approved skills were installed into the project's `.agents/skills/`. The optional docs MCP remains deferred. Node's built in runner with tsx was selected rather than a new test dependency. No runtime auth package was installed during this design step.

## Independent cross check

A second model reviewed the GA draft on 2026-10-26 without editing or fetching external sources. It found no new architecture choice to reopen, and identified three repairs: explicitly deny an existing session with unusable staff context, cover interrupted identity creation without a credential, and reconcile rate limit and development path contracts.

The user approved `401 SESSION_REQUIRED` plus cleanup for unavailable staff context (503 on required database/audit failure), an explicit guarded repair restricted to incomplete and never activated auth identities, and the clarified 429/tool routing contracts. Those repairs are in the build spec. The review otherwise found the identity link, server wrappers, renewal cookies, current role checks and policy value sources coherent.

## References

**Project sources**: root and server AGENTS.md, scope Feature 6, specs 0001 through 0004, the final HTML prototype and existing Prisma schema. These establish stack, identity, role, workflow and UI constraints.

**Checked official sources**:

1. [Express integration](https://better-auth.com/docs/integrations/express): supported Node service integration.
2. [Prisma adapter](https://better-auth.com/docs/adapters/prisma): PrismaPg/PostgreSQL integration.
3. [Database](https://better-auth.com/docs/concepts/database): core models, custom model names, id generation, server owned fields and lifecycle hooks.
4. [Server API](https://better-auth.com/docs/concepts/api): direct endpoint calls, error handling and returned cookie headers; checked documentation identifies version 1.7.13.
5. [Session management](https://better-auth.com/docs/concepts/session-management): database sessions, renewal and cookie cache tradeoff.
6. [Options](https://better-auth.com/docs/reference/options): signup control, password options and configuration.
7. [Official skills repository](https://github.com/better-auth/skills): installed general, security and email/password guidance.

The version index URL `https://better-auth.com/llms.txt` could not be rendered by the browser tool because it returned an unsupported Markdown content type. The checked official HTML documentation was used instead; do not describe the index as successfully fetched. The local prototype file URL remains blocked, so visual inspection is still an implementation prerequisite.
