# Vercel Preview Process Orders Cron

This cron is for calling a Vercel Preview deployment protected by Deployment Protection. It is separate from the production report-delivery cron.

## Endpoint

```text
POST /api/cron/process-orders
```

The endpoint runs the existing order maintenance job:

```sql
select public.expire_unconfirmed_orders()
```

It accepts only `POST`, requires `Authorization: Bearer <CRON_API_SECRET>`, uses timing-safe comparison, and never logs authorization or Vercel bypass headers.

## Required Environment Variables

Preview Vercel environment:

```dotenv
CRON_API_SECRET=<at least 32 random bytes>
VERCEL_PREVIEW_URL=https://<preview-host>.vercel.app
```

`CRON_API_SECRET` is server-only. Do not use `NEXT_PUBLIC_`.

## Supabase Vault Secrets

Create these in the Staging Supabase project only after the Preview URL and secrets are known:

```sql
select vault.create_secret(
  'https://<preview-host>',
  'vercel_preview_url',
  'StallOrder Vercel Preview URL for process-orders cron'
);

select vault.create_secret(
  '<VERCEL_PROTECTION_BYPASS_SECRET>',
  'vercel_bypass_secret',
  'StallOrder Vercel Protection Bypass for Preview cron'
);

select vault.create_secret(
  '<CRON_API_SECRET>',
  'cron_api_secret',
  'StallOrder process-orders cron API bearer secret'
);
```

The bypass secret is sent only as the `x-vercel-protection-bypass` header. Do not put it in a URL query parameter.

`vercel_preview_url` is intentionally restricted to `https://*.vercel.app` without a path, query string, or fragment so the cron cannot be turned into an arbitrary HTTP caller.

## Supabase Cron

Migration creates:

```text
internal.invoke_vercel_preview_cron()
invoke-vercel-preview-process-orders
```

Schedule:

```cron
*/5 * * * *
```

Command:

```sql
select internal.invoke_vercel_preview_cron();
```

The cron command stores only the function call, not secrets.

## Verification

Run these after Vault secrets are configured:

```sql
select internal.invoke_vercel_preview_cron();

select id, status_code, error_msg, created
from net._http_response
order by id desc
limit 5;

select jobname, schedule, command, active
from cron.job
where jobname = 'invoke-vercel-preview-process-orders';

select jobid, runid, status, return_message, start_time, end_time
from cron.job_run_details
order by start_time desc
limit 20;
```

Expected result: `status_code = 200`, no timeout, and `error_msg is null`.
