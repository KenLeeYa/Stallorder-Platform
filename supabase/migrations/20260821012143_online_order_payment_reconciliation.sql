insert into public.resilience_feature_flags (
  code,
  description,
  default_enabled,
  is_emergency
)
values (
  'ONLINE_ORDER_PAYMENT_ENABLED',
  'Provider-neutral online order payment foundation. Keep disabled until provider and policy approval.',
  false,
  false
)
on conflict (code) do nothing;

create unique index if not exists orders_id_organization_stall_key
  on public.orders (id, organization_id, stall_id);
create unique index if not exists payments_id_organization_stall_order_key
  on public.payments (id, organization_id, stall_id, order_id);

create table public.online_order_payment_intents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  stall_id uuid not null,
  order_id uuid not null,
  provider text not null default 'LOCAL_MOCK',
  provider_intent_id text not null,
  idempotency_key text not null,
  request_fingerprint text not null,
  amount integer not null,
  currency text not null,
  status text not null default 'REQUIRES_AUTHORIZATION',
  reconciliation_status text not null default 'PENDING',
  reconciliation_code text,
  reconciled_payment_id uuid,
  last_provider_event_id text,
  last_provider_event_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint online_order_payment_intents_scope_key
    unique (id, organization_id, stall_id, provider),
  constraint online_order_payment_intents_provider_key
    unique (provider, provider_intent_id),
  constraint online_order_payment_intents_order_key
    unique (order_id),
  constraint online_order_payment_intents_idempotency_key
    unique (organization_id, stall_id, idempotency_key),
  constraint online_order_payment_intents_stall_scope_fkey
    foreign key (stall_id, organization_id)
    references public.stalls(id, organization_id) on delete restrict,
  constraint online_order_payment_intents_order_scope_fkey
    foreign key (order_id, organization_id, stall_id)
    references public.orders(id, organization_id, stall_id) on delete restrict,
  constraint online_order_payment_intents_reconciled_payment_scope_fkey
    foreign key (reconciled_payment_id, organization_id, stall_id, order_id)
    references public.payments(id, organization_id, stall_id, order_id) on delete restrict,
  constraint online_order_payment_intents_provider_check
    check (provider = 'LOCAL_MOCK'),
  constraint online_order_payment_intents_provider_id_check
    check (provider_intent_id ~ '^local_mock_pi_[0-9a-f]{32}$'),
  constraint online_order_payment_intents_idempotency_check
    check (idempotency_key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  constraint online_order_payment_intents_fingerprint_check
    check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint online_order_payment_intents_amount_check check (amount > 0),
  constraint online_order_payment_intents_currency_check
    check (currency ~ '^[A-Z]{3}$'),
  constraint online_order_payment_intents_status_check check (
    status in (
      'REQUIRES_AUTHORIZATION', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'TIMED_OUT'
    )
  ),
  constraint online_order_payment_intents_reconciliation_check check (
    reconciliation_status in ('PENDING', 'MATCHED', 'MISMATCH', 'NOT_APPLICABLE')
    and (reconciliation_code is null or reconciliation_code ~ '^[A-Z][A-Z0-9_]{2,79}$')
    and (
      (reconciliation_status = 'MATCHED' and reconciled_payment_id is not null)
      or (reconciliation_status <> 'MATCHED' and reconciled_payment_id is null)
    )
  )
);

create index online_order_payment_intents_reconciliation_idx
  on public.online_order_payment_intents (
    organization_id, stall_id, reconciliation_status, created_at
  );
create index online_order_payment_intents_order_idx
  on public.online_order_payment_intents (order_id, created_at desc);

