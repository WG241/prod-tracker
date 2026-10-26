# Epic: Line Manager

Second user group after Employee. Approvals and team views depend on Employee task and leave data.

## Line Manager

### 16. Line Manager dashboard · needs a decision
Manager dashboard: team submission and approved completion metrics, employees yet to submit, and week context.
**Done when:** Line Manager sees live aggregates for their direct reports from the DB for the open week, including empty team states.
- [ ] Design it (spec): `/architect line manager dashboard`

### 17. Line Manager my tasks · needs a decision
The manager's own weekly tasks with the same lifecycle patterns as Employee where the prototype allows managers to own work.
**Done when:** Line Manager can manage their own task list against the DB without seeing other managers' private drafts incorrectly.
- [ ] Design it (spec): `/architect line manager my tasks`

### 18. Team history · needs a decision
History of the team's past weeks, filterable by person and status.
**Done when:** Line Manager can review prior week team tasks for direct reports only.
- [ ] Design it (spec): `/architect team history`

### 19. Approvals · needs a decision · Beta
Approve or decline awaiting work, grouped by employee, with comments; overdue threshold awareness from settings.
**Done when:** Line Manager can clear the awaiting queue for their team; approve and decline persist; Employee sees the outcome; in app and email alerts fire.
- [ ] Design it (spec): `/architect approvals`

### 20. Line Manager leave · needs a decision
Leave visibility and actions for the manager's own leave and team leave as shown for this role in the prototype.
**Done when:** Line Manager can handle the leave flows the prototype gives this role, with DB persistence and notifications to Employee and HR where required.
- [ ] Design it (spec): `/architect line manager leave`
