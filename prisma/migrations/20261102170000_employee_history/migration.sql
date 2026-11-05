BEGIN;

ALTER TABLE public."WorkWeek" ADD COLUMN IF NOT EXISTS "rosterCapturedAt" TIMESTAMPTZ(3);
ALTER TABLE public."TrackerSettings" ADD COLUMN IF NOT EXISTS "trackingStartsOn" DATE;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public."WorkWeek"'::regclass AND conname='roster_capture_after_freeze') THEN
    ALTER TABLE public."WorkWeek" ADD CONSTRAINT roster_capture_after_freeze CHECK ("rosterCapturedAt" IS NULL OR "rosterCapturedAt">="freezesAt");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public."TrackerSettings"'::regclass AND conname='tracking_start_monday') THEN
    ALTER TABLE public."TrackerSettings" ADD CONSTRAINT tracking_start_monday CHECK ("trackingStartsOn" IS NULL OR (extract(isodow FROM "trackingStartsOn")=1 AND "trackingStartsOn" BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.workforce_history_windows()
RETURNS TABLE ("startsOn" DATE, "freezesAt" TIMESTAMPTZ)
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
  SELECT w."startsOn",w."freezesAt" FROM public."WorkWeek" w
  UNION ALL
  SELECT d::date,(d+interval '5 days') AT TIME ZONE 'Africa/Lagos'
  FROM public."TrackerSettings" s
  CROSS JOIN LATERAL generate_series(s."trackingStartsOn"::timestamp,
    date_trunc('week',clock_timestamp() AT TIME ZONE 'Africa/Lagos'),interval '7 days') d
  WHERE s.id='workforce-group' AND NOT EXISTS (SELECT 1 FROM public."WorkWeek" w WHERE w."startsOn"=d::date)
$$;

CREATE OR REPLACE FUNCTION public.workforce_history_progress_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
  IF TG_TABLE_NAME='TrackerSettings' THEN
    IF OLD."trackingStartsOn" IS NOT NULL AND (TG_OP='DELETE' OR NEW."trackingStartsOn" IS DISTINCT FROM OLD."trackingStartsOn") THEN
      RAISE EXCEPTION 'Tracking coverage is immutable' USING ERRCODE='23514';
    END IF;
  ELSE
    IF TG_OP='DELETE' THEN
      IF OLD."freezesAt"<=clock_timestamp() OR OLD."rosterCapturedAt" IS NOT NULL THEN
        RAISE EXCEPTION 'Historical week cannot be deleted' USING ERRCODE='23514';
      END IF;
    ELSE
      IF ROW(OLD."startsOn",OLD."planningLocksAt",OLD."freezesAt") IS DISTINCT FROM ROW(NEW."startsOn",NEW."planningLocksAt",NEW."freezesAt") THEN
        RAISE EXCEPTION 'Week calendar is immutable' USING ERRCODE='23514';
      END IF;
      IF OLD."rosterCapturedAt" IS NOT NULL AND NEW."rosterCapturedAt" IS DISTINCT FROM OLD."rosterCapturedAt" THEN
        RAISE EXCEPTION 'Roster completion is immutable' USING ERRCODE='23514';
      END IF;
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.workforce_history_assignment_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE
  prior public."EmploymentAssignment"%ROWTYPE;
  revised public."EmploymentAssignment"%ROWTYPE;
  owner_key TEXT;
  w RECORD;
  beginning TIMESTAMPTZ;
  checked_at TIMESTAMPTZ;
  old_start TIMESTAMPTZ; old_end TIMESTAMPTZ; new_start TIMESTAMPTZ; new_end TIMESTAMPTZ;
  old_present BOOLEAN; new_present BOOLEAN;
BEGIN
  IF TG_OP<>'INSERT' THEN prior:=OLD; END IF;
  IF TG_OP<>'DELETE' THEN revised:=NEW; END IF;
  FOR owner_key IN SELECT DISTINCT v FROM unnest(ARRAY[prior."userId",revised."userId"]) v WHERE v IS NOT NULL ORDER BY v LOOP
    PERFORM id FROM public."User" WHERE id=owner_key FOR UPDATE;
  END LOOP;
  PERFORM w0.id FROM public."WorkWeek" w0
    WHERE (prior.id IS NOT NULL AND prior."effectiveFrom"<w0."freezesAt" AND coalesce(prior."effectiveTo",'infinity'::timestamptz)>(w0."startsOn"::timestamp AT TIME ZONE 'Africa/Lagos'))
       OR (revised.id IS NOT NULL AND revised."effectiveFrom"<w0."freezesAt" AND coalesce(revised."effectiveTo",'infinity'::timestamptz)>(w0."startsOn"::timestamp AT TIME ZONE 'Africa/Lagos'))
    ORDER BY w0."startsOn" FOR SHARE;
  checked_at:=clock_timestamp();
  FOR w IN SELECT * FROM public.workforce_history_windows() h WHERE h."freezesAt"<=checked_at LOOP
    beginning:=w."startsOn"::timestamp AT TIME ZONE 'Africa/Lagos';
    old_start:=greatest(prior."effectiveFrom",beginning); old_end:=least(coalesce(prior."effectiveTo",'infinity'::timestamptz),w."freezesAt");
    new_start:=greatest(revised."effectiveFrom",beginning); new_end:=least(coalesce(revised."effectiveTo",'infinity'::timestamptz),w."freezesAt");
    old_present:=prior.id IS NOT NULL AND old_start<old_end;
    new_present:=revised.id IS NOT NULL AND new_start<new_end;
    IF old_present IS DISTINCT FROM new_present OR (old_present AND new_present AND
      ROW(old_start,old_end,prior."userId",prior.role,prior."businessId",prior."unitId",prior."managerId",prior."departmentLabel") IS DISTINCT FROM
      ROW(new_start,new_end,revised."userId",revised.role,revised."businessId",revised."unitId",revised."managerId",revised."departmentLabel")) THEN
      RAISE EXCEPTION 'Historical assignment contribution is immutable' USING ERRCODE='23514';
    END IF;
  END LOOP;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.workforce_history_leave_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE
  prior public."LeaveRecord"%ROWTYPE;
  revised public."LeaveRecord"%ROWTYPE;
  owner_key TEXT; w RECORD; selected_day DATE; n INTEGER;
  checked_at TIMESTAMPTZ; reference_at TIMESTAMPTZ;
  old_covered BOOLEAN; new_covered BOOLEAN;
BEGIN
  IF TG_OP<>'INSERT' THEN prior:=OLD; END IF;
  IF TG_OP<>'DELETE' THEN revised:=NEW; END IF;
  FOR owner_key IN SELECT DISTINCT v FROM unnest(ARRAY[prior."userId",revised."userId"]) v WHERE v IS NOT NULL ORDER BY v LOOP
    PERFORM id FROM public."User" WHERE id=owner_key FOR UPDATE;
  END LOOP;
  PERFORM w0.id FROM public."WorkWeek" w0
    WHERE (prior.id IS NOT NULL AND prior."startsOn"<=w0."startsOn"+4 AND coalesce(prior."actualReturnOn",prior."expectedReturnOn")>w0."startsOn")
       OR (revised.id IS NOT NULL AND revised."startsOn"<=w0."startsOn"+4 AND coalesce(revised."actualReturnOn",revised."expectedReturnOn")>w0."startsOn")
    ORDER BY w0."startsOn" FOR SHARE;
  checked_at:=clock_timestamp();
  IF TG_OP='UPDATE' AND (prior."userId" IS DISTINCT FROM revised."userId"
    OR (prior."actualReturnOn" IS NOT NULL AND prior."actualReturnOn" IS DISTINCT FROM revised."actualReturnOn")
    OR (prior."cancelledAt" IS NOT NULL AND ROW(prior."cancelledAt",prior."cancelledById") IS DISTINCT FROM ROW(revised."cancelledAt",revised."cancelledById"))) THEN
    RAISE EXCEPTION 'Recorded leave event is immutable' USING ERRCODE='23514';
  END IF;
  FOR w IN SELECT * FROM public.workforce_history_windows() h WHERE h."freezesAt"<=checked_at LOOP
    reference_at:=w."freezesAt"-interval '1 millisecond';
    FOR n IN 0..4 LOOP
      selected_day:=w."startsOn"+n;
      old_covered:=coalesce(prior.id IS NOT NULL AND prior."startsOn"<=selected_day AND selected_day<coalesce(prior."actualReturnOn",prior."expectedReturnOn") AND (prior."cancelledAt" IS NULL OR prior."cancelledAt">reference_at),false);
      new_covered:=coalesce(revised.id IS NOT NULL AND revised."startsOn"<=selected_day AND selected_day<coalesce(revised."actualReturnOn",revised."expectedReturnOn") AND (revised."cancelledAt" IS NULL OR revised."cancelledAt">reference_at),false);
      IF old_covered IS DISTINCT FROM new_covered THEN
        RAISE EXCEPTION 'Historical leave contribution is immutable' USING ERRCODE='23514';
      END IF;
    END LOOP;
  END LOOP;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS history_assignment_guard ON public."EmploymentAssignment";
CREATE TRIGGER history_assignment_guard BEFORE INSERT OR UPDATE OR DELETE ON public."EmploymentAssignment" FOR EACH ROW EXECUTE FUNCTION public.workforce_history_assignment_guard();
DROP TRIGGER IF EXISTS history_leave_guard ON public."LeaveRecord";
CREATE TRIGGER history_leave_guard BEFORE INSERT OR UPDATE OR DELETE ON public."LeaveRecord" FOR EACH ROW EXECUTE FUNCTION public.workforce_history_leave_guard();
DROP TRIGGER IF EXISTS history_week_guard ON public."WorkWeek";
CREATE TRIGGER history_week_guard BEFORE UPDATE OR DELETE ON public."WorkWeek" FOR EACH ROW EXECUTE FUNCTION public.workforce_history_progress_guard();
DROP TRIGGER IF EXISTS history_tracking_guard ON public."TrackerSettings";
CREATE TRIGGER history_tracking_guard BEFORE UPDATE OR DELETE ON public."TrackerSettings" FOR EACH ROW EXECUTE FUNCTION public.workforce_history_progress_guard();
REVOKE ALL ON FUNCTION public.workforce_history_windows() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.workforce_history_progress_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.workforce_history_assignment_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.workforce_history_leave_guard() FROM PUBLIC;
COMMIT;
