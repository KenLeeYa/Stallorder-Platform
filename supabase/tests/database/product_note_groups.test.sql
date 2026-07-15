begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(21);

delete from public.public_order_attempts;
delete from public.public_rate_limit_buckets;
delete from public.rate_limit_buckets;
delete from public.order_sessions;
delete from public.orders;
delete from public.stall_order_counters;

select ok(
  (
    select count(*) = 6 and bool_and(relrowsecurity and relforcerowsecurity)
    from pg_class
    where oid = any (array[
      'public.product_note_groups'::regclass,
      'public.product_note_options'::regclass,
      'public.product_note_group_translations'::regclass,
      'public.product_note_option_translations'::regclass,
      'public.product_note_group_assignments'::regclass,
      'public.order_item_note_options'::regclass
    ])
  ),
  '註記群組相關資料表全部啟用並強制套用 RLS'
);

select ok(
  not exists (
    select 1
    from information_schema.role_table_grants
    where table_schema = 'public'
      and grantee = 'anon'
      and table_name = any (array[
        'product_note_groups', 'product_note_options',
        'product_note_group_translations', 'product_note_option_translations',
        'product_note_group_assignments', 'order_item_note_options'
      ])
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
  ),
  '匿名角色不可直接寫入註記群組或訂單註記快照'
);

select ok(
  not exists (
    select 1
    from information_schema.role_table_grants
    where table_schema = 'public'
      and grantee = 'authenticated'
      and table_name = any (array[
        'product_note_groups', 'product_note_options',
        'product_note_group_translations', 'product_note_option_translations',
        'product_note_group_assignments', 'order_item_note_options'
      ])
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
  ),
  '登入角色也必須經受信任後端寫入註記群組'
);

insert into public.organizations (
  id, name, slug, business_name, status, email, phone,
  default_timezone, default_currency, created_at, updated_at
) values (
  '91111111-1111-4111-8111-111111111119',
  '註記跨組織測試',
  'product-note-scope-test',
  '註記跨組織測試',
  'ACTIVE',
  'product-note-scope@stallorder.test',
  '0900-000-119',
  'Asia/Taipei',
  'TWD',
  now(),
  now()
);

select throws_ok(
  $$insert into public.product_note_group_assignments (
      organization_id, product_id, note_group_id, sort_order, is_active
    ) values (
      '91111111-1111-4111-8111-111111111119',
      '44444444-4444-4444-8444-444444444441',
      'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
      1,
      true
    )$$,
  'P0001',
  'PRODUCT_NOTE_ASSIGNMENT_SCOPE_MISMATCH',
  '資料庫拒絕跨組織商品與註記群組分派'
);

create function pg_temp.add_note_session(p_token text)
returns void
language sql
as $$
  insert into public.order_sessions (
    id, tenant_id, organization_id, stall_id, qr_code_id, token_hash,
    device_hash, ip_hash, status, expires_at, created_at
  ) values (
    gen_random_uuid(),
    '11111111-1111-4111-8111-111111111111',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    (select id from public.qr_codes where token = 'demo-aming-chicken-qr-2026-rotate-me'),
    encode(extensions.digest(p_token, 'sha256'), 'hex'),
    encode(extensions.digest('product-note-device', 'sha256'), 'hex'),
    encode(extensions.digest('ip-' || p_token, 'sha256'), 'hex'),
    'ACTIVE',
    now() + interval '10 minutes',
    now()
  );
$$;

create function pg_temp.submit_note_order(
  p_session_token text,
  p_order_id uuid,
  p_idempotency_key uuid,
  p_items jsonb,
  p_tracking_token text
)
returns jsonb
language sql
as $$
  select public.create_public_order(
    p_order_id,
    'demo-aming-chicken-qr-2026-rotate-me',
    encode(extensions.digest(p_session_token, 'sha256'), 'hex'),
    encode(extensions.digest('product-note-device', 'sha256'), 'hex'),
    encode(extensions.digest('ip-' || p_session_token, 'sha256'), 'hex'),
    encode(extensions.digest('product-note-qr', 'sha256'), 'hex'),
    encode(extensions.digest('behavior-' || p_session_token, 'sha256'), 'hex'),
    p_idempotency_key,
    encode(extensions.digest('idem-' || p_idempotency_key::text, 'sha256'), 'hex'),
    '註記測試顧客',
    '',
    p_items,
    encode(extensions.digest(p_tracking_token, 'sha256'), 'hex'),
    encode(extensions.digest('pickup-' || p_order_id::text, 'sha256'), 'hex'),
    'product-note-' || p_order_id::text
  );