create table public.online_order_payment_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  stall_id uuid not null,
  intent_id uuid not null,
  provider text not null,
  provider_event_id text not null,
  provider_intent_id text not null,
  event_type text not null,
  provider_created_at timestamptz not null,
  received_at timestamptz not null default now(),
  signature_timestamp timestamptz not null,
  body_sha256 text not null,
  order_reference text not null,
  amount integer not null,
  currency text not null,
  processing_status text not null default 'RECORDED',
  safe_error_code text,
  processed_at timestamptz,
  constraint online_order_payment_events_provider_event_key
    unique (provider, provider_event_id),
  constraint online_order_payment_events_intent_scope_fkey
    foreign key (intent_id, organization_id, stall_id, provider)
    references public.online_order_payment_intents(id, organization_id, stall_id, provider)
    on delete restrict,
  constraint online_order_payment_events_provider_check
    check (provider = 'LOCAL_MOCK'),
  constraint online_order_payment_events_provider_event_id_check
    check (provider_event_id ~ '^local_mock_evt_[0-9a-f]{32}$'),
  constraint online_order_payment_events_provider_intent_id_check
    check (provider_intent_id ~ '^local_mock_pi_[0-9a-f]{32}$'),
  constraint online_order_payment_events_type_check check (
    event_type in (
      'PAYMENT_AUTHORIZED', 'PAYMENT_CAPTURED', 'PAYMENT_FAILED', 'PAYMENT_TIMED_OUT'
    )
  ),
  constraint online_order_payment_events_body_hash_check
    check (body_sha256 ~ '^[0-9a-f]{64}$'),
  constraint online_order_payment_events_order_reference_check
    check (order_reference ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  constraint online_order_payment_events_amount_check check (amount > 0),
  constraint online_order_payment_events_currency_check
    check (currency ~ '^[A-Z]{3}$'),
  constraint online_order_payment_events_processing_check check (
    processing_status in ('RECORDED', 'IGNORED_OUT_OF_ORDER', 'MISMATCH', 'APPLIED')
    and (safe_error_code is null or safe_error_code ~ '^[A-Z][A-Z0-9_]{2,79}$')
    and ((processing_status = 'RECORDED' and processed_at is null)
      or (processing_status <> 'RECORDED' and processed_at is not null))
  )
);

create index online_order_payment_events_intent_created_idx
  on public.online_order_payment_events (intent_id, provider_created_at, received_at);
create index online_order_payment_events_processing_idx
  on public.online_order_payment_events (
    organization_id, stall_id, processing_status, received_at
  );

create function app_private.prepare_online_order_payment_intent()
returns trigger
language plpgsql
set search_path = pg_catalog, public, app_private
as $$
begin
  if new.id <> old.id
    or new.organization_id <> old.organization_id
    or new.stall_id <> old.stall_id
    or new.order_id <> old.order_id
    or new.provider <> old.provider
    or new.provider_intent_id <> old.provider_intent_id
    or new.idempotency_key <> old.idempotency_key
    or new.request_fingerprint <> old.request_fingerprint
    or new.amount <> old.amount
    or new.currency <> old.currency
    or new.created_at <> old.created_at then
    raise exception 'ONLINE_PAYMENT_INTENT_IMMUTABLE'
      using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger online_order_payment_intents_prepare_update
before update on public.online_order_payment_intents
for each row execute function app_private.prepare_online_order_payment_intent();

create function app_private.guard_online_order_payment_event()
returns trigger
language plpgsql
set search_path = pg_catalog, public, app_private
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'ONLINE_PAYMENT_EVENT_IMMUTABLE'
      using errcode = '23514';
  end if;
  if new.id <> old.id
    or new.organization_id <> old.organization_id
    or new.stall_id <> old.stall_id
    or new.intent_id <> old.intent_id
    or new.provider <> old.provider
    or new.provider_event_id <> old.provider_event_id
    or new.provider_intent_id <> old.provider_intent_id
    or new.event_type <> old.event_type
    or new.provider_created_at <> old.provider_created_at
    or new.received_at <> old.received_at
    or new.signature_timestamp <> old.signature_timestamp
    or new.body_sha256 <> old.body_sha256
    or new.order_reference <> old.order_reference
    or new.amount <> old.amount
    or new.currency <> old.currency then
    raise exception 'ONLINE_PAYMENT_EVENT_IMMUTABLE'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger online_order_payment_events_guard_change
before update or delete on public.online_order_payment_events
for each row execute function app_private.guard_online_order_payment_event();

create function app_private.record_online_order_payment_audit(
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_organization_id uuid,
  p_stall_id uuid,
  p_request_id text,
  p_after jsonb
)
returns void
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, extensions, app_private
as $$
begin
  insert into public.audit_logs (
    id, organization_id, stall_id, action, entity_type, entity_id,
    outcome, request_id, after_json
  ) values (
    gen_random_uuid(), p_organization_id, p_stall_id, p_action, p_entity_type,
    p_entity_id, 'SUCCESS'::public.audit_outcome,
    'online-payment:' || encode(
      extensions.digest(
        coalesce(nullif(btrim(p_request_id), ''), 'online-payment-system'),
        'sha256'
      ),
      'hex'
    ),
    coalesce(p_after, '{}'::jsonb)
  );
