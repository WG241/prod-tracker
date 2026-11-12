BEGIN;

ALTER TABLE public."LeaveRecord" ADD COLUMN IF NOT EXISTS "contextSnapshot" JSONB;
ALTER TABLE public."ReliefAssignment" ADD COLUMN IF NOT EXISTS "contextSnapshot" JSONB;

CREATE OR REPLACE FUNCTION public.workforce_cover_label(value JSONB)
RETURNS BOOLEAN LANGUAGE SQL IMMUTABLE STRICT SET search_path=pg_catalog AS $$
  SELECT jsonb_typeof(value)='string' AND char_length(value#>>'{}') BETWEEN 1 AND 240 AND btrim(value#>>'{}')=value#>>'{}'
$$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_constraint WHERE conrelid='public."LeaveRecord"'::regclass AND conname='manager_leave_snapshot_shape') THEN
    ALTER TABLE public."LeaveRecord" ADD CONSTRAINT manager_leave_snapshot_shape CHECK ("contextSnapshot" IS NULL OR COALESCE(
      jsonb_typeof("contextSnapshot")='object' AND octet_length("contextSnapshot"::text)<=8192
      AND "contextSnapshot"->'version'='1'::jsonb AND "contextSnapshot"->>'userId'="userId"
      AND "contextSnapshot"->>'role'='LINE_MANAGER' AND jsonb_typeof("contextSnapshot"->'businessId')='string'
      AND length("contextSnapshot"->>'businessId')>0
      AND public.workforce_cover_label("contextSnapshot"->'displayName') AND public.workforce_cover_label("contextSnapshot"->'businessName'),false));
  END IF;
  IF NOT EXISTS (SELECT FROM pg_constraint WHERE conrelid='public."ReliefAssignment"'::regclass AND conname='relief_snapshot_shape') THEN
    ALTER TABLE public."ReliefAssignment" ADD CONSTRAINT relief_snapshot_shape CHECK ("contextSnapshot" IS NULL OR COALESCE(
      jsonb_typeof("contextSnapshot")='object' AND octet_length("contextSnapshot"::text)<=8192
      AND "contextSnapshot"->'version'='1'::jsonb AND "contextSnapshot"->>'coveredManagerId'="coveredManagerId"
      AND "contextSnapshot"->>'reliefManagerId'="reliefManagerId" AND "contextSnapshot"->>'reliefRole'='LINE_MANAGER'
      AND jsonb_typeof("contextSnapshot"->'reliefBusinessId')='string' AND length("contextSnapshot"->>'reliefBusinessId')>0
      AND public.workforce_cover_label("contextSnapshot"->'coveredDisplayName')
      AND public.workforce_cover_label("contextSnapshot"->'reliefDisplayName')
      AND public.workforce_cover_label("contextSnapshot"->'reliefBusinessName')
      AND (("endedAt" IS NULL AND "endedById" IS NULL) OR ("endedAt">="createdAt" AND "endedById" IS NOT NULL)),false));
  END IF;
  IF NOT EXISTS (SELECT FROM pg_constraint WHERE conrelid='public."LeaveMutationReceipt"'::regclass
    AND conname='leave_receipt_shape' AND pg_get_constraintdef(oid) LIKE '%RELIEF_REPLACE%') THEN
    ALTER TABLE public."LeaveMutationReceipt" DROP CONSTRAINT IF EXISTS leave_receipt_shape;
    ALTER TABLE public."LeaveMutationReceipt" ADD CONSTRAINT leave_receipt_shape CHECK (
      operation IN ('CREATE','CANCEL','RETURN','MANAGER_CREATE','MANAGER_CANCEL','MANAGER_RETURN','RELIEF_REPLACE','RELIEF_END')
      AND "requestHash" ~ '^[0-9a-f]{64}$' AND jsonb_typeof(result)='object'
      AND coalesce(result->>'version'='1',false) AND coalesce(result->>'requestId'="requestId"::text,false)
      AND coalesce(result->>'operation'=operation,false) AND coalesce(result->>'leaveId'="leaveId",false)
      AND coalesce(result->>'replayed'='false',false) AND coalesce(jsonb_typeof(result->'changed')='boolean',false)
      AND coalesce(jsonb_typeof(result->'appliedAt')='string',false) AND coalesce(jsonb_typeof(result->'notificationWarnings')='array',false)
      AND CASE WHEN operation IN ('CREATE','CANCEL','RETURN') THEN true ELSE COALESCE(
        jsonb_typeof(result->'coverId') IN ('string','null') AND jsonb_typeof(result->'actualReturnOn') IN ('string','null')
        AND jsonb_array_length(result->'endedCoverIds')<=1,false) END
    );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.workforce_manager_leave_snapshot_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
  IF NEW."contextSnapshot" IS DISTINCT FROM OLD."contextSnapshot"
    OR (OLD."contextSnapshot" IS NOT NULL AND
      ROW(NEW.id,NEW."userId",NEW."startsOn",NEW."expectedReturnOn",NEW."createdAt") IS DISTINCT FROM
      ROW(OLD.id,OLD."userId",OLD."startsOn",OLD."expectedReturnOn",OLD."createdAt"))
  THEN RAISE EXCEPTION 'Manager leave evidence is immutable' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS manager_leave_snapshot_guard ON public."LeaveRecord";
CREATE TRIGGER manager_leave_snapshot_guard BEFORE UPDATE ON public."LeaveRecord"
FOR EACH ROW EXECUTE FUNCTION public.workforce_manager_leave_snapshot_guard();

CREATE OR REPLACE FUNCTION public.workforce_relief_evidence_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Relief evidence cannot be deleted' USING ERRCODE='23514'; END IF;
  IF (to_jsonb(OLD)-ARRAY['endedAt','endedById']) IS DISTINCT FROM (to_jsonb(NEW)-ARRAY['endedAt','endedById'])
    OR (OLD."endedAt" IS NOT NULL AND ROW(OLD."endedAt",OLD."endedById") IS DISTINCT FROM ROW(NEW."endedAt",NEW."endedById"))
    OR (OLD."endedAt" IS NULL AND ROW(OLD."endedAt",OLD."endedById") IS DISTINCT FROM ROW(NEW."endedAt",NEW."endedById")
      AND (NEW."endedAt" IS NULL OR NEW."endedById" IS NULL OR NEW."endedAt"<NEW."createdAt"))
  THEN RAISE EXCEPTION 'Relief evidence is immutable' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS relief_evidence_guard ON public."ReliefAssignment";
CREATE TRIGGER relief_evidence_guard BEFORE UPDATE OR DELETE ON public."ReliefAssignment"
FOR EACH ROW EXECUTE FUNCTION public.workforce_relief_evidence_guard();

CREATE INDEX IF NOT EXISTS "ReliefAssignment_leaveId_startsOn_id_idx" ON public."ReliefAssignment"("leaveId","startsOn" DESC,id DESC);
CREATE INDEX IF NOT EXISTS "LeaveRecord_userId_startsOn_id_idx" ON public."LeaveRecord"("userId","startsOn" DESC,id DESC);
COMMIT;
