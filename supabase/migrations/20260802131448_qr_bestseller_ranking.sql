create index if not exists orders_bestseller_completed_idx
  on public.orders (stall_id, completed_at desc, id)
  where status = 'COMPLETED'::public.order_status
    and is_test = false
    and cancelled_at is null;

create or replace function public.get_stall_best_sellers(p_stall_id uuid)
returns table (
  product_id uuid,
  rank integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with product_sales as (
    select
      order_item.product_id,
      sum(order_item.quantity)::bigint as units_sold
    from public.orders as order_record
    join public.order_items as order_item
      on order_item.order_id = order_record.id
      and order_item.stall_id = order_record.stall_id
    where order_record.stall_id = p_stall_id
      and order_record.status = 'COMPLETED'::public.order_status
      and order_record.is_test = false
      and order_record.cancelled_at is null
      and order_record.completed_at >= now() - interval '30 days'
      and order_item.product_id is not null
    group by order_item.product_id
    having sum(order_item.quantity) >= 3
  ), ranked_products as (
    select
      product_sales.product_id,
      row_number() over (
        order by product_sales.units_sold desc, product_sales.product_id
      )::integer as rank
    from product_sales
  )
  select ranked_products.product_id, ranked_products.rank
  from ranked_products
  where ranked_products.rank <= 3
  order by ranked_products.rank;
$$;

comment on function public.get_stall_best_sellers(uuid) is
  'Returns the top three products with at least three completed, non-test units sold for one stall in the trailing 30 days.';

revoke all on function public.get_stall_best_sellers(uuid) from public;
revoke all on function public.get_stall_best_sellers(uuid) from anon;
revoke all on function public.get_stall_best_sellers(uuid) from authenticated;
grant execute on function public.get_stall_best_sellers(uuid) to service_role;
