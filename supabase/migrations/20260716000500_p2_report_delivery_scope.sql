create or replace function public.enforce_report_delivery_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.report_schedules schedule
    where schedule.id = new.report_schedule_id
      and schedule.organization_id = new.organization_id
      and schedule.report_type = new.report_type
  ) then
    raise exception 'REPORT_DELIVERY_SCOPE_MISMATCH';
  end if;
  return new;
end;
$$;

create trigger report_deliveries_enforce_scope
before insert or update of organization_id, report_schedule_id, report_type
on public.report_deliveries
for each row execute function public.enforce_report_delivery_scope();
