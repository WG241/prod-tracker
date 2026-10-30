# Workforce fixture manifest

These are development examples from `docs/workforce-prototype-updated.html`, with synthetic history to exercise the approved data model. They are not live employee records. `prototype.json` preserves the literal source arrays. `plan.ts` constructs deterministic records and exposes its normalization list as `corrections`. `validate.ts` checks relationships and workflow coherence before the seed transaction starts.

Run `npm run db:seed` against local PostgreSQL. It inserts missing identities and evidence without resetting existing records. It creates the inactive foundation identity on a fresh database and preserves its existing id and timestamps when present. All fixture writes share one transaction. All four email deliveries are Suppressed, with no sender invoked.

| Record | Fixture count |
|---|---:|
| Staff identities | 28 |
| Businesses / units | 2 / 5 |
| Dated assignments | 29 |
| Weeks / weekly rosters | 4 / 110 |
| Task series / weekly task records | 32 / 35 |
| Comments | 8 |
| Approval attempts / decisions | 24 / 17 |
| Leave / relief records | 11 / 8 |
| Unlocks / audit events | 3 / 4 |
| Notifications / suppressed deliveries | 4 / 4 |

There is also one retained, inactive foundation identity, for 29 total users on the prepared database. Settings use the singleton `workforce-group` and the prototype's WAT schedule.

## Source normalization

1. Task identities use owner, title and week. The two v1.2 tasks that reuse source ids 10 and 11 remain separate tasks, giving 25 prototype tasks.
2. Approved is the canonical completed status. Legacy percentages and contradictory `notSubmitted` flags are omitted. Presence of any nondeleted weekly task counts as submission, including automatic carry.
3. Emeka Nwosu has one current role, Outsourcing Business Director. Conflicting historical relief references use Bayo Adeleke, an eligible Line Manager.
4. Evelyn Peters, Daniel Uche, Grace Ekanem, Joy Ibekwe and Emmanuel John retain their Outsourcing business and Nneka as manager. Their inconsistent Assessment or Recruitment units become Payroll under Outsourcing.
5. Named roster members without a complete account entry receive deterministic supporting assignments in `plan.ts`. The prototype's decorative aggregate totals are not treated as additional unnamed people.

## Synthetic supporting history

The reference instant is 26 October 2026 at 12:00 WAT. Weeks start on 5, 12, 19 and 26 October. Weeks 41 through 43 have frozen full rosters, including zero task people, group roles, missing submitters and people on full leave. Week 44 remains open. Date fields store calendar dates; event instants retain UTC offsets.

* Damilola transfers from Nneka and Outsourcing to Tunde and Resourcing on 14 October at 12:00 WAT. Week 41 retains Nneka, Week 42 uses the final assignment before freeze, and an old pending submission routes to Tunde while preserving its original assignment.
* Tosin joins on Wednesday 21 October at 12:00 WAT. Any part of a workday counts, giving three expected days that week.
* Grace is deactivated on 26 October at 09:00 WAT. Her frozen Week 43 record remains expected with zero tasks.
* Ada has one day of leave in Week 43, so four expected workdays remain. Femi is away for all five days and is excluded from expected participation.
* Supporting Ada history includes a late approval counted in its original week, a decline and changed resubmission snapshot, and three linked Week 44 carry records across the cast. A manager automatic approval and Tunde acting as historical relief for Nneka exercise both decision methods.
* The expired Ada unlock is retired before a replacement is inserted. Both records remain. A separate unit unlock exercises scoped targeting.
* Notification timestamps, read state and audit examples illustrate the model. They do not claim that reminder jobs, email sending or workflow APIs already exist.

## Independent expected projections

`npm run db:verify` queries PostgreSQL and compares these Week 43 expectations. Completion excludes Awaiting approval and Cancelled from the denominator.

| Scope | Expected people | Submitted people | Tasks | Approved | Eligible tasks |
|---|---:|---:|---:|---:|---:|
| Ada | 1 | 1 | 9 | 3 | 7 |
| Tunde's team | 15 | 5 | 24 | 7 | 18 |
| Resourcing director | 15 | 5 | 24 | 7 | 18 |
| Executive | 20 | 5 | 24 | 7 | 18 |
| HR / Admin | 20 | 5 | 24 | 7 | 18 |
| Outsourcing director | 5 | 0 | 0 | 0 | 0 |

Week 44 has 20 expected employees and three submitted trackers, all from carry. The verifier compares record fingerprints before and after reseeding, probes 23 invalid writes inside a rolled back transaction, and checks frozen metrics after a temporary deactivation. It expects the clean sample database, before later feature work changes these examples.
