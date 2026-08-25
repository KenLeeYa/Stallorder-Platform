-- Server-authoritative free-product lottery campaigns. The browser may show
-- qualification progress, but the final order subtotal is verified again in
-- the order transaction before a zero-price reward item is inserted.

alter table public.stall_ordering_settings
  add column if not exists lottery_spend_reward_enabled boolean not null default false,
  add column if not exists lottery_spend_threshold_amount integer not null default 666,
  add column if not exists lottery_festival_reward_enabled boolean not null default false,
  add column if not exists lottery_festival_starts_on date,
  add column if not exists lottery_festival_ends_on date,
  add column if not exists lottery_birthday_reward_enabled boolean not null default false;

alter table public.stall_ordering_settings
  add constraint stall_ordering_settings_lottery_spend_threshold_check
    check (lottery_spend_threshold_amount between 1 and 100000000),
  add constraint stall_ordering_settings_lottery_festival_dates_check
    check (
      not lottery_festival_reward_enabled
      or (
        lottery_festival_starts_on is not null
        and lottery_festival_ends_on is not null
        and lottery_festival_starts_on <= lottery_festival_ends_on
      )
    ),
  add constraint stall_ordering_settings_lottery_birthday_disabled_check
    check (not lottery_birthday_reward_enabled);

comment on column public.stall_ordering_settings.lottery_birthday_reward_enabled is
  'Reserved for a future verified member birthday and phone flow. It remains false until that identity boundary exists.';

alter table public.public_lottery_draws
  add column if not exists reward_kind text not null default 'RECOMMENDATION',
  add column if not exists qualification_type text not null default 'STANDARD',
  add column if not exists qualification_threshold_amount integer;

alter table public.public_lottery_draws
  add constraint public_lottery_draws_reward_kind_check
    check (reward_kind in ('RECOMMENDATION', 'FREE_PRODUCT')),
  add constraint public_lottery_draws_qualification_type_check
    check (qualification_type in ('STANDARD', 'SPEND', 'FESTIVAL')),
  add constraint public_lottery_draws_reward_snapshot_check
    check (
      (reward_kind = 'RECOMMENDATION' and qualification_type = 'STANDARD'
        and qualification_threshold_amount is null)
      or
      (reward_kind = 'FREE_PRODUCT' and qualification_type = 'FESTIVAL'
        and qualification_threshold_amount is null)
      or
      (reward_kind = 'FREE_PRODUCT' and qualification_type = 'SPEND'
        and qualification_threshold_amount between 1 and 100000000)
    );

alter table public.order_items
  add column if not exists promotion_source text not null default 'NONE',
  add column if not exists lottery_draw_id uuid;

alter table public.order_items
  add constraint order_items_promotion_source_check
    check (promotion_source in ('NONE', 'LOTTERY_FREE_PRODUCT')),
  add constraint order_items_lottery_draw_id_fkey
    foreign key (lottery_draw_id)
    references public.public_lottery_draws(id) on delete set null,
  add constraint order_items_lottery_reward_snapshot_check
    check (
      (promotion_source = 'NONE' and lottery_draw_id is null)
      or
      (promotion_source = 'LOTTERY_FREE_PRODUCT' and lottery_draw_id is not null
        and unit_price = 0 and quantity = 1)
    );

create unique index if not exists order_items_lottery_draw_unique
  on public.order_items (lottery_draw_id)
  where lottery_draw_id is not null;

comment on column public.order_items.promotion_source is
  'Immutable order-line provenance. LOTTERY_FREE_PRODUCT is a zero-price reward inserted by the order transaction.';