$$;

select pg_temp.add_note_session('missing-required-session');
select is(
  pg_temp.submit_note_order(
    'missing-required-session',
    '75000000-0000-4000-8000-000000000001',
    '75100000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'product_id', '44444444-4444-4444-8444-444444444443',
      'quantity', 1,
      'note', '',
      'modifier_option_ids', jsonb_build_array()
    )),
    'missing-required-tracking'
  )->>'code',
  'INVALID_PRODUCT_NOTES',
  '缺少必選辣度時拒絕成立訂單'
);
select is(
  (
    select status::text
    from public.order_sessions
    where token_hash = encode(extensions.digest('missing-required-session', 'sha256'), 'hex')
  ),
  'ACTIVE',
  '註記驗證失敗不會消耗訂單 session'
);
select is(
  (
    select reason_code
    from public.public_order_attempts
    where request_id = 'product-note-75000000-0000-4000-8000-000000000001'
    order by created_at desc
    limit 1
  ),
  'INVALID_PRODUCT_NOTES',
  '註記驗證失敗會寫入公開訂單安全紀錄'
);

select pg_temp.add_note_session('wrong-product-session');
select is(
  pg_temp.submit_note_order(
    'wrong-product-session',
    '75000000-0000-4000-8000-000000000002',
    '75100000-0000-4000-8000-000000000002',
    jsonb_build_array(jsonb_build_object(
      'product_id', '44444444-4444-4444-8444-444444444441',
      'quantity', 1,
      'note', '',
      'modifier_option_ids', jsonb_build_array('dddddddd-dddd-4ddd-8ddd-ddddddddddd3')
    )),
    'wrong-product-tracking'
  )->>'code',
  'INVALID_PRODUCT_NOTES',
  '不可將其他商品未分派的註記選項偽造進訂單'
);

select pg_temp.add_note_session('single-overflow-session');
select is(
  pg_temp.submit_note_order(
    'single-overflow-session',
    '75000000-0000-4000-8000-000000000003',
    '75100000-0000-4000-8000-000000000003',
    jsonb_build_array(jsonb_build_object(
      'product_id', '44444444-4444-4444-8444-444444444443',
      'quantity', 1,
      'note', '',
      'modifier_option_ids', jsonb_build_array(
        'dddddddd-dddd-4ddd-8ddd-ddddddddddd2',
        'dddddddd-dddd-4ddd-8ddd-ddddddddddd3'
      )
    )),
    'single-overflow-tracking'
  )->>'code',
  'INVALID_PRODUCT_NOTES',
  '單選群組不可同時選擇兩個選項'
);

select pg_temp.add_note_session('multiple-overflow-session');
select is(
  pg_temp.submit_note_order(
    'multiple-overflow-session',
    '75000000-0000-4000-8000-000000000004',
    '75100000-0000-4000-8000-000000000004',
    jsonb_build_array(jsonb_build_object(
      'product_id', '44444444-4444-4444-8444-444444444443',
      'quantity', 1,
      'note', '',
      'modifier_option_ids', jsonb_build_array(
        'dddddddd-dddd-4ddd-8ddd-ddddddddddd1',
        'dddddddd-dddd-4ddd-8ddd-ddddddddddd5',
        'dddddddd-dddd-4ddd-8ddd-ddddddddddd6',
        'dddddddd-dddd-4ddd-8ddd-ddddddddddd7'
      )
    )),
    'multiple-overflow-tracking'
  )->>'code',
  'INVALID_PRODUCT_NOTES',
  '複選群組超過最大選擇數時拒絕成立訂單'
);

