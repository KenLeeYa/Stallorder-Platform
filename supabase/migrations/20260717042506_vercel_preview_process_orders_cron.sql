create schema if not exists internal;
revoke all on schema internal from public, anon, authenticated;

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

create or replace function internal.invoke_vercel_preview_cron()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_preview_url text;
  v_bypass_secret text;
  v_cron_api_secret text;
  v_endpoint_url text;
  v_request_id uuid := gen_random_uuid();
  v_http_request_id bigint;
begin
  select nullif(decrypted_secret, '')
  into v_preview_url
  from vault.decrypted_secrets
  where name = 'vercel_preview_url'
  order by updated_at desc
  limit 1;

  select nullif(decrypted_secret, '')
  into v_bypass_secret
  from vault.decrypted_secrets
  where name = 'vercel_bypass_secret'
  order by updated_at desc
  limit 1;

  select nullif(decrypted_secret, '')
  into v_cron_api_secret
  from vault.decrypted_secrets
  where name = 'cron_api_secret'
  order by updated_at desc
  limit 1;

  if v_preview_url is null or v_bypass_secret is null or v_cron_api_secret is null then
    raise exception 'VERCEL_PREVIEW_CRON_NOT_CONFIGURED' using errcode = 'P0001';
  end if;

  v_preview_url := regexp_replace(v_preview_url, '/+$', '');

  if v_preview_url !~ '^https://[A-Za-z0-9][A-Za-z0-9.-]*\.vercel\.app$'
    or v_preview_url ~* '(^https://localhost\.|^https://127\.|^https://0\.|^https://10\.|^https://172\.(1[6-9]|2[0-9]|3[0-1])\.|^https://192\.168\.)'
  then
    raise exception 'VERCEL_PREVIEW_URL_INVALID' using errcode = 'P0001';
  end if;

  v_endpoint_url := v_preview_url || '/api/cron/process-orders';

  select net.http_post(
    url := v_endpoint_url,
    body := jsonb_build_object(
      'source', 'supabase-pg-net-cron',
      'triggered_at', now(),
      'request_id', v_request_id
    ),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-vercel-protection-bypass', v_bypass_secret,
      'Authorization', 'Bearer ' || v_cron_api_secret,
      'User-Agent', 'supabase-pg-net-cron/1.0'
    ),
    timeout_milliseconds := 10000
  )
  into v_http_request_id;

  return v_http_request_id;
end;
$$;

revoke all on function internal.invoke_vercel_preview_cron() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'invoke-vercel-preview-process-orders') then
    perform cron.unschedule('invoke-vercel-preview-process-orders');
  end if;

  perform cron.schedule(
    'invoke-vercel-preview-process-orders',
    '*/5 * * * *',
    'select internal.invoke_vercel_preview_cron();'
  );
end;
$$;
