BEGIN;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid = 'public."SharedMutationReceipt"'::regclass
      AND conname = 'shared_receipt_operation_hash' AND pg_get_constraintdef(oid) LIKE '%LM_APPROVE_BATCH%'
  ) THEN
    ALTER TABLE public."SharedMutationReceipt" DROP CONSTRAINT IF EXISTS shared_receipt_operation_hash;
    ALTER TABLE public."SharedMutationReceipt" ADD CONSTRAINT shared_receipt_operation_hash CHECK (
      ("operation" IN ('EMAIL_PREFERENCE', 'NOTIFICATION_READ', 'NOTIFICATIONS_READ_ALL', 'LM_REMIND',
        'LM_TASK_COMMENT', 'LM_APPROVE', 'LM_DECLINE', 'LM_APPROVE_BATCH')
        AND "requestHash" IS NOT NULL AND "requestHash" ~ '^[0-9a-f]{64}$')
      OR ("operation" = 'PASSWORD_CHANGE' AND "requestHash" IS NULL)
    );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.workforce_reject_closed_week_write()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE closed_at TIMESTAMPTZ;
BEGIN
  SELECT w."rosterCapturedAt" INTO closed_at FROM public."WorkWeek" w
  JOIN public."WeeklyTracker" r ON r."weekId"=w.id
  WHERE r.id=CASE WHEN TG_OP='INSERT' THEN NEW."trackerId" ELSE OLD."trackerId" END;
  IF closed_at IS NOT NULL THEN
    IF TG_OP='UPDATE' AND OLD.status='AWAITING_APPROVAL' AND OLD."deletedAt" IS NULL
      AND NEW.status IN ('APPROVED','DECLINED') AND NEW.revision=OLD.revision+1
      AND (to_jsonb(OLD)-ARRAY['status','revision','updatedAt'])=(to_jsonb(NEW)-ARRAY['status','revision','updatedAt'])
      AND EXISTS (
        SELECT FROM public."ApprovalRequest" r JOIN public."ApprovalDecision" d ON d."requestId"=r.id
        WHERE r."weeklyTaskId"=OLD.id AND r.state='DECIDED' AND d.method='HUMAN'
          AND r."attemptNumber"=(SELECT max(a."attemptNumber") FROM public."ApprovalRequest" a WHERE a."weeklyTaskId"=OLD.id)
          AND ((NEW.status='APPROVED' AND d.decision='APPROVE') OR (NEW.status='DECLINED' AND d.decision='DECLINE'))
      ) THEN RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Closed weekly history cannot be rewritten' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF TG_OP='UPDATE' AND NEW."trackerId" IS DISTINCT FROM OLD."trackerId" AND EXISTS (
    SELECT FROM public."WeeklyTracker" r JOIN public."WorkWeek" w ON w.id=r."weekId"
    WHERE r.id=NEW."trackerId" AND w."rosterCapturedAt" IS NOT NULL
  ) THEN RAISE EXCEPTION 'Cannot move a task into closed weekly history' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.workforce_reject_closed_review_write()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE closed_at TIMESTAMPTZ; task_key TEXT;
BEGIN
  IF TG_TABLE_NAME='ApprovalRequest' THEN
    task_key:=CASE WHEN TG_OP='INSERT' THEN NEW."weeklyTaskId" ELSE OLD."weeklyTaskId" END;
  ELSE
    SELECT r."weeklyTaskId" INTO task_key FROM public."ApprovalRequest" r
    WHERE r.id=CASE WHEN TG_OP='INSERT' THEN NEW."requestId" ELSE OLD."requestId" END;
  END IF;
  SELECT w."rosterCapturedAt" INTO closed_at FROM public."WeeklyTask" t
  JOIN public."WeeklyTracker" r ON r.id=t."trackerId" JOIN public."WorkWeek" w ON w.id=r."weekId"
  WHERE t.id=task_key;
  IF closed_at IS NOT NULL THEN
    IF TG_TABLE_NAME='ApprovalRequest' THEN
      IF TG_OP='UPDATE' AND OLD.state='PENDING' THEN
        IF NEW.state='PENDING' AND (to_jsonb(OLD)-'assignedManagerId')=(to_jsonb(NEW)-'assignedManagerId')
          AND NOT EXISTS (SELECT FROM public."ApprovalDecision" d WHERE d."requestId"=OLD.id) THEN RETURN NEW;
        END IF;
        IF NEW.state='DECIDED' AND (to_jsonb(OLD)-'state')=(to_jsonb(NEW)-'state')
          AND EXISTS (SELECT FROM public."ApprovalDecision" d WHERE d."requestId"=OLD.id AND d.method='HUMAN') THEN RETURN NEW;
        END IF;
      END IF;
    ELSIF TG_OP='INSERT' AND NEW.method='HUMAN' AND NEW."decidedAt">=closed_at AND EXISTS (
      SELECT FROM public."ApprovalRequest" r JOIN public."WeeklyTask" t ON t.id=r."weeklyTaskId"
      WHERE r.id=NEW."requestId" AND r.state='PENDING' AND r."submittedAt"<=NEW."decidedAt"
        AND t.status='AWAITING_APPROVAL' AND t."deletedAt" IS NULL
        AND r."attemptNumber"=(SELECT max(a."attemptNumber") FROM public."ApprovalRequest" a WHERE a."weeklyTaskId"=t.id)
    ) THEN RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Closed weekly history review cannot be rewritten' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.workforce_check_closed_decision_outcome()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
  IF EXISTS (
    SELECT FROM public."ApprovalRequest" r JOIN public."WeeklyTask" t ON t.id=r."weeklyTaskId"
    JOIN public."WeeklyTracker" tr ON tr.id=t."trackerId" JOIN public."WorkWeek" w ON w.id=tr."weekId"
    WHERE r.id=NEW."requestId" AND w."rosterCapturedAt" IS NOT NULL
      AND (r.state<>'DECIDED' OR NOT ((t.status='APPROVED' AND NEW.decision='APPROVE') OR (t.status='DECLINED' AND NEW.decision='DECLINE')))
  ) THEN RAISE EXCEPTION 'Closed review decision requires its matching outcome' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS closed_decision_outcome ON public."ApprovalDecision";
CREATE CONSTRAINT TRIGGER closed_decision_outcome AFTER INSERT ON public."ApprovalDecision"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.workforce_check_closed_decision_outcome();

COMMIT;
