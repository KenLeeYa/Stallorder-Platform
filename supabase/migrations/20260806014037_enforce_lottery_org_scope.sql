-- Tighten the normalized prize scope so a malformed discount whose stall and
-- organization foreign keys disagree cannot enter another tenant's pool.

create or replace function public.enforce_lottery_discount_chance_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_total_bps integer;
begin
  perform 1
  from public.stalls stall
  where stall.id = new.stall_id
  for update;

  if not exists (
    select 1
    from public.discount_options discount
    join public.stalls stall
      on stall.id = new.stall_id
    where discount.id = new.discount_option_id
      and discount.stall_id = new.stall_id
      and discount.organization_id = stall.organization_id
  ) then
    raise exception 'LOTTERY_DISCOUNT_SCOPE_MISMATCH';
  end if;

  select coalesce(sum(chance.win_rate_bps), 0)::integer
  into v_total_bps
  from public.stall_lottery_discount_chances chance
  where chance.stall_id = new.stall_id
    and chance.discount_option_id <> new.discount_option_id;

  if v_total_bps + new.win_rate_bps > 10000 then
    raise exception 'LOTTERY_DISCOUNT_TOTAL_EXCEEDED';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_lottery_discount_chance_scope()
from public, anon, authenticated;
grant execute on function public.enforce_lottery_discount_chance_scope()
to service_role;
