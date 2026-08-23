-- Printing and KDS are independent modules. A confirmed order must reach the
-- configured print queue even when the merchant intentionally keeps KDS off.
create or replace function public.queue_confirmed_order_print_job()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_printer_id uuid;
begin
  if new.status <> 'CONFIRMED'::public.order_status
     or (tg_op = 'UPDATE' and old.status = 'CONFIRMED'::public.order_status)
     or not exists (
       select 1
       from public.stall_ordering_settings settings
       where settings.stall_id = new.stall_id
         and settings.organization_id = new.organization_id
         and settings.print_module_enabled
     ) then
    return null;
  end if;

  select printer.id into v_printer_id
  from public.printers printer
  where printer.stall_id = new.stall_id
    and printer.organization_id = new.organization_id
    and printer.is_enabled
  order by (printer.last_seen_at >= now() - interval '90 seconds') desc,
    printer.last_seen_at desc nulls last, printer.created_at asc
  limit 1;

  insert into public.print_jobs (
    organization_id, stall_id, order_id, printer_id, status,
    queued_at, created_at, updated_at
  ) values (
    new.organization_id, new.stall_id, new.id, v_printer_id,
    'PENDING'::public.print_job_status, now(), now(), now()
  ) on conflict do nothing;
  return null;
end;
$$;

revoke all on function public.queue_confirmed_order_print_job() from public, anon, authenticated;
grant execute on function public.queue_confirmed_order_print_job() to service_role;
