create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

alter table public.tenants alter column updated_at set default now();
alter table public.stalls alter column updated_at set default now();
alter table public.user_accounts alter column updated_at set default now();
alter table public.stall_memberships alter column updated_at set default now();
alter table public.rate_limit_buckets alter column updated_at set default now();
alter table public.products alter column updated_at set default now();
alter table public.qr_codes alter column updated_at set default now();
alter table public.stall_ordering_settings alter column updated_at set default now();
alter table public.orders alter column updated_at set default now();
alter table public.public_rate_limit_buckets alter column updated_at set default now();

alter table public.products
  add constraint products_price_nonnegative check (price >= 0),
  add constraint products_tenant_matches_stall check (tenant_id is not null);

alter table public.qr_codes
  add constraint qr_codes_token_length check (char_length(token) between 24 and 200),
  add constraint qr_codes_token_version_positive check (token_version > 0);

alter table public.stall_ordering_settings
  add constraint ordering_settings_bounds check (
    order_session_ttl_seconds between 60 and 3600
    and unconfirmed_order_timeout_seconds between 60 and 7200
    and max_item_quantity between 1 and 100
    and max_unique_products between 1 and 100
    and max_total_quantity between 1 and 500
    and max_note_length between 0 and 1000
    and max_pending_orders_per_device between 1 and 100
    and max_orders_per_window between 1 and 1000
    and order_window_seconds between 10 and 86400
    and max_sessions_per_ip_window between 1 and 10000
    and max_sessions_per_device_window between 1 and 10000
    and max_sessions_per_qr_window between 1 and 100000
    and max_sessions_per_stall_window between 1 and 100000
    and max_behavior_frequency between 1 and 1000
  );

alter table public.order_sessions
  add constraint order_sessions_token_hash_length check (char_length(token_hash) = 64),
  add constraint order_sessions_device_hash_length check (char_length(device_hash) = 64),
  add constraint order_sessions_ip_hash_length check (char_length(ip_hash) = 64);

alter table public.orders
  add constraint orders_total_nonnegative check (total >= 0),
  add constraint orders_tracking_hash_length check (char_length(tracking_token_hash) = 64),
  add constraint orders_pickup_hash_length check (char_length(pickup_code_hash) = 64);

alter table public.order_items
  add constraint order_items_quantity_positive check (quantity > 0),
  add constraint order_items_price_nonnegative check (unit_price >= 0);

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_accounts ua
    where ua.auth_user_id = auth.uid()
      and ua.is_active
      and ua.platform_role = 'PLATFORM_ADMIN'::public.user_role
  );
$$;