end;
$$;

create function app_private.create_online_order_payment_intent(
  p_organization_id uuid,
  p_stall_id uuid,
  p_order_id uuid,
  p_idempotency_key text,
  p_request_fingerprint text,
  p_request_id text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, extensions, app_private
as $$
declare
  v_existing public.online_order_payment_intents%rowtype;
  v_intent public.online_order_payment_intents%rowtype;
  v_order public.orders%rowtype;
  v_currency text;
  v_intent_id uuid;
begin
  if p_organization_id is null
    or p_stall_id is null
    or p_order_id is null
    or p_idempotency_key is null
    or p_idempotency_key !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or p_request_fingerprint is null
    or p_request_fingerprint !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'code', 'PAYMENT_INVALID_INPUT');
  end if;

  perform pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'online-payment-intent:' || p_organization_id::text || ':'
      || p_stall_id::text || ':' || lower(p_idempotency_key),
    0
  ));

  select * into v_existing
  from public.online_order_payment_intents intent
  where intent.organization_id = p_organization_id
    and intent.stall_id = p_stall_id
    and intent.idempotency_key = lower(p_idempotency_key);

  if found then
    if v_existing.order_id <> p_order_id
      or v_existing.request_fingerprint <> p_request_fingerprint then
      return jsonb_build_object('ok', false, 'code', 'PAYMENT_IDEMPOTENCY_CONFLICT');
    end if;
    return jsonb_build_object(
      'ok', true,
      'code', 'PAYMENT_INTENT_IDEMPOTENT_REPLAY',
      'intentId', v_existing.id,
      'providerIntentId', v_existing.provider_intent_id,
      'orderId', v_existing.order_id,
      'amount', v_existing.amount,
      'currency', v_existing.currency,
      'status', v_existing.status,
      'idempotentReplay', true
    );
  end if;

  if not app_private.evaluate_resilience_feature_flag(
    'ONLINE_ORDER_PAYMENT_ENABLED', p_organization_id, p_stall_id, null, p_order_id::text
  ) then
    return jsonb_build_object('ok', false, 'code', 'ONLINE_ORDER_PAYMENT_DISABLED');
  end if;

  perform pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'online-payment-order:' || p_order_id::text,
    0
  ));
  select * into v_existing
  from public.online_order_payment_intents intent
  where intent.order_id = p_order_id
    and intent.organization_id = p_organization_id
    and intent.stall_id = p_stall_id;
  if found then
    return jsonb_build_object('ok', false, 'code', 'PAYMENT_ORDER_INTENT_EXISTS');
  end if;

  select order_record.*
  into v_order
  from public.orders order_record
  join public.stalls stall
    on stall.id = order_record.stall_id
   and stall.organization_id = order_record.organization_id
  where order_record.id = p_order_id
    and order_record.organization_id = p_organization_id
    and order_record.stall_id = p_stall_id
  for update of order_record;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'PAYMENT_ORDER_NOT_FOUND');
  end if;
  select stall.currency into v_currency
  from public.stalls stall
  where stall.id = v_order.stall_id
    and stall.organization_id = v_order.organization_id;
  if v_order.status in ('CANCELLED'::public.order_status, 'EXPIRED'::public.order_status)
    or v_order.payment_status <> 'UNPAID'::public.payment_status
    or v_order.total <= 0
    or exists (select 1 from public.payments payment where payment.order_id = v_order.id) then
    return jsonb_build_object('ok', false, 'code', 'PAYMENT_ORDER_NOT_ELIGIBLE');
  end if;

  v_intent_id := gen_random_uuid();
  insert into public.online_order_payment_intents (
    id, organization_id, stall_id, order_id, provider, provider_intent_id,
    idempotency_key, request_fingerprint, amount, currency
  ) values (
    v_intent_id, p_organization_id, p_stall_id, p_order_id, 'LOCAL_MOCK',
    'local_mock_pi_' || replace(v_intent_id::text, '-', ''),
    lower(p_idempotency_key), p_request_fingerprint, v_order.total, v_currency
  )
  returning * into v_intent;

  perform app_private.record_online_order_payment_audit(
    'ONLINE_PAYMENT_INTENT_CREATED', 'ONLINE_PAYMENT_INTENT', v_intent.id,
    v_intent.organization_id, v_intent.stall_id, p_request_id,
    jsonb_build_object(
      'provider', v_intent.provider,
      'orderId', v_intent.order_id,
      'amount', v_intent.amount,
      'currency', v_intent.currency,
      'status', v_intent.status
    )
  );

  return jsonb_build_object(
    'ok', true,
    'code', 'PAYMENT_INTENT_CREATED',
    'intentId', v_intent.id,
    'providerIntentId', v_intent.provider_intent_id,
    'orderId', v_intent.order_id,
    'amount', v_intent.amount,
    'currency', v_intent.currency,
    'status', v_intent.status,
    'idempotentReplay', false
  );
