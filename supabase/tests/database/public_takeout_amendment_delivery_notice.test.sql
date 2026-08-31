begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(8);

select has_column(
  'public',
  'stall_ordering_settings',
  'delivery_customer_notice',
  'delivery settings include a customer notice'
);

select is(
  (
    select pg_get_expr(def.adbin, def.adrelid)
    from pg_attrdef def
    join pg_attribute attribute
      on attribute.attrelid = def.adrelid
      and attribute.attnum = def.adnum
    where def.adrelid = 'public.stall_ordering_settings'::regclass
      and attribute.attname = 'preorder_min_lead_minutes'
  ),
  '5',
  'new stalls default to a five-minute preorder lead time'
);

select lives_ok(
  $$update public.stall_ordering_settings
    set preorder_min_lead_minutes = 5
    where stall_id = '22222222-2222-4222-8222-222222222222'$$,
  'five-minute lead times are accepted'
);

select throws_ok(
  $$update public.stall_ordering_settings
    set preorder_min_lead_minutes = 4
    where stall_id = '22222222-2222-4222-8222-222222222222'$$,
  '23514',
  null,
  'lead times below five minutes remain blocked'
);

select lives_ok(
  $$update public.stall_ordering_settings
    set delivery_customer_notice = repeat('a', 500)
    where stall_id = '22222222-2222-4222-8222-222222222222'$$,
  'delivery notices up to 500 characters are accepted'
);

select throws_ok(
  $$update public.stall_ordering_settings
    set delivery_customer_notice = repeat('a', 501)
    where stall_id = '22222222-2222-4222-8222-222222222222'$$,
  '22001',
  null,
  'delivery notices over 500 characters remain blocked'
);

insert into public.orders (
  id, organization_id, stall_id, order_no, tracking_token_hash, idempotency_key,
  customer_name, subtotal, total, device_hash, pickup_code_hash,
  confirmation_expires_at, updated_at
) values (
  'e8300000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  'AMENDMENT-TEST',
  encode(extensions.digest('amendment-tracking', 'sha256'), 'hex'),
  'e8300000-0000-4000-8000-000000000002',
  '測試顧客', 95, 95,
  encode(extensions.digest('amendment-device', 'sha256'), 'hex'),
  encode(extensions.digest('123', 'sha256'), 'hex'),
  now() + interval '10 minutes', now()
);

insert into public.order_events (
  id, organization_id, stall_id, order_id, event_type, metadata_json
) values (
  'e8300000-0000-4000-8000-000000000003',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  'e8300000-0000-4000-8000-000000000001',
  'PUBLIC_ORDER_ITEMS_ADJUSTED',
  jsonb_build_object(
    'reason', 'SOLD_OUT_REMOVE',
    'customerMessage', '商品售完，已移除並重新計算金額。',
    'before', jsonb_build_object('total', 190),
    'after', jsonb_build_object('total', 95)
  )
);

select is(
  public.get_public_order(
    encode(extensions.digest('amendment-tracking', 'sha256'), 'hex'),
    encode(extensions.digest('amendment-device', 'sha256'), 'hex')
  ) #>> '{merchantAmendment,message}',
  '商品售完，已移除並重新計算金額。',
  'public tracking returns the latest merchant amendment notice'
);

select is(
  public.get_public_order(
    encode(extensions.digest('amendment-tracking', 'sha256'), 'hex'),
    encode(extensions.digest('amendment-device', 'sha256'), 'hex')
  )->>'currency',
  'TWD',
  'public tracking returns the stall currency for updated totals'
);

select * from finish();
rollback;
