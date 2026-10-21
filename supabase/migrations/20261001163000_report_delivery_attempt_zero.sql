begin;
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid='public.report_deliveries'::regclass
    and conname='report_deliveries_attempt_count_check' and convalidated
    and pg_get_constraintdef(oid)='CHECK (((attempt_count >= 1) AND (attempt_count <= 10)))')
  then raise exception 'REPORT_PRIOR_ATTEMPT_CONSTRAINT_MISMATCH'; end if;
end;
$$;
alter table public.report_deliveries drop constraint report_deliveries_attempt_count_check;
alter table public.report_deliveries add constraint report_deliveries_attempt_count_check
  check ((attempt_count >= 1 and attempt_count <= 10) or (attempt_count = 0 and intent_json is not null));
commit;