end;
$$;

create function app_private.record_online_order_payment_event(
  p_provider text,
  p_provider_event_id text,
  p_provider_intent_id text,
  p_event_type text,
  p_provider_created_at timestamptz,
  p_signature_timestamp timestamptz,
  p_body_sha256 text,
  p_order_reference text,
  p_amount integer,
  p_currency text,
  p_request_id text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_existing public.online_order_payment_events%rowtype;
  v_intent public.online_order_payment_intents%rowtype;
  v_event public.online_order_payment_events%rowtype;
  v_event_status text;
  v_match_code text;
  v_incoming_rank integer;
  v_current_rank integer;
  v_apply boolean;
begin
  if p_provider <> 'LOCAL_MOCK'
    or p_provider_event_id is null
    or p_provider_event_id !~ '^local_mock_evt_[0-9a-f]{32}$'
    or p_provider_intent_id !~ '^local_mock_pi_[0-9a-f]{32}$'
    or p_event_type not in (
      'PAYMENT_AUTHORIZED', 'PAYMENT_CAPTURED', 'PAYMENT_FAILED', 'PAYMENT_TIMED_OUT'
    )
    or p_provider_created_at is null
    or p_signature_timestamp is null
    or p_body_sha256 !~ '^[0-9a-f]{64}$'
    or p_order_reference !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or p_amount <= 0
    or p_currency !~ '^[A-Z]{3}$' then
    return jsonb_build_object('ok', false, 'code', 'PAYMENT_EVENT_INVALID');
  end if;
  if p_signature_timestamp < now() - interval '5 minutes'
    or p_signature_timestamp > now() + interval '5 minutes' then
    return jsonb_build_object('ok', false, 'code', 'PAYMENT_WEBHOOK_TIMESTAMP_EXPIRED');
  end if;

  perform pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'online-payment-event:' || p_provider || ':' || p_provider_event_id,
    0
  ));

  select * into v_existing
  from public.online_order_payment_events payment_event
  where payment_event.provider = p_provider
    and payment_event.provider_event_id = p_provider_event_id;
  if found then
    if v_existing.provider_intent_id <> p_provider_intent_id
      or v_existing.event_type <> p_event_type
      or v_existing.provider_created_at <> p_provider_created_at
      or v_existing.body_sha256 <> p_body_sha256
      or v_existing.order_reference <> lower(p_order_reference)
      or v_existing.amount <> p_amount
      or v_existing.currency <> p_currency then
      return jsonb_build_object('ok', false, 'code', 'PAYMENT_EVENT_IDEMPOTENCY_CONFLICT');
    end if;
    return jsonb_build_object(
      'ok', true,
      'code', 'PAYMENT_EVENT_DUPLICATE',
      'eventId', v_existing.id,
      'intentId', v_existing.intent_id,
      'processingStatus', v_existing.processing_status,
      'duplicate', true
    );
  end if;

  select * into v_intent
  from public.online_order_payment_intents intent
  where intent.provider = p_provider
    and intent.provider_intent_id = p_provider_intent_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'PAYMENT_INTENT_NOT_FOUND');
  end if;

  if lower(p_order_reference) <> v_intent.order_id::text then
    v_match_code := 'ORDER_MISMATCH';
  elsif p_amount <> v_intent.amount then
    v_match_code := 'AMOUNT_MISMATCH';
  elsif p_currency <> v_intent.currency then
    v_match_code := 'CURRENCY_MISMATCH';
  end if;

  if v_match_code is not null then
    v_event_status := 'MISMATCH';
    insert into public.online_order_payment_events (
      organization_id, stall_id, intent_id, provider, provider_event_id,
      provider_intent_id, event_type, provider_created_at, signature_timestamp,
      body_sha256, order_reference, amount, currency, processing_status,
      safe_error_code, processed_at
    ) values (
      v_intent.organization_id, v_intent.stall_id, v_intent.id, p_provider,
      p_provider_event_id, p_provider_intent_id, p_event_type,
      p_provider_created_at, p_signature_timestamp, p_body_sha256,
      lower(p_order_reference), p_amount, p_currency, v_event_status,
      v_match_code, now()
    ) returning * into v_event;
    if v_intent.reconciliation_status <> 'MATCHED' then
      update public.online_order_payment_intents
      set reconciliation_status = 'MISMATCH', reconciliation_code = v_match_code
      where id = v_intent.id;
    end if;
  else
    if v_intent.reconciliation_status = 'MATCHED' then
      v_apply := false;
    else
      v_incoming_rank := case p_event_type
        when 'PAYMENT_AUTHORIZED' then 10
        when 'PAYMENT_FAILED' then 20
        when 'PAYMENT_TIMED_OUT' then 20
        when 'PAYMENT_CAPTURED' then 30
      end;
      v_current_rank := case v_intent.status
        when 'REQUIRES_AUTHORIZATION' then 0
        when 'AUTHORIZED' then 10
        when 'FAILED' then 20
        when 'TIMED_OUT' then 20
        when 'CAPTURED' then 30
      end;
      v_apply := v_incoming_rank > v_current_rank
        or (
          v_incoming_rank = v_current_rank
          and p_provider_created_at >= coalesce(v_intent.last_provider_event_at, '-infinity'::timestamptz)
        );
    end if;
    v_event_status := case when v_apply then 'RECORDED' else 'IGNORED_OUT_OF_ORDER' end;

    insert into public.online_order_payment_events (
      organization_id, stall_id, intent_id, provider, provider_event_id,
      provider_intent_id, event_type, provider_created_at, signature_timestamp,
      body_sha256, order_reference, amount, currency, processing_status,
      safe_error_code, processed_at
    ) values (
      v_intent.organization_id, v_intent.stall_id, v_intent.id, p_provider,
      p_provider_event_id, p_provider_intent_id, p_event_type,
      p_provider_created_at, p_signature_timestamp, p_body_sha256,
      lower(p_order_reference), p_amount, p_currency, v_event_status,
      case
        when v_apply then null
        when v_intent.reconciliation_status = 'MATCHED' then 'ALREADY_RECONCILED'
        else 'OUT_OF_ORDER_EVENT'
      end,
      case when v_apply then null else now() end
    ) returning * into v_event;

    if v_apply then
      update public.online_order_payment_intents
      set status = case p_event_type
          when 'PAYMENT_AUTHORIZED' then 'AUTHORIZED'
          when 'PAYMENT_CAPTURED' then 'CAPTURED'
          when 'PAYMENT_FAILED' then 'FAILED'
          when 'PAYMENT_TIMED_OUT' then 'TIMED_OUT'
        end,
        reconciliation_status = case p_event_type
          when 'PAYMENT_FAILED' then 'NOT_APPLICABLE'
          when 'PAYMENT_TIMED_OUT' then 'NOT_APPLICABLE'
          else 'PENDING'
        end,
        reconciliation_code = null,
        last_provider_event_id = p_provider_event_id,
        last_provider_event_at = p_provider_created_at
      where id = v_intent.id
      returning * into v_intent;
    end if;
  end if;

  perform app_private.record_online_order_payment_audit(
    'ONLINE_PAYMENT_EVENT_RECORDED', 'ONLINE_PAYMENT_EVENT', v_event.id,
    v_intent.organization_id, v_intent.stall_id, p_request_id,
    jsonb_build_object(
      'provider', p_provider,
      'eventType', p_event_type,
      'processingStatus', v_event.processing_status,
      'safeErrorCode', v_event.safe_error_code,
      'intentId', v_intent.id
    )
  );

  return jsonb_build_object(
    'ok', true,
    'code', 'PAYMENT_EVENT_RECORDED',
    'eventId', v_event.id,
    'intentId', v_intent.id,
    'intentStatus', v_intent.status,
    'processingStatus', v_event.processing_status,
    'duplicate', false
  );
