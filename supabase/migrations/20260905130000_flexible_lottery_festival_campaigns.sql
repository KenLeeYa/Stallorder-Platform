-- Store festival lottery campaigns as first-class stall-owned records so one
-- stall can schedule multiple named periods with independent product pools.

create table public.stall_lottery_campaigns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  stall_id uuid not null,
  name varchar(80) not null,
  is_enabled boolean not null default false,
  starts_on date not null,
  ends_on date not null,
  product_ids uuid[] not null default '{}'::uuid[],
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint stall_lottery_campaigns_organization_fkey
    foreign key (organization_id) references public.organizations(id) on delete cascade,
  constraint stall_lottery_campaigns_stall_scope_fkey
    foreign key (stall_id, organization_id)
    references public.stalls(id, organization_id) on delete cascade,
  constraint stall_lottery_campaigns_name_check
    check (length(btrim(name)) between 1 and 80),
  constraint stall_lottery_campaigns_dates_check
    check (starts_on <= ends_on),
  constraint stall_lottery_campaigns_product_count_check
    check (cardinality(product_ids) <= 100 and array_position(product_ids, null) is null),
  constraint stall_lottery_campaigns_enabled_products_check
    check (not is_enabled or cardinality(product_ids) > 0),
  constraint stall_lottery_campaigns_sort_order_check
    check (sort_order between 0 and 10000)
);

create unique index stall_lottery_campaigns_active_name_key
  on public.stall_lottery_campaigns (organization_id, stall_id, lower(btrim(name)))
  where deleted_at is null;
create index stall_lottery_campaigns_schedule_idx
  on public.stall_lottery_campaigns (stall_id, is_enabled, starts_on, ends_on)
  where deleted_at is null;
create index stall_lottery_campaigns_list_idx
  on public.stall_lottery_campaigns (organization_id, stall_id, sort_order)
  where deleted_at is null;

create function app_private.enforce_lottery_campaign_schedule()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.stall_id::text, 0));
  if new.is_enabled and new.deleted_at is null and exists (
    select 1
    from public.stall_lottery_campaigns campaign
    where campaign.stall_id = new.stall_id
      and campaign.organization_id = new.organization_id
      and campaign.id <> new.id
      and campaign.is_enabled
      and campaign.deleted_at is null
      and daterange(campaign.starts_on, campaign.ends_on, '[]')
        && daterange(new.starts_on, new.ends_on, '[]')
  ) then
    raise exception 'LOTTERY_CAMPAIGN_DATES_OVERLAP' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger enforce_lottery_campaign_schedule
before insert or update of stall_id, organization_id, is_enabled, starts_on, ends_on, deleted_at
on public.stall_lottery_campaigns
for each row execute function app_private.enforce_lottery_campaign_schedule();

alter table public.stall_lottery_campaigns enable row level security;
alter table public.stall_lottery_campaigns force row level security;
revoke all on table public.stall_lottery_campaigns from public, anon, authenticated;
grant select, insert, update, delete on table public.stall_lottery_campaigns to service_role;

comment on table public.stall_lottery_campaigns is
  'Named, non-overlapping festival lottery periods with independent stall product pools.';

alter table public.public_lottery_draws
  add column campaign_id uuid,
  add column campaign_name varchar(80);

alter table public.public_lottery_draws
  add constraint public_lottery_draws_campaign_fkey
    foreign key (campaign_id) references public.stall_lottery_campaigns(id) on delete set null,
  add constraint public_lottery_draws_campaign_snapshot_check
    check (
      campaign_id is null
      or length(btrim(campaign_name)) between 1 and 80
    );

create index public_lottery_draws_campaign_idx
  on public.public_lottery_draws (campaign_id)
  where campaign_id is not null;

