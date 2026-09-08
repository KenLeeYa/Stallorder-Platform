-- Gift insertion explicitly excludes order discounts. The older product snapshot
-- trigger overwrote that exclusion with the product's ordinary sale setting.
create or replace function public.snapshot_order_item_discount_eligibility()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_is_eligible boolean;
begin
  if new.product_id is null then
    new.is_order_discount_eligible := new.promotion_source <> 'LOTTERY_FREE_PRODUCT'
      and coalesce(new.is_order_discount_eligible, true);
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

  new.is_order_discount_eligible := new.promotion_source <> 'LOTTERY_FREE_PRODUCT'
    and v_is_eligible;
  return new;
end;
$$;
