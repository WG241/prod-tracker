# Epic: Employee

Recommended first user group. Finish this epic (plus shared profile and notifications when they unblock the happy path) before Line Manager.

## Employee

### 9. Employee home and weekly board · needs a decision
Employee Home: week context, metrics, and the weekly task board or list for the open week, respecting tracker lock state from HR.
**Done when:** a signed in Employee sees this week's tasks from the DB, empty and locked states render clearly, and week navigation matches the prototype intent.
- [ ] Design it (spec): `/architect employee home and weekly board`

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