create function app_private.get_festival_lottery_product_pool(
  p_organization_id uuid,
  p_stall_id uuid,
  p_campaign_id uuid
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
  select
    product.id,
    product.name::text,
    null::integer,
    'DISCOVERY'::text,
    1
  from public.stall_lottery_campaigns campaign
  join public.stall_products assignment
    on assignment.organization_id = campaign.organization_id
   and assignment.stall_id = campaign.stall_id
   and assignment.product_id = any(campaign.product_ids)
  join public.products product
    on product.id = assignment.product_id
   and product.organization_id = assignment.organization_id
  join public.product_categories category
    on category.id = product.category_id
   and category.organization_id = product.organization_id
   and category.is_active
  where campaign.id = p_campaign_id
    and campaign.organization_id = p_organization_id
    and campaign.stall_id = p_stall_id
    and campaign.deleted_at is null
    and campaign.is_enabled
    and assignment.is_enabled
    and not assignment.is_sold_out
    and product.is_active
    and product.kind = 'SINGLE'::public.product_kind
    and (assignment.available_from is null or assignment.available_from <= now())
    and (assignment.available_until is null or assignment.available_until > now())
  order by assignment.sort_order, product.sort_order, product.id;
$$;

revoke all on function app_private.get_festival_lottery_product_pool(uuid, uuid, uuid)
from public, anon, authenticated;
grant execute on function app_private.get_festival_lottery_product_pool(uuid, uuid, uuid)
to service_role;

-- Preserve the trusted selected product snapshot when the reward is redeemed.
drop trigger if exists enforce_stall_lottery_reward_product on public.order_items;
create or replace function app_private.enforce_stall_lottery_reward_product()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.lottery_draw_id is not null and not exists (
    select 1
    from public.public_lottery_draws draw
    join public.stall_products assignment
      on assignment.organization_id = draw.organization_id
     and assignment.stall_id = draw.stall_id
     and assignment.product_id = draw.selected_product_id
    join public.products product
      on product.id = assignment.product_id
     and product.organization_id = assignment.organization_id
    join public.product_categories category
      on category.id = product.category_id
     and category.organization_id = product.organization_id
    where draw.id = new.lottery_draw_id
      and draw.organization_id = new.organization_id
      and draw.stall_id = new.stall_id
      and draw.reward_kind = 'FREE_PRODUCT'
      and draw.selected_product_id = new.product_id
      and assignment.is_enabled
      and not assignment.is_sold_out
      and product.is_active
      and product.kind = 'SINGLE'::public.product_kind
      and category.is_active
      and (assignment.available_from is null or assignment.available_from <= now())
      and (assignment.available_until is null or assignment.available_until > now())
  ) then
    raise exception 'LOTTERY_REWARD_PRODUCT_UNAVAILABLE' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger enforce_stall_lottery_reward_product
before insert or update of lottery_draw_id, product_id, organization_id, stall_id
on public.order_items
for each row
when (new.lottery_draw_id is not null)
execute function app_private.enforce_stall_lottery_reward_product();

create or replace function public.draw_public_lottery(
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
  v_campaign public.stall_lottery_campaigns%rowtype;
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

  select * into v_campaign
  from public.stall_lottery_campaigns campaign
  where campaign.organization_id = v_session.organization_id
    and campaign.stall_id = v_session.stall_id
    and campaign.is_enabled
    and campaign.deleted_at is null
    and v_business_date between campaign.starts_on and campaign.ends_on
  order by campaign.sort_order, campaign.starts_on, campaign.id
  limit 1;

  if found then
    v_free_reward := true;
    v_qualification_type := 'FESTIVAL';
  elsif coalesce(v_settings.lottery_festival_reward_enabled, false)
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
     or coalesce(v_settings.lottery_festival_reward_enabled, false)
     or exists (
       select 1 from public.stall_lottery_campaigns campaign
       where campaign.stall_id = v_session.stall_id
         and campaign.organization_id = v_session.organization_id
         and campaign.is_enabled
         and campaign.deleted_at is null
     ) then
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
      'qualificationThresholdAmount', null,
      'campaignName', null
    );
  end if;

  if v_draw.redeemed_order_id is not null and v_draw.reward_kind <> 'FREE_PRODUCT' then
    return jsonb_build_object('ok', false, 'code', 'LOTTERY_ALREADY_REDEEMED');
  end if;

  if v_draw.reward_kind = 'FREE_PRODUCT' then
    return v_result || jsonb_build_object(
      'freeProductReward', true,
      'qualificationType', v_draw.qualification_type,
      'qualificationThresholdAmount', v_draw.qualification_threshold_amount,
      'campaignName', v_draw.campaign_name,
      'discountWon', false,
      'discountLabel', null,
      'discountRateBps', null
    );
  end if;

  if v_campaign.id is not null then
    select candidate.product_id as id, candidate.product_name as name,
      candidate.best_seller_rank as rank, candidate.recommendation_pool as pool
    into v_product
    from app_private.get_festival_lottery_product_pool(
      v_session.organization_id, v_session.stall_id, v_campaign.id
    ) candidate
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
  else
    select candidate.product_id as id, candidate.product_name as name,
      candidate.best_seller_rank as rank, candidate.recommendation_pool as pool
    into v_product
    from app_private.get_lottery_product_recommendation_pool(
      v_session.organization_id, v_session.stall_id
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
      campaign_id = v_campaign.id,
      campaign_name = v_campaign.name,
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
    'campaignName', v_campaign.name,
    'discountWon', false,
    'discountLabel', null,
    'discountRateBps', null
  );
end;
$$;

comment on function public.draw_public_lottery(text, text, integer) is
  'Draws a standard, spend, or active named festival reward using the campaign-specific product pool.';

revoke all on function public.draw_public_lottery(text, text, integer)
from public, anon, authenticated;
grant execute on function public.draw_public_lottery(text, text, integer)
to service_role;