end;
$$;

create function app_private.reconcile_online_order_payment(
  p_organization_id uuid,
  p_stall_id uuid,
  p_intent_id uuid,
  p_request_id text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_intent public.online_order_payment_intents%rowtype;
  v_order public.orders%rowtype;
  v_event public.online_order_payment_events%rowtype;
  v_payment public.payments%rowtype;
  v_currency text;
  v_match_code text;
begin
  select * into v_intent
  from public.online_order_payment_intents intent
  where intent.id = p_intent_id
    and intent.organization_id = p_organization_id
    and intent.stall_id = p_stall_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'PAYMENT_INTENT_NOT_FOUND');
  end if;
  select * into v_order
  from public.orders order_record
  where order_record.id = v_intent.order_id
    and order_record.organization_id = v_intent.organization_id
    and order_record.stall_id = v_intent.stall_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'PAYMENT_RECONCILIATION_MISMATCH');
  end if;
  select stall.currency into v_currency
  from public.stalls stall
  where stall.id = v_intent.stall_id
    and stall.organization_id = v_intent.organization_id;
  if v_intent.reconciliation_status = 'MATCHED'
    and v_intent.reconciled_payment_id is not null then
    return jsonb_build_object(
      'ok', true,
      'code', 'PAYMENT_RECONCILIATION_IDEMPOTENT_REPLAY',
      'intentId', v_intent.id,
      'paymentId', v_intent.reconciled_payment_id,
      'idempotentReplay', true
    );
  end if;
  if v_intent.reconciliation_status = 'MISMATCH' then
    return jsonb_build_object(
      'ok', false,
      'code', 'PAYMENT_RECONCILIATION_MISMATCH',
      'matchCode', v_intent.reconciliation_code
    );
  end if;
  if v_intent.status <> 'CAPTURED' then
    return jsonb_build_object('ok', false, 'code', 'PAYMENT_NOT_CAPTURED');
  end if;

  select * into v_event
  from public.online_order_payment_events payment_event
  where payment_event.intent_id = v_intent.id
    and payment_event.event_type = 'PAYMENT_CAPTURED'
    and payment_event.processing_status in ('RECORDED', 'APPLIED')
  order by payment_event.provider_created_at desc, payment_event.received_at desc
  limit 1
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'PAYMENT_CAPTURE_EVENT_NOT_FOUND');
  end if;

  if v_intent.organization_id <> v_order.organization_id
    or v_intent.stall_id <> v_order.stall_id
    or v_intent.order_id <> v_order.id
    or v_event.organization_id <> v_order.organization_id
    or v_event.stall_id <> v_order.stall_id
    or v_event.order_reference <> v_order.id::text then
    v_match_code := 'ORDER_OR_TENANT_MISMATCH';
  elsif v_intent.amount <> v_order.total or v_event.amount <> v_order.total then
    v_match_code := 'AMOUNT_MISMATCH';
  elsif v_intent.currency <> v_currency or v_event.currency <> v_currency then
    v_match_code := 'CURRENCY_MISMATCH';
  end if;

  if v_match_code is not null then
    update public.online_order_payment_intents
    set reconciliation_status = 'MISMATCH', reconciliation_code = v_match_code
    where id = v_intent.id;
    update public.online_order_payment_events
    set processing_status = 'MISMATCH', safe_error_code = v_match_code, processed_at = now()
    where id = v_event.id;
    perform app_private.record_online_order_payment_audit(
      'ONLINE_PAYMENT_RECONCILIATION_MISMATCH', 'ONLINE_PAYMENT_INTENT', v_intent.id,
      v_intent.organization_id, v_intent.stall_id, p_request_id,
      jsonb_build_object('provider', v_intent.provider, 'matchCode', v_match_code)
    );
    return jsonb_build_object(
      'ok', false, 'code', 'PAYMENT_RECONCILIATION_MISMATCH', 'matchCode', v_match_code
    );
  end if;

  select * into v_payment
  from public.payments payment
  where payment.order_id = v_order.id
  for update;
  if found or v_order.payment_status <> 'UNPAID'::public.payment_status then
    return jsonb_build_object('ok', false, 'code', 'PAYMENT_ALREADY_RECORDED');
  end if;

  insert into public.payments (
    organization_id, stall_id, order_id, amount, method, status, reference,
    method_label, paid_at
  ) values (
    v_order.organization_id, v_order.stall_id, v_order.id, v_order.total,
    'OTHER'::public.payment_method, 'PAID'::public.payment_status,
    'ONLINE:LOCAL_MOCK:' || v_intent.provider_intent_id,
    'Online payment', v_event.provider_created_at
  ) returning * into v_payment;

  update public.orders
  set payment_status = 'PAID'::public.payment_status,
    paid_at = coalesce(paid_at, v_event.provider_created_at),
    updated_at = now()
  where id = v_order.id;

  update public.online_order_payment_events
  set processing_status = 'APPLIED', safe_error_code = null, processed_at = now()
  where id = v_event.id;

  update public.online_order_payment_intents
  set reconciliation_status = 'MATCHED', reconciliation_code = null,
    reconciled_payment_id = v_payment.id
  where id = v_intent.id;

  perform app_private.record_online_order_payment_audit(
    'ONLINE_PAYMENT_RECONCILED', 'ONLINE_PAYMENT_INTENT', v_intent.id,
    v_intent.organization_id, v_intent.stall_id, p_request_id,
    jsonb_build_object(
      'provider', v_intent.provider,
      'orderId', v_order.id,
      'paymentId', v_payment.id,
      'amount', v_payment.amount,
      'currency', v_currency,
      'status', 'MATCHED'
    )
  );

  return jsonb_build_object(
    'ok', true,
    'code', 'PAYMENT_RECONCILED',
    'intentId', v_intent.id,
    'paymentId', v_payment.id,
    'idempotentReplay', false
  );
