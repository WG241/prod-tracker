# Employee task APIs

Root and server AGENTS.md apply. Specs 0008, 0009, 0010 and 0011 govern this area. GET `/api/employee/home`, GET `/api/employee/history`, GET `/api/employee/leave` and GET `/api/employee/tasks/:taskId` project owned records. Feature 10 adds separate create, edit, status, carry, comment and delete endpoints. Feature 12 adds separate leave create, cancel and return operations. No read creates a week, tracker or other domain record.

`router.ts` uses the real auth service, forwards session cookies, enforces the existing origin policy and Employee role, and sends no store responses with fixed error messages. `reads.ts` rechecks current employment inside a Repeatable Read transaction. Every task predicate includes both ownerId and tracker.userId. Missing, hidden and other owned task ids share one 404 response.

`calendar.ts` validates date only selections in years 0001 through 9999, Monday weeks, inclusive ranges of at most 366 days and safe positive pages. Use the Africa/Lagos calendar helpers. Existing weeks retain persisted cutoffs; missing weeks derive settings without writes. Only current weeks before freeze may open. Applicable scoped unlocks never override freeze or future weeks. Leave union and planning openness remain separate facts.

Task and attention counts cover the full selection. Each list and comment page contains at most 25 rows. Count before calculating offsets; an out of range page has no offset query, including Number.MAX_SAFE_INTEGER. Queries within a transaction run in sequence.

Frozen details require snapshotAt and validated version 1 recorded owner and reporting labels. Never replace them with current labels. Latest review evidence comes from the highest attempt, and automatic decisions identify System. Return safe display fields, never raw snapshots or credentials.

`npm run test:employee` uses the explicit separate TEST_DATABASE_URL. Its stable fixtures are created atomically and evidence is never rewritten. The ordinary Neon development database is not a test fixture target.

`write-router.ts` applies exact Origin, Fetch Metadata, JSON, field, body size and persistent user/IP limits. The private auth result supplies an internal persisted session id that never appears in public SessionContext.

`writes.ts` uses Read Committed transactions, an owner User mutex, explicit permission and task locks, a fresh clock after waits, and at most three attempts for deadlocks or natural key races. Future manager and HR writers must follow the same owner, permission, week, source task, continuation order. Read checks use the same calendar facts.

Every successful command, including no change, commits one immutable user/UUID receipt. Its digest includes the supplied revision. Direct content changes increment task revision; comments and source controlled continuation visibility do not. A failed request commits no domain evidence. Submission notification and audit commit with the request, and telemetry runs only after a new commit.

Carry creates only the immediate next week, preserves independent content, and only hides or restores a revision zero Pending continuation without edits, comments, review history or children. Delete hides only its source. Planning closure blocks carry and delete; freeze and leave block all writes. Approved tasks permit current conversation only.

`npm run test:employee:lifecycle` exercises the real separate test database. `npm run test:employee:app` starts an isolated production app on port 3001, or development on 3002 with `-- --dev`, after a build. The lifecycle browser suite is restricted to those ports and uses guarded TEST_DATABASE_URL fixtures.

History validates one shared version 1 snapshot shape before counting or paging. Valid own snapshots remain readable independently of whole roster completion. Uncertain or corrupt weeks contribute scoped availability, including long task overlap, rather than invented history. Week labels use the ISO week year.

`history-capture.ts` owns independent atomic initialization, person and whole roster units. Use database epochs for the fresh clock after waits. Capture preserves existing valid evidence; legacy uncaptured facts before the immutable protection audit require reviewed repair. Completion uses a short assignment table SHARE fence before the week lock. Source triggers protect frozen assignment and leave contributions even before capture completes.

`history-worker.ts` admits coverage, person and completion units within one 20 second budget with independent 10/50/5 caps and advancing cursors. It runs at startup and every minute, stops new units immediately on shutdown, and keeps ordinary serving available. A failed unit rolls back and backs off while unrelated work may progress; a database outage stops that pass. `scripts/history-capture.ts` provides private diagnostics and safe bounded retry only.

Use `npm run test:employee:history` and `npm run test:employee:history:browser`. Historical test arrangement alone may use `tests/helpers/historical-fixtures.ts`, which holds exclusive source table locks and restores its two source guards before committing. Never import that helper into application or operator code, or suspend audit/frozen snapshot guards.

`leave-state.ts` classifies owned current/upcoming periods for Leave, Home and writes. Ambiguous legacy periods block changes while Home preserves its union pause. Leave dates use an exclusive first day back. The owner mutex enforces one period; immutable leave receipts preserve exact results and warning codes under retry.

`leave-writes.ts` prelocks affected source weeks before its final clock and date check, then rechecks clock and authority after the guarded leave write. A changed WAT day rolls back and retries the whole unit, with three total attempts. Never bypass the existing source guard. Notifications, audit and receipt commit with each changed event; missing eligible manager/HR configuration warns while actual persistence failures roll everything back.

Leave recipient discovery fixes its candidate set, locks selected User and assignment rows and revalidates eligibility. No broad User table fence is used. Future manager/HR writers must share owner/source locking and preserve terminal events. Use `npm run test:employee:leave` and `npm run test:employee:leave:browser` on the explicit separate test database.
