# Notification reasoning

## Context

The database already stores completion and leave notifications, and shared role shells have a disabled bell. The prototype supplies an unread tray, selection rows, Mark all and an empty state, but no large-list controls. Later manager and HR destination workflows remain unbuilt.

## Options considered

1. Latest-only unread tray. Smallest interface, but permanently strands older unread messages beyond its limit.
2. Paginated unread tray with shared receipts and a typed target registry. Reuses the prototype and real event records, with added pagination and explicit unavailable targets. Chosen.
3. Full inbox/read archive with a new page. Better historical browsing, but adds a product surface absent from the prototype and outside the confirmed scope.
4. Real-time connection. Faster arrival updates, but adds connection lifecycle and server work without a stated low-latency requirement. Foreground summary checks are sufficient here.

## Rationale

The engineer chose selection-as-read, all-unread batch semantics, protection of later arrivals under retry, retained older-role messages and current target checks. Those rules require receipts and a clear recipient arrival boundary; a bare repeated UPDATE would incorrectly read newly arrived messages after response loss.

Approval request linkage identifies the immutable attempt instead of reinterpreting a task notification after resubmission. Existing domain keys can prove some legacy links; ambiguous ones must remain unavailable. A closed registry also prevents arbitrary stored routes or unknown kinds from bypassing authorization or being treated as mandatory email.

## Confirmed integration and UI

The engineer approved 25-row pagination within the existing tray, shared failure states and visible 30-second count refreshes. Existing task-completion/leave and new account-security events are the first producers. Later workflows supply their own actions and hooks; automatic weekly reminders are deferred. In app notifications stay on regardless of the email toggle.

The ownership/receipt/approval relationship model was confirmed on 3 November 2026. This design reuses the same User mutex, PostgreSQL session authority, safe errors and actor-bound operation lifetime as earlier work. It does not implement new manager, director, Executive or HR business pages.