-- Preserve the existing two-argument draw for standard recommendations and
-- expose a three-argument campaign-aware overload. This keeps all current
-- rate limits and daily idempotency in one trusted implementation.
create function public.draw_public_lottery(
  p_session_token_hash text,
  p_device_hash text,
  p_cart_total integer
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
  v_draw public.public_lottery_draws%rowtype;
  v_product record;
  v_result jsonb;
  v_business_date date;
  v_qualification_type text := 'STANDARD';
  v_threshold integer;
  v_free_reward boolean := false;
begin
  if p_cart_total < 0 or p_cart_total > 100000000 then
    return jsonb_build_object('ok', false, 'code', 'INVALID_REQUEST');
  end if;

  select * into v_session
  from public.order_sessions session_record
  where session_record.token_hash = p_session_token_hash;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'SESSION_NOT_FOUND');
  end if;

  select * into v_stall from public.stalls where id = v_session.stall_id;
  select * into v_settings
  from public.stall_ordering_settings settings
  where settings.stall_id = v_session.stall_id;
  v_business_date := app_private.stall_business_date(v_stall.id, now());

  if coalesce(v_settings.lottery_festival_reward_enabled, false)
     and v_settings.lottery_festival_starts_on is not null
     and v_settings.lottery_festival_ends_on is not null
     and v_business_date between v_settings.lottery_festival_starts_on
                             and v_settings.lottery_festival_ends_on then
    v_free_reward := true;
    v_qualification_type := 'FESTIVAL';
  elsif coalesce(v_settings.lottery_spend_reward_enabled, false)
     and p_cart_total >= v_settings.lottery_spend_threshold_amount then
    v_free_reward := true;
    v_qualification_type := 'SPEND';
    v_threshold := v_settings.lottery_spend_threshold_amount;
  elsif coalesce(v_settings.lottery_spend_reward_enabled, false)
     or coalesce(v_settings.lottery_festival_reward_enabled, false) then
    return jsonb_build_object('ok', false, 'code', 'LOTTERY_NOT_ELIGIBLE');
  end if;

  v_result := public.draw_public_lottery(p_session_token_hash, p_device_hash);
  if not coalesce((v_result->>'ok')::boolean, false) then
    return v_result;
  end if;

  select * into v_draw
  from public.public_lottery_draws draw
  where draw.id = (v_result->>'drawId')::uuid
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'LOTTERY_DRAW_INVALID');
  end if;

  if not v_free_reward then
    return v_result || jsonb_build_object(
      'freeProductReward', false,
      'qualificationType', 'STANDARD',
      'qualificationThresholdAmount', null
    );
  end if;

  if v_draw.redeemed_order_id is not null
     and v_draw.reward_kind <> 'FREE_PRODUCT' then
    return jsonb_build_object('ok', false, 'code', 'LOTTERY_ALREADY_REDEEMED');
  end if;

  if v_draw.reward_kind = 'FREE_PRODUCT' then
    return v_result || jsonb_build_object(
      'freeProductReward', true,
      'qualificationType', v_draw.qualification_type,
      'qualificationThresholdAmount', v_draw.qualification_threshold_amount,
      'discountWon', false,
      'discountLabel', null,
      'discountRateBps', null
    );
  end if;

  -- Prefer the recommendation already drawn when it is a safe one-click gift.
  select
    candidate.product_id as id,
    candidate.product_name as name,
    candidate.best_seller_rank as rank,
    candidate.recommendation_pool as pool
  into v_product
  from app_private.get_lottery_product_recommendation_pool(
    v_session.organization_id,
    v_session.stall_id
  ) candidate
  where candidate.product_id = v_draw.selected_product_id
    and not exists (
      select 1
      from public.product_note_group_assignments assignment
      join public.product_note_groups note_group
        on note_group.id = assignment.note_group_id
       and note_group.organization_id = assignment.organization_id
       and note_group.is_active
      where assignment.organization_id = v_session.organization_id
        and assignment.product_id = candidate.product_id
        and assignment.is_active
        and (note_group.is_required or note_group.min_selections > 0)
    )
  limit 1;

  if not found then
    select
      candidate.product_id as id,
      candidate.product_name as name,
      candidate.best_seller_rank as rank,
      candidate.recommendation_pool as pool
    into v_product
    from app_private.get_lottery_product_recommendation_pool(
      v_session.organization_id,
      v_session.stall_id
    ) candidate
    cross join lateral generate_series(1, candidate.recommendation_weight) ticket
    where not exists (
      select 1
      from public.product_note_group_assignments assignment
      join public.product_note_groups note_group
        on note_group.id = assignment.note_group_id
       and note_group.organization_id = assignment.organization_id
       and note_group.is_active
      where assignment.organization_id = v_session.organization_id
        and assignment.product_id = candidate.product_id
        and assignment.is_active
        and (note_group.is_required or note_group.min_selections > 0)
    )
    order by gen_random_uuid()
    limit 1;
  end if;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'PRODUCT_UNAVAILABLE');
  end if;

  update public.public_lottery_draws
  set selected_product_id = v_product.id,
      selected_product_name = v_product.name,
      best_seller_rank = v_product.rank,
      recommendation_basis = v_product.pool,
      reward_kind = 'FREE_PRODUCT',
      qualification_type = v_qualification_type,
      qualification_threshold_amount = v_threshold,
      discount_option_id = null,
      discount_label = null,
      discount_rate_bps = null
  where id = v_draw.id;

  return v_result || jsonb_build_object(
    'productId', v_product.id,
    'productName', v_product.name,
    'bestSellerRank', v_product.rank,
    'recommendationBasis', v_product.pool,
    'freeProductReward', true,
    'qualificationType', v_qualification_type,
    'qualificationThresholdAmount', v_threshold,
    'discountWon', false,
    'discountLabel', null,
    'discountRateBps', null
  );