select pg_temp.add_note_session('valid-note-session');
create temporary table valid_note_order_result as
select pg_temp.submit_note_order(
  'valid-note-session',
  '75000000-0000-4000-8000-000000000005',
  '75100000-0000-4000-8000-000000000005',
  jsonb_build_array(jsonb_build_object(
    'product_id', '44444444-4444-4444-8444-444444444443',
    'quantity', 2,
    'note', '胡椒少一點',
    'modifier_option_ids', jsonb_build_array(
      'dddddddd-dddd-4ddd-8ddd-ddddddddddd3',
      'dddddddd-dddd-4ddd-8ddd-ddddddddddd5'
    )
  )),
  'valid-note-tracking'
) as result;

select is(
  (select result #>> '{order,order_status}' from valid_note_order_result),
  'WAITING_CONFIRMATION',
  '合法註記訂單從 WAITING_CONFIRMATION 開始'
);
select is(
  (
    select base_unit_price::text
    from public.order_items
    where order_id = '75000000-0000-4000-8000-000000000005'
  ),
  '75',
  '訂單品項保留商品原始單價快照'
);
select is(
  (
    select unit_price::text
    from public.order_items
    where order_id = '75000000-0000-4000-8000-000000000005'
  ),
  '90',
  '受信任後端以資料庫選項價格重新計算品項單價'
);
select is(
  (select total::text from public.orders where id = '75000000-0000-4000-8000-000000000005'),
  '180',
  '訂單總額包含每份加料價格'
);
select is(
  (
    select count(*)::text
    from public.order_item_note_options note
    join public.order_items item on item.id = note.order_item_id
    where item.order_id = '75000000-0000-4000-8000-000000000005'
  ),
  '2',
  '訂單建立後儲存兩筆註記快照'
);
select is(
  (
    select string_agg(note.group_name || '：' || note.option_name || '：' || note.price_delta::text, ',' order by note.sort_order)
    from public.order_item_note_options note
    join public.order_items item on item.id = note.order_item_id
    where item.order_id = '75000000-0000-4000-8000-000000000005'
  ),
  '辣度：中辣：0,加料：加蛋：15',
  '註記群組名稱、選項名稱與價差均保存為歷史快照'
);
select is(
  jsonb_array_length(
    public.get_public_order(
      encode(extensions.digest('valid-note-tracking', 'sha256'), 'hex'),
      encode(extensions.digest('product-note-device', 'sha256'), 'hex')
    ) #> '{items,0,noteOptions}'
  )::text,
  '2',
  '顧客訂單追蹤回傳註記快照'
);

select is(
  pg_temp.submit_note_order(
    'valid-note-session',
    '75000000-0000-4000-8000-000000000006',
    '75100000-0000-4000-8000-000000000005',
    jsonb_build_array(jsonb_build_object(
      'product_id', '44444444-4444-4444-8444-444444444443',
      'quantity', 2,
      'note', '胡椒少一點',
      'modifier_option_ids', jsonb_build_array(
        'dddddddd-dddd-4ddd-8ddd-ddddddddddd3',
        'dddddddd-dddd-4ddd-8ddd-ddddddddddd5'
      )
    )),
    'replayed-note-tracking'
  )->>'idempotent_replay',
  'true',
  '相同冪等鍵只回傳原訂單'
);
select is(
  (
    select count(*)::text
    from public.order_item_note_options note
    join public.order_items item on item.id = note.order_item_id
    where item.order_id = '75000000-0000-4000-8000-000000000005'
  ),
  '2',
  '冪等重播不會重複建立註記快照'
);

select lives_ok(
  $$delete from public.product_note_options
    where id in (
      'dddddddd-dddd-4ddd-8ddd-ddddddddddd3',
      'dddddddd-dddd-4ddd-8ddd-ddddddddddd5'
    )$$,
  '刪除商品註記選項不會破壞歷史訂單'
);
select is(
  (
    select count(*)::text || ':' || count(note.note_option_id)::text || ':' ||
      string_agg(note.group_name || '：' || note.option_name, ',' order by note.sort_order)
    from public.order_item_note_options note
    join public.order_items item on item.id = note.order_item_id
    where item.order_id = '75000000-0000-4000-8000-000000000005'
  ),
  '2:0:辣度：中辣,加料：加蛋',
  '選項刪除後訂單快照仍保留原始顯示內容'
);

select * from finish();
rollback;
