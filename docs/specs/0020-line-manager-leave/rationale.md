# Manager leave reasoning

## Context

The prototype has manager-owned leave, required relief selection and a leave history with recorded officers. Employee leave already provides strict dates, history guards and atomic receipts. Existing relief rows are dated and referenced by decisions, but no manager grant/revoke service exists.

## Options considered

1. Edit the same relief row when dates/officer change. Fewer rows, but changes what an earlier immutable decision's referenced arrangement means.
2. End the old arrangement and append a replacement with owned receipts and immutable labels. More history rows, but preserves actual authority and supports stale-form conflicts. Chosen.
3. Delegate all leave/cover changes to HR. Central control, but contradicts the prototype's self service manager form.
4. Grant full covered-team scope to relief. Easier generic browsing, but exposes private drafts/history beyond the chosen pending-review job.

## Rationale

The engineer chose full initial cover, multiple simultaneous covered managers per officer, narrow pending-review scope, immediate revocation with warnings, and bounded shorter replacement intervals. Incoming obligations must be resolved before overlapping own leave. Those rules need both sides locked and validated, not just an available-name dropdown.

Owner, officer, current director and HR receive real atomic messages. Missing optional recipients warn rather than losing the business event. New display snapshots preserve names/business labels without fabricating legacy history. Scheduled, cover editing, pagination and shared recovery controls were explicitly approved; no new team leave administration or sidebar is inferred.
