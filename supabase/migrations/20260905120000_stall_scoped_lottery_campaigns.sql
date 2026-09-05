-- Keep lottery campaign presentation and prize eligibility scoped to one stall.
-- Empty product lists retain the legacy product flag as a read-only compatibility
-- fallback; the merchant module writes an explicit stall-owned list on first save.

alter table public.stall_ordering_settings
  add column if not exists lottery_campaign_name varchar(80) not null default '抽抽樂',
  add column if not exists lottery_product_ids uuid[] not null default '{}'::uuid[];

alter table public.stall_ordering_settings
  add constraint stall_ordering_settings_lottery_campaign_name_check check (
    length(btrim(lottery_campaign_name)) between 1 and 80
  ),
  add constraint stall_ordering_settings_lottery_product_count_check check (
    cardinality(lottery_product_ids) <= 100
    and array_position(lottery_product_ids, null) is null
  );

comment on column public.stall_ordering_settings.lottery_campaign_name is
  'Merchant-defined customer-facing name for this stall lottery campaign.';
comment on column public.stall_ordering_settings.lottery_product_ids is
  'Ordered product IDs selected by this stall as trusted lottery candidates.';

create or replace function app_private.get_lottery_product_recommendation_pool(
  p_organization_id uuid,
  p_stall_id uuid
)
returns table (
  product_id uuid,
  product_name text,
  best_seller_rank integer,
  recommendation_pool text,
  recommendation_weight integer
)
language sql
stable
set search_path = ''
as $$
  with eligible_products as materialized (
    select
      product.id as product_id,
      product.name::text as product_name,
      assignment.sort_order as assignment_sort_order,
      product.sort_order as product_sort_order
    from public.stall_products as assignment
    join public.products as product
      on product.id = assignment.product_id
     and product.organization_id = assignment.organization_id
    join public.product_categories as category
      on category.id = product.category_id
     and category.organization_id = product.organization_id
     and category.is_active
    join public.stall_ordering_settings as settings
      on settings.stall_id = assignment.stall_id
     and settings.organization_id = assignment.organization_id
    where assignment.organization_id = p_organization_id
      and assignment.stall_id = p_stall_id
      and assignment.is_enabled
      and not assignment.is_sold_out
      and product.is_active
      and product.kind = 'SINGLE'::public.product_kind
      and (
        product.id = any(settings.lottery_product_ids)
        or (
          cardinality(settings.lottery_product_ids) = 0
          and product.is_lottery_eligible
        )
      )
      and (assignment.available_from is null or assignment.available_from <= now())
      and (assignment.available_until is null or assignment.available_until > now())
  ), eligible_sales as (
    select
      eligible.product_id,
      sum(order_item.quantity)::bigint as units_sold,
      count(distinct order_record.id)::bigint as order_count,
      max(order_record.completed_at) as latest_sale_at
    from eligible_products as eligible
    join public.order_items as order_item
      on order_item.organization_id = p_organization_id
     and order_item.stall_id = p_stall_id
     and order_item.product_id = eligible.product_id
    join public.orders as order_record
      on order_record.id = order_item.order_id
     and order_record.organization_id = order_item.organization_id
     and order_record.stall_id = order_item.stall_id
    where order_record.status = 'COMPLETED'::public.order_status
      and order_record.payment_status <> 'REFUNDED'::public.payment_status
      and order_record.origin not in ('TEST'::public.order_origin, 'SYSTEM_CANARY'::public.order_origin)
      and not order_record.is_test
      and order_record.cancelled_at is null
      and order_record.completed_at >= now() - interval '30 days'
    group by eligible.product_id
    having count(distinct order_record.id) >= 3
  ), ranked_sales as (
    select
      eligible_sales.product_id,
      row_number() over (
        order by eligible_sales.units_sold desc,
          eligible_sales.order_count desc,
          eligible_sales.latest_sale_at desc,
          eligible_sales.product_id
      )::integer as rank
    from eligible_sales
  ), eligible_with_rank as (
    select
      eligible.product_id,
      eligible.product_name,
      eligible.assignment_sort_order,
      eligible.product_sort_order,
      case when ranked.rank <= 3 then ranked.rank end as best_seller_rank
    from eligible_products as eligible
    left join ranked_sales as ranked on ranked.product_id = eligible.product_id
  )
  select
    eligible.product_id,
    eligible.product_name,
    eligible.best_seller_rank,
    case when eligible.best_seller_rank is null then 'DISCOVERY' else 'BEST_SELLER' end,
    case eligible.best_seller_rank when 1 then 5 when 2 then 3 when 3 then 2 else 1 end
  from eligible_with_rank as eligible
  order by coalesce(eligible.best_seller_rank, 2147483647),
    eligible.assignment_sort_order,
    eligible.product_sort_order,
    eligible.product_id;
$$;

comment on function app_private.get_lottery_product_recommendation_pool(uuid, uuid) is
  'Returns stall-selected lottery candidates and falls back to legacy flags only until the stall saves an explicit list.';

revoke all on function app_private.get_lottery_product_recommendation_pool(uuid, uuid)
from public, anon, authenticated;
grant execute on function app_private.get_lottery_product_recommendation_pool(uuid, uuid)
to service_role;

create function app_private.enforce_stall_lottery_reward_product()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.lottery_draw_id is not null and not exists (
    select 1
    from public.stall_ordering_settings settings
    join public.stall_products assignment
      on assignment.organization_id = settings.organization_id
     and assignment.stall_id = settings.stall_id
     and assignment.product_id = new.product_id
    join public.products product
      on product.id = new.product_id
      and product.organization_id = new.organization_id
    join public.product_categories category
      on category.id = product.category_id
     and category.organization_id = product.organization_id
    where settings.organization_id = new.organization_id
      and settings.stall_id = new.stall_id
      and assignment.is_enabled
      and not assignment.is_sold_out
      and (assignment.available_from is null or assignment.available_from <= now())
      and (assignment.available_until is null or assignment.available_until > now())
      and product.is_active
      and product.kind = 'SINGLE'::public.product_kind
      and category.is_active
      and (
        product.id = any(settings.lottery_product_ids)
        or (
          cardinality(settings.lottery_product_ids) = 0
          and product.is_lottery_eligible
        )
      )
  ) then
    raise exception 'LOTTERY_REWARD_PRODUCT_UNAVAILABLE' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function app_private.enforce_stall_lottery_reward_product()
from public, anon, authenticated;

create trigger enforce_stall_lottery_reward_product
before insert or update of lottery_draw_id, product_id, organization_id, stall_id
on public.order_items
for each row
when (new.lottery_draw_id is not null)
execute function app_private.enforce_stall_lottery_reward_product();

comment on function app_private.enforce_stall_lottery_reward_product() is
  'Rejects a lottery reward item unless the product belongs to the redeemed order stall campaign.';
