# Email alert reasoning

## Context

Notification and EmailDelivery records already exist, but seeded deliveries are Suppressed and no mail provider/worker is configured. Current completion and leave actions already commit real in app events. The engineer requested a design for shared features only, with no provider connection, credentials, sending or development in this pass.

Safe testing matters because the fixtures use fictional staff identities. Message text is internal business data. The sender must not equate database commit, provider acceptance and inbox delivery, or convert retry after a lost acknowledgment into a fresh send.

## Options considered

1. Send synchronously from each domain handler. Fewest components, but provider failure/latency couples to business success and cannot atomically coordinate email with PostgreSQL.
2. PostgreSQL outbox and Resend HTTP in the existing app. Adds leases/snapshots and operational states, but fits the current process and provides documented bounded provider idempotency. Chosen.
3. Approved organizational SMTP with Nodemailer. Reuses an existing relay where available, but SMTP acknowledgment/message id is not a deduplication guarantee after response loss.
4. External queue and separate worker service. Independent scaling, but another service/deployment without a demonstrated need at this volume.

## Rationale

Official provider/transport documentation was checked on 3 November 2026. Resend documents a 24-hour idempotency period and owned sender-domain setup. An acceptance id is not proof of inbox delivery. SMTP has no general equivalent deduplication guarantee. These facts support the selected fixed-payload/key retry boundary; they do not establish organizational approval or credentials, which remain operator prerequisites.

The engineer chose Resend, explicit Off/Preview/Catch-all/Live modes, plain text, an in-app worker and bounded retries followed by Uncertain. Workflow mail obeys preferences and leave; security notices bypass those two rules. All recipients are rechecked, old events are not backfilled, and workflow/security age limits are 24 hours/seven days. Signed delivery/bounce webhooks are explicitly deferred, so this feature reports send/worker failure and provider acceptance only.

Preview-first composition follows the project's Facade variant without treating a fake Sent row as proof. Catch-all makes a controlled external test possible without mailing fictional staff addresses. Live arming and an explicit address-domain policy make production intent reviewable, while durable snapshots ensure retries do not change destination/content after a profile or task edit.

## Confirmed model and tooling

The engineer confirmed the shared target model and durable delivery claim fields, explicit delivery states and immutable message snapshots. Optional Resend Agent Skills/MCP discovery is deferred, not declined permanently. No new package is necessary for the HTTP send adapter; development may use the already selected Node fetch and existing test runner/provider boundary injection.

An independent model cross check found three material gaps. The engineer approved all recommended fixes: retain firstUncertainAt across later rejection or policy stops, freeze the original recipient basis, and define initial approval mail without depending on the unbuilt Feature 19 policy. A timeout followed by rejection cannot prove the first request was not accepted. A manager who becomes HR cannot reuse a different relationship for an older message. Initial approval mail therefore stays with a still-current permanent manager in the recorded business, while relief routing remains an explicit later integration.

The required security/account semantics come from spec 0013, event/recipient ownership from 0014, and the bounded sanitized monitoring boundary from spec 0007. Email state is operational evidence; it never grants a task permission, changes a frozen snapshot or rewrites the domain event.
