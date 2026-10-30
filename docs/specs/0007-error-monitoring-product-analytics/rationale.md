# Reasoning for 0007

## Context

The service currently emits isolated sanitized console messages, and the browser has a health request but no crash boundary or analytics. Employee and Line Manager task workflows are planned, not built. This foundation must make errors inspectable now without inventing the later workflows or treating sample events as their completion.

Workforce data includes employee identity and work content. Aggregate role usage does not require recording those details. Required AuditEvent writes and database reporting already have different ownership and stronger guarantees than diagnostic telemetry.

## Options considered

### Local rotating files and CLI

This avoids another service and remains useful when PostgreSQL is unavailable. It requires bounded buffering, file maintenance and local operator inspection. The user chose this initial approach (basis: existing single Node service, official Node filesystem/stream guidance).

### Hosted monitoring and analytics

Hosted products could supply dashboards, retention, alerts and deeper diagnostics. They require provider, account, data destination and delivery choices the user explicitly deferred. No hosted SDK, account or credential is introduced.

### Database analytics with durable outbox

A transactional outbox could retain committed event intent and retry delivery. It adds schema and dispatch behavior, and requires a clear deduplication contract. The user chose nonblocking best effort instead, preserving business/audit truth separately.

## Rationale

The user confirmed JSON Lines sinks, aggregate role visits/completed actions without people tracking, 30 days and a 100 MB cap, best effort delivery, fixed codes/sanitized locations, and the local record model. The build spec states the decimal total cap and binary segment/buffer limits explicitly rather than mixing ambiguous file size labels.

Submission means a committed approval request. Late approval compares the persisted decision instant with the original week freeze, distinct from overdue request age or task end date. Human and automatic outcomes share one event with separate method/timing buckets, avoiding double-counting late approvals.

React reporting callbacks cover its supported error paths; a native class boundary is the narrow API exception needed for the approved recovery UI. Event/ordinary async failures require their own capture points. Native file backpressure and one serialized writer keep best effort observability from becoming an unbounded application dependency (basis: official React, Node and Express documentation).

The user explicitly retained the real workflow completion requirement. Local synthetic fixtures prove contracts only. Feature 8 remains open until the Employee/manager implementations, including manager own completion, emit runtime records from actual committed actions.

### Independent cross check

An independent model reviewed the draft on 2026-10-28 and found one material privacy gap. Forwarding an original exception after response headers are sent can reach Express's default logger, which prints raw messages/stacks outside test mode. Local evidence was the installed Express application default logger and finalhandler's scheduled logging before connection termination. The user approved a controlled sanitized terminal handler, canary checks of stderr/client/JSONL output in development and compiled production, and explicit suppression of Node's default raw fatal logging. The revised build spec records these contracts. No further material blockers were found in file bounds, event sources, authentication dependencies or the actual workflow completion gate. This review is design evidence, not runtime verification or final spec acceptance.

## References

**Project sources**: root/server AGENTS.md, scope Feature 8, specs 0001 through 0006, existing health/error handling, current Prisma approval/week model, and the prototype's card/button patterns. The fallback composition is an explicit user approved exception to the prototype page rule.

**Checked official sources**:

1. [React Component](https://react.dev/reference/react/Component), native boundary behavior and limitations.
2. [React createRoot](https://react.dev/reference/react-dom/client/createRoot), caught/uncaught/recoverable error callbacks.
3. [React 19 upgrade guide](https://react.dev/blog/2024/04/25/react-19-upgrade-guide), changed reporting behavior.
4. [Node 24 filesystem](https://nodejs.org/download/release/latest-v24.x/docs/api/fs.html), asynchronous filesystem access and concurrent modification limits.
5. [Node 24 streams](https://nodejs.org/download/release/latest-v24.x/docs/api/stream.html), write buffering, drain and errors.
6. [Node 24 process](https://nodejs.org/download/release/latest-v24.x/docs/api/process.html), fatal exception and exit behavior.
7. [Express error handling](https://expressjs.com/en/guide/error-handling/), async handler propagation and headers already sent.

No runtime implementation, dependency install or visual prototype comparison was completed during this design step.
