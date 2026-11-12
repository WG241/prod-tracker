BEGIN;

CREATE OR REPLACE FUNCTION public.workforce_reject_closed_review_write()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE closed_at TIMESTAMPTZ; task_key TEXT;
BEGIN
  -- Keep the expressions separate because these triggers receive different row types.
  IF TG_TABLE_NAME = 'ApprovalRequest' THEN
    task_key := CASE WHEN TG_OP = 'DELETE' THEN OLD."weeklyTaskId" ELSE NEW."weeklyTaskId" END;
  ELSE
    SELECT r."weeklyTaskId" INTO task_key FROM public."ApprovalRequest" r
    WHERE r.id = CASE WHEN TG_OP = 'DELETE' THEN OLD."requestId" ELSE NEW."requestId" END;
  END IF;
  SELECT w."rosterCapturedAt" INTO closed_at
  FROM public."WeeklyTask" t
  JOIN public."WeeklyTracker" r ON r.id = t."trackerId"
  JOIN public."WorkWeek" w ON w.id = r."weekId"
  WHERE t.id = task_key;
  IF closed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Closed weekly history review cannot be rewritten' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

COMMIT;
