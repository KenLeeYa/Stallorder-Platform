alter table public.products
  add column if not exists is_order_discount_eligible boolean not null default true;

alter table public.order_items
  add column if not exists is_order_discount_eligible boolean not null default true;

create or replace function public.snapshot_order_item_discount_eligibility()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_is_eligible boolean;
begin
  if new.product_id is null then
    new.is_order_discount_eligible := coalesce(new.is_order_discount_eligible, true);
    return new;
  end if;

  select product.is_order_discount_eligible
  into v_is_eligible
  from public.products product
  where product.id = new.product_id
    and product.organization_id = new.organization_id;

  if not found then
    raise exception 'ORDER_ITEM_PRODUCT_SCOPE_MISMATCH' using errcode = '23514';
  end if;

  new.is_order_discount_eligible := v_is_eligible;
  return new;
end;
$$;

drop trigger if exists order_items_snapshot_discount_eligibility_before_insert
  on public.order_items;
create trigger order_items_snapshot_discount_eligibility_before_insert
before insert on public.order_items
for each row execute function public.snapshot_order_item_discount_eligibility();

create or replace function public.enforce_lottery_order_discount_eligibility()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_eligible_subtotal numeric;
  v_discounted_eligible numeric;
begin
  if new.discount_source <> 'LOTTERY' or new.discount_rate_bps is null then
    return new;
  end if;

  select coalesce(sum(
    order_item.unit_price::numeric * order_item.quantity::numeric
  ) filter (where order_item.is_order_discount_eligible), 0)
  into v_eligible_subtotal
  from public.order_items order_item
  where order_item.order_id = new.id
    and order_item.organization_id = new.organization_id
    and order_item.stall_id = new.stall_id;

  if v_eligible_subtotal < 0 or v_eligible_subtotal > new.subtotal then
    raise exception 'ORDER_DISCOUNT_ELIGIBLE_SUBTOTAL_INVALID' using errcode = '23514';
  end if;

  v_discounted_eligible := round(
    (v_eligible_subtotal * new.discount_rate_bps::numeric) / 10000
  );
  new.discount_amount := (v_eligible_subtotal - v_discounted_eligible)::integer;
  new.total := new.subtotal - new.discount_amount;
  return new;
end;
$$;

drop trigger if exists orders_enforce_lottery_discount_eligibility_before_update
  on public.orders;
create trigger orders_enforce_lottery_discount_eligibility_before_update
before update of lottery_draw_id, discount_source, discount_rate_bps, subtotal
on public.orders
for each row
when (new.discount_source = 'LOTTERY')
execute function public.enforce_lottery_order_discount_eligibility();

revoke all on function public.snapshot_order_item_discount_eligibility()
  from public, anon, authenticated;
revoke all on function public.enforce_lottery_order_discount_eligibility()
  from public, anon, authenticated;
grant execute on function public.snapshot_order_item_discount_eligibility()
  to service_role;
grant execute on function public.enforce_lottery_order_discount_eligibility()
  to service_role;
