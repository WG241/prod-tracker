# Approval reasoning

## Context

Employee completion already records exact pending attempts and immutable submission snapshots. The prototype offers individual and per-Employee batch review, decision history and blockers. Permanent reporting can change, and dated cross-business relief must end promptly when leave/cover ends. Frozen roster context is not current approval authority.

## Options considered

1. Reuse broad current/historical task permission for decisions. Few helpers, but it either denies the new manager legitimate pending work or gives relief too much history.
2. Exact pending-review resolver with immutable decisions and atomic bounded commands. Requires explicit scope and transaction work but supports routing, late reviews and revocation. Chosen.
3. Client loop for Approve all. Simpler endpoint, but can partially approve unseen/stale work and complicates response-loss recovery.
4. Stop all reviews at freeze. Simplifies time gating but strands valid pending submissions and contradicts the accepted late-outcome model.

## Rationale

The engineer chose all pending weeks by default, narrow relief scope, actor leave pause, late outcomes and atomic displayed batches. Reusing existing request/decision evidence honors those choices without a new approval system. Canonical DECLINED follows the accepted data model despite the prototype's older In progress behavior.

The existing helper for relief reads is not a sufficient complete decision policy. The design supplies current source/covered/officer role checks, exact request binding and final time checks. Pending routing remains an explicit trusted HR transaction integration, never a mutating read. Visible badge polling is separate from deliberate list refresh to preserve focused rows.

An independent model cross check found one material completeness gap: the manager notification destination was still left unavailable by the shared dispatcher contract. The engineer approved explicit REVIEW_REQUEST and TEAM_TASK actions, fresh exact scope and actor-bound navigation/open intents. Owner messages keep OWN_TASK. The same correction retains permanent-manager alerts for all new Employee replies, while relief recipients and review links remain pending-request specific. No additional material blocker was identified by that targeted review; runtime proof remains for development.
