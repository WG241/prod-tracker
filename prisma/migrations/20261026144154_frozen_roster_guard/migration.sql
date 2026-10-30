-- A missing submitter has no task FK to protect its historical roster row.
-- Protect the captured context itself after it has been frozen.
CREATE FUNCTION workforce_protect_frozen_roster() RETURNS trigger LANGUAGE plpgsql AS $$
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
CREATE TRIGGER "frozen_roster_guard" BEFORE UPDATE OR DELETE ON "WeeklyTracker"
  FOR EACH ROW EXECUTE FUNCTION workforce_protect_frozen_roster();