end;
$$;

alter table public.online_order_payment_intents enable row level security;
alter table public.online_order_payment_intents force row level security;
alter table public.online_order_payment_events enable row level security;
alter table public.online_order_payment_events force row level security;

revoke all on table public.online_order_payment_intents
  from public, anon, authenticated;
revoke all on table public.online_order_payment_events
  from public, anon, authenticated;

grant select, insert, update, delete
  on table public.online_order_payment_intents,
    public.online_order_payment_events
  to service_role;

revoke all on function app_private.prepare_online_order_payment_intent()
  from public, anon, authenticated, service_role;
revoke all on function app_private.guard_online_order_payment_event()
  from public, anon, authenticated, service_role;
revoke all on function app_private.record_online_order_payment_audit(
  text, text, uuid, uuid, uuid, text, jsonb
) from public, anon, authenticated, service_role;

revoke all on function app_private.create_online_order_payment_intent(
  uuid, uuid, uuid, text, text, text
) from public, anon, authenticated;
grant execute on function app_private.create_online_order_payment_intent(
  uuid, uuid, uuid, text, text, text
) to service_role;

revoke all on function app_private.record_online_order_payment_event(
  text, text, text, text, timestamptz, timestamptz, text, text, integer, text, text
) from public, anon, authenticated;
grant execute on function app_private.record_online_order_payment_event(
  text, text, text, text, timestamptz, timestamptz, text, text, integer, text, text
) to service_role;

revoke all on function app_private.reconcile_online_order_payment(
  uuid, uuid, uuid, text
) from public, anon, authenticated;
grant execute on function app_private.reconcile_online_order_payment(
  uuid, uuid, uuid, text
) to service_role;

comment on table public.online_order_payment_intents is
  'Provider-neutral online order payment intent ledger. LOCAL_MOCK only in this provisional phase.';
comment on table public.online_order_payment_events is
  'Normalized signed webhook event ledger. Stores hashes and safe fields, never secrets, signatures, raw bodies, or customer PII.';
comment on function app_private.reconcile_online_order_payment(uuid, uuid, uuid, text) is
  'The only transaction allowed to materialize a MATCHED online capture into public.payments and orders.payment_status.';
