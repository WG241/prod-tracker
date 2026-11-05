-- Feature 10. Existing evidence stays intact; legacy tasks are conservatively touched.
BEGIN;

ALTER TABLE "WeeklyTask" ADD COLUMN IF NOT EXISTS "revision" INTEGER;
UPDATE "WeeklyTask" SET "revision" = 1 WHERE "revision" IS NULL;
ALTER TABLE "WeeklyTask" ALTER COLUMN "revision" SET DEFAULT 0;
ALTER TABLE "WeeklyTask" ALTER COLUMN "revision" SET NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'task_revision_nonnegative' AND conrelid = '"WeeklyTask"'::regclass) THEN
    ALTER TABLE "WeeklyTask" ADD CONSTRAINT "task_revision_nonnegative" CHECK ("revision" >= 0);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "TaskMutationReceipt" (
  "userId" TEXT NOT NULL,
  "requestId" UUID NOT NULL,
  "operation" TEXT NOT NULL,
  "requestHash" CHAR(64) NOT NULL,
  "taskId" TEXT NOT NULL,
  "result" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TaskMutationReceipt_pkey" PRIMARY KEY ("userId", "requestId")
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TaskMutationReceipt_userId_fkey' AND conrelid = '"TaskMutationReceipt"'::regclass) THEN
    ALTER TABLE "TaskMutationReceipt" ADD CONSTRAINT "TaskMutationReceipt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TaskMutationReceipt_taskId_userId_fkey' AND conrelid = '"TaskMutationReceipt"'::regclass) THEN
    ALTER TABLE "TaskMutationReceipt" ADD CONSTRAINT "TaskMutationReceipt_taskId_userId_fkey" FOREIGN KEY ("taskId", "userId") REFERENCES "WeeklyTask"("id", "ownerId") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'task_receipt_shape' AND conrelid = '"TaskMutationReceipt"'::regclass) THEN
    ALTER TABLE "TaskMutationReceipt" ADD CONSTRAINT "task_receipt_shape" CHECK (
      "operation" IN ('CREATE','EDIT','STATUS','CARRY','DELETE','COMMENT') AND
      "requestHash" ~ '^[0-9a-f]{64}$' AND jsonb_typeof("result") = 'object' AND
      coalesce("result"->>'version' = '1', false)
    );
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "TaskMutationReceipt_taskId_userId_idx" ON "TaskMutationReceipt"("taskId", "userId");
DROP TRIGGER IF EXISTS "task_receipt_append_only" ON "TaskMutationReceipt";
CREATE TRIGGER "task_receipt_append_only" BEFORE UPDATE OR DELETE ON "TaskMutationReceipt"
  FOR EACH ROW EXECUTE FUNCTION workforce_reject_history_rewrite();

COMMIT;
