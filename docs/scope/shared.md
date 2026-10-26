# Epic: Shared (all roles)

Cross role surfaces. Build once; every user group uses them. Prefer finishing in app notifications with the first role that needs alerts (Employee or Line Manager), then email once those events exist.

## Shared

### 13. Shared profile · needs a decision
Profile page for the signed in person: identity fields, role, business, unit, manager; notification preferences as in the prototype.
**Done when:** each role can open Profile, see correct seeded identity, and save preference toggles that persist in the DB.
- [ ] Design it (spec): `/architect shared profile`

### 14. In app notifications · needs a decision
Notification tray and unread state for events such as approvals needed, approved or declined work, leave updates, lock or unlock, and relief changes.
**Done when:** relevant actions create notification rows; each role sees only its events; mark read and read all work.
- [ ] Design it (spec): `/architect in app notifications`

### 15. Email alerts · needs a decision · Beta
Email for the same alert classes as in app (approve queue, decisions, leave, lock or unlock, relief). Local or staging safe sending.
**Done when:** triggering those events sends email to the right seeded addresses (or a catch all in local), and content matches the in app event; failures are visible in error monitoring.
- [ ] Design it (spec): `/architect email alerts`
