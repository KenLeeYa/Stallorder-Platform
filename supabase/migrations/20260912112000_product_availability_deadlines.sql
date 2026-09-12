begin;
-- Daily/manual availability is separate from persistent numeric stock.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
alter table public.stall_products add column if not exists sold_out_until timestamptz;

create function public.product_next_service_day(p_stall_id uuid)
returns timestamptz language sql stable set search_path = public, pg_temp as $$
  select (
    date_trunc('day', (now() at time zone s.timezone) - make_interval(hours => coalesce(os.business_day_cutoff_hour, 0)))
    + interval '1 day' + make_interval(hours => coalesce(os.business_day_cutoff_hour, 0))
  ) at time zone s.timezone
  from public.stalls s left join public.stall_ordering_settings os on os.stall_id = s.id
  where s.id = p_stall_id;
$$;

create function public.product_manual_pause_active(p_sold_out boolean, p_until timestamptz)
returns boolean language sql stable parallel safe as $$
  select p_sold_out and (p_until is null or p_until > now());
$$;

create function public.set_product_sold_out_deadline()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if not new.is_sold_out then
    new.sold_out_until := null;
  elsif new.sold_out_until is null then
    new.sold_out_until := public.product_next_service_day(new.stall_id);
  end if;
  return new;
end;
$$;

create trigger stall_products_sold_out_deadline
before insert or update of is_sold_out, sold_out_until on public.stall_products
for each row execute function public.set_product_sold_out_deadline();

revoke all on function public.product_next_service_day(uuid) from public, anon, authenticated;
revoke all on function public.product_manual_pause_active(boolean, timestamptz) from public, anon, authenticated;
revoke all on function public.set_product_sold_out_deadline() from public, anon, authenticated;
grant execute on function public.product_next_service_day(uuid) to service_role;
grant execute on function public.product_manual_pause_active(boolean, timestamptz) to service_role;

-- Existing pause deadlines are backfilled only on the verified Primary writer
-- after schema Apply, then replicated. DR schema Apply must not change data.

comment on column public.stall_products.sold_out_until is
  'Manual pause expires at this instant. Numeric stock is never reset. Permanent delisting uses is_enabled=false.';

