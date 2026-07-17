begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(9);

select ok(
  to_regnamespace('internal') is not null,
  'internal schema exists for preview cron'
);

select ok(
  to_regprocedure('internal.invoke_vercel_preview_cron()') is not null,
  'preview process-orders cron function exists'
);

select ok(
  (select prosecdef from pg_proc where oid = 'internal.invoke_vercel_preview_cron()'::regprocedure),
  'preview cron function is security definer'
);

select ok(
  (select proconfig::text from pg_proc where oid = 'internal.invoke_vercel_preview_cron()'::regprocedure) like '%search_path%',
  'preview cron function pins search_path'
);

select ok(
  not has_schema_privilege('anon', 'internal', 'USAGE')
  and not has_schema_privilege('authenticated', 'internal', 'USAGE')
  and not has_function_privilege('anon', 'internal.invoke_vercel_preview_cron()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'internal.invoke_vercel_preview_cron()', 'EXECUTE'),
  'public API roles cannot execute preview cron function'
);

select ok(
  exists (
    select 1
    from cron.job
    where jobname = 'invoke-vercel-preview-process-orders'
      and schedule = '*/5 * * * *'
      and command = 'select internal.invoke_vercel_preview_cron();'
      and active
  ),
  'preview process-orders cron job is active every five minutes'
);

select ok(
  not exists (
    select 1
    from cron.job
    where jobname = 'invoke-vercel-preview-process-orders'
      and (
        command ilike '%Bearer%'
        or command ilike '%vercel_bypass_secret%'
        or command ilike '%cron_api_secret%'
      )
  ),
  'preview cron command does not store secret material'
);

select ok(
  pg_get_functiondef('internal.invoke_vercel_preview_cron()'::regprocedure) like '%\\.vercel\\.app%',
  'preview cron only allows Vercel Preview hosts'
);

select throws_ok(
  $$select internal.invoke_vercel_preview_cron()$$,
  'P0001',
  'VERCEL_PREVIEW_CRON_NOT_CONFIGURED',
  'preview cron fails closed when Vault secrets are missing'
);

select * from finish();
rollback;
