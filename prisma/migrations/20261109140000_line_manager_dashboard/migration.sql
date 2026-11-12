BEGIN;

ALTER TABLE public."Notification" ADD COLUMN IF NOT EXISTS "workWeekId" TEXT;
CREATE INDEX IF NOT EXISTS "Notification_workWeekId_idx" ON public."Notification" ("workWeekId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."Notification"'::regclass AND conname = 'Notification_workWeekId_fkey') THEN
    ALTER TABLE public."Notification" ADD CONSTRAINT "Notification_workWeekId_fkey"
      FOREIGN KEY ("workWeekId") REFERENCES public."WorkWeek" (id) ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.workforce_check_reminder_target() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF (NEW.kind = 'WORK_REMINDER') IS DISTINCT FROM (NEW."workWeekId" IS NOT NULL)
    OR (NEW."workWeekId" IS NOT NULL AND
      (NEW."weeklyTaskId" IS NOT NULL OR NEW."approvalRequestId" IS NOT NULL OR
       NEW."leaveId" IS NOT NULL OR NEW."reliefAssignmentId" IS NOT NULL)) THEN
    RAISE EXCEPTION 'Invalid notification workweek target' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS notification_reminder_target ON public."Notification";
CREATE TRIGGER notification_reminder_target BEFORE INSERT ON public."Notification"
  FOR EACH ROW EXECUTE FUNCTION public.workforce_check_reminder_target();

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid = 'public."SharedMutationReceipt"'::regclass
      AND conname = 'shared_receipt_operation_hash' AND pg_get_constraintdef(oid) LIKE '%LM_TASK_COMMENT%'
  ) THEN
    ALTER TABLE public."SharedMutationReceipt" DROP CONSTRAINT IF EXISTS shared_receipt_operation_hash;
    ALTER TABLE public."SharedMutationReceipt" ADD CONSTRAINT shared_receipt_operation_hash CHECK (
      ("operation" IN ('EMAIL_PREFERENCE', 'NOTIFICATION_READ', 'NOTIFICATIONS_READ_ALL', 'LM_REMIND', 'LM_TASK_COMMENT')
        AND "requestHash" IS NOT NULL AND "requestHash" ~ '^[0-9a-f]{64}$')
      OR ("operation" = 'PASSWORD_CHANGE' AND "requestHash" IS NULL)
    );
  END IF;
END $$;

COMMIT;
