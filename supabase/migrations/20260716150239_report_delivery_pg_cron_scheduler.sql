create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

create or replace function app_private.invoke_due_report_deliveries()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
  v_request_id bigint;
begin
  select nullif(decrypted_secret, '')
  into v_url
  from vault.decrypted_secrets
  where name = 'stallorder_report_delivery_url'
  order by updated_at desc
  limit 1;

  select nullif(decrypted_secret, '')
  into v_secret
  from vault.decrypted_secrets
  where name = 'stallorder_report_delivery_cron_secret'
  order by updated_at desc
  limit 1;

  if v_url is null or v_secret is null then
    raise notice 'REPORT_DELIVERY_CRON_NOT_CONFIGURED';
    return null;
  end if;

  if v_url !~ '^https://[A-Za-z0-9.-]+/api/cron/report-deliveries$' then
    raise exception 'REPORT_DELIVERY_CRON_URL_INVALID' using errcode = 'P0001';
  end if;

  select net.http_get(
    url := v_url,
    headers := jsonb_build_object(
      'authorization', 'Bearer ' || v_secret,
      'user-agent', 'StallOrder Supabase Cron'
    ),
    timeout_milliseconds := 10000
  )
  into v_request_id;

  return v_request_id;
end;
$$;

revoke all on function app_private.invoke_due_report_deliveries() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'stallorder-report-deliveries') then
    perform cron.unschedule('stallorder-report-deliveries');
  end if;

  perform cron.schedule(
    'stallorder-report-deliveries',
    '*/5 * * * *',
    'select app_private.invoke_due_report_deliveries()'
  );
end;
$$;
