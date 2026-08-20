set lock_timeout = '5s';
set statement_timeout = '2min';

create or replace function app_private.invoke_due_report_deliveries()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
  v_vercel_bypass_secret text;
  v_headers jsonb;
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

  select nullif(decrypted_secret, '')
  into v_vercel_bypass_secret
  from vault.decrypted_secrets
  where name = 'stallorder_vercel_protection_bypass_secret'
  order by updated_at desc
  limit 1;

  if v_url is null or v_secret is null then
    raise notice 'REPORT_DELIVERY_CRON_NOT_CONFIGURED';
    return null;
  end if;

  if v_url !~ '^https://[A-Za-z0-9.-]+/api/cron/report-deliveries$' then
    raise exception 'REPORT_DELIVERY_CRON_URL_INVALID' using errcode = 'P0001';
  end if;

  v_headers := jsonb_build_object(
    'authorization', 'Bearer ' || v_secret,
    'user-agent', 'StallOrder Supabase Cron'
  );

  if v_vercel_bypass_secret is not null then
    v_headers := v_headers || jsonb_build_object(
      'x-vercel-protection-bypass',
      v_vercel_bypass_secret
    );
  end if;

  select net.http_get(
    url := v_url,
    headers := v_headers,
    timeout_milliseconds := 10000
  )
  into v_request_id;

  return v_request_id;
end;
$$;

revoke all on function app_private.invoke_due_report_deliveries()
from public, anon, authenticated;

select cron.schedule(
  'stallorder-report-deliveries',
  '*/5 * * * *',
  'select app_private.invoke_due_report_deliveries()'
);
