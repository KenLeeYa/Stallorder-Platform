do $migration$
declare
  duplicate_job record;
begin
  if not exists (
    select 1
    from cron.job
    where jobname = 'stallorder-expire-unconfirmed-orders'
      and command = 'select public.expire_unconfirmed_orders()'
      and active
  ) then
    raise exception 'DIRECT_ORDER_EXPIRY_CRON_REQUIRED';
  end if;

  for duplicate_job in
    select jobid
    from cron.job
    where jobname = 'invoke-vercel-preview-process-orders'
  loop
    perform cron.unschedule(duplicate_job.jobid);
  end loop;
end
$migration$;