create or replace function public.has_stall_role(
  p_stall_id uuid,
  p_roles public.user_role[] default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_platform_admin() or exists (
    select 1
    from public.stall_memberships sm
    join public.user_accounts ua on ua.id = sm.user_id
    join public.stalls s on s.id = sm.stall_id
    where sm.stall_id = p_stall_id
      and sm.tenant_id = s.tenant_id
      and ua.auth_user_id = auth.uid()
      and ua.is_active
      and sm.is_active
      and (p_roles is null or sm.role = any (p_roles))
  );
$$;

revoke all on function public.is_platform_admin() from public, anon;
revoke all on function public.has_stall_role(uuid, public.user_role[]) from public, anon;
grant execute on function public.is_platform_admin() to authenticated;
grant execute on function public.has_stall_role(uuid, public.user_role[]) to authenticated;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'tenants', 'stalls', 'user_accounts', 'stall_memberships', 'auth_sessions',
    'audit_logs', 'rate_limit_buckets', 'products', 'qr_codes',
    'stall_ordering_settings', 'order_sessions', 'orders', 'order_items',
    'order_events', 'public_order_attempts', 'public_rate_limit_buckets',
    'stall_order_counters'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('alter table public.%I force row level security', table_name);
  end loop;
end;
$$;

revoke all on all tables in schema public from anon, authenticated;

grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

grant select on public.tenants, public.stalls, public.products, public.orders,
  public.order_items, public.order_events, public.qr_codes,
  public.stall_ordering_settings, public.stall_memberships,
  public.user_accounts, public.audit_logs to authenticated;

create policy tenants_member_select on public.tenants
for select to authenticated
using (
  public.is_platform_admin()
  or exists (
    select 1
    from public.stall_memberships sm
    join public.user_accounts ua on ua.id = sm.user_id
    where sm.tenant_id = tenants.id
      and ua.auth_user_id = auth.uid()
      and ua.is_active
      and sm.is_active
  )
);

create policy stalls_member_select on public.stalls
for select to authenticated
using (public.has_stall_role(id, null));

create policy user_accounts_self_select on public.user_accounts
for select to authenticated
using (auth_user_id = auth.uid() or public.is_platform_admin());

create policy memberships_self_or_owner_select on public.stall_memberships
for select to authenticated
using (
  public.has_stall_role(stall_id, array['MERCHANT_OWNER']::public.user_role[])
  or exists (
    select 1 from public.user_accounts ua
    where ua.id = stall_memberships.user_id and ua.auth_user_id = auth.uid()
  )
);

create policy products_member_select on public.products
for select to authenticated
using (public.has_stall_role(stall_id, null));

create policy qr_codes_manager_select on public.qr_codes
for select to authenticated
using (public.has_stall_role(stall_id, array['MERCHANT_OWNER', 'MERCHANT_MANAGER']::public.user_role[]));

create policy ordering_settings_manager_select on public.stall_ordering_settings
for select to authenticated
using (public.has_stall_role(stall_id, array['MERCHANT_OWNER', 'MERCHANT_MANAGER']::public.user_role[]));

create policy orders_member_select on public.orders
for select to authenticated
using (public.has_stall_role(stall_id, null));

create policy order_items_member_select on public.order_items
for select to authenticated
using (public.has_stall_role(stall_id, null));

create policy order_events_member_select on public.order_events
for select to authenticated
using (public.has_stall_role(stall_id, null));

create policy audit_logs_manager_select on public.audit_logs
for select to authenticated
using (
  public.is_platform_admin()
  or (stall_id is not null and public.has_stall_role(
    stall_id,
    array['MERCHANT_OWNER', 'MERCHANT_MANAGER']::public.user_role[]
  ))
);

create or replace function public.record_public_order_attempt(
  p_request_id text,
  p_event_type text,
  p_outcome public.public_attempt_outcome,
  p_reason_code text,
  p_tenant_id uuid default null,
  p_stall_id uuid default null,
  p_qr_code_id uuid default null,
  p_order_session_id uuid default null,
  p_ip_hash text default null,
  p_device_hash text default null,
  p_qr_token_hash text default null,
  p_order_session_hash text default null,
  p_behavior_hash text default null,
  p_idempotency_hash text default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.public_order_attempts (
    id, tenant_id, stall_id, qr_code_id, order_session_id, request_id,
    event_type, outcome, reason_code, ip_hash, device_hash, qr_token_hash,
    order_session_hash, behavior_hash, idempotency_hash, created_at
  ) values (
    gen_random_uuid(), p_tenant_id, p_stall_id, p_qr_code_id,
    p_order_session_id, left(p_request_id, 100), left(p_event_type, 80),
    p_outcome, left(p_reason_code, 120), p_ip_hash, p_device_hash,
    p_qr_token_hash, p_order_session_hash, p_behavior_hash,
    p_idempotency_hash, now()
  );
$$;

create or replace function public.consume_public_rate_limit(
  p_stall_id uuid,
  p_dimension_type text,
  p_dimension_hash text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window_start timestamptz;
  v_count integer;
begin
  if p_limit < 1 or p_window_seconds < 1 or p_dimension_hash is null then
    return false;
  end if;

  v_window_start := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds
  );

  insert into public.public_rate_limit_buckets (
    id, stall_id, dimension_type, dimension_hash, window_start,
    count, expires_at, updated_at
  ) values (
    gen_random_uuid(), p_stall_id, left(p_dimension_type, 40),
    p_dimension_hash, v_window_start, 1,
    v_window_start + make_interval(secs => p_window_seconds), now()
  )
  on conflict (stall_id, dimension_type, dimension_hash, window_start)
  do update set
    count = public.public_rate_limit_buckets.count + 1,
    updated_at = now()
  returning count into v_count;

  return v_count <= p_limit;
end;
$$;

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
  v_stall public.stalls%rowtype;
  v_tenant public.tenants%rowtype;
  v_settings public.stall_ordering_settings%rowtype;
  v_session_id uuid := gen_random_uuid();
  v_expires_at timestamptz;
  v_allowed_ip boolean;
  v_allowed_device boolean;
  v_allowed_qr boolean;
  v_allowed_stall boolean;
  v_allowed_behavior boolean;
begin
  select * into v_qr
  from public.qr_codes
  where token = p_qr_token
  for update;

  if not found then
    perform public.record_public_order_attempt(
      p_request_id, 'SESSION_ISSUE', 'DENIED', 'QR_NOT_FOUND',
      null, null, null, null, p_ip_hash, p_device_hash,
      p_qr_token_hash, null, p_behavior_hash, null
    );
    return jsonb_build_object('ok', false, 'code', 'QR_NOT_FOUND');
  end if;

  select * into v_stall from public.stalls where id = v_qr.stall_id;
  select * into v_tenant from public.tenants where id = v_qr.tenant_id;
  select * into v_settings
  from public.stall_ordering_settings
  where stall_id = v_qr.stall_id;

  if v_qr.state = 'REVOKED'::public.qr_code_state then
    perform public.record_public_order_attempt(p_request_id, 'SESSION_ISSUE', 'DENIED', 'QR_REVOKED', v_qr.tenant_id, v_qr.stall_id, v_qr.id, null, p_ip_hash, p_device_hash, p_qr_token_hash, null, p_behavior_hash, null);
    return jsonb_build_object('ok', false, 'code', 'QR_REVOKED');
  elsif v_qr.state = 'PAUSED'::public.qr_code_state then
    perform public.record_public_order_attempt(p_request_id, 'SESSION_ISSUE', 'DENIED', 'QR_PAUSED', v_qr.tenant_id, v_qr.stall_id, v_qr.id, null, p_ip_hash, p_device_hash, p_qr_token_hash, null, p_behavior_hash, null);
    return jsonb_build_object('ok', false, 'code', 'QR_PAUSED');
  elsif v_qr.state = 'EXPIRED'::public.qr_code_state or (v_qr.expires_at is not null and v_qr.expires_at <= now()) then
    perform public.record_public_order_attempt(p_request_id, 'SESSION_ISSUE', 'DENIED', 'QR_EXPIRED', v_qr.tenant_id, v_qr.stall_id, v_qr.id, null, p_ip_hash, p_device_hash, p_qr_token_hash, null, p_behavior_hash, null);
    return jsonb_build_object('ok', false, 'code', 'QR_EXPIRED');
  end if;

  if not v_stall.is_active or v_stall.ordering_state = 'CLOSED'::public.stall_ordering_state then
    perform public.record_public_order_attempt(p_request_id, 'SESSION_ISSUE', 'DENIED', 'STALL_CLOSED', v_qr.tenant_id, v_qr.stall_id, v_qr.id, null, p_ip_hash, p_device_hash, p_qr_token_hash, null, p_behavior_hash, null);
    return jsonb_build_object('ok', false, 'code', 'STALL_CLOSED');
  elsif v_stall.ordering_state = 'PAUSED'::public.stall_ordering_state then
    perform public.record_public_order_attempt(p_request_id, 'SESSION_ISSUE', 'DENIED', 'ORDERING_PAUSED', v_qr.tenant_id, v_qr.stall_id, v_qr.id, null, p_ip_hash, p_device_hash, p_qr_token_hash, null, p_behavior_hash, null);
    return jsonb_build_object('ok', false, 'code', 'ORDERING_PAUSED');
  elsif v_stall.is_sold_out then
    perform public.record_public_order_attempt(p_request_id, 'SESSION_ISSUE', 'DENIED', 'STALL_SOLD_OUT', v_qr.tenant_id, v_qr.stall_id, v_qr.id, null, p_ip_hash, p_device_hash, p_qr_token_hash, null, p_behavior_hash, null);
    return jsonb_build_object('ok', false, 'code', 'STALL_SOLD_OUT');
  elsif v_tenant.status not in ('TRIALING'::public.tenant_status, 'ACTIVE'::public.tenant_status) then
    perform public.record_public_order_attempt(p_request_id, 'SESSION_ISSUE', 'DENIED', 'TENANT_INACTIVE', v_qr.tenant_id, v_qr.stall_id, v_qr.id, null, p_ip_hash, p_device_hash, p_qr_token_hash, null, p_behavior_hash, null);
    return jsonb_build_object('ok', false, 'code', 'TENANT_INACTIVE');
  end if;

  v_allowed_ip := public.consume_public_rate_limit(v_qr.stall_id, 'SESSION_IP', p_ip_hash, v_settings.max_sessions_per_ip_window, v_settings.order_window_seconds);
  v_allowed_device := public.consume_public_rate_limit(v_qr.stall_id, 'SESSION_DEVICE', p_device_hash, v_settings.max_sessions_per_device_window, v_settings.order_window_seconds);
  v_allowed_qr := public.consume_public_rate_limit(v_qr.stall_id, 'SESSION_QR', p_qr_token_hash, v_settings.max_sessions_per_qr_window, v_settings.order_window_seconds);
  v_allowed_stall := public.consume_public_rate_limit(v_qr.stall_id, 'SESSION_STALL', encode(extensions.digest(v_qr.stall_id::text, 'sha256'), 'hex'), v_settings.max_sessions_per_stall_window, v_settings.order_window_seconds);
  v_allowed_behavior := public.consume_public_rate_limit(v_qr.stall_id, 'SESSION_BEHAVIOR', p_behavior_hash, v_settings.max_behavior_frequency * 5, v_settings.order_window_seconds);

  if not (v_allowed_ip and v_allowed_device and v_allowed_qr and v_allowed_stall and v_allowed_behavior) then
    perform public.record_public_order_attempt(p_request_id, 'SESSION_ISSUE', 'DENIED', 'RATE_LIMITED', v_qr.tenant_id, v_qr.stall_id, v_qr.id, null, p_ip_hash, p_device_hash, p_qr_token_hash, null, p_behavior_hash, null);
    return jsonb_build_object('ok', false, 'code', 'RATE_LIMITED');
  end if;

  v_expires_at := now() + make_interval(secs => v_settings.order_session_ttl_seconds);
  insert into public.order_sessions (
    id, tenant_id, stall_id, qr_code_id, token_hash, device_hash,
    ip_hash, status, expires_at, created_at
  ) values (
    v_session_id, v_qr.tenant_id, v_qr.stall_id, v_qr.id,
    p_session_token_hash, p_device_hash, p_ip_hash,
    'ACTIVE'::public.order_session_status, v_expires_at, now()
  );

  perform public.record_public_order_attempt(p_request_id, 'SESSION_ISSUE', 'ALLOWED', 'SESSION_ISSUED', v_qr.tenant_id, v_qr.stall_id, v_qr.id, v_session_id, p_ip_hash, p_device_hash, p_qr_token_hash, p_session_token_hash, p_behavior_hash, null);
  return jsonb_build_object(
    'ok', true,
    'tenant_id', v_qr.tenant_id,
    'stall_id', v_qr.stall_id,
    'qr_code_id', v_qr.id,
    'order_session_id', v_session_id,
    'expires_at', v_expires_at
  );
exception
  when unique_violation then
    perform public.record_public_order_attempt(p_request_id, 'SESSION_ISSUE', 'ERROR', 'SESSION_TOKEN_COLLISION', null, null, null, null, p_ip_hash, p_device_hash, p_qr_token_hash, p_session_token_hash, p_behavior_hash, null);
    return jsonb_build_object('ok', false, 'code', 'SESSION_TOKEN_COLLISION');
end;
$$;

create or replace function public.consume_global_rate_limit(
  p_key text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_expires_at timestamptz := v_now + make_interval(secs => p_window_seconds);
  v_count integer;
begin
  if p_limit < 1 or p_window_seconds < 1 or p_key is null then
    return false;
  end if;

  insert into public.rate_limit_buckets (key, count, expires_at, updated_at)
  values (p_key, 1, v_expires_at, v_now)
  on conflict (key) do update set
    count = case
      when public.rate_limit_buckets.expires_at <= v_now then 1
      else public.rate_limit_buckets.count + 1
    end,
    expires_at = case
      when public.rate_limit_buckets.expires_at <= v_now then v_expires_at
      else public.rate_limit_buckets.expires_at
    end,
    updated_at = v_now
  returning count into v_count;

  return v_count <= p_limit;
end;
$$;

create or replace function public.check_global_public_request_gate(
  p_scope text,
  p_ip_hash text,
  p_device_hash text,
  p_behavior_hash text,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scope text := upper(p_scope);
  v_ip_limit integer;
  v_device_limit integer;
  v_behavior_limit integer;
  v_allowed_ip boolean;
  v_allowed_device boolean;
  v_allowed_behavior boolean;
begin
  case v_scope
    when 'SESSION' then v_ip_limit := 60; v_device_limit := 30; v_behavior_limit := 15;
    when 'ORDER' then v_ip_limit := 40; v_device_limit := 20; v_behavior_limit := 12;
    when 'TRACKING' then v_ip_limit := 120; v_device_limit := 120; v_behavior_limit := 60;
    else return jsonb_build_object('ok', false, 'code', 'INVALID_REQUEST');
  end case;

  v_allowed_ip := public.consume_global_rate_limit(
    encode(extensions.digest('PUBLIC|' || v_scope || '|IP|' || p_ip_hash, 'sha256'), 'hex'),
    v_ip_limit,
    300
  );
  v_allowed_device := public.consume_global_rate_limit(
    encode(extensions.digest('PUBLIC|' || v_scope || '|DEVICE|' || p_device_hash, 'sha256'), 'hex'),
    v_device_limit,
    300
  );
  v_allowed_behavior := public.consume_global_rate_limit(
    encode(extensions.digest('PUBLIC|' || v_scope || '|BEHAVIOR|' || p_behavior_hash, 'sha256'), 'hex'),
    v_behavior_limit,
    300
  );

  if not (v_allowed_ip and v_allowed_device and v_allowed_behavior) then
    perform public.record_public_order_attempt(
      p_request_id,
      v_scope || '_GLOBAL_GATE',
      'DENIED',
      'RATE_LIMITED',
      null, null, null, null,
      p_ip_hash, p_device_hash, null, null, p_behavior_hash, null
    );
    return jsonb_build_object('ok', false, 'code', 'RATE_LIMITED');
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.lookup_public_order_idempotency(
  p_session_token_hash text,
  p_idempotency_key uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'order_id', o.id,
    'order_no', o.order_no,
    'order_status', o.status,
    'payment_status', o.payment_status,
    'total_amount', o.total,
    'created_at', o.created_at
  )
  from public.order_sessions os
  join public.orders o on o.id = os.order_id
  where os.token_hash = p_session_token_hash
    and o.idempotency_key = p_idempotency_key;
$$;

create or replace function public.check_public_order_submission_gate(
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
  v_session public.order_sessions%rowtype;
  v_settings public.stall_ordering_settings%rowtype;
  v_allowed_ip boolean;
  v_allowed_device boolean;
  v_allowed_qr boolean;
  v_allowed_session boolean;
  v_allowed_stall boolean;
  v_allowed_behavior boolean;
begin
  select * into v_session
  from public.order_sessions
  where token_hash = p_session_token_hash;

  if not found then
    perform public.record_public_order_attempt(
      p_request_id, 'ORDER_GATE', 'DENIED', 'SESSION_NOT_FOUND',
      null, null, null, null, p_ip_hash, p_device_hash,
      p_qr_token_hash, p_session_token_hash, p_behavior_hash, null
    );
    return jsonb_build_object('ok', false, 'code', 'SESSION_NOT_FOUND');
  end if;

  select * into v_settings
  from public.stall_ordering_settings
  where stall_id = v_session.stall_id;

  v_allowed_ip := public.consume_public_rate_limit(v_session.stall_id, 'ATTEMPT_IP', p_ip_hash, greatest(v_settings.max_orders_per_window * 4, 10), v_settings.order_window_seconds);
  v_allowed_device := public.consume_public_rate_limit(v_session.stall_id, 'ATTEMPT_DEVICE', p_device_hash, greatest(v_settings.max_orders_per_window * 3, 8), v_settings.order_window_seconds);
  v_allowed_qr := public.consume_public_rate_limit(v_session.stall_id, 'ATTEMPT_QR', p_qr_token_hash, greatest(v_settings.max_orders_per_window * 50, 100), v_settings.order_window_seconds);
  v_allowed_session := public.consume_public_rate_limit(v_session.stall_id, 'ATTEMPT_SESSION', p_session_token_hash, 8, v_settings.order_window_seconds);
  v_allowed_stall := public.consume_public_rate_limit(v_session.stall_id, 'ATTEMPT_STALL', encode(extensions.digest(v_session.stall_id::text, 'sha256'), 'hex'), greatest(v_settings.max_orders_per_window * 200, 500), v_settings.order_window_seconds);
  v_allowed_behavior := public.consume_public_rate_limit(v_session.stall_id, 'ATTEMPT_BEHAVIOR', p_behavior_hash, greatest(v_settings.max_behavior_frequency * 2, 6), v_settings.order_window_seconds);

  if not (v_allowed_ip and v_allowed_device and v_allowed_qr and v_allowed_session and v_allowed_stall and v_allowed_behavior) then
    perform public.record_public_order_attempt(
      p_request_id, 'ORDER_GATE', 'DENIED', 'RATE_LIMITED',
      v_session.tenant_id, v_session.stall_id, v_session.qr_code_id, v_session.id,
      p_ip_hash, p_device_hash, p_qr_token_hash, p_session_token_hash,
      p_behavior_hash, null
    );
    return jsonb_build_object('ok', false, 'code', 'RATE_LIMITED');
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

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
  elsif not v_stall.is_active or v_stall.ordering_state = 'CLOSED'::public.stall_ordering_state then
    perform public.record_public_order_attempt(p_request_id, 'ORDER_SUBMIT', 'DENIED', 'STALL_CLOSED', v_session.tenant_id, v_session.stall_id, v_session.qr_code_id, v_session.id, p_ip_hash, p_device_hash, p_qr_token_hash, p_session_token_hash, p_behavior_hash, p_idempotency_hash);
    return jsonb_build_object('ok', false, 'code', 'STALL_CLOSED');
  elsif v_stall.ordering_state = 'PAUSED'::public.stall_ordering_state then
    perform public.record_public_order_attempt(p_request_id, 'ORDER_SUBMIT', 'DENIED', 'ORDERING_PAUSED', v_session.tenant_id, v_session.stall_id, v_session.qr_code_id, v_session.id, p_ip_hash, p_device_hash, p_qr_token_hash, p_session_token_hash, p_behavior_hash, p_idempotency_hash);
    return jsonb_build_object('ok', false, 'code', 'ORDERING_PAUSED');
  elsif v_stall.is_sold_out then
    perform public.record_public_order_attempt(p_request_id, 'ORDER_SUBMIT', 'DENIED', 'STALL_SOLD_OUT', v_session.tenant_id, v_session.stall_id, v_session.qr_code_id, v_session.id, p_ip_hash, p_device_hash, p_qr_token_hash, p_session_token_hash, p_behavior_hash, p_idempotency_hash);
    return jsonb_build_object('ok', false, 'code', 'STALL_SOLD_OUT');
  elsif v_tenant.status not in ('TRIALING'::public.tenant_status, 'ACTIVE'::public.tenant_status) then
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

  if v_item_count > v_settings.max_unique_products or v_distinct_count <> v_item_count then
    perform public.record_public_order_attempt(p_request_id, 'ORDER_SUBMIT', 'DENIED', 'TOO_MANY_OR_DUPLICATE_PRODUCTS', v_session.tenant_id, v_session.stall_id, v_session.qr_code_id, v_session.id, p_ip_hash, p_device_hash, p_qr_token_hash, p_session_token_hash, p_behavior_hash, p_idempotency_hash);
    return jsonb_build_object('ok', false, 'code', 'TOO_MANY_OR_DUPLICATE_PRODUCTS');
  elsif v_total_quantity > v_settings.max_total_quantity then
    perform public.record_public_order_attempt(p_request_id, 'ORDER_SUBMIT', 'DENIED', 'EXCESSIVE_TOTAL_QUANTITY', v_session.tenant_id, v_session.stall_id, v_session.qr_code_id, v_session.id, p_ip_hash, p_device_hash, p_qr_token_hash, p_session_token_hash, p_behavior_hash, p_idempotency_hash);
    return jsonb_build_object('ok', false, 'code', 'EXCESSIVE_TOTAL_QUANTITY');
  elsif exists (
    select 1 from jsonb_to_recordset(p_items) as item(product_id uuid, quantity integer, note text)
    where item.quantity < 1 or item.quantity > v_settings.max_item_quantity
       or char_length(coalesce(item.note, '')) > v_settings.max_note_length
  ) then
    perform public.record_public_order_attempt(p_request_id, 'ORDER_SUBMIT', 'DENIED', 'EXCESSIVE_ITEM_QUANTITY', v_session.tenant_id, v_session.stall_id, v_session.qr_code_id, v_session.id, p_ip_hash, p_device_hash, p_qr_token_hash, p_session_token_hash, p_behavior_hash, p_idempotency_hash);
    return jsonb_build_object('ok', false, 'code', 'EXCESSIVE_ITEM_QUANTITY');
  elsif char_length(coalesce(p_customer_note, '')) > v_settings.max_note_length then
    perform public.record_public_order_attempt(p_request_id, 'ORDER_SUBMIT', 'DENIED', 'NOTE_TOO_LONG', v_session.tenant_id, v_session.stall_id, v_session.qr_code_id, v_session.id, p_ip_hash, p_device_hash, p_qr_token_hash, p_session_token_hash, p_behavior_hash, p_idempotency_hash);
    return jsonb_build_object('ok', false, 'code', 'NOTE_TOO_LONG');
  end if;

  select count(*), coalesce(sum(p.price * requested.quantity), 0)
  into v_valid_product_count, v_total
  from jsonb_to_recordset(p_items) as requested(product_id uuid, quantity integer, note text)
  join public.products p on p.id = requested.product_id
  where p.tenant_id = v_session.tenant_id
    and p.stall_id = v_session.stall_id
    and p.is_available;

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

  v_business_date := (now() at time zone 'Asia/Taipei')::date;
  insert into public.stall_order_counters (stall_id, business_date, next_value)
  values (v_session.stall_id, v_business_date, 2)
  on conflict (stall_id, business_date)
  do update set next_value = public.stall_order_counters.next_value + 1
  returning next_value - 1 into v_sequence;
  v_order_no := to_char(v_business_date, 'YYMMDD') || '-' || lpad(v_sequence::text, 3, '0');

  insert into public.orders (
    id, tenant_id, stall_id, order_no, tracking_token_hash,
    idempotency_key, source, customer_name, customer_phone,
    table_label, note, status, payment_status, total, device_hash,
    pickup_code_hash, confirmation_expires_at, created_at, updated_at
  ) values (
    p_order_id, v_session.tenant_id, v_session.stall_id, v_order_no,
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
    id, tenant_id, stall_id, order_id, product_id, name,
    unit_price, quantity, note, created_at
  )
  select gen_random_uuid(), v_session.tenant_id, v_session.stall_id,
    p_order_id, p.id, p.name, p.price, requested.quantity,
    nullif(left(trim(requested.note), v_settings.max_note_length), ''), v_created_at
  from jsonb_to_recordset(p_items) as requested(product_id uuid, quantity integer, note text)
  join public.products p on p.id = requested.product_id
  where p.tenant_id = v_session.tenant_id
    and p.stall_id = v_session.stall_id
    and p.is_available;

  update public.order_sessions
  set status = 'CONSUMED'::public.order_session_status,
      used_at = v_created_at,
      order_id = p_order_id
  where id = v_session.id and status = 'ACTIVE'::public.order_session_status;

  insert into public.order_events (
    id, tenant_id, stall_id, order_id, event_type,
    previous_status, new_status, created_at
  ) values (
    gen_random_uuid(), v_session.tenant_id, v_session.stall_id,
    p_order_id, 'PUBLIC_ORDER_CREATED', null,
    'WAITING_CONFIRMATION'::public.order_status, v_created_at
  );

  insert into public.audit_logs (
    id, tenant_id, stall_id, action, entity_type, entity_id,
    outcome, request_id, ip_hash, metadata, created_at
  ) values (
    gen_random_uuid(), v_session.tenant_id, v_session.stall_id,
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
$$;

create or replace function public.get_public_order(
  p_tracking_token_hash text,
  p_device_hash text
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'orderId', o.id,
    'orderNo', o.order_no,
    'orderStatus', o.status,
    'paymentStatus', o.payment_status,
    'totalAmount', o.total,
    'createdAt', o.created_at,
    'confirmedAt', o.confirmed_at,
    'completedAt', case when o.status = 'COMPLETED'::public.order_status then o.updated_at else null end,
    'stallName', s.name
  )
  from public.orders o
  join public.stalls s on s.id = o.stall_id
  where o.tracking_token_hash = p_tracking_token_hash
    and o.device_hash = p_device_hash;
$$;

create or replace function public.expire_unconfirmed_orders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order record;
  v_count integer := 0;
begin
  for v_order in
    update public.orders
    set status = 'EXPIRED'::public.order_status,
        expired_at = now(),
        updated_at = now()
    where status = 'WAITING_CONFIRMATION'::public.order_status
      and confirmation_expires_at <= now()
    returning id, tenant_id, stall_id
  loop
    v_count := v_count + 1;
    insert into public.order_events (
      id, tenant_id, stall_id, order_id, event_type,
      previous_status, new_status, created_at
    ) values (
      gen_random_uuid(), v_order.tenant_id, v_order.stall_id, v_order.id,
      'UNCONFIRMED_ORDER_EXPIRED', 'WAITING_CONFIRMATION'::public.order_status,
      'EXPIRED'::public.order_status, now()
    );
    insert into public.audit_logs (
      id, tenant_id, stall_id, action, entity_type, entity_id,
      outcome, request_id, metadata, created_at
    ) values (
      gen_random_uuid(), v_order.tenant_id, v_order.stall_id,
      'UNCONFIRMED_ORDER_EXPIRED', 'ORDER', v_order.id,
      'SUCCESS'::public.audit_outcome, gen_random_uuid()::text,
      '{"reason":"confirmation_timeout"}', now()
    );
  end loop;

  update public.order_sessions
  set status = 'EXPIRED'::public.order_session_status
  where status = 'ACTIVE'::public.order_session_status and expires_at <= now();

  update public.order_sessions os
  set status = 'EXPIRED'::public.order_session_status
  where os.status = 'ACTIVE'::public.order_session_status
    and exists (
      select 1 from public.qr_codes qr
      where qr.id = os.qr_code_id
        and qr.expires_at is not null
        and qr.expires_at <= now()
    );

  update public.qr_codes
  set state = 'EXPIRED'::public.qr_code_state,
      updated_at = now()
  where state in ('ACTIVE'::public.qr_code_state, 'PAUSED'::public.qr_code_state)
    and expires_at is not null
    and expires_at <= now();

  delete from public.public_rate_limit_buckets where expires_at < now() - interval '1 day';
  delete from public.rate_limit_buckets where expires_at < now() - interval '1 day';
  delete from public.public_order_attempts where created_at < now() - interval '180 days';
  return v_count;
end;
$$;

revoke all on function public.record_public_order_attempt(text, text, public.public_attempt_outcome, text, uuid, uuid, uuid, uuid, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.consume_public_rate_limit(uuid, text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.consume_global_rate_limit(text, integer, integer) from public, anon, authenticated;
revoke all on function public.check_global_public_request_gate(text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.issue_order_session(text, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.lookup_public_order_idempotency(text, uuid) from public, anon, authenticated;
revoke all on function public.check_public_order_submission_gate(text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.create_public_order(uuid, text, text, text, text, text, text, uuid, text, text, text, jsonb, text, text, text) from public, anon, authenticated;
revoke all on function public.get_public_order(text, text) from public, anon, authenticated;
revoke all on function public.expire_unconfirmed_orders() from public, anon, authenticated;

grant execute on function public.record_public_order_attempt(text, text, public.public_attempt_outcome, text, uuid, uuid, uuid, uuid, text, text, text, text, text, text) to service_role;
grant execute on function public.check_global_public_request_gate(text, text, text, text, text) to service_role;
grant execute on function public.issue_order_session(text, text, text, text, text, text, text) to service_role;
grant execute on function public.lookup_public_order_idempotency(text, uuid) to service_role;
grant execute on function public.check_public_order_submission_gate(text, text, text, text, text, text) to service_role;
grant execute on function public.create_public_order(uuid, text, text, text, text, text, text, uuid, text, text, text, jsonb, text, text, text) to service_role;
grant execute on function public.get_public_order(text, text) to service_role;
grant execute on function public.expire_unconfirmed_orders() to service_role;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema extensions;
    if not exists (select 1 from cron.job where jobname = 'stallorder-expire-unconfirmed-orders') then
      perform cron.schedule(
        'stallorder-expire-unconfirmed-orders',
        '* * * * *',
        'select public.expire_unconfirmed_orders()'
      );
    end if;
  end if;
end;
$$;
