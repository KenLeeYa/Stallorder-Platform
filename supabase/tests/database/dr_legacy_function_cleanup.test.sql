begin;

select plan(2);

select is(
  (
    select count(*)
    from pg_catalog.pg_proc function_record
    join pg_catalog.pg_namespace namespace_record
      on namespace_record.oid = function_record.pronamespace
    where namespace_record.nspname = 'public'
      and function_record.proname = 'refresh_kds_operational_alerts_legacy_20260813'
  ),
  0::bigint,
  'orphaned refresh KDS legacy function is absent'
);

select is(
  (
    select count(*)
    from pg_catalog.pg_proc function_record
    join pg_catalog.pg_namespace namespace_record
      on namespace_record.oid = function_record.pronamespace
    where namespace_record.nspname = 'public'
      and function_record.proname = 'calculate_stall_capacity_legacy_20260813'
  ),
  0::bigint,
  'orphaned capacity legacy function is absent'
);

select * from finish();
rollback;
