-- Phase 2: central entitlement decisions, transactional resource limits,
-- billable-order metering, usage warnings, and subscription maintenance.

-- Subscription status is the commercial source of truth. The legacy
-- organization status remains an operational gate and therefore stays ACTIVE
-- while a subscription is PAST_DUE or in GRACE_PERIOD.
update public.organizations organization
set status = 'ACTIVE'::public.tenant_status,
    updated_at = now()
where organization.status in (
  'PAST_DUE'::public.tenant_status,
  'GRACE_PERIOD'::public.tenant_status
)
and exists (
  select 1
  from public.subscriptions subscription
  where subscription.organization_id = organization.id
    and subscription.status in ('PAST_DUE', 'GRACE_PERIOD')
);

create or replace function public.billing_order_package_quantity(p_code text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_code
    when 'ORDER_PACKAGE_LITE_100' then 100
    when 'ORDER_PACKAGE_STANDARD_500' then 500
    when 'ORDER_PACKAGE_PRO_1000' then 1000
    else 0
  end;
$$;

create or replace function public.billing_order_access_code(
  p_organization_id uuid,
  p_lock boolean default true
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_subscription public.subscriptions%rowtype;
  v_version public.plan_versions%rowtype;
  v_order_count integer := 0;
  v_package_orders integer := 0;
begin
  if p_organization_id is null then
    return 'SUBSCRIPTION_NOT_ACTIVE';
  end if;

  if p_lock then
    select subscription.* into v_subscription
    from public.subscriptions subscription
    where subscription.organization_id = p_organization_id
    for update;
  else
    select subscription.* into v_subscription
    from public.subscriptions subscription
    where subscription.organization_id = p_organization_id;
  end if;

  if not found or v_subscription.status = 'CANCELLED' then
    return 'SUBSCRIPTION_NOT_ACTIVE';
  elsif v_subscription.status = 'SUSPENDED' then
    return 'SUBSCRIPTION_SUSPENDED';
  elsif v_subscription.status not in ('TRIALING', 'ACTIVE', 'PAST_DUE', 'GRACE_PERIOD') then
    return 'SUBSCRIPTION_NOT_ACTIVE';
  end if;

  select version.* into strict v_version
  from public.plan_versions version
  where version.id = v_subscription.plan_version_id;

  if not exists (
    select 1
    from public.plan_entitlements entitlement
    where entitlement.plan_version_id = v_subscription.plan_version_id
      and entitlement.feature_code = 'QR_ORDERING'
      and entitlement.is_enabled
  ) then
    return 'FEATURE_NOT_INCLUDED';
  end if;

  if v_subscription.status = 'TRIALING' then
    if v_subscription.trial_ends_at is null or v_subscription.trial_ends_at <= now() then
      return 'TRIAL_EXPIRED';
    end if;

    if v_version.included_orders is not null then
      select coalesce(sum(event.quantity), 0)::integer into v_order_count
      from public.usage_events event
      where event.organization_id = p_organization_id
        and event.event_type = 'BILLABLE_ORDER_COMPLETED'
        and event.occurred_at >= coalesce(v_subscription.trial_started_at, v_subscription.created_at)
        and event.occurred_at < v_subscription.trial_ends_at;

      if v_order_count >= v_version.included_orders then
        return 'TRIAL_ORDER_LIMIT_REACHED';
      end if;
    end if;
  elsif v_version.emergency_hard_cap_enabled then
    select coalesce(sum(event.quantity), 0)::integer into v_order_count
    from public.usage_events event
    where event.organization_id = p_organization_id
      and event.event_type = 'BILLABLE_ORDER_COMPLETED'
      and event.occurred_at >= v_subscription.billing_period_start
      and event.occurred_at < v_subscription.billing_period_end;

    select coalesce(sum(
      public.billing_order_package_quantity(item.code) * item.quantity
    ), 0)::integer into v_package_orders
    from public.subscription_items item
    where item.subscription_id = v_subscription.id
      and item.item_type = 'ORDER_PACKAGE'
      and item.status = 'ACTIVE'
      and item.starts_at < v_subscription.billing_period_end
      and (item.ends_at is null or item.ends_at >= v_subscription.billing_period_start);

    if v_order_count >= coalesce(v_version.emergency_hard_cap_orders, 0) + v_package_orders then
      return 'ORDER_PACKAGE_REQUIRED';
    end if;
  end if;

  return 'OK';
exception
  when no_data_found then
    return 'SUBSCRIPTION_NOT_ACTIVE';
end;
$$;

create or replace function public.billing_raise_if_denied(p_code text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_code <> 'OK' then
    raise exception using errcode = 'P0001', message = p_code;
  end if;
end;
$$;

create or replace function public.enforce_billing_resource_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid;
  v_subscription public.subscriptions%rowtype;
  v_version public.plan_versions%rowtype;
  v_current_count integer := 0;
  v_next_count integer := 0;
  v_approved_additional integer := 0;
  v_code text;
begin
  v_organization_id := new.organization_id;
  if v_organization_id is null then
    raise exception using errcode = 'P0001', message = 'SUBSCRIPTION_NOT_ACTIVE';
  end if;

  v_code := public.billing_order_access_code(v_organization_id, true);
  perform public.billing_raise_if_denied(v_code);

  select subscription.* into strict v_subscription
  from public.subscriptions subscription
  where subscription.organization_id = v_organization_id;
  select version.* into strict v_version
  from public.plan_versions version
  where version.id = v_subscription.plan_version_id;

  if tg_table_name = 'stalls' then
    if tg_op = 'UPDATE' and (old.is_active or not new.is_active) then
      return new;
    end if;
    select count(*)::integer into v_current_count
    from public.stalls stall
    where stall.organization_id = v_organization_id and stall.is_active
      and (tg_op = 'INSERT' or stall.id <> new.id);
    v_next_count := v_current_count + 1;
    if v_version.max_stalls is not null and v_next_count > v_version.max_stalls then
      raise exception using errcode = 'P0001', message = 'PLAN_LIMIT_REACHED';
    end if;
    select coalesce(sum(approval.quantity), 0)::integer into v_approved_additional
    from public.additional_stall_approvals approval
    where approval.subscription_id = v_subscription.id
      and approval.status = 'APPROVED'
      and approval.effective_at <= now()
      and (approval.expires_at is null or approval.expires_at > now());
    if v_next_count > v_version.included_stalls + v_approved_additional then
      raise exception using errcode = 'P0001', message = 'ADDITIONAL_STALL_APPROVAL_REQUIRED';
    end if;

  elsif tg_table_name = 'products' then
    if tg_op = 'UPDATE' and (old.is_active or not new.is_active) then
      return new;
    end if;
    select count(*)::integer into v_current_count
    from public.products product
    where product.organization_id = v_organization_id and product.is_active
      and (tg_op = 'INSERT' or product.id <> new.id);
    if v_version.max_products is not null and v_current_count + 1 > v_version.max_products then
      raise exception using errcode = 'P0001', message = 'PLAN_LIMIT_REACHED';
    end if;

  elsif tg_table_name = 'qr_codes' then
    select count(*)::integer into v_current_count
    from public.qr_codes qr
    where qr.organization_id = v_organization_id
      and qr.state in ('ACTIVE'::public.qr_code_state, 'PAUSED'::public.qr_code_state);
    if v_version.max_qr_codes is not null and v_current_count + 1 > v_version.max_qr_codes then
      raise exception using errcode = 'P0001', message = 'PLAN_LIMIT_REACHED';
    end if;

  elsif tg_table_name in ('organization_memberships', 'stall_memberships') then
    if new.role = 'ORGANIZATION_OWNER'::public.user_role then
      return new;
    end if;
    if tg_op = 'UPDATE' and (old.is_active or not new.is_active) then
      return new;
    end if;
    select count(distinct member.profile_id)::integer into v_current_count
    from (
      select membership.profile_id
      from public.organization_memberships membership
      where membership.organization_id = v_organization_id
        and membership.is_active
        and membership.role <> 'ORGANIZATION_OWNER'::public.user_role
      union
      select membership.profile_id
      from public.stall_memberships membership
      where membership.organization_id = v_organization_id
        and membership.is_active
    ) member
    where member.profile_id <> new.profile_id;
    if v_version.max_staff is not null and v_current_count + 1 > v_version.max_staff then
      raise exception using errcode = 'P0001', message = 'PLAN_LIMIT_REACHED';
    end if;
  end if;

  return new;
end;
$$;

create trigger stalls_billing_limit_before_write
before insert or update of is_active on public.stalls
for each row execute function public.enforce_billing_resource_limit();

create trigger products_billing_limit_before_write
before insert or update of is_active on public.products
for each row execute function public.enforce_billing_resource_limit();

create trigger qr_codes_billing_limit_before_insert
before insert on public.qr_codes
for each row execute function public.enforce_billing_resource_limit();

create trigger organization_memberships_billing_limit_before_write
before insert or update of is_active on public.organization_memberships
for each row execute function public.enforce_billing_resource_limit();

create trigger stall_memberships_billing_limit_before_write
before insert or update of is_active on public.stall_memberships
for each row execute function public.enforce_billing_resource_limit();

create or replace function public.enforce_new_order_subscription()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid;
begin
  v_organization_id := new.organization_id;
  if v_organization_id is null then
    select stall.organization_id into v_organization_id
    from public.stalls stall where stall.id = new.stall_id;
  end if;
  perform public.billing_raise_if_denied(
    public.billing_order_access_code(v_organization_id, true)
  );
  return new;
end;
$$;

create trigger order_sessions_billing_access_before_insert
before insert on public.order_sessions
for each row execute function public.enforce_new_order_subscription();

create trigger orders_billing_access_before_insert
before insert on public.orders
for each row execute function public.enforce_new_order_subscription();

create or replace function public.rebuild_billing_usage_summary(
  p_organization_id uuid,
  p_billing_period date,
  p_actor_profile_id uuid default null,
  p_request_id text default null
)
returns public.billing_usage_summaries
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period date := date_trunc('month', p_billing_period)::date;
  v_summary public.billing_usage_summaries%rowtype;
begin
  if p_organization_id is null or p_billing_period is null then
    raise exception using errcode = '22023', message = 'INVALID_USAGE_PERIOD';
  end if;
  if not exists (select 1 from public.organizations where id = p_organization_id) then
    raise exception using errcode = 'P0001', message = 'ORGANIZATION_NOT_FOUND';
  end if;

  insert into public.billing_usage_summaries (
    organization_id, billing_period, billable_order_count, active_stall_count,
    active_staff_count, qr_code_count, csv_export_count, calculated_at, updated_at
  )
  select
    p_organization_id,
    v_period,
    coalesce((
      select sum(event.quantity)::integer
      from public.usage_events event
      where event.organization_id = p_organization_id
        and event.billing_period = v_period
        and event.event_type = 'BILLABLE_ORDER_COMPLETED'
    ), 0),
    (select count(*)::integer from public.stalls stall
      where stall.organization_id = p_organization_id and stall.is_active),
    (select count(distinct member.profile_id)::integer from (
      select membership.profile_id
      from public.organization_memberships membership
      where membership.organization_id = p_organization_id
        and membership.is_active
        and membership.role <> 'ORGANIZATION_OWNER'::public.user_role
      union
      select membership.profile_id
      from public.stall_memberships membership
      where membership.organization_id = p_organization_id and membership.is_active
    ) member),
    (select count(*)::integer from public.qr_codes qr
      where qr.organization_id = p_organization_id
        and qr.state in ('ACTIVE'::public.qr_code_state, 'PAUSED'::public.qr_code_state)),
    coalesce((
      select sum(event.quantity)::integer
      from public.usage_events event
      where event.organization_id = p_organization_id
        and event.billing_period = v_period
        and event.event_type = 'CSV_EXPORTED'
    ), 0),
    now(),
    now()
  on conflict (organization_id, billing_period) do update set
    billable_order_count = excluded.billable_order_count,
    active_stall_count = excluded.active_stall_count,
    active_staff_count = excluded.active_staff_count,
    qr_code_count = excluded.qr_code_count,
    csv_export_count = excluded.csv_export_count,
    calculated_at = excluded.calculated_at,
    updated_at = excluded.updated_at
  returning * into v_summary;

  if p_actor_profile_id is not null then
    insert into public.audit_logs (
      id, tenant_id, organization_id, actor_profile_id, action, entity_type,
      entity_id, outcome, request_id, after_json, created_at
    ) values (
      gen_random_uuid(), p_organization_id, p_organization_id, p_actor_profile_id,
      'USAGE_REBUILT', 'BILLING_USAGE_SUMMARY', v_summary.id,
      'SUCCESS'::public.audit_outcome,
      left(coalesce(nullif(p_request_id, ''), gen_random_uuid()::text), 100),
      jsonb_build_object(
        'billingPeriod', v_period,
        'billableOrderCount', v_summary.billable_order_count,
        'activeStallCount', v_summary.active_stall_count,
        'activeStaffCount', v_summary.active_staff_count,
        'qrCodeCount', v_summary.qr_code_count,
        'csvExportCount', v_summary.csv_export_count
      ),
      now()
    );
  end if;

  return v_summary;
end;
$$;

create or replace function public.reconcile_billing_usage_warnings(
  p_organization_id uuid,
  p_billing_period date
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_subscription public.subscriptions%rowtype;
  v_version public.plan_versions%rowtype;
  v_used integer := 0;
  v_package_orders integer := 0;
  v_limit integer;
  v_threshold integer;
  v_type text;
  v_notification_id uuid;
  v_inserted integer := 0;
begin
  select subscription.* into v_subscription
  from public.subscriptions subscription
  where subscription.organization_id = p_organization_id;
  if not found then return 0; end if;
  select version.* into v_version from public.plan_versions version
  where version.id = v_subscription.plan_version_id;
  if v_version.included_orders is null or v_version.included_orders = 0 then return 0; end if;

  select coalesce(sum(event.quantity), 0)::integer into v_used
  from public.usage_events event
  where event.organization_id = p_organization_id
    and event.event_type = 'BILLABLE_ORDER_COMPLETED'
    and event.billing_period = date_trunc('month', p_billing_period)::date;

  if v_subscription.status <> 'TRIALING' then
    select coalesce(sum(
      public.billing_order_package_quantity(item.code) * item.quantity
    ), 0)::integer into v_package_orders
    from public.subscription_items item
    where item.subscription_id = v_subscription.id
      and item.item_type = 'ORDER_PACKAGE'
      and item.status = 'ACTIVE'
      and item.starts_at < v_subscription.billing_period_end
      and (item.ends_at is null or item.ends_at >= v_subscription.billing_period_start);
  end if;
  v_limit := v_version.included_orders + v_package_orders;
  if v_limit <= 0 then return 0; end if;

  foreach v_threshold in array array[80, 90, 100, 110] loop
    if v_used * 100 >= v_limit * v_threshold then
      v_type := 'USAGE_' || v_threshold::text || '_PERCENT';
      insert into public.billing_notifications (
        organization_id, notification_type, severity, title, message,
        entity_type, entity_id, dedupe_key, metadata_json
      ) values (
        p_organization_id,
        v_type,
        case when v_threshold >= 100 then 'CRITICAL' when v_threshold >= 90 then 'WARNING' else 'INFO' end,
        '訂單用量已達 ' || v_threshold::text || '%',
        case when v_threshold >= 100
          then '本期訂單用量已達方案額度，系統仍會依付費方案軟性上限持續接單。'
          else '本期訂單用量接近方案額度，請檢視升級或加購訂單包。'
        end,
        'SUBSCRIPTION', v_subscription.id,
        'usage:' || date_trunc('month', p_billing_period)::date::text || ':' || v_threshold::text,
        jsonb_build_object('used', v_used, 'limit', v_limit, 'threshold', v_threshold)
      )
      on conflict (organization_id, dedupe_key) where dedupe_key is not null do nothing
      returning id into v_notification_id;

      if v_notification_id is not null then
        insert into public.notification_outbox (
          organization_id, billing_notification_id, channel, status
        ) values (p_organization_id, v_notification_id, 'IN_APP', 'PENDING')
        on conflict (billing_notification_id, channel) do nothing;
        v_inserted := v_inserted + 1;
      end if;
      v_notification_id := null;
    end if;
  end loop;
  return v_inserted;
end;
$$;

create or replace function public.record_billable_order_completed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period date;
begin
  if new.status = 'COMPLETED'::public.order_status
    and (tg_op = 'INSERT' or old.status <> 'COMPLETED'::public.order_status) then
    perform 1 from public.subscriptions subscription
    where subscription.organization_id = new.organization_id
    for update;

    v_period := date_trunc('month', coalesce(new.completed_at, now()))::date;
    insert into public.usage_events (
      organization_id, stall_id, event_type, quantity, billing_period,
      reference_type, reference_id, occurred_at
    ) values (
      new.organization_id, new.stall_id, 'BILLABLE_ORDER_COMPLETED', 1,
      v_period, 'ORDER', new.id::text, coalesce(new.completed_at, now())
    ) on conflict do nothing;

    perform public.rebuild_billing_usage_summary(new.organization_id, v_period);
    perform public.reconcile_billing_usage_warnings(new.organization_id, v_period);
  end if;
  return null;
end;
$$;

create trigger orders_billable_usage_after_completion
after insert or update of status on public.orders
for each row execute function public.record_billable_order_completed();

create or replace function public.enforce_order_package_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_subscription public.subscriptions%rowtype;
  v_catalog public.add_on_catalog%rowtype;
  v_plan_code text;
begin
  if new.item_type <> 'ORDER_PACKAGE' then return new; end if;

  select subscription.* into strict v_subscription
  from public.subscriptions subscription
  where subscription.id = new.subscription_id
  for update;
  if v_subscription.organization_id <> new.organization_id then
    raise exception using errcode = 'P0001', message = 'BILLING_ORGANIZATION_SCOPE_MISMATCH';
  end if;
  if v_subscription.status = 'TRIALING' then
    raise exception using errcode = 'P0001', message = 'UPGRADE_REQUIRED';
  elsif v_subscription.status in ('SUSPENDED', 'CANCELLED') then
    raise exception using errcode = 'P0001', message = 'SUBSCRIPTION_NOT_ACTIVE';
  end if;

  select catalog.* into v_catalog
  from public.add_on_catalog catalog
  where catalog.code = new.code
    and catalog.is_active
    and catalog.availability_status = 'ENABLED';
  if not found or public.billing_order_package_quantity(new.code) = 0 then
    raise exception using errcode = 'P0001', message = 'ORDER_PACKAGE_REQUIRED';
  end if;
  select plan.code into v_plan_code
  from public.plan_versions version
  join public.plans plan on plan.id = version.plan_id
  where version.id = v_subscription.plan_version_id;
  if (v_plan_code = 'LITE' and new.code <> 'ORDER_PACKAGE_LITE_100')
    or (v_plan_code = 'STANDARD' and new.code <> 'ORDER_PACKAGE_STANDARD_500')
    or (v_plan_code = 'PRO' and new.code <> 'ORDER_PACKAGE_PRO_1000')
    or v_plan_code not in ('LITE', 'STANDARD', 'PRO') then
    raise exception using errcode = 'P0001', message = 'UPGRADE_REQUIRED';
  end if;
  if new.unit_price <> v_catalog.unit_price or new.currency <> v_catalog.currency then
    raise exception using errcode = 'P0001', message = 'SERVER_PRICE_MISMATCH';
  end if;
  return new;
end;
$$;

create trigger subscription_items_order_package_before_insert
before insert on public.subscription_items
for each row execute function public.enforce_order_package_assignment();

create or replace function public.expire_billing_trials()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_subscription record;
  v_notification_id uuid;
  v_count integer := 0;
begin
  for v_subscription in
    select subscription.id, subscription.organization_id, subscription.status,
      subscription.trial_ends_at
    from public.subscriptions subscription
    where subscription.status = 'TRIALING'
      and subscription.trial_ends_at <= now()
    for update skip locked
  loop
    update public.subscriptions
    set status = 'SUSPENDED', suspended_at = coalesce(suspended_at, now()), updated_at = now()
    where id = v_subscription.id and status = 'TRIALING';
    if not found then continue; end if;

    update public.organizations
    set status = 'SUSPENDED'::public.tenant_status, updated_at = now()
    where id = v_subscription.organization_id;

    insert into public.billing_notifications (
      organization_id, notification_type, severity, title, message,
      entity_type, entity_id, dedupe_key
    ) values (
      v_subscription.organization_id, 'TRIAL_EXPIRED', 'CRITICAL',
      '試用期已結束', '試用期已結束，完成付款並由平台驗證後即可恢復服務。',
      'SUBSCRIPTION', v_subscription.id, 'trial-expired:' || v_subscription.id::text
    ) on conflict (organization_id, dedupe_key) where dedupe_key is not null do nothing
    returning id into v_notification_id;
    if v_notification_id is not null then
      insert into public.notification_outbox (
        organization_id, billing_notification_id, channel, status
      ) values (v_subscription.organization_id, v_notification_id, 'IN_APP', 'PENDING')
      on conflict (billing_notification_id, channel) do nothing;
    end if;

    insert into public.audit_logs (
      id, tenant_id, organization_id, action, entity_type, entity_id,
      outcome, request_id, before_json, after_json, created_at
    ) values (
      gen_random_uuid(), v_subscription.organization_id, v_subscription.organization_id,
      'SUBSCRIPTION_SUSPENDED', 'SUBSCRIPTION', v_subscription.id,
      'SUCCESS'::public.audit_outcome, 'billing-trial-expiration-job',
      jsonb_build_object('status', 'TRIALING'),
      jsonb_build_object('status', 'SUSPENDED', 'reason', 'TRIAL_EXPIRED'), now()
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create or replace function public.mark_overdue_billing_invoices()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice record;
  v_notification_id uuid;
  v_count integer := 0;
begin
  for v_invoice in
    select invoice.id, invoice.organization_id, invoice.subscription_id,
      invoice.invoice_number
    from public.invoices invoice
    where invoice.status = 'OPEN' and invoice.due_at < now()
    for update skip locked
  loop
    update public.invoices set status = 'OVERDUE', updated_at = now()
    where id = v_invoice.id and status = 'OPEN';
    if not found then continue; end if;

    update public.subscriptions
    set status = 'PAST_DUE', past_due_at = coalesce(past_due_at, now()), updated_at = now()
    where id = v_invoice.subscription_id and status = 'ACTIVE';

    insert into public.billing_notifications (
      organization_id, notification_type, severity, title, message,
      entity_type, entity_id, dedupe_key
    ) values (
      v_invoice.organization_id, 'PAYMENT_OVERDUE', 'WARNING',
      '帳單已逾期', '帳單 ' || v_invoice.invoice_number || ' 已逾期，請儘速完成付款。',
      'INVOICE', v_invoice.id, 'invoice-overdue:' || v_invoice.id::text
    ) on conflict (organization_id, dedupe_key) where dedupe_key is not null do nothing
    returning id into v_notification_id;
    if v_notification_id is not null then
      insert into public.notification_outbox (
        organization_id, billing_notification_id, channel, status
      ) values (v_invoice.organization_id, v_notification_id, 'IN_APP', 'PENDING')
      on conflict (billing_notification_id, channel) do nothing;
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- Add commercial checks without rewriting the established QR abuse-control
-- functions. The wrappers run before all existing validation and return only
-- stable, UI-safe billing codes.
alter function public.issue_order_session(text, text, text, text, text, text, text)
  rename to issue_order_session_billing_legacy;

create or replace function public.issue_order_session(
  p_qr_token text,
  p_session_token_hash text,
  p_ip_hash text,
  p_device_hash text,
  p_qr_token_hash text,
  p_behavior_hash text,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_qr public.qr_codes%rowtype;
  v_code text;
begin
  select * into v_qr from public.qr_codes where token = p_qr_token;
  if found then
    v_code := public.billing_order_access_code(v_qr.organization_id, true);
    if v_code <> 'OK' then
      perform public.record_public_order_attempt(
        p_request_id, 'SESSION_ISSUE', 'DENIED', v_code,
        v_qr.tenant_id, v_qr.stall_id, v_qr.id, null, p_ip_hash,
        p_device_hash, p_qr_token_hash, null, p_behavior_hash, null
      );
      return jsonb_build_object('ok', false, 'code', v_code);
    end if;
  end if;
  return public.issue_order_session_billing_legacy(
    p_qr_token, p_session_token_hash, p_ip_hash, p_device_hash,
    p_qr_token_hash, p_behavior_hash, p_request_id
  );
end;
$$;

alter function public.create_public_order(
  uuid, text, text, text, text, text, text, uuid, text, text, text,
  jsonb, text, text, text
) rename to create_public_order_billing_legacy;

create or replace function public.create_public_order(
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
  p_customer_note text,
  p_items jsonb,
  p_tracking_token_hash text,
  p_pickup_code_hash text,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.order_sessions%rowtype;
  v_code text;
begin
  select * into v_session
  from public.order_sessions
  where token_hash = p_session_token_hash;
  if found then
    v_code := public.billing_order_access_code(v_session.organization_id, true);
    if v_code <> 'OK' then
      perform public.record_public_order_attempt(
        p_request_id, 'ORDER_SUBMIT', 'DENIED', v_code,
        v_session.tenant_id, v_session.stall_id, v_session.qr_code_id,
        v_session.id, p_ip_hash, p_device_hash, p_qr_token_hash,
        p_session_token_hash, p_behavior_hash, p_idempotency_hash
      );
      return jsonb_build_object('ok', false, 'code', v_code);
    end if;
  end if;
  return public.create_public_order_billing_legacy(
    p_order_id, p_qr_token, p_session_token_hash, p_device_hash, p_ip_hash,
    p_qr_token_hash, p_behavior_hash, p_idempotency_key, p_idempotency_hash,
    p_customer_name, p_customer_note, p_items, p_tracking_token_hash,
    p_pickup_code_hash, p_request_id
  );
end;
$$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if not exists (select 1 from cron.job where jobname = 'stallorder-billing-trial-expiration') then
      perform cron.schedule(
        'stallorder-billing-trial-expiration', '*/15 * * * *',
        'select public.expire_billing_trials()'
      );
    end if;
    if not exists (select 1 from cron.job where jobname = 'stallorder-billing-invoice-overdue') then
      perform cron.schedule(
        'stallorder-billing-invoice-overdue', '7 * * * *',
        'select public.mark_overdue_billing_invoices()'
      );
    end if;
  end if;
end;
$$;

revoke all on function public.billing_order_package_quantity(text) from public, anon, authenticated;
revoke all on function public.billing_order_access_code(uuid, boolean) from public, anon, authenticated;
revoke all on function public.billing_raise_if_denied(text) from public, anon, authenticated;
revoke all on function public.enforce_billing_resource_limit() from public, anon, authenticated;
revoke all on function public.enforce_new_order_subscription() from public, anon, authenticated;
revoke all on function public.rebuild_billing_usage_summary(uuid, date, uuid, text) from public, anon, authenticated;
revoke all on function public.reconcile_billing_usage_warnings(uuid, date) from public, anon, authenticated;
revoke all on function public.record_billable_order_completed() from public, anon, authenticated;
revoke all on function public.enforce_order_package_assignment() from public, anon, authenticated;
revoke all on function public.expire_billing_trials() from public, anon, authenticated;
revoke all on function public.mark_overdue_billing_invoices() from public, anon, authenticated;
revoke all on function public.issue_order_session_billing_legacy(text, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.issue_order_session(text, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.create_public_order_billing_legacy(
  uuid, text, text, text, text, text, text, uuid, text, text, text,
  jsonb, text, text, text
) from public, anon, authenticated;
revoke all on function public.create_public_order(
  uuid, text, text, text, text, text, text, uuid, text, text, text,
  jsonb, text, text, text
) from public, anon, authenticated;

grant execute on function public.billing_order_access_code(uuid, boolean) to service_role;
grant execute on function public.rebuild_billing_usage_summary(uuid, date, uuid, text) to service_role;
grant execute on function public.reconcile_billing_usage_warnings(uuid, date) to service_role;
grant execute on function public.expire_billing_trials() to service_role;
grant execute on function public.mark_overdue_billing_invoices() to service_role;
grant execute on function public.issue_order_session(text, text, text, text, text, text, text) to service_role;
grant execute on function public.create_public_order(
  uuid, text, text, text, text, text, text, uuid, text, text, text,
  jsonb, text, text, text
) to service_role;
