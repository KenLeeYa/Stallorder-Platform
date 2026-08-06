-- Keep one server-authoritative definition of "best seller" for both the QR
-- menu and lottery recommendations. Refunded, synthetic, inactive, disabled,
-- and sold-out products must not occupy a public Top 3 position.

create or replace function public.get_stall_best_sellers(p_stall_id uuid)
returns table (
  product_id uuid,
  rank integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  with product_sales as (
    select
      order_item.product_id,
      sum(order_item.quantity)::bigint as units_sold,
      count(distinct order_record.id)::bigint as order_count,
      max(order_record.completed_at) as latest_sale_at
    from public.orders as order_record
    join public.order_items as order_item
      on order_item.order_id = order_record.id
      and order_item.stall_id = order_record.stall_id
    join public.stall_products as assignment
      on assignment.organization_id = order_record.organization_id
      and assignment.stall_id = order_record.stall_id
      and assignment.product_id = order_item.product_id
      and assignment.is_enabled
      and not assignment.is_sold_out
    join public.products as product
      on product.id = order_item.product_id
      and product.organization_id = order_record.organization_id
      and product.is_active
    join public.product_categories as category
      on category.id = product.category_id
      and category.organization_id = product.organization_id
      and category.is_active
    where order_record.stall_id = p_stall_id
      and order_record.status = 'COMPLETED'::public.order_status
      and order_record.payment_status <> 'REFUNDED'::public.payment_status
      and order_record.origin not in (
        'TEST'::public.order_origin,
        'SYSTEM_CANARY'::public.order_origin
      )
      and not order_record.is_test
      and order_record.cancelled_at is null
      and order_record.completed_at >= now() - interval '30 days'
    group by order_item.product_id
    having count(distinct order_record.id) >= 3
  ), ranked_products as (
    select
      product_sales.product_id,
      row_number() over (
        order by
          product_sales.units_sold desc,
          product_sales.order_count desc,
          product_sales.latest_sale_at desc,
          product_sales.product_id
      )::integer as rank
    from product_sales
  )
  select ranked_products.product_id, ranked_products.rank
  from ranked_products
  where ranked_products.rank <= 3
  order by ranked_products.rank;
$$;

comment on function public.get_stall_best_sellers(uuid) is
  'Returns the top three currently enabled products sold in at least three completed, non-refunded, non-synthetic orders for one stall in the trailing 30 days.';

revoke all on function public.get_stall_best_sellers(uuid)
from public, anon, authenticated;
grant execute on function public.get_stall_best_sellers(uuid)
to service_role;

alter table public.public_lottery_draws
  add column if not exists best_seller_rank integer,
  add column if not exists recommendation_basis text default 'DISCOVERY';

-- Keep this as an expand-only change. A constant default is metadata-only on
-- supported PostgreSQL versions, so historical rows are safely treated as
-- discovery draws without scanning sales or rewriting the draw table.
alter table public.public_lottery_draws
  alter column recommendation_basis set default 'DISCOVERY';

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
    where assignment.organization_id = p_organization_id
      and assignment.stall_id = p_stall_id
      and assignment.is_enabled
      and not assignment.is_sold_out
      and product.is_active
      and product.kind = 'SINGLE'::public.product_kind
      and product.is_lottery_eligible
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
      and order_record.origin not in (
        'TEST'::public.order_origin,
        'SYSTEM_CANARY'::public.order_origin
      )
      and not order_record.is_test
      and order_record.cancelled_at is null
      and order_record.completed_at >= now() - interval '30 days'
    group by eligible.product_id
    having count(distinct order_record.id) >= 3
  ), ranked_sales as (
    select
      eligible_sales.product_id,
      row_number() over (
        order by
          eligible_sales.units_sold desc,
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
    left join ranked_sales as ranked
      on ranked.product_id = eligible.product_id
  )
  select
    eligible.product_id,
    eligible.product_name,
    eligible.best_seller_rank,
    case when eligible.best_seller_rank is null then 'DISCOVERY' else 'BEST_SELLER' end,
    case eligible.best_seller_rank
      when 1 then 5
      when 2 then 3
      when 3 then 2
      else 1
    end
  from eligible_with_rank as eligible
  order by
    coalesce(eligible.best_seller_rank, 2147483647),
    eligible.assignment_sort_order,
    eligible.product_sort_order,
    eligible.product_id;
$$;

comment on function app_private.get_lottery_product_recommendation_pool(uuid, uuid) is
  'Returns trusted lottery candidates. Top 3 products receive bounded rank weights 5/3/2; every other eligible product remains in the discovery pool with weight 1.';

revoke all on function app_private.get_lottery_product_recommendation_pool(uuid, uuid)
from public, anon, authenticated;
grant execute on function app_private.get_lottery_product_recommendation_pool(uuid, uuid)
to service_role;

alter table public.public_lottery_draws
  drop constraint if exists public_lottery_draws_best_seller_rank_check,
  add constraint public_lottery_draws_best_seller_rank_check
    check (best_seller_rank is null or best_seller_rank between 1 and 3)
    not valid,
  drop constraint if exists public_lottery_draws_recommendation_snapshot_check,
  add constraint public_lottery_draws_recommendation_snapshot_check
    check (
      recommendation_basis is not null
      and (
        (recommendation_basis = 'BEST_SELLER' and best_seller_rank is not null)
      or (recommendation_basis = 'DISCOVERY' and best_seller_rank is null)
      )
    )
    not valid;

comment on column public.public_lottery_draws.best_seller_rank is
  'Snapshot of the selected product rank at draw time; null for discovery recommendations.';
comment on column public.public_lottery_draws.recommendation_basis is
  'Snapshot of whether the selected product came from BEST_SELLER or DISCOVERY at draw time. Legacy rows default safely to DISCOVERY without reconstructing historical rankings.';

create or replace function app_private.pick_lottery_recommendation_pool(
  p_bucket integer,
  p_has_best_seller boolean,
  p_has_discovery boolean
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_bucket is null or p_bucket not between 0 and 9999 then null
    when p_has_best_seller and p_has_discovery and p_bucket < 8000 then 'BEST_SELLER'
    when p_has_best_seller and p_has_discovery then 'DISCOVERY'
    when p_has_best_seller then 'BEST_SELLER'
    when p_has_discovery then 'DISCOVERY'
    else null
  end;
$$;

comment on function app_private.pick_lottery_recommendation_pool(integer, boolean, boolean) is
  'Uses an exact 80/20 bestseller-to-discovery split when both pools exist and falls back to the available pool.';

revoke all on function app_private.pick_lottery_recommendation_pool(integer, boolean, boolean)
from public, anon, authenticated;
grant execute on function app_private.pick_lottery_recommendation_pool(integer, boolean, boolean)
to service_role;

create or replace function public.draw_public_lottery(
  p_session_token_hash text,
  p_device_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.order_sessions%rowtype;
  v_stall public.stalls%rowtype;
  v_settings public.stall_ordering_settings%rowtype;
  v_existing public.public_lottery_draws%rowtype;
  v_product record;
  v_discount public.discount_options%rowtype;
  v_business_date date;
  v_expires_at timestamptz;
  v_random_bytes bytea;
  v_random_value integer;
  v_bucket integer;
  v_selected_discount_id uuid;
  v_has_weighted_discounts boolean;
  v_has_best_seller boolean;
  v_has_discovery boolean;
  v_recommendation_pool text;
  v_best_seller_rank integer;
  v_allowed_ip boolean;
  v_allowed_qr boolean;
  v_draw_id uuid := gen_random_uuid();
begin
  select * into v_session
  from public.order_sessions session_record
  where session_record.token_hash = p_session_token_hash
  for update;
  if not found
     or v_session.status <> 'ACTIVE'::public.order_session_status
     or v_session.expires_at <= now() then
    return jsonb_build_object('ok', false, 'code', 'SESSION_NOT_FOUND');
  end if;
  if v_session.device_hash <> p_device_hash then
    return jsonb_build_object('ok', false, 'code', 'SESSION_DEVICE_MISMATCH');
  end if;
  if v_session.ordering_mode <> 'DEFAULT' then
    return jsonb_build_object('ok', false, 'code', 'LOTTERY_UNAVAILABLE');
  end if;

  select * into v_stall from public.stalls where id = v_session.stall_id;
  select * into v_settings
  from public.stall_ordering_settings settings
  where settings.stall_id = v_session.stall_id;
  if not coalesce(v_settings.lottery_enabled, false)
     or not v_stall.is_active
     or v_stall.is_sold_out
     or exists (
       select 1 from public.qr_codes qr
       where qr.id = v_session.qr_code_id
         and (qr.dining_table_id is not null
           or qr.market_event_id is not null
           or qr.stall_schedule_id is not null
           or qr.fulfillment_type_context in (
             'DINE_IN'::public.fulfillment_type,
             'DELIVERY'::public.fulfillment_type
           ))
     ) then
    return jsonb_build_object('ok', false, 'code', 'LOTTERY_UNAVAILABLE');
  end if;

  v_business_date := app_private.stall_business_date(v_stall.id, now());
  select * into v_existing
  from public.public_lottery_draws draw
  where draw.stall_id = v_session.stall_id
    and draw.device_hash = p_device_hash
    and draw.business_date = v_business_date;
  if found then
    return jsonb_build_object(
      'ok', true,
      'drawId', v_existing.id,
      'productId', v_existing.selected_product_id,
      'productName', v_existing.selected_product_name,
      'bestSellerRank', case
        when coalesce(v_existing.recommendation_basis, 'DISCOVERY') = 'BEST_SELLER'
          then v_existing.best_seller_rank
        else null
      end,
      'recommendationBasis', coalesce(v_existing.recommendation_basis, 'DISCOVERY'),
      'recommendationStrategy', 'POPULARITY_30D',
      'discountWon', v_existing.discount_option_id is not null,
      'discountLabel', v_existing.discount_label,
      'discountRateBps', v_existing.discount_rate_bps,
      'expiresAt', v_existing.expires_at,
      'idempotentReplay', true
    );
  end if;

  -- A browser-provided device id is not a financial security boundary. Keep
  -- the per-device daily idempotency above, and cap new draws by the trusted
  -- session IP and QR scopes to prevent simple device-id rotation abuse.
  v_allowed_ip := public.consume_public_rate_limit(
    v_session.stall_id,
    'LOTTERY_IP',
    v_session.ip_hash,
    10,
    86400
  );
  v_allowed_qr := public.consume_public_rate_limit(
    v_session.stall_id,
    'LOTTERY_QR',
    encode(extensions.digest(v_session.qr_code_id::text, 'sha256'), 'hex'),
    500,
    86400
  );
  if not (v_allowed_ip and v_allowed_qr) then
    return jsonb_build_object('ok', false, 'code', 'LOTTERY_RATE_LIMITED');
  end if;

  select
    coalesce(bool_or(candidate.recommendation_pool = 'BEST_SELLER'), false),
    coalesce(bool_or(candidate.recommendation_pool = 'DISCOVERY'), false)
  into v_has_best_seller, v_has_discovery
  from app_private.get_lottery_product_recommendation_pool(
    v_session.organization_id,
    v_session.stall_id
  ) as candidate;

  -- Product recommendations use a separate exact bucket from the financial
  -- discount draw. When both pools exist, 80% uses the Top 3 weighted 5/3/2
  -- and 20% explores another eligible item. This keeps the result useful
  -- without permanently hiding lower-volume products.
  loop
    v_random_bytes := extensions.gen_random_bytes(2);
    v_random_value := get_byte(v_random_bytes, 0) * 256
      + get_byte(v_random_bytes, 1);
    exit when v_random_value < 60000;
  end loop;
  v_bucket := v_random_value % 10000;
  v_recommendation_pool := app_private.pick_lottery_recommendation_pool(
    v_bucket,
    v_has_best_seller,
    v_has_discovery
  );
  if v_recommendation_pool is null then
    return jsonb_build_object('ok', false, 'code', 'PRODUCT_UNAVAILABLE');
  end if;

  select
    candidate.product_id as id,
    candidate.product_name as name,
    candidate.best_seller_rank as rank
  into v_product
  from app_private.get_lottery_product_recommendation_pool(
    v_session.organization_id,
    v_session.stall_id
  ) as candidate
  cross join lateral generate_series(1, candidate.recommendation_weight) as ticket
  where candidate.recommendation_pool = v_recommendation_pool
  order by gen_random_uuid()
  limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'PRODUCT_UNAVAILABLE');
  end if;
  v_best_seller_rank := v_product.rank;

  select exists (
    select 1
    from public.stall_lottery_discount_chances chance
    join public.discount_options discount
      on discount.id = chance.discount_option_id
     and discount.stall_id = chance.stall_id
     and discount.is_enabled
    where chance.stall_id = v_session.stall_id
  ) into v_has_weighted_discounts;

  if v_has_weighted_discounts
     or (
       v_settings.lottery_discount_option_id is not null
       and v_settings.lottery_discount_win_rate_bps > 0
     ) then
    -- Reject the incomplete 5536-value tail before modulo so every bucket
    -- has exactly six representatives and the configured odds stay exact.
    loop
      v_random_bytes := extensions.gen_random_bytes(2);
      v_random_value := get_byte(v_random_bytes, 0) * 256
        + get_byte(v_random_bytes, 1);
      exit when v_random_value < 60000;
    end loop;
    v_bucket := v_random_value % 10000;

    if v_has_weighted_discounts then
      v_selected_discount_id := app_private.pick_public_lottery_discount(
        v_session.stall_id,
        v_bucket
      );
      if v_selected_discount_id is not null then
        select * into v_discount
        from public.discount_options discount
        where discount.id = v_selected_discount_id
          and discount.organization_id = v_session.organization_id
          and discount.stall_id = v_session.stall_id
          and discount.is_enabled;
      end if;
    else
      select * into v_discount
      from public.discount_options discount
      where discount.id = v_settings.lottery_discount_option_id
        and discount.organization_id = v_session.organization_id
        and discount.stall_id = v_session.stall_id
        and discount.is_enabled;
      if found and v_bucket >= v_settings.lottery_discount_win_rate_bps then
        v_discount := null;
      end if;
    end if;
  end if;

  v_expires_at := (
    (v_business_date + 1)::timestamp
    + make_interval(hours => coalesce(v_settings.business_day_cutoff_hour, 0))
  ) at time zone v_stall.timezone;
  insert into public.public_lottery_draws (
    id, organization_id, stall_id, order_session_id, device_hash,
    business_date, selected_product_id, selected_product_name,
    best_seller_rank, recommendation_basis,
    discount_option_id, discount_label, discount_rate_bps, expires_at
  ) values (
    v_draw_id, v_session.organization_id, v_session.stall_id, v_session.id,
    p_device_hash, v_business_date, v_product.id, v_product.name,
    v_best_seller_rank, v_recommendation_pool,
    v_discount.id, v_discount.name, v_discount.rate_bps, v_expires_at
  );

  return jsonb_build_object(
    'ok', true,
    'drawId', v_draw_id,
    'productId', v_product.id,
    'productName', v_product.name,
    'bestSellerRank', v_best_seller_rank,
    'recommendationBasis', v_recommendation_pool,
    'recommendationStrategy', 'POPULARITY_30D',
    'discountWon', v_discount.id is not null,
    'discountLabel', v_discount.name,
    'discountRateBps', v_discount.rate_bps,
    'expiresAt', v_expires_at,
    'idempotentReplay', false
  );
exception
  when unique_violation then
    select * into v_existing
    from public.public_lottery_draws draw
    where draw.stall_id = v_session.stall_id
      and draw.device_hash = p_device_hash
      and draw.business_date = v_business_date;
    return jsonb_build_object(
      'ok', true,
      'drawId', v_existing.id,
      'productId', v_existing.selected_product_id,
      'productName', v_existing.selected_product_name,
      'bestSellerRank', case
        when coalesce(v_existing.recommendation_basis, 'DISCOVERY') = 'BEST_SELLER'
          then v_existing.best_seller_rank
        else null
      end,
      'recommendationBasis', coalesce(v_existing.recommendation_basis, 'DISCOVERY'),
      'recommendationStrategy', 'POPULARITY_30D',
      'discountWon', v_existing.discount_option_id is not null,
      'discountLabel', v_existing.discount_label,
      'discountRateBps', v_existing.discount_rate_bps,
      'expiresAt', v_existing.expires_at,
      'idempotentReplay', true
    );
end;
$$;

comment on function public.draw_public_lottery(text, text) is
  'Draws one daily product recommendation using a bounded 30-day bestseller strategy, then independently draws any configured discount.';

revoke all on function public.draw_public_lottery(text, text)
from public, anon, authenticated;
grant execute on function public.draw_public_lottery(text, text)
to service_role;
