-- Pickup and delivery use a shared five-minute clock grid. New stalls default
-- to five minutes while existing merchant-selected cadences remain unchanged.
-- Every supported interval starts on the next five-minute clock boundary so
-- the server slot list and the shared client picker cannot diverge.
set lock_timeout = '5s';
set statement_timeout = '2min';

alter table public.stall_ordering_settings
  alter column preorder_slot_minutes set default 5,
  drop constraint if exists stall_ordering_settings_preorder_slot_check,
  add constraint stall_ordering_settings_preorder_slot_check
    check (preorder_slot_minutes in (5, 15, 30, 60, 120)) not valid;

create or replace function public.get_takeout_preorder_slots(
  p_stall_id uuid,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_settings public.stall_ordering_settings%rowtype;
  v_stall public.stalls%rowtype;
begin
  select * into v_settings
  from public.stall_ordering_settings settings
  where settings.stall_id = p_stall_id;
  if not found then
    return '[]'::jsonb;
  end if;
  select * into v_stall
  from public.stalls stall
  where stall.id = p_stall_id;

  if not found
     or not (
       coalesce(v_settings.takeout_preorder_enabled, false)
       or coalesce(v_settings.delivery_module_enabled, false)
     )
     or not v_stall.is_active
     or v_stall.is_sold_out
     or v_stall.ordering_state = 'PAUSED'::public.stall_ordering_state
     or v_stall.business_status = 'PAUSED'::public.stall_business_status then
    return '[]'::jsonb;
  end if;

  return public.get_fulfillment_time_slots_raw(p_stall_id, p_now);
end;
$$;

revoke all on function public.get_takeout_preorder_slots(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.get_takeout_preorder_slots(uuid, timestamptz)
  to service_role;
