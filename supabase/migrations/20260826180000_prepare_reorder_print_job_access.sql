-- The public reorder Edge Function must fail closed after any print work starts.
-- Expose only the boolean guard through a server-only RPC instead of granting
-- the Edge runtime direct access to the existing print_jobs table.
create function public.reorder_print_job_started(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.print_jobs
    where order_id = p_order_id
      and status <> 'PENDING'
  );
$$;

revoke all on function public.reorder_print_job_started(uuid)
from public, anon, authenticated;
grant execute on function public.reorder_print_job_started(uuid)
to service_role;
