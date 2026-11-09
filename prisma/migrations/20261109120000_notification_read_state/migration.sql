BEGIN;

ALTER TABLE public."Notification" ADD COLUMN IF NOT EXISTS "approvalRequestId" TEXT;
ALTER TABLE public."SharedMutationReceipt" ADD COLUMN IF NOT EXISTS "targetNotificationId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "ApprovalRequest_id_weeklyTaskId_key"
  ON public."ApprovalRequest" (id, "weeklyTaskId");
CREATE UNIQUE INDEX IF NOT EXISTS "Notification_id_recipientId_key"
  ON public."Notification" (id, "recipientId");
CREATE INDEX IF NOT EXISTS "Notification_approvalRequestId_weeklyTaskId_idx"
  ON public."Notification" ("approvalRequestId", "weeklyTaskId");
CREATE INDEX IF NOT EXISTS "SharedMutationReceipt_targetNotificationId_userId_idx"
  ON public."SharedMutationReceipt" ("targetNotificationId", "userId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."Notification"'::regclass AND conname = 'Notification_approvalRequestId_weeklyTaskId_fkey') THEN
    ALTER TABLE public."Notification" ADD CONSTRAINT "Notification_approvalRequestId_weeklyTaskId_fkey"
      FOREIGN KEY ("approvalRequestId", "weeklyTaskId") REFERENCES public."ApprovalRequest" (id, "weeklyTaskId") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."Notification"'::regclass AND conname = 'notification_approval_task_required') THEN
    ALTER TABLE public."Notification" ADD CONSTRAINT notification_approval_task_required
      CHECK ("approvalRequestId" IS NULL OR "weeklyTaskId" IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."SharedMutationReceipt"'::regclass AND conname = 'SharedMutationReceipt_targetNotificationId_userId_fkey') THEN
    ALTER TABLE public."SharedMutationReceipt" ADD CONSTRAINT "SharedMutationReceipt_targetNotificationId_userId_fkey"
      FOREIGN KEY ("targetNotificationId", "userId") REFERENCES public."Notification" (id, "recipientId") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."SharedMutationReceipt"'::regclass AND conname = 'shared_receipt_notification_target') THEN
    ALTER TABLE public."SharedMutationReceipt" ADD CONSTRAINT shared_receipt_notification_target
      CHECK (("operation" = 'NOTIFICATION_READ') = ("targetNotificationId" IS NOT NULL));
    ALTER TABLE public."SharedMutationReceipt" DROP CONSTRAINT IF EXISTS shared_receipt_operation_hash;
    ALTER TABLE public."SharedMutationReceipt" ADD CONSTRAINT shared_receipt_operation_hash CHECK (
      ("operation" IN ('EMAIL_PREFERENCE', 'NOTIFICATION_READ', 'NOTIFICATIONS_READ_ALL')
        AND "requestHash" IS NOT NULL AND "requestHash" ~ '^[0-9a-f]{64}$')
      OR ("operation" = 'PASSWORD_CHANGE' AND "requestHash" IS NULL)
    );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.workforce_protect_notification() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Notification evidence is retained' USING ERRCODE = '23514';
  END IF;
  IF (to_jsonb(NEW) - 'readAt' - 'approvalRequestId') IS DISTINCT FROM (to_jsonb(OLD) - 'readAt' - 'approvalRequestId') THEN
    RAISE EXCEPTION 'Notification content is immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW."readAt" IS DISTINCT FROM OLD."readAt" AND (
    OLD."readAt" IS NOT NULL OR NEW."readAt" IS NULL OR NEW."readAt" < OLD."createdAt"
    OR NEW."readAt" > clock_timestamp()
  ) THEN
    RAISE EXCEPTION 'Notification read time is immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW."approvalRequestId" IS DISTINCT FROM OLD."approvalRequestId" AND (
    OLD."approvalRequestId" IS NOT NULL OR NEW.kind <> 'APPROVAL_REQUESTED'
    OR NEW."readAt" IS DISTINCT FROM OLD."readAt" OR NOT EXISTS (
      SELECT 1 FROM public."ApprovalRequest" r WHERE r.id = NEW."approvalRequestId"
        AND r."weeklyTaskId" = OLD."weeklyTaskId" AND r."assignedManagerId" = OLD."recipientId"
        AND OLD."deduplicationKey" = 'approval-requested:' || r.id
    )
  ) THEN
    RAISE EXCEPTION 'Notification approval link is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS notification_immutable ON public."Notification";
CREATE TRIGGER notification_immutable BEFORE UPDATE OR DELETE ON public."Notification"
  FOR EACH ROW EXECUTE FUNCTION public.workforce_protect_notification();

UPDATE public."Notification" n SET "approvalRequestId" = r.id
FROM public."ApprovalRequest" r
WHERE n.kind = 'APPROVAL_REQUESTED' AND n."approvalRequestId" IS NULL
  AND n."deduplicationKey" = 'approval-requested:' || r.id
  AND n."weeklyTaskId" = r."weeklyTaskId" AND n."recipientId" = r."assignedManagerId";

COMMIT;
