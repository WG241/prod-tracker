-- Postgres hardening (Supabase Postgres best practices):
-- 1) Index every foreign key for JOIN / referential checks.
-- 2) Pin trigger function search_path and revoke PUBLIC EXECUTE.
-- 3) Align AuthUser email CHECK with User (require '@').
-- Idempotent: safe to re-run; statements no-op when objects already match.

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ApprovalDecision_actorId_idx" ON "ApprovalDecision"("actorId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ApprovalDecision_actingForManagerId_idx" ON "ApprovalDecision"("actingForManagerId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ApprovalDecision_reliefAssignmentId_idx" ON "ApprovalDecision"("reliefAssignmentId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ApprovalRequest_weeklyTaskId_submittedById_idx" ON "ApprovalRequest"("weeklyTaskId", "submittedById");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ApprovalRequest_submittedById_idx" ON "ApprovalRequest"("submittedById");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ApprovalRequest_submissionAssignmentId_submittedById_idx" ON "ApprovalRequest"("submissionAssignmentId", "submittedById");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AuditEvent_actorId_idx" ON "AuditEvent"("actorId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "EmploymentAssignment_unitId_businessId_idx" ON "EmploymentAssignment"("unitId", "businessId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LeaveRecord_cancelledById_idx" ON "LeaveRecord"("cancelledById");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Notification_weeklyTaskId_idx" ON "Notification"("weeklyTaskId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Notification_leaveId_idx" ON "Notification"("leaveId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Notification_reliefAssignmentId_idx" ON "Notification"("reliefAssignmentId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PlanningUnlock_userId_idx" ON "PlanningUnlock"("userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PlanningUnlock_unitId_idx" ON "PlanningUnlock"("unitId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PlanningUnlock_businessId_idx" ON "PlanningUnlock"("businessId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PlanningUnlock_grantedById_idx" ON "PlanningUnlock"("grantedById");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PlanningUnlock_revokedById_idx" ON "PlanningUnlock"("revokedById");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ReliefAssignment_leaveId_coveredManagerId_idx" ON "ReliefAssignment"("leaveId", "coveredManagerId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ReliefAssignment_endedById_idx" ON "ReliefAssignment"("endedById");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TaskComment_authorId_idx" ON "TaskComment"("authorId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TaskSeries_ownerId_idx" ON "TaskSeries"("ownerId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TrackerSettings_updatedById_idx" ON "TrackerSettings"("updatedById");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WeeklyTask_seriesId_ownerId_idx" ON "WeeklyTask"("seriesId", "ownerId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WeeklyTask_trackerId_ownerId_idx" ON "WeeklyTask"("trackerId", "ownerId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WeeklyTask_carriedFromId_seriesId_idx" ON "WeeklyTask"("carriedFromId", "seriesId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WeeklyTracker_assignmentId_userId_idx" ON "WeeklyTracker"("assignmentId", "userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WorkWeek_lockedById_idx" ON "WorkWeek"("lockedById");

-- Align AuthUser email invariant with User.user_canonical_email (replace only when needed).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'auth_email_canonical'
      AND conrelid = '"AuthUser"'::regclass
      AND pg_get_constraintdef(oid) NOT LIKE '%POSITION((''@''::text) IN (email))%'
  ) THEN
    ALTER TABLE "AuthUser" DROP CONSTRAINT "auth_email_canonical";
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'auth_email_canonical'
      AND conrelid = '"AuthUser"'::regclass
  ) THEN
    ALTER TABLE "AuthUser" ADD CONSTRAINT "auth_email_canonical"
      CHECK ("email" = lower(btrim("email")) AND position('@' IN "email") > 1);
  END IF;
END $$;

-- History / evidence guards: invoker + fixed search_path, not callable by PUBLIC.
CREATE OR REPLACE FUNCTION workforce_reject_history_rewrite()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'Historical evidence cannot be rewritten' USING ERRCODE = '23514';
END;
$$;

CREATE OR REPLACE FUNCTION workforce_protect_submission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Submission evidence cannot be deleted' USING ERRCODE = '23514';
  END IF;
  IF ROW(NEW."weeklyTaskId", NEW."attemptNumber", NEW."submittedById", NEW."submissionAssignmentId", NEW."submittedAt", NEW."submissionSnapshot")
    IS DISTINCT FROM ROW(OLD."weeklyTaskId", OLD."attemptNumber", OLD."submittedById", OLD."submissionAssignmentId", OLD."submittedAt", OLD."submissionSnapshot") THEN
    RAISE EXCEPTION 'Submission evidence cannot be rewritten' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION workforce_protect_frozen_roster()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
BEGIN
  IF OLD."snapshotAt" IS NOT NULL THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Frozen roster evidence cannot be deleted' USING ERRCODE = '23514';
    END IF;
    IF ROW(NEW."userId", NEW."weekId", NEW."assignmentId", NEW."contextSnapshot", NEW."expectedWorkingDaysSnapshot", NEW."snapshotAt")
      IS DISTINCT FROM ROW(OLD."userId", OLD."weekId", OLD."assignmentId", OLD."contextSnapshot", OLD."expectedWorkingDaysSnapshot", OLD."snapshotAt") THEN
      RAISE EXCEPTION 'Frozen roster evidence cannot be rewritten' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION workforce_reject_history_rewrite() FROM PUBLIC;
REVOKE ALL ON FUNCTION workforce_protect_submission() FROM PUBLIC;
REVOKE ALL ON FUNCTION workforce_protect_frozen_roster() FROM PUBLIC;