-- Canonical public RPCs retain their existing authorization, pricing and stock checks.
CREATE OR REPLACE FUNCTION public.create_public_order(p_order_id uuid, p_qr_token text, p_session_token_hash text, p_device_hash text, p_ip_hash text, p_qr_token_hash text, p_behavior_hash text, p_idempotency_key uuid, p_idempotency_hash text, p_customer_name text, p_customer_note text, p_items jsonb, p_tracking_token_hash text, p_pickup_code_hash text, p_request_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_session public.order_sessions%rowtype;
  v_result jsonb;
  v_order_id uuid;
  v_order_total integer;
  v_idempotent_replay boolean;
  v_fulfillment_at timestamptz := now();
  v_billing_code text;
begin
  select * into v_session
  from public.order_sessions session_record
  where session_record.token_hash = p_session_token_hash;

  if v_session.ordering_mode = 'PREORDER' then
    v_fulfillment_at := v_session.requested_fulfillment_at;
    if v_fulfillment_at is null then
      return jsonb_build_object('ok', false, 'code', 'PREORDER_TIME_REQUIRED');
    end if;
    if jsonb_typeof(p_items) = 'array' and exists (
      select 1
      from jsonb_array_elements(p_items) item
      left join public.stall_products assignment
        on assignment.stall_id = v_session.stall_id
       and assignment.organization_id = v_session.organization_id
       and assignment.product_id = (item->>'product_id')::uuid
      where assignment.product_id is null
         or not assignment.is_enabled
         or public.product_manual_pause_active(assignment.is_sold_out, assignment.sold_out_until)
         or (
           assignment.available_from is not null
           and v_fulfillment_at < assignment.available_from
         )
         or (
           assignment.available_until is not null
           and v_fulfillment_at >= assignment.available_until
         )
    ) then
      perform public.record_public_order_attempt(
        p_request_id, 'ORDER_SUBMIT', 'DENIED', 'PRODUCT_UNAVAILABLE',
        v_session.tenant_id, v_session.stall_id, v_session.qr_code_id,
        v_session.id, p_ip_hash, p_device_hash, p_qr_token_hash,
        p_session_token_hash, p_behavior_hash, p_idempotency_hash
      );
      return jsonb_build_object('ok', false, 'code', 'PRODUCT_UNAVAILABLE');
    end if;
  end if;

  if v_session.id is not null and jsonb_typeof(p_items) = 'array' then
    if exists (
      select 1
      from jsonb_array_elements(p_items) item
      where case
        when not (item ? 'bundle_choice_ids') then false
        when jsonb_typeof(item->'bundle_choice_ids') <> 'array' then true
        else jsonb_array_length(item->'bundle_choice_ids') > 50
      end
    ) or exists (
      select 1
      from (
        select requested.line_index, selected.value::uuid as choice_id
        from jsonb_array_elements(p_items) with ordinality as requested(item, line_index)
        cross join lateral jsonb_array_elements_text(
          coalesce(requested.item->'bundle_choice_ids', '[]'::jsonb)
        ) selected(value)
        group by requested.line_index, selected.value::uuid
        having count(*) > 1
      ) duplicate_selection
    ) then
      perform public.record_public_order_attempt(
        p_request_id, 'ORDER_SUBMIT', 'DENIED', 'INVALID_PRODUCT_BUNDLE',
        v_session.tenant_id, v_session.stall_id, v_session.qr_code_id,
        v_session.id, p_ip_hash, p_device_hash, p_qr_token_hash,
        p_session_token_hash, p_behavior_hash, p_idempotency_hash
      );
      return jsonb_build_object('ok', false, 'code', 'INVALID_PRODUCT_BUNDLE');
    end if;

    -- SINGLE products cannot carry bundle selections. A BUNDLE must have at
    -- least one configured group and every group must satisfy its trusted
    -- minimum/maximum selection bounds.
    if exists (
      with requested as (
        select (item->>'product_id')::uuid as product_id,
          coalesce(item->'bundle_choice_ids', '[]'::jsonb) as selected_choices
        from jsonb_array_elements(p_items) item
      )
      select 1
      from requested
      join public.products product
        on product.id = requested.product_id
       and product.organization_id = v_session.organization_id
      where (
        product.kind = 'SINGLE'::public.product_kind
        and jsonb_array_length(requested.selected_choices) <> 0
      ) or (
        product.kind = 'BUNDLE'::public.product_kind
        and not exists (
          select 1
          from public.product_bundle_choice_groups choice_group
          where choice_group.organization_id = v_session.organization_id
            and choice_group.bundle_product_id = product.id
        )
      ) or (
        product.kind = 'BUNDLE'::public.product_kind
        and exists (
          select 1
          from public.product_bundle_choice_groups choice_group
          cross join lateral (
            select count(*)::integer as selected_count
            from jsonb_array_elements_text(requested.selected_choices) selected(value)
            join public.product_bundle_choices choice
              on choice.id = selected.value::uuid
             and choice.organization_id = v_session.organization_id
             and choice.choice_group_id = choice_group.id
             and choice.is_enabled
          ) selection_count
          where choice_group.organization_id = v_session.organization_id
            and choice_group.bundle_product_id = product.id
            and (
              selection_count.selected_count < choice_group.min_selections
              or selection_count.selected_count > choice_group.max_selections
            )
        )
      )
    ) then
      perform public.record_public_order_attempt(
        p_request_id, 'ORDER_SUBMIT', 'DENIED', 'INVALID_PRODUCT_BUNDLE',
        v_session.tenant_id, v_session.stall_id, v_session.qr_code_id,
        v_session.id, p_ip_hash, p_device_hash, p_qr_token_hash,
        p_session_token_hash, p_behavior_hash, p_idempotency_hash
      );
      return jsonb_build_object('ok', false, 'code', 'INVALID_PRODUCT_BUNDLE');
    end if;

    -- Every selected id must belong to the requested bundle and resolve to an
    -- active SINGLE component that is currently sellable at this stall.
    if exists (
      select 1
      from jsonb_array_elements(p_items) item
      cross join lateral jsonb_array_elements_text(
        coalesce(item->'bundle_choice_ids', '[]'::jsonb)
      ) selected(value)
      left join public.product_bundle_choices choice
        on choice.id = selected.value::uuid
       and choice.organization_id = v_session.organization_id
       and choice.is_enabled
      left join public.product_bundle_choice_groups choice_group
        on choice_group.id = choice.choice_group_id
       and choice_group.organization_id = v_session.organization_id
       and choice_group.bundle_product_id = (item->>'product_id')::uuid
      left join public.products component
        on component.id = choice.component_product_id
       and component.organization_id = v_session.organization_id
       and component.kind = 'SINGLE'::public.product_kind
       and component.is_active
      left join public.product_categories component_category
        on component_category.id = component.category_id
       and component_category.organization_id = v_session.organization_id
       and component_category.is_active
      left join public.stall_products component_assignment
        on component_assignment.product_id = component.id
       and component_assignment.organization_id = v_session.organization_id
       and component_assignment.stall_id = v_session.stall_id
       and component_assignment.is_enabled
       and not public.product_manual_pause_active(component_assignment.is_sold_out, component_assignment.sold_out_until)
       and (
         component_assignment.available_from is null
         or component_assignment.available_from <= v_fulfillment_at
       )
       and (
         component_assignment.available_until is null
         or component_assignment.available_until > v_fulfillment_at
       )
      where choice.id is null
         or choice_group.id is null
         or component.id is null
         or component_category.id is null
         or component_assignment.product_id is null
    ) then
      perform public.record_public_order_attempt(
        p_request_id, 'ORDER_SUBMIT', 'DENIED', 'INVALID_PRODUCT_BUNDLE',
        v_session.tenant_id, v_session.stall_id, v_session.qr_code_id,
        v_session.id, p_ip_hash, p_device_hash, p_qr_token_hash,
        p_session_token_hash, p_behavior_hash, p_idempotency_hash
      );
      return jsonb_build_object('ok', false, 'code', 'INVALID_PRODUCT_BUNDLE');
    end if;
  end if;

  if v_session.ordering_mode = 'PREORDER' then
    -- The operational legacy wrapper evaluates availability at now(). The
    -- checks above use the trusted pickup time instead, while this explicit
    -- billing gate preserves the next layer before entering note validation.
    v_billing_code := public.billing_order_access_code(
      v_session.organization_id,
      true
    );
    if v_billing_code <> 'OK' then
      perform public.record_public_order_attempt(
        p_request_id, 'ORDER_SUBMIT', 'DENIED', v_billing_code,
        v_session.tenant_id, v_session.stall_id, v_session.qr_code_id,
        v_session.id, p_ip_hash, p_device_hash, p_qr_token_hash,
        p_session_token_hash, p_behavior_hash, p_idempotency_hash
      );
      return jsonb_build_object('ok', false, 'code', v_billing_code);
    end if;
    v_result := public.create_public_order_with_notes_legacy(
      p_order_id, p_qr_token, p_session_token_hash, p_device_hash, p_ip_hash,
      p_qr_token_hash, p_behavior_hash, p_idempotency_key, p_idempotency_hash,
      p_customer_name, p_customer_note, p_items, p_tracking_token_hash,
      p_pickup_code_hash, p_request_id
    );
  else
    v_result := public.create_public_order_bundle_legacy(
      p_order_id, p_qr_token, p_session_token_hash, p_device_hash, p_ip_hash,
      p_qr_token_hash, p_behavior_hash, p_idempotency_key, p_idempotency_hash,
      p_customer_name, p_customer_note, p_items, p_tracking_token_hash,
      p_pickup_code_hash, p_request_id
    );
  end if;
  if not coalesce((v_result->>'ok')::boolean, false) or not (v_result ? 'order') then
    return v_result;
  end if;

  v_order_id := (v_result #>> '{order,order_id}')::uuid;
  v_idempotent_replay := coalesce((v_result->>'idempotent_replay')::boolean, false);
  if not v_idempotent_replay then
    with inserted as (
      insert into public.order_item_note_options (
        organization_id, stall_id, order_item_id, note_group_id,
        note_option_id, group_name, option_name, price_delta, sort_order,
        created_at
      )
      select
        v_session.organization_id,
        v_session.stall_id,
        order_item.id,
        null,
        null,
        '套餐 · ' || choice_group.name,
        component.name || case when choice.quantity > 1
          then ' × ' || choice.quantity::text else '' end,
        choice.price_delta,
        choice_group.sort_order * 1000 + choice.sort_order,
        now()
      from jsonb_array_elements(p_items) with ordinality as requested(item, line_index)
      cross join lateral jsonb_array_elements_text(
        coalesce(requested.item->'bundle_choice_ids', '[]'::jsonb)
      ) selected(value)
      join public.order_items order_item
        on order_item.order_id = v_order_id
       and order_item.source_line_index = requested.line_index
      join public.product_bundle_choices choice
        on choice.id = selected.value::uuid
       and choice.organization_id = v_session.organization_id
      join public.product_bundle_choice_groups choice_group
        on choice_group.id = choice.choice_group_id
       and choice_group.bundle_product_id = order_item.product_id
      join public.products component
        on component.id = choice.component_product_id
       and component.organization_id = v_session.organization_id
      returning order_item_id, price_delta
    ), affected as (
      select distinct order_item_id from inserted
    ), bundle_delta as (
      select order_item_id, sum(price_delta)::integer as price_delta
      from inserted
      group by order_item_id
    ), note_delta as (
      -- Data-modifying CTE rows are exposed through RETURNING, while this
      -- table scan intentionally sees only the pre-existing note selections.
      select option.order_item_id, sum(option.price_delta)::integer as price_delta
      from public.order_item_note_options option
      join affected on affected.order_item_id = option.order_item_id
      group by option.order_item_id
    ), trusted_price as (
      select order_item.id,
        order_item.base_unit_price
          + coalesce(note_delta.price_delta, 0)
          + bundle_delta.price_delta as unit_price
      from public.order_items order_item
      join affected on affected.order_item_id = order_item.id
      join bundle_delta on bundle_delta.order_item_id = order_item.id
      left join note_delta on note_delta.order_item_id = order_item.id
    )
    update public.order_items order_item
    set unit_price = greatest(0, trusted_price.unit_price)
    from trusted_price
    where order_item.id = trusted_price.id;

    select coalesce(sum(unit_price * quantity), 0)::integer
    into v_order_total
    from public.order_items
    where order_id = v_order_id;
    update public.orders
    set subtotal = v_order_total,
        total = v_order_total,
        updated_at = now()
    where id = v_order_id;
  else
    select total into v_order_total from public.orders where id = v_order_id;
  end if;

  v_result := jsonb_set(
    v_result,
    '{order,total_amount}',
    to_jsonb(v_order_total),
    true
  );
  return v_result;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.create_public_order_billing_legacy(p_order_id uuid, p_qr_token text, p_session_token_hash text, p_device_hash text, p_ip_hash text, p_qr_token_hash text, p_behavior_hash text, p_idempotency_key uuid, p_idempotency_hash text, p_customer_name text, p_customer_note text, p_items jsonb, p_tracking_token_hash text, p_pickup_code_hash text, p_request_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_session_id uuid;
  v_tenant_id uuid;
  v_organization_id uuid;
  v_stall_id uuid;
  v_qr_code_id uuid;
begin
  select session_record.id, session_record.tenant_id, session_record.organization_id,
    session_record.stall_id, session_record.qr_code_id
  into v_session_id, v_tenant_id, v_organization_id, v_stall_id, v_qr_code_id
  from public.order_sessions session_record
  where session_record.token_hash = p_session_token_hash;

  if v_stall_id is not null and jsonb_typeof(p_items) = 'array' and exists (
    select 1
    from jsonb_array_elements(p_items) item
    left join public.stall_products stall_product
      on stall_product.stall_id = v_stall_id
      and stall_product.organization_id = v_organization_id
      and stall_product.product_id = (item->>'product_id')::uuid
    where stall_product.id is null
      or not stall_product.is_enabled
      or public.product_manual_pause_active(stall_product.is_sold_out, stall_product.sold_out_until)
      or (stall_product.available_from is not null and now() < stall_product.available_from)
      or (stall_product.available_until is not null and now() >= stall_product.available_until)
  ) then
    perform public.record_public_order_attempt(
      p_request_id, 'ORDER_SUBMIT', 'DENIED', 'PRODUCT_UNAVAILABLE',
      v_tenant_id, v_stall_id, v_qr_code_id, v_session_id, p_ip_hash,
      p_device_hash, p_qr_token_hash, p_session_token_hash, p_behavior_hash,
      p_idempotency_hash
    );
    return jsonb_build_object('ok', false, 'code', 'PRODUCT_UNAVAILABLE');
  end if;

  return public.create_public_order_with_notes_legacy(
    p_order_id, p_qr_token, p_session_token_hash, p_device_hash, p_ip_hash,
    p_qr_token_hash, p_behavior_hash, p_idempotency_key, p_idempotency_hash,
    p_customer_name, p_customer_note, p_items, p_tracking_token_hash,
    p_pickup_code_hash, p_request_id
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.create_public_order_legacy(p_order_id uuid, p_qr_token text, p_session_token_hash text, p_device_hash text, p_ip_hash text, p_qr_token_hash text, p_behavior_hash text, p_idempotency_key uuid, p_idempotency_hash text, p_customer_name text, p_customer_note text, p_items jsonb, p_tracking_token_hash text, p_pickup_code_hash text, p_request_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_session public.order_sessions%rowtype;
  v_qr public.qr_codes%rowtype;
  v_stall public.stalls%rowtype;
  v_tenant public.tenants%rowtype;
  v_settings public.stall_ordering_settings%rowtype;
  v_existing jsonb;
  v_item_count integer;
  v_distinct_count integer;
  v_total_quantity integer;
  v_valid_product_count integer;
  v_total integer;
  v_pending_count integer;
  v_business_date date;
  v_sequence integer;
  v_order_no text;
  v_created_at timestamptz := now();
  v_allowed_ip boolean;
  v_allowed_device boolean;
  v_allowed_qr boolean;
  v_allowed_session boolean;
  v_allowed_stall boolean;
  v_allowed_behavior boolean;
begin
  select * into v_session
  from public.order_sessions
  where token_hash = p_session_token_hash
  for update;

  if not found then
    perform public.record_public_order_attempt(p_request_id, 'ORDER_SUBMIT', 'DENIED', 'SESSION_NOT_FOUND', null, null, null, null, p_ip_hash, p_device_hash, p_qr_token_hash, p_session_token_hash, p_behavior_hash, p_idempotency_hash);
    return jsonb_build_object('ok', false, 'code', 'SESSION_NOT_FOUND');
  end if;

  v_existing := public.lookup_public_order_idempotency(p_session_token_hash, p_idempotency_key);
  if v_existing is not null then
    perform public.record_public_order_attempt(p_request_id, 'ORDER_SUBMIT', 'ALLOWED', 'IDEMPOTENT_REPLAY', v_session.tenant_id, v_session.stall_id, v_session.qr_code_id, v_session.id, p_ip_hash, p_device_hash, p_qr_token_hash, p_session_token_hash, p_behavior_hash, p_idempotency_hash);
    return jsonb_build_object('ok', true, 'idempotent_replay', true, 'order', v_existing);
  end if;

  if v_session.status <> 'ACTIVE'::public.order_session_status then
    perform public.record_public_order_attempt(p_request_id, 'ORDER_SUBMIT', 'DENIED', 'SESSION_REPLAYED', v_session.tenant_id, v_session.stall_id, v_session.qr_code_id, v_session.id, p_ip_hash, p_device_hash, p_qr_token_hash, p_session_token_hash, p_behavior_hash, p_idempotency_hash);
    return jsonb_build_object('ok', false, 'code', 'SESSION_REPLAYED');
  elsif v_session.expires_at <= now() then
    update public.order_sessions set status = 'EXPIRED'::public.order_session_status where id = v_session.id;
    perform public.record_public_order_attempt(p_request_id, 'ORDER_SUBMIT', 'DENIED', 'SESSION_EXPIRED', v_session.tenant_id, v_session.stall_id, v_session.qr_code_id, v_session.id, p_ip_hash, p_device_hash, p_qr_token_hash, p_session_token_hash, p_behavior_hash, p_idempotency_hash);
    return jsonb_build_object('ok', false, 'code', 'SESSION_EXPIRED');
  elsif v_session.device_hash <> p_device_hash then
    perform public.record_public_order_attempt(p_request_id, 'ORDER_SUBMIT', 'DENIED', 'SESSION_DEVICE_MISMATCH', v_session.tenant_id, v_session.stall_id, v_session.qr_code_id, v_session.id, p_ip_hash, p_device_hash, p_qr_token_hash, p_session_token_hash, p_behavior_hash, p_idempotency_hash);
    return jsonb_build_object('ok', false, 'code', 'SESSION_DEVICE_MISMATCH');
  end if;

  select * into v_qr from public.qr_codes where id = v_session.qr_code_id for share;
  select * into v_stall from public.stalls where id = v_session.stall_id for share;
  select * into v_tenant from public.tenants where id = v_session.tenant_id for share;
  select * into v_settings from public.stall_ordering_settings where stall_id = v_session.stall_id;

  if v_qr.token <> p_qr_token then
    perform public.record_public_order_attempt(p_request_id, 'ORDER_SUBMIT', 'DENIED', 'QR_SESSION_MISMATCH', v_session.tenant_id, v_session.stall_id, v_session.qr_code_id, v_session.id, p_ip_hash, p_device_hash, p_qr_token_hash, p_session_token_hash, p_behavior_hash, p_idempotency_hash);
    return jsonb_build_object('ok', false, 'code', 'QR_SESSION_MISMATCH');
  elsif v_qr.state <> 'ACTIVE'::public.qr_code_state then
    perform public.record_public_order_attempt(p_request_id, 'ORDER_SUBMIT', 'DENIED', 'QR_NOT_ACTIVE', v_session.tenant_id, v_session.stall_id, v_session.qr_code_id, v_session.id, p_ip_hash, p_device_hash, p_qr_token_hash, p_session_token_hash, p_behavior_hash, p_idempotency_hash);
    return jsonb_build_object('ok', false, 'code', 'QR_NOT_ACTIVE');
  elsif v_qr.expires_at is not null and v_qr.expires_at <= now() then
    perform public.record_public_order_attempt(p_request_id, 'ORDER_SUBMIT', 'DENIED', 'QR_EXPIRED', v_session.tenant_id, v_session.stall_id, v_session.qr_code_id, v_session.id, p_ip_hash, p_device_hash, p_qr_token_hash, p_session_token_hash, p_behavior_hash, p_idempotency_hash);
    return jsonb_build_object('ok', false, 'code', 'QR_EXPIRED');
  elsif not v_stall.is_active or (
    v_stall.ordering_state = 'CLOSED'::public.stall_ordering_state
    and v_session.ordering_mode <> 'PREORDER'
  ) then
    perform public.record_public_order_attempt(p_request_id, 'ORDER_SUBMIT', 'DENIED', 'STALL_CLOSED', v_session.tenant_id, v_session.stall_id, v_session.qr_code_id, v_session.id, p_ip_hash, p_device_hash, p_qr_token_hash, p_session_token_hash, p_behavior_hash, p_idempotency_hash);
    return jsonb_build_object('ok', false, 'code', 'STALL_CLOSED');
  elsif v_stall.ordering_state = 'PAUSED'::public.stall_ordering_state then
    perform public.record_public_order_attempt(p_request_id, 'ORDER_SUBMIT', 'DENIED', 'ORDERING_PAUSED', v_session.tenant_id, v_session.stall_id, v_session.qr_code_id, v_session.id, p_ip_hash, p_device_hash, p_qr_token_hash, p_session_token_hash, p_behavior_hash, p_idempotency_hash);
    return jsonb_build_object('ok', false, 'code', 'ORDERING_PAUSED');
  elsif v_stall.is_sold_out then
    perform public.record_public_order_attempt(p_request_id, 'ORDER_SUBMIT', 'DENIED', 'STALL_SOLD_OUT', v_session.tenant_id, v_session.stall_id, v_session.qr_code_id, v_session.id, p_ip_hash, p_device_hash, p_qr_token_hash, p_session_token_hash, p_behavior_hash, p_idempotency_hash);
    return jsonb_build_object('ok', false, 'code', 'STALL_SOLD_OUT');
  elsif v_tenant.status not in ('TRIALING'::public.tenant_status, 'ACTIVE'::public.tenant_status, 'GRACE_PERIOD'::public.tenant_status) then
    perform public.record_public_order_attempt(p_request_id, 'ORDER_SUBMIT', 'DENIED', 'TENANT_INACTIVE', v_session.tenant_id, v_session.stall_id, v_session.qr_code_id, v_session.id, p_ip_hash, p_device_hash, p_qr_token_hash, p_session_token_hash, p_behavior_hash, p_idempotency_hash);
    return jsonb_build_object('ok', false, 'code', 'TENANT_INACTIVE');
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    perform public.record_public_order_attempt(p_request_id, 'ORDER_SUBMIT', 'DENIED', 'INVALID_ITEMS', v_session.tenant_id, v_session.stall_id, v_session.qr_code_id, v_session.id, p_ip_hash, p_device_hash, p_qr_token_hash, p_session_token_hash, p_behavior_hash, p_idempotency_hash);
    return jsonb_build_object('ok', false, 'code', 'INVALID_ITEMS');
  end if;

  select count(*), count(distinct product_id), coalesce(sum(quantity), 0)
  into v_item_count, v_distinct_count, v_total_quantity
  from jsonb_to_recordset(p_items) as item(product_id uuid, quantity integer, note text);

  if v_item_count > 100 or v_distinct_count > v_settings.max_unique_products then
    perform public.record_public_order_attempt(p_request_id, 'ORDER_SUBMIT', 'DENIED', 'TOO_MANY_OR_DUPLICATE_PRODUCTS', v_session.tenant_id, v_session.stall_id, v_session.qr_code_id, v_session.id, p_ip_hash, p_device_hash, p_qr_token_hash, p_session_token_hash, p_behavior_hash, p_idempotency_hash);
    return jsonb_build_object('ok', false, 'code', 'TOO_MANY_OR_DUPLICATE_PRODUCTS');
  elsif exists (
    with canonical_lines as (
      select
        (item->>'product_id')::uuid as product_id,
        btrim(coalesce(item->>'note', '')) as note,
        (
          select coalesce(jsonb_agg(selected.value::uuid order by selected.value::uuid), '[]'::jsonb)
          from jsonb_array_elements_text(coalesce(item->'modifier_option_ids', '[]'::jsonb)) selected(value)
        ) as modifier_option_ids,
        (
          select coalesce(jsonb_agg(selected.value::uuid order by selected.value::uuid), '[]'::jsonb)
          from jsonb_array_elements_text(coalesce(item->'bundle_choice_ids', '[]'::jsonb)) selected(value)
        ) as bundle_choice_ids
      from jsonb_array_elements(p_items) item
    )
    select 1
    from canonical_lines
    group by product_id, note, modifier_option_ids, bundle_choice_ids
    having count(*) > 1
  ) then
    perform public.record_public_order_attempt(p_request_id, 'ORDER_SUBMIT', 'DENIED', 'TOO_MANY_OR_DUPLICATE_PRODUCTS', v_session.tenant_id, v_session.stall_id, v_session.qr_code_id, v_session.id, p_ip_hash, p_device_hash, p_qr_token_hash, p_session_token_hash, p_behavior_hash, p_idempotency_hash);
    return jsonb_build_object('ok', false, 'code', 'TOO_MANY_OR_DUPLICATE_PRODUCTS');
  elsif v_total_quantity > v_settings.max_total_quantity then
    perform public.record_public_order_attempt(p_request_id, 'ORDER_SUBMIT', 'DENIED', 'EXCESSIVE_TOTAL_QUANTITY', v_session.tenant_id, v_session.stall_id, v_session.qr_code_id, v_session.id, p_ip_hash, p_device_hash, p_qr_token_hash, p_session_token_hash, p_behavior_hash, p_idempotency_hash);
    return jsonb_build_object('ok', false, 'code', 'EXCESSIVE_TOTAL_QUANTITY');
  elsif exists (
    select 1 from jsonb_to_recordset(p_items) as item(product_id uuid, quantity integer, note text)
    where item.quantity < 1 or item.quantity > v_settings.max_item_quantity
       or char_length(coalesce(item.note, '')) > v_settings.max_note_length
  ) or exists (
    select 1
    from jsonb_to_recordset(p_items) as item(product_id uuid, quantity integer)
    group by item.product_id
    having sum(item.quantity) > v_settings.max_item_quantity
  ) then
    perform public.record_public_order_attempt(p_request_id, 'ORDER_SUBMIT', 'DENIED', 'EXCESSIVE_ITEM_QUANTITY', v_session.tenant_id, v_session.stall_id, v_session.qr_code_id, v_session.id, p_ip_hash, p_device_hash, p_qr_token_hash, p_session_token_hash, p_behavior_hash, p_idempotency_hash);
    return jsonb_build_object('ok', false, 'code', 'EXCESSIVE_ITEM_QUANTITY');
  elsif char_length(coalesce(p_customer_note, '')) > v_settings.max_note_length then
    perform public.record_public_order_attempt(p_request_id, 'ORDER_SUBMIT', 'DENIED', 'NOTE_TOO_LONG', v_session.tenant_id, v_session.stall_id, v_session.qr_code_id, v_session.id, p_ip_hash, p_device_hash, p_qr_token_hash, p_session_token_hash, p_behavior_hash, p_idempotency_hash);
    return jsonb_build_object('ok', false, 'code', 'NOTE_TOO_LONG');
  end if;

  select
    count(*),
    coalesce(sum(coalesce(stall_product.price_override, product.default_price) * requested.quantity), 0)
  into v_valid_product_count, v_total
  from jsonb_to_recordset(p_items) as requested(product_id uuid, quantity integer, note text)
  join public.stall_products stall_product
    on stall_product.product_id = requested.product_id
   and stall_product.stall_id = v_session.stall_id
   and stall_product.organization_id = v_session.organization_id
  join public.products product
    on product.id = stall_product.product_id
   and product.organization_id = stall_product.organization_id
  where product.is_active
    and stall_product.is_enabled
    and not public.product_manual_pause_active(stall_product.is_sold_out, stall_product.sold_out_until);

  if v_valid_product_count <> v_item_count then
    perform public.record_public_order_attempt(p_request_id, 'ORDER_SUBMIT', 'DENIED', 'PRODUCT_UNAVAILABLE', v_session.tenant_id, v_session.stall_id, v_session.qr_code_id, v_session.id, p_ip_hash, p_device_hash, p_qr_token_hash, p_session_token_hash, p_behavior_hash, p_idempotency_hash);
    return jsonb_build_object('ok', false, 'code', 'PRODUCT_UNAVAILABLE');
  end if;

  select count(*) into v_pending_count
  from public.orders
  where stall_id = v_session.stall_id
    and device_hash = p_device_hash
    and status = 'WAITING_CONFIRMATION'::public.order_status
    and confirmation_expires_at > now();

  if v_pending_count >= v_settings.max_pending_orders_per_device then
    perform public.record_public_order_attempt(p_request_id, 'ORDER_SUBMIT', 'DENIED', 'TOO_MANY_PENDING_ORDERS', v_session.tenant_id, v_session.stall_id, v_session.qr_code_id, v_session.id, p_ip_hash, p_device_hash, p_qr_token_hash, p_session_token_hash, p_behavior_hash, p_idempotency_hash);
    return jsonb_build_object('ok', false, 'code', 'TOO_MANY_PENDING_ORDERS');
  end if;

  v_allowed_ip := public.consume_public_rate_limit(v_session.stall_id, 'ORDER_IP', p_ip_hash, v_settings.max_orders_per_window, v_settings.order_window_seconds);
  v_allowed_device := public.consume_public_rate_limit(v_session.stall_id, 'ORDER_DEVICE', p_device_hash, v_settings.max_orders_per_window, v_settings.order_window_seconds);
  v_allowed_qr := public.consume_public_rate_limit(v_session.stall_id, 'ORDER_QR', p_qr_token_hash, v_settings.max_orders_per_window * 20, v_settings.order_window_seconds);
  v_allowed_session := public.consume_public_rate_limit(v_session.stall_id, 'ORDER_SESSION', p_session_token_hash, 1, v_settings.order_window_seconds);
  v_allowed_stall := public.consume_public_rate_limit(v_session.stall_id, 'ORDER_STALL', encode(extensions.digest(v_session.stall_id::text, 'sha256'), 'hex'), v_settings.max_orders_per_window * 100, v_settings.order_window_seconds);
  v_allowed_behavior := public.consume_public_rate_limit(v_session.stall_id, 'ORDER_BEHAVIOR', p_behavior_hash, v_settings.max_behavior_frequency, v_settings.order_window_seconds);

  if not (v_allowed_ip and v_allowed_device and v_allowed_qr and v_allowed_session and v_allowed_stall and v_allowed_behavior) then
    perform public.record_public_order_attempt(p_request_id, 'ORDER_SUBMIT', 'DENIED', 'RATE_LIMITED', v_session.tenant_id, v_session.stall_id, v_session.qr_code_id, v_session.id, p_ip_hash, p_device_hash, p_qr_token_hash, p_session_token_hash, p_behavior_hash, p_idempotency_hash);
    return jsonb_build_object('ok', false, 'code', 'RATE_LIMITED');
  end if;

  v_business_date := (now() at time zone v_stall.timezone)::date;
  insert into public.stall_order_counters (stall_id, organization_id, business_date, next_value)
  values (v_session.stall_id, v_session.organization_id, v_business_date, 2)
  on conflict (stall_id, business_date)
  do update set next_value = public.stall_order_counters.next_value + 1
  returning next_value - 1 into v_sequence;
  v_order_no := to_char(v_business_date, 'YYMMDD') || '-' || lpad(v_sequence::text, 3, '0');

  insert into public.orders (
    id, tenant_id, organization_id, stall_id, order_no, tracking_token_hash,
    idempotency_key, source, customer_name, customer_phone,
    table_label, note, status, payment_status, total, device_hash,
    pickup_code_hash, confirmation_expires_at, created_at, updated_at
  ) values (
    p_order_id, v_session.tenant_id, v_session.organization_id, v_session.stall_id, v_order_no,
    p_tracking_token_hash, p_idempotency_key, 'QR_MENU',
    coalesce(nullif(left(trim(p_customer_name), 50), ''), '現場顧客'),
    null, null, nullif(left(trim(p_customer_note), v_settings.max_note_length), ''),
    'WAITING_CONFIRMATION'::public.order_status,
    'UNPAID'::public.payment_status, v_total, p_device_hash,
    p_pickup_code_hash,
    v_created_at + make_interval(secs => v_settings.unconfirmed_order_timeout_seconds),
    v_created_at, v_created_at
  );

  insert into public.order_items (
    id, tenant_id, organization_id, stall_id, order_id, product_id, name,
    unit_price, quantity, note, source_line_index, created_at
  )
  select
    gen_random_uuid(),
    v_session.tenant_id,
    v_session.organization_id,
    v_session.stall_id,
    p_order_id,
    product.id,
    product.name,
    coalesce(stall_product.price_override, product.default_price),
    (requested.item->>'quantity')::integer,
    nullif(left(trim(requested.item->>'note'), v_settings.max_note_length), ''),
    requested.line_index::smallint,
    v_created_at
  from jsonb_array_elements(p_items) with ordinality as requested(item, line_index)
  join public.stall_products stall_product
    on stall_product.product_id = (requested.item->>'product_id')::uuid
   and stall_product.stall_id = v_session.stall_id
   and stall_product.organization_id = v_session.organization_id
  join public.products product
    on product.id = stall_product.product_id
   and product.organization_id = stall_product.organization_id
  where product.is_active
    and stall_product.is_enabled
    and not public.product_manual_pause_active(stall_product.is_sold_out, stall_product.sold_out_until);

  update public.order_sessions
  set status = 'CONSUMED'::public.order_session_status,
      used_at = v_created_at,
      order_id = p_order_id
  where id = v_session.id and status = 'ACTIVE'::public.order_session_status;

  insert into public.order_events (
    id, tenant_id, organization_id, stall_id, order_id, event_type,
    previous_status, new_status, created_at
  ) values (
    gen_random_uuid(), v_session.tenant_id, v_session.organization_id, v_session.stall_id,
    p_order_id, 'PUBLIC_ORDER_CREATED', null,
    'WAITING_CONFIRMATION'::public.order_status, v_created_at
  );

  insert into public.audit_logs (
    id, tenant_id, organization_id, stall_id, action, entity_type, entity_id,
    outcome, request_id, ip_hash, metadata, created_at
  ) values (
    gen_random_uuid(), v_session.tenant_id, v_session.organization_id, v_session.stall_id,
    'PUBLIC_ORDER_CREATED', 'ORDER', p_order_id,
    'SUCCESS'::public.audit_outcome, left(p_request_id, 100), p_ip_hash,
    jsonb_build_object('itemCount', v_item_count, 'total', v_total)::text,
    v_created_at
  );

  perform public.record_public_order_attempt(p_request_id, 'ORDER_SUBMIT', 'ALLOWED', 'ORDER_CREATED', v_session.tenant_id, v_session.stall_id, v_session.qr_code_id, v_session.id, p_ip_hash, p_device_hash, p_qr_token_hash, p_session_token_hash, p_behavior_hash, p_idempotency_hash);
  return jsonb_build_object(
    'ok', true,
    'idempotent_replay', false,
    'order', jsonb_build_object(
      'order_id', p_order_id,
      'order_no', v_order_no,
      'order_status', 'WAITING_CONFIRMATION',
      'payment_status', 'UNPAID',
      'total_amount', v_total,
      'created_at', v_created_at
    )
  );
exception
  when unique_violation then
    v_existing := public.lookup_public_order_idempotency(p_session_token_hash, p_idempotency_key);
    if v_existing is not null then
      return jsonb_build_object('ok', true, 'idempotent_replay', true, 'order', v_existing);
    end if;
    perform public.record_public_order_attempt(p_request_id, 'ORDER_SUBMIT', 'ERROR', 'UNIQUE_CONFLICT', v_session.tenant_id, v_session.stall_id, v_session.qr_code_id, v_session.id, p_ip_hash, p_device_hash, p_qr_token_hash, p_session_token_hash, p_behavior_hash, p_idempotency_hash);
    return jsonb_build_object('ok', false, 'code', 'ORDER_CONFLICT');
  when others then
    perform public.record_public_order_attempt(p_request_id, 'ORDER_SUBMIT', 'ERROR', 'ORDER_CREATE_ERROR', v_session.tenant_id, v_session.stall_id, v_session.qr_code_id, v_session.id, p_ip_hash, p_device_hash, p_qr_token_hash, p_session_token_hash, p_behavior_hash, p_idempotency_hash);
    return jsonb_build_object('ok', false, 'code', 'ORDER_CREATE_ERROR');
end;
$function$
;

CREATE OR REPLACE FUNCTION public.create_public_order_with_free_lottery_reward_targeted(p_order_id uuid, p_qr_token text, p_session_token_hash text, p_device_hash text, p_ip_hash text, p_qr_token_hash text, p_behavior_hash text, p_idempotency_key uuid, p_idempotency_hash text, p_customer_name text, p_customer_phone text, p_delivery_address text, p_customer_note text, p_items jsonb, p_tracking_token_hash text, p_pickup_code_hash text, p_request_id text, p_wait_acknowledged boolean, p_requested_fulfillment_at timestamptz, p_lottery_draw_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
     and not public.product_manual_pause_active(stall_product.is_sold_out, stall_product.sold_out_until)
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
$function$
;

CREATE OR REPLACE FUNCTION public.get_stall_best_sellers(p_stall_id uuid)
 RETURNS TABLE(product_id uuid, rank integer)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
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
      and not public.product_manual_pause_active(assignment.is_sold_out, assignment.sold_out_until)
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
$function$
;
commit;
