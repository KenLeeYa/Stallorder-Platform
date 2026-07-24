begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(8);

select ok(
  to_regnamespace('app_private') is not null,
  'private schema exists for internal scheduler functions'
);

select ok(
  to_regprocedure('app_private.invoke_due_report_deliveries()') is not null,
  'report delivery scheduler function exists'
);

select isnt(
  (select prosecdef
   from pg_proc
   where oid = 'app_private.invoke_due_report_deliveries()'::regprocedure),
  false,
  'scheduler function is security definer so cron can read Vault'
);

select ok(
  (select proconfig::text
   from pg_proc
   where oid = 'app_private.invoke_due_report_deliveries()'::regprocedure) like '%search_path%',
  'scheduler function pins an empty search_path'
);

select ok(
  not has_function_privilege('anon', 'app_private.invoke_due_report_deliveries()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'app_private.invoke_due_report_deliveries()', 'EXECUTE')
  and not has_schema_privilege('anon', 'app_private', 'USAGE'),
  'public API roles cannot execute the scheduler function'
);

select ok(
  exists (
    select 1
    from cron.job
    where jobname = 'stallorder-report-deliveries'
      and schedule = '*/5 * * * *'
      and command = 'select app_private.invoke_due_report_deliveries()'
      and active
  ),
  'report delivery cron job is scheduled every five minutes'
);

select ok(
  not exists (
    select 1
    from cron.job
    where jobname = 'stallorder-report-deliveries'
      and command ilike '%Bearer%'
  ),
  'cron command does not store bearer secrets'
);

select is(
  app_private.invoke_due_report_deliveries(),
  null::bigint,
  'scheduler no-ops when Vault runtime config is missing'
);

select * from finish();
rollback;
