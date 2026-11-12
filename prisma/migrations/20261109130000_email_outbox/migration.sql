BEGIN;

ALTER TYPE public."EmailState" ADD VALUE IF NOT EXISTS 'SENDING';
ALTER TYPE public."EmailState" ADD VALUE IF NOT EXISTS 'PREVIEWED';
ALTER TYPE public."EmailState" ADD VALUE IF NOT EXISTS 'UNCERTAIN';

ALTER TABLE public."EmailDelivery"
  ADD COLUMN IF NOT EXISTS "enqueuedAt" TIMESTAMPTZ(3),
  ADD COLUMN IF NOT EXISTS "recipientBasis" JSONB,
  ADD COLUMN IF NOT EXISTS "messageSnapshot" JSONB,
  ADD COLUMN IF NOT EXISTS "transportMode" TEXT,
  ADD COLUMN IF NOT EXISTS provider TEXT,
  ADD COLUMN IF NOT EXISTS "transportRevision" TEXT,
  ADD COLUMN IF NOT EXISTS "providerKey" TEXT,
  ADD COLUMN IF NOT EXISTS "payloadHash" CHAR(64),
  ADD COLUMN IF NOT EXISTS "firstAttemptAt" TIMESTAMPTZ(3),
  ADD COLUMN IF NOT EXISTS "firstUncertainAt" TIMESTAMPTZ(3),
  ADD COLUMN IF NOT EXISTS "leaseToken" UUID,
  ADD COLUMN IF NOT EXISTS "leaseExpiresAt" TIMESTAMPTZ(3),
  ADD COLUMN IF NOT EXISTS "providerMessageId" TEXT;

CREATE INDEX IF NOT EXISTS "EmailDelivery_state_leaseExpiresAt_idx"
  ON public."EmailDelivery" (state, "leaseExpiresAt");

-- Compare new enum labels as text until this transaction commits.
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_constraint WHERE conrelid = 'public."EmailDelivery"'::regclass AND conname = 'email_outbox_shape') THEN
    ALTER TABLE public."EmailDelivery" ADD CONSTRAINT email_outbox_shape CHECK (
      "enqueuedAt" IS NULL OR (
        "recipientBasis" IS NOT NULL AND jsonb_typeof("recipientBasis") = 'object'
        AND "attemptCount" BETWEEN 0 AND 5
        AND ("attemptCount" > 0) = ("lastAttemptAt" IS NOT NULL)
        AND (state::text = 'SENDING') = ("leaseToken" IS NOT NULL)
        AND ("leaseToken" IS NULL) = ("leaseExpiresAt" IS NULL)
        AND (state::text = 'SENT') = ("providerMessageId" IS NOT NULL)
        AND (state::text = 'SENT') = ("sentAt" IS NOT NULL)
        AND (state::text <> 'UNCERTAIN' OR "firstUncertainAt" IS NOT NULL)
        AND (state::text <> 'PREVIEWED' OR provider IS NOT DISTINCT FROM 'preview')
        AND (state::text NOT IN ('QUEUED', 'SENDING', 'PREVIEWED', 'SENT', 'UNCERTAIN') OR "messageSnapshot" IS NOT NULL)
        AND ("firstUncertainAt" IS NULL OR "firstAttemptAt" IS NOT NULL)
        AND ("firstAttemptAt" IS NULL OR provider IS NOT DISTINCT FROM 'resend')
        AND (state::text <> 'SENT' OR "firstAttemptAt" IS NOT NULL)
        AND ("messageSnapshot" IS NULL OR (
          jsonb_typeof("messageSnapshot") = 'object' AND "payloadHash" IS NOT NULL AND "payloadHash" ~ '^[0-9a-f]{64}$'
          AND ((provider IS NOT DISTINCT FROM 'preview' AND "transportMode" IS NOT DISTINCT FROM 'preview' AND "providerKey" IS NULL)
            OR (provider IS NOT DISTINCT FROM 'resend' AND "transportMode" IS NOT NULL AND "transportMode" IN ('catch-all', 'live')
              AND "transportRevision" IS NOT NULL AND "providerKey" IS NOT DISTINCT FROM ('workforce/email/v1/' || id)))
        ))
      )
    );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.workforce_protect_email_delivery() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Email delivery evidence is retained' USING ERRCODE = '23514';
  END IF;
  IF NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
  IF OLD."enqueuedAt" IS NULL OR OLD.state::text IN ('SENT', 'PREVIEWED', 'SUPPRESSED', 'UNCERTAIN')
    OR (to_jsonb(NEW) - ARRAY['state','attemptCount','scheduledAt','lastAttemptAt','sentAt','failureCode','firstAttemptAt','firstUncertainAt','leaseToken','leaseExpiresAt','providerMessageId'])
      IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['state','attemptCount','scheduledAt','lastAttemptAt','sentAt','failureCode','firstAttemptAt','firstUncertainAt','leaseToken','leaseExpiresAt','providerMessageId'])
    OR (OLD."firstAttemptAt" IS NOT NULL AND NEW."firstAttemptAt" IS DISTINCT FROM OLD."firstAttemptAt")
    OR (OLD."firstUncertainAt" IS NOT NULL AND NEW."firstUncertainAt" IS DISTINCT FROM OLD."firstUncertainAt")
    OR (OLD.state::text = 'QUEUED' AND NEW.state::text NOT IN ('SENDING','FAILED','SUPPRESSED','UNCERTAIN'))
    OR (OLD.state::text = 'SENDING' AND NEW.state::text NOT IN ('QUEUED','SENT','PREVIEWED','FAILED','SUPPRESSED','UNCERTAIN'))
    OR (OLD.state::text = 'FAILED' AND (NEW.state::text <> 'QUEUED' OR OLD."firstUncertainAt" IS NOT NULL))
    OR NEW."attemptCount" <> OLD."attemptCount" + (CASE WHEN NEW.state::text = 'SENDING' THEN 1 ELSE 0 END)
  THEN
    RAISE EXCEPTION 'Invalid email delivery transition' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS email_delivery_guard ON public."EmailDelivery";
CREATE TRIGGER email_delivery_guard BEFORE UPDATE OR DELETE ON public."EmailDelivery"
  FOR EACH ROW EXECUTE FUNCTION public.workforce_protect_email_delivery();

COMMIT;
