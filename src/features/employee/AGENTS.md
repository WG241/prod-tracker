# Employee Home

Root AGENTS.md applies. Match the final Employee Home List and Card views, week controls, attention card, date picker and task drawer in the approved HTML prototype. Specs 0008 and 0009 govern behavior. Current task controls use server capabilities and real operation endpoints; leave controls remain deferred.

`contracts.ts` is browser safe and carries only response types, canonical status labels and selection state. Server clients and credentials never belong here. AuthApp keeps nonprivate selection and anchor state across session revalidation, while unmounting all private Home and drawer data. A new identity gets a fresh selection.

`useEmployeeRead` owns native fetch cancellation and sequence checks. A changed URL never renders old period data. Same selection refresh failures retain rows and their original asOf together with a stale notice. Returned nextChangeAt schedules a refresh and stale permissions close conservatively until success. There is no polling or private browser storage.

Initial selection comes from the server calendar and becomes a fixed Monday anchor. Previous and Next clear a range and move from that anchor. Applying a range leaves the anchor unchanged. List and Card preserve selection and page. Period changes close the drawer and reset both page controls and attention dismissal.

Use the shared native Dialog and Drawer. The read only task record is a named focusable region so an overflowing body remains keyboard scrollable even when its buttons are disabled. Date errors use the shared form validation helper. Root and modal announcements stay in their appropriate shared hosts.

`npm run test:employee:browser` exercises the running app using the fictional Employee credential from LOCAL_AUTH_TEST_PASSWORD. EMPLOYEE_BASE_URL selects a loopback origin, and EMPLOYEE_TARGET names the evidence folder in `.local/verification/feature9/`. Reports exclude credentials and browser storage. Automated axe and viewport checks do not establish actual NVDA or native browser zoom evidence.

`TaskOperations` lives in AuthApp above workspace and modal lifetime. An unresolved operation retains its UUID, normalized submitted intent and original revision in memory. Reopening reconnects to it; retry cannot change its intent. Foreground revalidation withholds private views, same actor reauthorization retains the operation, and sign out or identity/role changes clear records and invalidate callbacks.

`TaskActionDialog` coordinates one modal at a time, including retained edits through blocker and completion confirmation. Carry acts directly from the prototype actions; its recovery uses the approved banner pattern. A confirmed commit refreshes Home and a matching drawer. A failed refresh reports saved work separately, and an empty last page is repaired explicitly. Never silently resubmit a draft against a newer revision.

`test:employee:lifecycle:browser` uses isolated ports 3001 and 3002, real test database fixtures, and checks completion, carry, comment, delete, unknown outcome retry, explicit conflict reload and page repair. Actual NVDA and native zoom evidence remain separate.
