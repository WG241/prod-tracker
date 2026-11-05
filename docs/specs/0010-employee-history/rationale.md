# Employee history reasoning

## Context

Feature 11 is the Employee's own historical work journey. Features 9 and 10 already provide owned task reads, current writes, strict freeze cutoffs and immutable roster columns. The seeded database contains captured historical examples, but ordinary newly closed weeks have no automatic capture process. Showing only a table would leave new history incomplete and future denominators biased toward task authors.

The final prototype supplies the History table, week/date controls and frozen drawer. Its page lacks the scope's status filter, although another history dialog supplies that control. The user approved reusing it and the shared failure/empty treatments. Existing Completed sample labels must follow the already accepted domain distinction between Awaiting approval and Approved.

Mutable names, account flags and organisation labels do not provide a full temporal history. Existing dated assignments and leave fields support some reconstruction, but cannot justify silently reusing every present day value for an overdue snapshot. The user chose conservative unavailable history with a separately reviewed repair.

## Options considered

### Only read existing captured history

This is the smallest page and API change and preserves the seeded examples. Its limitation is that each newly closed ordinary week would remain unavailable until another feature provided capture. The user chose to close that dependency here.

### History with capture in the existing app process

This reuses the existing Node process and PostgreSQL transaction boundaries without a service account or another provider. It captures full rosters and catches up after downtime. Its costs are scheduling, diagnostic and concurrency code, eventual availability and explicit refusal of uncertain old facts. This is the selected option.

### A separately scheduled capture worker

A separate worker can continue while the web process is suspended and gives operational isolation. It also requires a deployment and scheduling contract that this local Node application does not currently have. The user chose startup and minute checks in the existing process instead.

### Best effort historical backfill

Using today's account and label values could make more old rows immediately visible. It could also silently record a later name, status or reporting label as historical truth, with no evidence for intervening changes. The user explicitly rejected this fallback and an unrestricted rewrite interface.

## Rationale

The two added progress fields make the distinction between one person's valid history and a fully captured weekly roster explicit. Capturing each person atomically lets good records progress without claiming an incomplete denominator is complete. Existing immutable snapshot fields and natural keys supply retry identity, so no parallel task or history store is needed.

Read Committed with ordered owner/week locks carries forward Feature 10's correction: a fresh clock after a lock wait must be paired with fresh statement snapshots. One process guard limits local work; database locks and existing uniqueness protect competing processes and operator retries.

The strict source timestamp rule favors evidence over availability and may conservatively reject harmless later profile edits. That is intentional under the user's confirmed repair policy. A separately reviewed repair can establish missing facts; the safe command only diagnoses or retries the normal trusted capture path.

The user confirmed all frozen weeks, valid zero task weeks, the two field model, a separate History endpoint, continued application availability during catch-up, shared state treatments, diagnostics/safe retry only, and no separate References section. No new provider or runtime secret was selected.

## Independent cross check

The user requested another model and approved its recommended fixes. The review identified completion membership races, insufficient assignment/leave provenance, unbounded coverage/completion phases, ambiguous date-filtered availability and unclear scoped CLI results. The spec now provides a short assignment table fence plus enforced historical source guards, a protection start source in the immutable initialization audit, budgets and fair cursors for all phases, a conservative availability union, explicit selected-week states and bounded selector-specific CLI results.

Protection cannot be retroactively proved by installing guards today. Existing valid individual snapshots remain authoritative, while uncaptured people and unproven whole rosters from before the protection start require separate review. This is the confirmed conservative repair policy, with no additional data model or rewrite interface. The brief completion table fence can delay HR assignment writes; its tight lock wait and transaction bounds limit that cost.

A follow-up read confirmed the revised completion, fairness, availability and CLI semantics. It also tightened the implementation of the approved protections: source guards must serialize owners before their final clock check, duplicate seed writes must not bypass a guard through an unlocked existence check, and the current week must be committed before initialization can serve as protection evidence. Historical test setup remains isolated under exclusive locks, while runtime behavior tests exercise fully enabled guards.