end;
$$;

comment on function public.draw_public_lottery(text, text, integer) is
  'Draws a standard recommendation or a qualifying spend/festival free-product reward. Final spend eligibility is rechecked during order creation.';

revoke all on function public.draw_public_lottery(text, text, integer)
from public, anon, authenticated;
grant execute on function public.draw_public_lottery(text, text, integer)
to service_role;

-- Add a new transaction entry point without replacing the existing order
-- functions. The application switches to this function only after the schema
-- migration is applied by the protected Production Apply workflow.
create function public.create_public_order_with_free_lottery_reward_targeted(
  p_order_id uuid,
  p_qr_token text,
  p_session_token_hash text,
  p_device_hash text,
  p_ip_hash text,
  p_qr_token_hash text,
  p_behavior_hash text,
  p_idempotency_key uuid,
  p_idempotency_hash text,
  p_customer_name text,
  p_customer_phone text,
  p_delivery_address text,
  p_customer_note text,
  p_items jsonb,
  p_tracking_token_hash text,
  p_pickup_code_hash text,
  p_request_id text,
  p_wait_acknowledged boolean,
  p_requested_fulfillment_at timestamptz,
  p_lottery_draw_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_order_id uuid;
  v_idempotent_replay boolean;
  v_draw public.public_lottery_draws%rowtype;
  v_order record;
  v_product record;
begin
  v_result := public.create_public_order_with_fulfillment_time_targeted(
    p_order_id, p_qr_token, p_session_token_hash, p_device_hash, p_ip_hash,
    p_qr_token_hash, p_behavior_hash, p_idempotency_key, p_idempotency_hash,
    p_customer_name, p_customer_phone, p_delivery_address, p_customer_note,
    p_items, p_tracking_token_hash,
    p_pickup_code_hash, p_request_id, p_wait_acknowledged,
    p_requested_fulfillment_at, p_lottery_draw_id
  );
  if not coalesce((v_result->>'ok')::boolean, false) or not (v_result ? 'order') then
    return v_result;
  end if;

  v_order_id := (v_result #>> '{order,order_id}')::uuid;
  v_idempotent_replay := coalesce((v_result->>'idempotent_replay')::boolean, false);
  if p_lottery_draw_id is null then
    return v_result;
  end if;

  select * into v_draw
  from public.public_lottery_draws draw
  where draw.id = p_lottery_draw_id
  for update;
  if not found
     or v_draw.reward_kind <> 'FREE_PRODUCT'
     or v_draw.redeemed_order_id is distinct from v_order_id then
    return v_result;
  end if;

  select order_record.tenant_id, order_record.organization_id,
         order_record.stall_id, order_record.subtotal
  into v_order
  from public.orders order_record
  where order_record.id = v_order_id
  for update;

  if v_draw.qualification_type = 'SPEND'
     and v_order.subtotal < v_draw.qualification_threshold_amount then
    raise exception 'LOTTERY_REWARD_NOT_ELIGIBLE' using errcode = '23514';
  end if;

  if not v_idempotent_replay and not exists (
    select 1 from public.order_items item
    where item.lottery_draw_id = v_draw.id
  ) then
    select
      product.id,
      product.name,
      coalesce(stall_product.price_override, product.default_price) as price
    into v_product
    from public.products product
    join public.product_categories category
      on category.id = product.category_id
     and category.organization_id = product.organization_id
     and category.is_active
    join public.stall_products stall_product
      on stall_product.product_id = product.id
     and stall_product.organization_id = product.organization_id
     and stall_product.stall_id = v_order.stall_id
     and stall_product.is_enabled
     and not stall_product.is_sold_out
     and (stall_product.available_from is null or stall_product.available_from <= now())
     and (stall_product.available_until is null or stall_product.available_until > now())
    where product.id = v_draw.selected_product_id
      and product.organization_id = v_order.organization_id
      and product.is_active
      and product.is_lottery_eligible
      and product.kind = 'SINGLE'::public.product_kind
      and not exists (
        select 1
        from public.product_note_group_assignments assignment
        join public.product_note_groups note_group
          on note_group.id = assignment.note_group_id
         and note_group.organization_id = assignment.organization_id
         and note_group.is_active
        where assignment.organization_id = product.organization_id
          and assignment.product_id = product.id
          and assignment.is_active
          and (note_group.is_required or note_group.min_selections > 0)
      );
    if not found then
      raise exception 'LOTTERY_REWARD_PRODUCT_UNAVAILABLE' using errcode = '23514';
    end if;

    insert into public.order_items (
      id, tenant_id, organization_id, stall_id, order_id, product_id, name,
      base_unit_price, unit_price, quantity, is_order_discount_eligible,
      promotion_source, lottery_draw_id, note, created_at
    ) values (
      gen_random_uuid(), v_order.tenant_id, v_order.organization_id,
      v_order.stall_id, v_order_id, v_product.id, v_product.name,
      v_product.price, 0, 1, false,
      'LOTTERY_FREE_PRODUCT', v_draw.id, '抽抽樂免費贈品', now()
    );

    update public.audit_logs
    set metadata = (
      coalesce(nullif(metadata, '')::jsonb, '{}'::jsonb)
      || jsonb_build_object(
        'lotteryRewardKind', 'FREE_PRODUCT',
        'lotteryRewardProductId', v_product.id,
        'lotteryRewardProductName', v_product.name,
        'lotteryRewardBasePrice', v_product.price,
        'lotteryQualificationType', v_draw.qualification_type,
        'lotteryQualificationThresholdAmount', v_draw.qualification_threshold_amount
      )
    )::text
    where entity_type = 'ORDER'
      and entity_id = v_order_id
      and action = 'PUBLIC_ORDER_CREATED';
  else
    select item.product_id as id, item.name
    into v_product
    from public.order_items item
    where item.lottery_draw_id = v_draw.id;
  end if;

  return jsonb_set(
    v_result,
    '{order,lottery_reward}',
    jsonb_build_object(
      'kind', 'FREE_PRODUCT',
      'product_id', v_product.id,
      'product_name', v_product.name,
      'amount', 0
    ),
    true
  );
end;
$$;

revoke all on function public.create_public_order_with_free_lottery_reward_targeted(
  uuid, text, text, text, text, text, text, uuid, text, text, text, text,
  text, jsonb, text, text, text, boolean, timestamptz, uuid
) from public, anon, authenticated;
grant execute on function public.create_public_order_with_free_lottery_reward_targeted(
  uuid, text, text, text, text, text, text, uuid, text, text, text, text,
  text, jsonb, text, text, text, boolean, timestamptz, uuid
) to service_role;

comment on function public.create_public_order_with_free_lottery_reward_targeted(
  uuid, text, text, text, text, text, text, uuid, text, text, text, text,
  text, jsonb, text, text, text, boolean, timestamptz, uuid
) is
  'Creates an order through the existing trusted transaction and atomically adds an eligible free-product lottery reward.';
