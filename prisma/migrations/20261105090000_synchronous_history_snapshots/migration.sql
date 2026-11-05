BEGIN;

CREATE TABLE IF NOT EXISTS public."HistoryWeekSnapshot" (
  "id" TEXT NOT NULL,
  "weekId" TEXT NOT NULL,
  "startsOn" DATE NOT NULL,
  "freezesAt" TIMESTAMPTZ(3) NOT NULL,
  "capturedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "HistoryWeekSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS public."HistoryPersonSnapshot" (
  "id" TEXT NOT NULL,
  "historyWeekId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "assignmentId" TEXT NOT NULL,
  "contextSnapshot" JSONB NOT NULL,
  "expectedWorkingDaysSnapshot" INTEGER NOT NULL,
  "snapshotAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "HistoryPersonSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS public."HistoryTaskSnapshot" (
  "id" TEXT NOT NULL,
  "historyWeekId" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "ownerName" TEXT NOT NULL,
  "title" VARCHAR(120) NOT NULL,
  "activity" TEXT NOT NULL,
  "startsOn" DATE NOT NULL,
  "endsOn" DATE NOT NULL,
  "status" "TaskStatus" NOT NULL,
  "blockerReason" TEXT,
  "carryRequested" BOOLEAN NOT NULL,
  "carriedFrom" BOOLEAN NOT NULL,
  "revision" INTEGER NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "HistoryTaskSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS public."HistoryCommentSnapshot" (
  "id" TEXT NOT NULL,
  "taskSnapshotId" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "authorName" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "HistoryCommentSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS public."HistoryReviewSnapshot" (
  "id" TEXT NOT NULL,
  "taskSnapshotId" TEXT NOT NULL,
  "attemptNumber" INTEGER NOT NULL,
  "state" "ApprovalState" NOT NULL,
  "submittedAt" TIMESTAMPTZ(3) NOT NULL,
  "decision" "DecisionKind",
  "method" "DecisionMethod",
  "reason" TEXT,
  "decidedAt" TIMESTAMPTZ(3),
  "reviewerName" TEXT,
  "coveredManagerName" TEXT,
  CONSTRAINT "HistoryReviewSnapshot_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public."HistoryWeekSnapshot"'::regclass AND conname='history_week_snapshot_week_fk') THEN
    ALTER TABLE public."HistoryWeekSnapshot" ADD CONSTRAINT history_week_snapshot_week_fk FOREIGN KEY ("weekId") REFERENCES public."WorkWeek"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public."HistoryWeekSnapshot"'::regclass AND conname='history_week_snapshot_week_unique') THEN
    ALTER TABLE public."HistoryWeekSnapshot" ADD CONSTRAINT history_week_snapshot_week_unique UNIQUE ("weekId");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public."HistoryPersonSnapshot"'::regclass AND conname='history_person_snapshot_week_fk') THEN
    ALTER TABLE public."HistoryPersonSnapshot" ADD CONSTRAINT history_person_snapshot_week_fk FOREIGN KEY ("historyWeekId") REFERENCES public."HistoryWeekSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public."HistoryPersonSnapshot"'::regclass AND conname='history_person_snapshot_unique') THEN
    ALTER TABLE public."HistoryPersonSnapshot" ADD CONSTRAINT history_person_snapshot_unique UNIQUE ("historyWeekId","userId");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public."HistoryTaskSnapshot"'::regclass AND conname='history_task_snapshot_week_fk') THEN
    ALTER TABLE public."HistoryTaskSnapshot" ADD CONSTRAINT history_task_snapshot_week_fk FOREIGN KEY ("historyWeekId") REFERENCES public."HistoryWeekSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public."HistoryCommentSnapshot"'::regclass AND conname='history_comment_snapshot_task_fk') THEN
    ALTER TABLE public."HistoryCommentSnapshot" ADD CONSTRAINT history_comment_snapshot_task_fk FOREIGN KEY ("taskSnapshotId") REFERENCES public."HistoryTaskSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public."HistoryReviewSnapshot"'::regclass AND conname='history_review_snapshot_task_fk') THEN
    ALTER TABLE public."HistoryReviewSnapshot" ADD CONSTRAINT history_review_snapshot_task_fk FOREIGN KEY ("taskSnapshotId") REFERENCES public."HistoryTaskSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public."HistoryReviewSnapshot"'::regclass AND conname='history_review_snapshot_unique') THEN
    ALTER TABLE public."HistoryReviewSnapshot" ADD CONSTRAINT history_review_snapshot_unique UNIQUE ("taskSnapshotId","attemptNumber");
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "HistoryWeekSnapshot_startsOn_idx" ON public."HistoryWeekSnapshot"("startsOn");
CREATE INDEX IF NOT EXISTS "HistoryPersonSnapshot_userId_snapshotAt_idx" ON public."HistoryPersonSnapshot"("userId","snapshotAt");
CREATE INDEX IF NOT EXISTS "HistoryTaskSnapshot_week_owner_idx" ON public."HistoryTaskSnapshot"("historyWeekId","ownerId");
CREATE INDEX IF NOT EXISTS "HistoryTaskSnapshot_week_starts_idx" ON public."HistoryTaskSnapshot"("historyWeekId","startsOn");
CREATE INDEX IF NOT EXISTS "HistoryCommentSnapshot_task_created_idx" ON public."HistoryCommentSnapshot"("taskSnapshotId","createdAt");
CREATE INDEX IF NOT EXISTS "HistoryReviewSnapshot_task_attempt_idx" ON public."HistoryReviewSnapshot"("taskSnapshotId","attemptNumber");

CREATE OR REPLACE FUNCTION public.workforce_reject_closed_week_write()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE closed_at TIMESTAMPTZ;
BEGIN
  SELECT w."rosterCapturedAt" INTO closed_at
  FROM public."WeeklyTracker" r
  JOIN public."WorkWeek" w ON w."id"=r."weekId"
  WHERE r."id"=CASE WHEN TG_OP='DELETE' THEN OLD."trackerId" ELSE NEW."trackerId" END;
  IF closed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Closed weekly history cannot be rewritten' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.workforce_reject_closed_comment_write()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE closed_at TIMESTAMPTZ;
BEGIN
  SELECT w."rosterCapturedAt" INTO closed_at
  FROM public."WeeklyTask" t
  JOIN public."WeeklyTracker" r ON r."id"=t."trackerId"
  JOIN public."WorkWeek" w ON w."id"=r."weekId"
  WHERE t."id"=CASE WHEN TG_OP='DELETE' THEN OLD."weeklyTaskId" ELSE NEW."weeklyTaskId" END;
  IF closed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Closed weekly history comments cannot be rewritten' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.workforce_reject_closed_review_write()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE closed_at TIMESTAMPTZ; task_key TEXT;
BEGIN
  task_key := CASE WHEN TG_TABLE_NAME='ApprovalRequest' THEN CASE WHEN TG_OP='DELETE' THEN OLD."weeklyTaskId" ELSE NEW."weeklyTaskId" END ELSE NULL END;
  IF TG_TABLE_NAME='ApprovalDecision' THEN
    SELECT r."weeklyTaskId" INTO task_key FROM public."ApprovalRequest" r WHERE r."id"=CASE WHEN TG_OP='DELETE' THEN OLD."requestId" ELSE NEW."requestId" END;
  END IF;
  SELECT w."rosterCapturedAt" INTO closed_at
  FROM public."WeeklyTask" t
  JOIN public."WeeklyTracker" r ON r."id"=t."trackerId"
  JOIN public."WorkWeek" w ON w."id"=r."weekId"
  WHERE t."id"=task_key;
  IF closed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Closed weekly history review cannot be rewritten' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS history_closed_task_guard ON public."WeeklyTask";
CREATE TRIGGER history_closed_task_guard BEFORE INSERT OR UPDATE OR DELETE ON public."WeeklyTask" FOR EACH ROW EXECUTE FUNCTION public.workforce_reject_closed_week_write();
DROP TRIGGER IF EXISTS history_closed_comment_guard ON public."TaskComment";
CREATE TRIGGER history_closed_comment_guard BEFORE INSERT OR UPDATE OR DELETE ON public."TaskComment" FOR EACH ROW EXECUTE FUNCTION public.workforce_reject_closed_comment_write();
DROP TRIGGER IF EXISTS history_closed_request_guard ON public."ApprovalRequest";
CREATE TRIGGER history_closed_request_guard BEFORE INSERT OR UPDATE OR DELETE ON public."ApprovalRequest" FOR EACH ROW EXECUTE FUNCTION public.workforce_reject_closed_review_write();
DROP TRIGGER IF EXISTS history_closed_decision_guard ON public."ApprovalDecision";
CREATE TRIGGER history_closed_decision_guard BEFORE INSERT OR UPDATE OR DELETE ON public."ApprovalDecision" FOR EACH ROW EXECUTE FUNCTION public.workforce_reject_closed_review_write();

DROP TRIGGER IF EXISTS history_week_snapshot_immutable ON public."HistoryWeekSnapshot";
CREATE TRIGGER history_week_snapshot_immutable BEFORE UPDATE OR DELETE ON public."HistoryWeekSnapshot" FOR EACH ROW EXECUTE FUNCTION public.workforce_reject_history_rewrite();
DROP TRIGGER IF EXISTS history_person_snapshot_immutable ON public."HistoryPersonSnapshot";
CREATE TRIGGER history_person_snapshot_immutable BEFORE UPDATE OR DELETE ON public."HistoryPersonSnapshot" FOR EACH ROW EXECUTE FUNCTION public.workforce_reject_history_rewrite();
DROP TRIGGER IF EXISTS history_task_snapshot_immutable ON public."HistoryTaskSnapshot";
CREATE TRIGGER history_task_snapshot_immutable BEFORE UPDATE OR DELETE ON public."HistoryTaskSnapshot" FOR EACH ROW EXECUTE FUNCTION public.workforce_reject_history_rewrite();
DROP TRIGGER IF EXISTS history_comment_snapshot_immutable ON public."HistoryCommentSnapshot";
CREATE TRIGGER history_comment_snapshot_immutable BEFORE UPDATE OR DELETE ON public."HistoryCommentSnapshot" FOR EACH ROW EXECUTE FUNCTION public.workforce_reject_history_rewrite();
DROP TRIGGER IF EXISTS history_review_snapshot_immutable ON public."HistoryReviewSnapshot";
CREATE TRIGGER history_review_snapshot_immutable BEFORE UPDATE OR DELETE ON public."HistoryReviewSnapshot" FOR EACH ROW EXECUTE FUNCTION public.workforce_reject_history_rewrite();

REVOKE ALL ON FUNCTION public.workforce_reject_closed_week_write() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.workforce_reject_closed_comment_write() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.workforce_reject_closed_review_write() FROM PUBLIC;
COMMIT;
