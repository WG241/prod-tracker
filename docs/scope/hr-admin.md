# Epic: HR / Admin

Fifth user group. Finish after the operating roles so controls and admin land on real task and leave traffic. Highest concentration of sensitive controls.

## HR / Admin

### 29. HR dashboard · needs a decision
HR overview of participation, lock state, overdue approvals, and leave or relief signals for the open week.
**Done when:** HR sees org wide operational metrics from the DB that match the prototype's HR home intent.
- [ ] Design it (spec): `/architect hr dashboard`

### 30. Organisation admin · needs a decision
Manage businesses and units (add, rename) for Workforce Group structure.
**Done when:** HR can create and edit businesses and units persisted in the DB; Employee and leader scopes update accordingly.
- [ ] Design it (spec): `/architect organisation admin`

### 31. Employees admin · needs a decision · Beta
List and manage employees: role, business, unit, manager, active or on leave; add and edit person forms.
**Done when:** HR can add and update people in the DB; role changes alter nav and data scope on next sign in; unsafe deletes are blocked or confirmed.
- [ ] Design it (spec): `/architect employees admin`

### 32. Tracker controls · needs a decision · Beta
Planning lock, timed unlocks, extend unlock, and relock; live countdown as in the prototype.
**Done when:** HR can lock and unlock the tracker with persisted windows; Employees cannot edit while locked; unlock expiry returns to locked; alerts notify affected roles.
- [ ] Design it (spec): `/architect tracker controls`

### 33. Leave and relief admin · needs a decision
HR view of leave and relief officers: assign or edit relief, end relief, visibility across the org.
**Done when:** HR can manage leave and relief records in the DB; Employees and managers see the resulting coverage rules.
- [ ] Design it (spec): `/architect leave and relief admin`

### 34. HR performance records · needs a decision
Org wide performance records with export.
**Done when:** HR can filter and export group wide records from the DB.
- [ ] Design it (spec): `/architect hr performance records`

### 35. HR reports · needs a decision
Org wide reports with the prototype's scope options (person, unit, business, everyone) and formats.
**Done when:** HR can preview and download reports for each allowed scope from live data.
- [ ] Design it (spec): `/architect hr reports`

### 36. Audit log · needs a decision · GA
Append only (or tamper evident) log of sensitive actions: unlocks, role changes, org edits, approvals overrides if any; export.
**Done when:** listed admin and control actions write audit rows; HR can filter and export; entries show actor, time, and action.
- [ ] Design it (spec): `/architect audit log`

### 37. Tracker settings · needs a decision
Settings such as daily lock time and overdue approval threshold (days), persisted and enforced by tracker controls and approvals.
**Done when:** HR can save settings to the DB; lock schedule and overdue cues honor the new values after refresh.
- [ ] Design it (spec): `/architect tracker settings`
