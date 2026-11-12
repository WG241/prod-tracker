BEGIN;

CREATE TABLE IF NOT EXISTS public."NotificationPreference" (
  "userId" TEXT PRIMARY KEY REFERENCES public."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "emailRemindersEnabled" BOOLEAN NOT NULL DEFAULT true,
  "revision" INTEGER NOT NULL DEFAULT 0 CHECK ("revision" >= 0),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL
);

CREATE TABLE IF NOT EXISTS public."SharedMutationReceipt" (
  "userId" TEXT NOT NULL REFERENCES public."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "requestId" UUID NOT NULL,
  "operation" TEXT NOT NULL,
  "requestHash" CHAR(64),
  "result" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("userId", "requestId"),
  CONSTRAINT shared_receipt_operation_hash CHECK (
    ("operation" = 'EMAIL_PREFERENCE' AND "requestHash" IS NOT NULL AND "requestHash" ~ '^[0-9a-f]{64}$')
    OR ("operation" = 'PASSWORD_CHANGE' AND "requestHash" IS NULL)
  )
);

DROP TRIGGER IF EXISTS shared_receipt_immutable ON public."SharedMutationReceipt";
CREATE TRIGGER shared_receipt_immutable BEFORE UPDATE OR DELETE ON public."SharedMutationReceipt"
  FOR EACH ROW EXECUTE FUNCTION public.workforce_reject_history_rewrite();

INSERT INTO public."NotificationPreference" ("userId", "emailRemindersEnabled", "updatedAt")
SELECT "id", "emailRemindersEnabled", CURRENT_TIMESTAMP FROM public."User"
ON CONFLICT ("userId") DO NOTHING;

COMMIT;
