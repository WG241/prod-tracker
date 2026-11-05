BEGIN;
CREATE TABLE IF NOT EXISTS public."LeaveMutationReceipt" (
  "userId" TEXT NOT NULL,
  "requestId" UUID NOT NULL,
  operation TEXT NOT NULL,
  "requestHash" CHAR(64) NOT NULL,
  "leaveId" TEXT NOT NULL,
  result JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeaveMutationReceipt_pkey" PRIMARY KEY ("userId","requestId")
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public."LeaveMutationReceipt"'::regclass AND conname='leave_receipt_user_fk') THEN
    ALTER TABLE public."LeaveMutationReceipt" ADD CONSTRAINT leave_receipt_user_fk FOREIGN KEY ("userId") REFERENCES public."User"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public."LeaveMutationReceipt"'::regclass AND conname='leave_receipt_owner_fk') THEN
    ALTER TABLE public."LeaveMutationReceipt" ADD CONSTRAINT leave_receipt_owner_fk FOREIGN KEY ("leaveId","userId") REFERENCES public."LeaveRecord"(id,"userId") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public."LeaveMutationReceipt"'::regclass AND conname='leave_receipt_shape') THEN
    ALTER TABLE public."LeaveMutationReceipt" ADD CONSTRAINT leave_receipt_shape CHECK (
      operation IN ('CREATE','CANCEL','RETURN') AND "requestHash" ~ '^[0-9a-f]{64}$' AND
      jsonb_typeof(result)='object' AND coalesce(result->>'version'='1',false) AND
      coalesce(result->>'requestId'="requestId"::text,false) AND coalesce(result->>'operation'=operation,false) AND
      coalesce(result->>'leaveId'="leaveId",false) AND coalesce(result->>'replayed'='false',false) AND
      coalesce(jsonb_typeof(result->'changed')='boolean',false) AND coalesce(jsonb_typeof(result->'appliedAt')='string',false) AND
      coalesce(jsonb_typeof(result->'notificationWarnings')='array',false)
    );
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "LeaveMutationReceipt_leaveId_userId_idx" ON public."LeaveMutationReceipt"("leaveId","userId");
CREATE OR REPLACE FUNCTION public.workforce_leave_receipt_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'Leave receipts are immutable' USING ERRCODE='23514'; END $$;
DROP TRIGGER IF EXISTS leave_receipt_immutable ON public."LeaveMutationReceipt";
CREATE TRIGGER leave_receipt_immutable BEFORE UPDATE OR DELETE ON public."LeaveMutationReceipt" FOR EACH ROW EXECUTE FUNCTION public.workforce_leave_receipt_guard();
REVOKE ALL ON FUNCTION public.workforce_leave_receipt_guard() FROM PUBLIC;
COMMIT;
