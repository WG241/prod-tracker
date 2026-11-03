# Employee task lifecycle reasoning

## Context

Feature 9 exposes persisted work but intentionally keeps all writes unavailable. The existing weekly model separates carried records and preserves immutable review evidence. The Employee needs to change current work while respecting planning locks, leave and freeze, and a failed network response must not create a second task or submission.

The final prototype contains the required write surfaces. Its numeric progress action conflicts with the accepted status only model. The user approved replacing that one form with the existing small confirmation layout, plus existing error and button placements for retry and edit conflicts. They confirmed the lock, carry, pending review, date and text rules recorded in the build spec.

## Options considered

### Option 1: UI guards and ordinary database updates

This uses the fewest new records and can deliver the happy path quickly. Its cost is lost edits across tabs and duplicate create/comment/submission effects when the browser cannot tell whether a request committed. Disabling a button does not cover those failures.

### Option 2: Revision checks and durable mutation receipts

This adds a small explicit task version and a committed result per request. It protects stale forms and retry while keeping domain state, notification and audit atomic. Its cost is a migration, retained receipts, transaction ordering and extra failure handling. This is the selected approach.

### Option 3: Reuse timestamps and audit JSON as request receipts

This avoids a dedicated receipt table and keeps storage changes smaller. It couples operational replay to audit payload shape and needs extra care around timestamp precision and identifying true direct task edits. The user chose explicit revisions and a dedicated receipt model for clearer contracts.

## Rationale

The existing relational model already handles task ownership, weekly identities and review attempts. Extending it is less disruptive than inventing a parallel task store or background command service. Receipt uniqueness, natural task keys and transaction locks give a concrete recovery path after a lost response.

Independent continuation content preserves the record of what was carried. Reusing its identity when undo is reversed respects the existing series/tracker uniqueness rule and preserves creation evidence. Restricting undo to a proven untouched row protects later work.

Employee completion must remain a request for review. Routing, notification and audit belong with that request in the same commit, while local analytics is a best effort observation after commit. A receipt replay is an observation of an earlier commit, not a new business event.

Keeping the existing stack avoids another provider, deployment process or secret. The feature remains one Employee workflow. Manager decisions, actual notification consumption, email and frozen roster processing each have separate ownership and are not made to look complete by this write slice.

## Independent cross check

The user requested another model to inspect decision completeness. It identified four interactions: inherited long dates versus closed planning edits, mandatory receipts for no change outcomes, carry withdrawal of pending reviews, and operation ownership after a modal closes. The user approved all recommended fixes. The build spec now names each exception and its regression case, including the revision in the request digest and keeping unresolved intent above modal lifetime.

During implementation, the user approved replacing Serializable isolation with Read Committed and explicit permission locks. A Serializable snapshot may predate a person lock wait, so capturing a later clock alone cannot make its permission reads fresh. Read Committed sees changes committed during the wait. The owner mutex and session, assignment, leave, settings, week, unlock and task locks protect the records checked through commit. Completion also locks the manager User for update to prevent a new assignment through its foreign key while routing is checked. A regression commits leave during the owner lock wait and proves the waiting command rejects it.
