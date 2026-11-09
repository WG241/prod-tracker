# 0014. Events, targets and read transactions

## Summary

Each notification is a retained message addressed to one recipient. Its kind determines a safe target and future email policy through a closed server registry. Read state is separate from target authorization and domain decisions.

## Registry and factory

Define one server-only constructor per registered event. Input values come from the domain transaction's persisted records and successful result. Return the created/existing Notification id, never a second delivery of the same event. Existing recipient/deduplication uniqueness is the natural key. If a row already exists, require identical immutable event fields; a mismatch is a fixed integrity failure that rolls back the domain command. Do not silently overwrite an old message.

| Kind | Recipient/source and natural key | Class / target |
| --- | --- | --- |
| PASSWORD_CHANGED | Account owner, `password-changed:<userId>:<requestId>` | SECURITY / Profile |
| APPROVAL_REQUESTED | Feature 10's resolved permanent reviewer; `approval-requested:<requestId>` | WORK / exact approval attempt, future manager handler |
| LEAVE_RECORDED | Feature 12's resolved owner/manager/HR; `leave:<id>:recorded` | LEAVE / owned Employee Leave, otherwise authorized future role handler |
| LEAVE_CANCELLED | Same event transaction's current recipient resolution; `leave:<id>:cancelled` | LEAVE / same target policy |
| LEAVE_RETURNED | Same event transaction's current recipient resolution; `leave:<id>:returned` | LEAVE / same target policy |

Do not expand an old event's recipient set after a configuration or role change. Domain replays create no new messages. Unknown legacy kinds use text/generic icon and no target/email eligibility. No input endpoint can choose SECURITY or bypass its preference rule.

Future contracts reserve APPROVAL_APPROVED/DECLINED for immutable decisions and the task owner, TASK_COMMENTED for a newly committed comment and its authorized recipient, TRACKER_LOCKED/UNLOCKED and WORK_REMINDER for the owning tracker control/reminder action, and RELIEF_ASSIGNED/ENDED for persisted relief changes. Their source features must supply stable event ids, per-recipient dedup keys, safe English snapshots, the appropriate existing target relation and a current authorization/eligibility handler. There is no generic broadcast fallback. Registering a kind alone does not implement its producer.

No task/leave/approval state changes occur in this factory. Spec 0015 adds a transactional email-enqueue hook to a newly inserted registered notification; an existing row/replay does not enqueue retrospectively. Its producers also supply the original recipient basis from their locked resolution, so the delivery can freeze OWNER/MANAGER/HR or ASSIGNED_REVIEWER evidence. Feature 12 retains this basis when deduplicating recipients; it is never reconstructed from message text or inferred through a later role.

## Message integrity and legacy links

New messages preserve recipient, kind, title/body, dedup key, target fields and creation time. Read state cannot clear or change a nonnull readAt. A nullable approvalRequestId can be normalized once only when the existing key/task/assigned-recipient proof identifies that exact request. After it is set it is immutable. Ambiguous legacy notifications remain readable with unavailable navigation; never guess a latest attempt to fill them.

The migration adds Notification uniqueness on `(id,recipientId)` for owned receipt references, and ApprovalRequest uniqueness on `(id,weeklyTaskId)` for the exact attempt/task FK. Index referencing FK columns. Existing message content/dates are unchanged; new constraint/trigger installation must not validate an invented target into old rows.

## Read transactions and retry

Use the User mutex, persisted session/identity/current assignment locks and fresh clock from spec 0013, then notification rows in deterministic id order. Reading all takes that recipient's User update lock before choosing eligible rows. Existing producers must hold a recipient User share lock while inserting; the FK check also coordinates inserts. The factory enforces recipient locking consistently, including new producers. A concurrent source command may need a known-rollback deadlock retry under the existing domain retry budget; no lost commit is retried blindly.

Canonical hashes are SHA-256 of fixed nonsecret structures: single `{operation:'NOTIFICATION_READ',notificationId}` or batch `{operation:'NOTIFICATIONS_READ_ALL'}`. Keys are User/UUID. Recheck current authority before receipt lookup. A matching receipt returns its original read result without executing the mutation predicate again; a mismatch is 409. This is what keeps a new arrival unread after a lost read-all response.

Single-read selects by both id and recipientId. A missing, other recipient or not-yet-available future-dated row is the same 404. Under locks, NULL readAt becomes the database action instant; an already read message retains its first timestamp and returns changed false. Record its owned targetNotificationId and safe result in the same receipt transaction.

Read-all captures a fresh database action instant after the recipient lock wait and conditionally updates every owned row with readAt NULL and createdAt <= that instant. Store changedCount and appliedAt, plus the receipt, atomically. New source inserts that commit after this recipient boundary remain unread. Do not limit the batch to the displayed page or use the client's clock.

Counts returned alongside results are freshly computed under current authority. The stored receipt does not freeze the current count. A command may return its old result with a new unreadCount; this is expected and must not trigger another batch write.

## Target resolution

Resolve the selected owned notification independently of the read result, including every replay. A stored successful target action must never be replayed as authorization. Use current session/role, current scope and the exact target row; return only a closed action, never arbitrary URLs or target content.

* Profile: current owner account, all roles.
* Employee Leave: only when leave.userId is the current Employee; the existing page shows current/upcoming state. Do not claim a past-leave detail surface exists.
* Own task: current Employee ownership, nonhidden task, matching tracker ownership and the existing current/frozen detail contract. Return its persisted tracker week and id. Frozen content remains validated by the existing detail endpoint.
* Approval: the exact request/task pair. Until Feature 19 provides its real authorized handler, return future destination unavailable, never open a guessed latest request. That feature must settle current reviewer/dated relief navigation authority. Spec 0015 separately defines an initial permanent-manager email eligibility check; it grants no target access and does not implement relief routing.
* Manager/HR leave and relief: require their current scope and a real handler supplied by the owning later feature. They are unavailable here.
* Tracker notices: later producers may target the currently authorized own tracker. No historical-week deep link is inferred from body copy.

The current implemented handler set is Profile, Employee Leave and owned Employee task detail. A role mismatch, changed assignment, hidden/missing row, unproven legacy link or unsupported kind returns a fixed UNAVAILABLE reason without target data. Message selection remains a successful read. A genuine dependency failure rolls back an uncommitted read rather than disguising it as a permanent unavailable target; after a committed read, downstream drawer failure is a separate read Retry.

## Rationale

Unread-only composition and selection-as-read come from the inspected prototype and confirmed answers. A recipient mutex plus command receipt gives the batch a clear arrival boundary and safe replay. Exact request links preserve the meaning of approval events, while fresh target resolution prevents historical messages from carrying old permissions forward.
