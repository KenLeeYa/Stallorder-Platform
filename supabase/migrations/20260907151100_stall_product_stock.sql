-- SKU portions are stall-specific. NULL stock means unlimited; zero is sold out.
set lock_timeout = '5s';
set statement_timeout = '2min';
alter table public.stall_products
  add column stock_remaining integer,
  add column stock_version integer not null default 0,
  add column stock_started_at timestamptz,
  add constraint stall_products_stock_check check (stock_remaining >= 0),
  add constraint stall_products_stock_version_check check (stock_version >= 0);
alter table public.orders
  add column stock_allocations jsonb not null default '{}'::jsonb,
  add column stock_consumed boolean not null default false,
  add constraint orders_stock_allocations_object_check check (jsonb_typeof(stock_allocations) = 'object');

create or replace function app_private.version_stall_stock()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.stock_version := 0;
    new.stock_started_at := case when new.stock_remaining is not null then clock_timestamp() else null end;
  elsif new.stock_remaining is distinct from old.stock_remaining then
    new.stock_version := old.stock_version + 1;
    new.stock_started_at := case when new.stock_remaining is null then null
      when old.stock_remaining is null then clock_timestamp() else old.stock_started_at end;
  else
    new.stock_version := old.stock_version;
    new.stock_started_at := old.stock_started_at;
  end if;
  return new;
end;
$$;
create trigger stall_products_stock_version before insert or update on public.stall_products
  for each row execute function app_private.version_stall_stock();

-- Mark consumption once production starts; later cancellation/refund cannot restock it.
create or replace function app_private.mark_order_stock_consumed()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'orders' then
    new.stock_consumed := coalesce(new.stock_consumed, false)
      or (case when tg_op = 'UPDATE' then old.stock_consumed else false end)
      or new.status::text in ('PREPARING','PACKING','READY','COMPLETED');
  elsif new.status::text in ('PREPARING','READY','SERVED','COMPLETED') then
    update public.orders set stock_consumed = true where id = new.order_id and not stock_consumed;
  end if;
  return new;
end;
$$;
create trigger orders_mark_stock_consumed before insert or update on public.orders
  for each row execute function app_private.mark_order_stock_consumed();
create trigger order_items_mark_stock_consumed before insert or update of status on public.order_items
  for each row execute function app_private.mark_order_stock_consumed();
create trigger production_tasks_mark_stock_consumed before insert or update of status on public.order_production_tasks
  for each row execute function app_private.mark_order_stock_consumed();

-- Deferred reconciliation sees the final set of lines, including an amendment's
-- delete/recreate sequence. Per-SKU row locks prevent overselling; allocation
-- snapshots make retries and repeated trigger events idempotent.
create or replace function app_private.reconcile_order_stock()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_order public.orders%rowtype;
  v_product record;
  v_stock public.stall_products%rowtype;
  v_allocations jsonb;
  v_previous integer;
  v_desired integer;
  v_delta integer;
  v_same_epoch boolean;
  v_lines jsonb;
  v_cache_key text;
  v_fingerprint text;
begin
  if tg_table_name = 'orders' then v_id := new.id;
  elsif tg_op = 'DELETE' then v_id := old.order_id;
  else v_id := new.order_id;
  end if;
  select * into v_order from public.orders where id = v_id for update;
  if not found or v_order.source = 'MERCHANT_SETUP_TEST' then return null; end if;
  select coalesce(jsonb_object_agg(product_id::text, quantity), '{}'::jsonb) into v_lines
  from (select product_id, sum(quantity)::integer as quantity from public.order_items
    where order_id = v_id and product_id is not null group by product_id) lines;
  -- All deferred line events see the final lines. Avoid locking every SKU again
  -- for each duplicate event; the fingerprint changes if immediate-mode writes
  -- alter the order within this transaction. Durable allocations still govern retries.
  v_cache_key := 'stallorder.stock_' || replace(v_id::text, '-', '');
  v_fingerprint := md5(jsonb_build_array(v_order.status, v_order.stock_consumed, v_lines)::text);
  if current_setting(v_cache_key, true) = v_fingerprint then return null; end if;
  v_allocations := v_order.stock_allocations;
  for v_product in
    select product_id, sum(quantity)::integer as quantity from (
      select key::uuid as product_id, value::integer as quantity from jsonb_each_text(v_lines)
      union all
      select key::uuid, 0 from jsonb_each(v_allocations)
    ) lines group by product_id order by product_id
  loop
    select * into v_stock from public.stall_products
      where stall_id = v_order.stall_id and organization_id = v_order.organization_id
        and product_id = v_product.product_id for update;
    if not found or v_stock.stock_remaining is null then
      v_allocations := v_allocations - v_product.product_id::text;
      continue;
    end if;
    v_same_epoch := coalesce(
      (v_allocations #>> array[v_product.product_id::text, 'epoch'])::timestamptz = v_stock.stock_started_at, false);
    -- Switching from unlimited to counted stock starts with current sellable
    -- portions, not a retroactive deduction for already existing orders.
    if not v_same_epoch and v_order.created_at < v_stock.stock_started_at then continue; end if;
    v_previous := case when v_same_epoch then (v_allocations #>> array[v_product.product_id::text, 'quantity'])::integer else 0 end;
    v_desired := case when v_order.status::text in ('CANCELLED','EXPIRED') then
      case when v_order.stock_consumed then v_previous else 0 end
      when v_order.stock_consumed then greatest(v_previous, v_product.quantity)
      else v_product.quantity end;
    v_delta := v_desired - v_previous;
    if v_delta > v_stock.stock_remaining then
      raise exception using errcode = 'P0001', message = 'PRODUCT_STOCK_INSUFFICIENT';
    end if;
    if v_delta <> 0 then
      update public.stall_products set stock_remaining = stock_remaining - v_delta
        where id = v_stock.id;
    end if;
    v_allocations := jsonb_set(v_allocations, array[v_product.product_id::text],
      jsonb_build_object('quantity', v_desired, 'epoch', v_stock.stock_started_at));
  end loop;
  if v_allocations is distinct from v_order.stock_allocations then
    update public.orders set stock_allocations = v_allocations where id = v_id;
  end if;
  perform set_config(v_cache_key, v_fingerprint, true);
  return null;
end;
$$;
create constraint trigger order_items_reconcile_stock after insert or update or delete on public.order_items
  deferrable initially deferred for each row execute function app_private.reconcile_order_stock();
create constraint trigger orders_reconcile_stock after insert or update of status on public.orders
  deferrable initially deferred for each row execute function app_private.reconcile_order_stock();

revoke all on function app_private.version_stall_stock() from public, anon, authenticated;
revoke all on function app_private.mark_order_stock_consumed() from public, anon, authenticated;
revoke all on function app_private.reconcile_order_stock() from public, anon, authenticated;
