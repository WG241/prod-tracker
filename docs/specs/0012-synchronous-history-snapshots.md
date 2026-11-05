# 0012 · Synchronous history snapshots

**Status**: Assumed
**Date**: 2026-11-05
**Authorized by**: engineer, during /develop

## Owed decision

Replace the current delayed history capture path with a synchronous close operation that publishes a complete immutable snapshot for a week.

## Assumption built on

At the Saturday week close, one atomic PostgreSQL transaction will validate the roster and source facts, copy the employee context, tasks, comments, and review evidence into immutable history snapshot tables, mark the week complete, and reject later writes for that week. The History API will prefer these snapshots and retain the existing valid tracker snapshot path for older records that predate this change. A scheduled close will run once per week after the Africa/Lagos freeze boundary, with startup recovery for missed closes.

## Code area

`prisma/schema.prisma`, `prisma/migrations/`, `server/employee/history-*`, `server/employee/reads.ts`, `server/index.ts`, `tests/employee/history.test.ts`.

## Requirements

1. A closed week publishes all required employee and task history in one transaction.
2. A failed close publishes nothing partial and can be retried safely.
3. History reads use the immutable snapshot when one exists, including task detail, comments, and review evidence.
4. Writes for a published week are rejected by application and database guards.
5. The normal user experience does not wait for a background capture pass.
6. Existing valid history remains readable while the new path is introduced.

## Ratify

This decision was recorded by `/develop`, not deliberated. Run `/architect synchronous history snapshots` to deliberate and ratify it. Until then it stays flagged as an owed decision; it does not block testing this build.
