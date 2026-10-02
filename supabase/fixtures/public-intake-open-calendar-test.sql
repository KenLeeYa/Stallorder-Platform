-- Test-only positive intake prerequisite. Include inside each test's rollback transaction.
-- Keep real calendar validation enabled; never use this fixture in release migrations.
-- Both today and yesterday cover the overnight tail if the test runs near midnight.
WITH local_clock AS (
  SELECT id, organization_id, clock_timestamp() AT TIME ZONE timezone AS local_now
  FROM public.stalls WHERE id = '22222222-2222-4222-8222-222222222222'::uuid
), windows AS (
  SELECT id, organization_id,
    extract(dow FROM local_now::date + offset_day)::smallint AS day_of_week,
    to_char(local_now - interval '1 hour', 'HH24:MI') AS opens_at,
    to_char(local_now + interval '1 hour', 'HH24:MI') AS closes_at
  FROM local_clock CROSS JOIN generate_series(-1, 0) AS offsets(offset_day)
)
INSERT INTO public.stall_business_hours(organization_id,stall_id,day_of_week,opens_at,closes_at,is_closed)
SELECT organization_id,id,day_of_week,opens_at,closes_at,false FROM windows
ON CONFLICT(stall_id,day_of_week) DO UPDATE
SET opens_at=excluded.opens_at,closes_at=excluded.closes_at,is_closed=false;
