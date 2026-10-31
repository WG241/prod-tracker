# Epic: Employee

Recommended first user group. Finish this epic (plus shared profile and notifications when they unblock the happy path) before Line Manager.

## Employee

### 9. Employee home and weekly board · in-progress
Employee Home: week context, metrics, and the weekly task board or list for the open week, respecting tracker lock state from HR.
**Done when:** a signed in Employee sees this week's tasks from the DB, empty and locked states render clearly, and week navigation matches the prototype intent.
- [x] Design it (spec): `/architect employee home and weekly board`
- [ ] Build it: `/develop employee home and weekly board`
  - [ ] Confirm the built shared shell and authentication prerequisites, and obtain approved visual prototype references (AC-1, AC-5, AC-8, AC-9).
  - [ ] Compose the final prototype List and Card views, date controls, attention section, read only drawer, and approved states (AC-1 through AC-6, AC-8).
  - [ ] Implement the two guarded read endpoints, calendar and lock projections, ownership checks, and pagination on the existing database model (AC-2 through AC-5, AC-7, AC-8).
  - [ ] Connect live data with cancellation, boundary refresh, stale states, and session handling (AC-2 through AC-8).
- [ ] Verify it: `/check verify employee home and weekly board`

spec [0008](../specs/0008-employee-home-weekly-board.md) · code pending · prerequisites: built Features 4 and 6, plus approved visual prototype inspection. The accepted design follows the final List and Card screen without the superseded board or metric cards. Task changes remain in Feature 10.

### 10. Employee task lifecycle · needs a decision
Create and edit tasks, update progress, mark complete for approval, carry tasks, cancel or hold where the prototype allows, with comments.
**Done when:** Employee can take a task from creation through awaiting approval against seeded or new rows; invalid edits while locked are blocked with a clear message.
- [ ] Design it (spec): `/architect employee task lifecycle`

### 11. Employee history · needs a decision
Past weeks of the Employee's own work with status filters, read only when the week is closed.
**Done when:** Employee can browse prior weeks' tasks from the DB and open task detail without editing closed history.
- [ ] Design it (spec): `/architect employee history`

### 12. Employee leave · needs a decision
Request leave, see status, and understand relief officer impact for the Employee's own absences.
**Done when:** Employee can submit a leave request stored in the DB, see it listed, and get in app (and later email) confirmation of the request path from the prototype.
- [ ] Design it (spec): `/architect employee leave`
