# Manager dashboard reasoning

## Context

The prototype provides the full Dashboard, but current role pages are scaffolds. Employee task/leave data, frozen rosters and pending requests already exist. Shared profile, notifications and email have confirmed designs. Team reporting must remain distinct from temporary review cover.

## Options considered

1. Copy the prototype's sample counters and static activity first. Fast visual proof, but it cannot establish data or authority acceptance.
2. Reuse the existing relational records with shared scoped projections and small commands. More query/concurrency work, but keeps one source and preserves existing evidence. Chosen.
3. Add a reporting cache or event warehouse. Could reduce repeated aggregation later, but adds stale data and infrastructure without a measured need.

## Rationale

The engineer chose whole overlapping workweeks, a six-week trend, manual reminders with a daily natural limit and unavailable historical aggregates instead of misleading partial rates. Reusing the existing snapshot/calendar definitions gives those values a coherent source. Temporary relief remains limited to pending review, so it cannot inflate or expose a permanent team's report.

Prototype defects include a manager task lookup opening an unrelated Employee sample and hardcoded activity/participation inconsistencies. Preserve its composition, never those authority or data errors. Pagination, shared failure treatments and scoped selectors were explicitly approved.
