-- Product-level lottery recommendation eligibility defaults to enabled for
-- backward compatibility. Bundles remain excluded because their required
-- choices must be made explicitly by the customer.

alter table public.products
  add column if not exists is_lottery_eligible boolean not null default true;

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

  select product.id, product.name
  into v_product
  from public.stall_products assignment
  join public.products product
    on product.id = assignment.product_id
    and product.organization_id = assignment.organization_id
  join public.product_categories category
    on category.id = product.category_id
    and category.organization_id = product.organization_id
    and category.is_active
  where assignment.organization_id = v_session.organization_id
    and assignment.stall_id = v_session.stall_id
    and assignment.is_enabled
    and not assignment.is_sold_out
    and product.is_active
    and product.kind = 'SINGLE'::public.product_kind
    and product.is_lottery_eligible
    and (assignment.available_from is null or assignment.available_from <= now())
    and (assignment.available_until is null or assignment.available_until > now())
  order by gen_random_uuid()
  limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'PRODUCT_UNAVAILABLE');
  end if;

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
    discount_option_id, discount_label, discount_rate_bps, expires_at
  ) values (
    v_draw_id, v_session.organization_id, v_session.stall_id, v_session.id,
    p_device_hash, v_business_date, v_product.id, v_product.name,
    v_discount.id, v_discount.name, v_discount.rate_bps, v_expires_at
  );

  return jsonb_build_object(
    'ok', true,
    'drawId', v_draw_id,
    'productId', v_product.id,
    'productName', v_product.name,
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
      'discountWon', v_existing.discount_option_id is not null,
      'discountLabel', v_existing.discount_label,
      'discountRateBps', v_existing.discount_rate_bps,
      'expiresAt', v_existing.expires_at,
      'idempotentReplay', true
    );
end;
$$;

revoke all on function public.draw_public_lottery(text, text)
from public, anon, authenticated;
grant execute on function public.draw_public_lottery(text, text)
to service_role;
