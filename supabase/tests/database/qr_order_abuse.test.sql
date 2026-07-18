begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(31);

delete from public.public_order_attempts;
delete from public.public_rate_limit_buckets;
delete from public.rate_limit_buckets;
delete from public.order_sessions;
delete from public.orders;
delete from public.stall_order_counters;

create function pg_temp.add_session(
  p_token_hash text,
  p_device_hash text default 'device-a',
  p_status public.order_session_status default 'ACTIVE',
  p_expires_at timestamptz default now() + interval '10 minutes'
)
returns void
language sql
as $$
  insert into public.order_sessions (
    id, tenant_id, stall_id, qr_code_id, token_hash, device_hash,
    ip_hash, status, expires_at, created_at
  ) values (
    gen_random_uuid(),
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333333',
    encode(extensions.digest(p_token_hash, 'sha256'), 'hex'),
    encode(extensions.digest(p_device_hash, 'sha256'), 'hex'),
    encode(extensions.digest('ip-' || p_token_hash, 'sha256'), 'hex'),
    p_status, p_expires_at, now()
  );
$$;

create function pg_temp.submit_order(
  p_session_hash text,
  p_order_id uuid,
  p_idempotency_key uuid,
  p_tracking_hash text,
  p_quantity integer default 1,
  p_device_hash text default 'device-a'
)
returns jsonb
language sql
as $$
  select public.create_public_order(
    p_order_id,
    'demo-aming-chicken-qr-2026-rotate-me',
    encode(extensions.digest(p_session_hash, 'sha256'), 'hex'),
    encode(extensions.digest(p_device_hash, 'sha256'), 'hex'),
    encode(extensions.digest('ip-' || p_session_hash, 'sha256'), 'hex'),
    'qr-hash',
    'behavior-' || p_session_hash,
    p_idempotency_key,
    'idem-' || p_idempotency_key::text,
    '測試顧客',
    '',
    jsonb_build_array(jsonb_build_object(
      'product_id', '44444444-4444-4444-8444-444444444441',
      'quantity', p_quantity,
      'note', ''
    )),
    encode(extensions.digest(p_tracking_hash, 'sha256'), 'hex'),
    encode(extensions.digest('pickup-' || p_order_id::text, 'sha256'), 'hex'),
    'test-' || p_order_id::text
  );
$$;

update public.qr_codes set state = 'REVOKED', expires_at = null where id = '33333333-3333-4333-8333-333333333333';
select is(
  public.issue_order_session('demo-aming-chicken-qr-2026-rotate-me', 'revoked-session', 'ip-a', 'device-a', 'qr-a', 'behavior-a', 'req-a')->>'code',
  'QR_REVOKED',
  '撤銷 QR 不得建立 session'
);

update public.qr_codes set state = 'EXPIRED' where id = '33333333-3333-4333-8333-333333333333';
select is(
  public.issue_order_session('demo-aming-chicken-qr-2026-rotate-me', 'expired-qr-session', 'ip-b', 'device-b', 'qr-b', 'behavior-b', 'req-b')->>'code',
  'QR_EXPIRED',
  '過期 QR 不得建立 session'
);

update public.qr_codes set state = 'PAUSED' where id = '33333333-3333-4333-8333-333333333333';
select is(
  public.issue_order_session('demo-aming-chicken-qr-2026-rotate-me', 'paused-qr-session', 'ip-c', 'device-c', 'qr-c', 'behavior-c', 'req-c')->>'code',
  'QR_PAUSED',
  '暫停 QR 不得建立 session'
);

update public.qr_codes set state = 'ACTIVE' where id = '33333333-3333-4333-8333-333333333333';
update public.stalls set ordering_state = 'CLOSED' where id = '22222222-2222-4222-8222-222222222222';
select is(
  public.issue_order_session('demo-aming-chicken-qr-2026-rotate-me', 'closed-session', 'ip-d', 'device-d', 'qr-d', 'behavior-d', 'req-d')->>'code',
  'STALL_CLOSED',
  '關閉攤位不得建立 session'
);

update public.stalls set ordering_state = 'PAUSED' where id = '22222222-2222-4222-8222-222222222222';
select is(
  public.issue_order_session('demo-aming-chicken-qr-2026-rotate-me', 'paused-stall-session', 'ip-e', 'device-e', 'qr-e', 'behavior-e', 'req-e')->>'code',
  'ORDERING_PAUSED',
  '暫停點餐不得建立 session'
);
update public.stalls set ordering_state = 'OPEN' where id = '22222222-2222-4222-8222-222222222222';

select pg_temp.add_session('expired-session', 'device-a', 'ACTIVE', now() - interval '1 second');
select is(
  pg_temp.submit_order('expired-session', '70000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', 'tracking-expired')->>'code',
  'SESSION_EXPIRED',
  '逾時 session 不得建單'
);

select pg_temp.add_session('excess-session');
select is(
  pg_temp.submit_order('excess-session', '70000000-0000-4000-8000-000000000002', '71000000-0000-4000-8000-000000000002', 'tracking-excess', 21)->>'code',
  'EXCESSIVE_ITEM_QUANTITY',
  '超過單品數量上限時拒絕建單'
);

select pg_temp.add_session('success-session');
select is(
  pg_temp.submit_order('success-session', '70000000-0000-4000-8000-000000000003', '71000000-0000-4000-8000-000000000003', 'tracking-success')->'order'->>'order_status',
  'WAITING_CONFIRMATION',
  '公開訂單從 WAITING_CONFIRMATION 開始'
);
select is(
  (select status::text from public.order_sessions where token_hash = encode(extensions.digest('success-session', 'sha256'), 'hex')),
  'CONSUMED',
  '成功建單後 session 只能消耗一次'
);
select is(
  pg_temp.submit_order('success-session', '70000000-0000-4000-8000-000000000004', '71000000-0000-4000-8000-000000000003', 'tracking-duplicate')->>'idempotent_replay',
  'true',
  '相同冪等鍵回傳既有訂單'
);
select is(
  (select count(*)::text from public.orders where idempotency_key = '71000000-0000-4000-8000-000000000003'),
  '1',
  '重複冪等鍵不建立第二張訂單'
);
select is(
  pg_temp.submit_order('success-session', '70000000-0000-4000-8000-000000000005', '71000000-0000-4000-8000-000000000005', 'tracking-replay')->>'code',
  'SESSION_REPLAYED',
  '不同冪等鍵不得重播已消耗 session'
);

select ok(
  public.get_public_order(
    encode(extensions.digest('tracking-success', 'sha256'), 'hex'),
    encode(extensions.digest('device-a', 'sha256'), 'hex')
  ) is not null,
  '原裝置可查詢自己的公開訂單'
);
select ok(
  public.get_public_order(
    encode(extensions.digest('tracking-success', 'sha256'), 'hex'),
    encode(extensions.digest('device-b', 'sha256'), 'hex')
  ) is null,
  '其他裝置不得跨訂單查詢'
);
select is(
  public.lookup_resumable_public_order(
    'demo-aming-chicken-qr-2026-rotate-me',
    encode(extensions.digest('device-a', 'sha256'), 'hex'),
    'resume-ip', 'resume-qr', 'resume-behavior', 'resume-request'
  )->>'order_id',
  '70000000-0000-4000-8000-000000000003',
  '同一裝置重掃原 QR 可找回進行中的訂單'
);
select ok(
  public.lookup_resumable_public_order(
    'demo-aming-chicken-qr-2026-rotate-me',
    encode(extensions.digest('device-b', 'sha256'), 'hex'),
    'resume-ip-b', 'resume-qr-b', 'resume-behavior-b', 'resume-request-b'
  ) is null,
  '不同裝置重掃同一 QR 不得取得其他顧客訂單'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.lookup_resumable_public_order(text,text,text,text,text,text)',
    'EXECUTE'
  ),
  'anon 無法直接執行訂單找回 RPC'
);

select pg_temp.add_session('gate-session');
do $$
begin
  for counter in 1..8 loop
    perform public.check_public_order_submission_gate(
      encode(extensions.digest('gate-session', 'sha256'), 'hex'),
      'gate-ip', 'gate-device', 'gate-qr', 'gate-behavior', 'gate-' || counter
    );
  end loop;
end;
$$;
select is(
  (select count(distinct dimension_type)::text from public.public_rate_limit_buckets where dimension_type like 'ATTEMPT_%'),
  '6',
  '前置 gate 同時計算六種 rate limit 維度'
);
select is(
  public.check_public_order_submission_gate(
    encode(extensions.digest('gate-session', 'sha256'), 'hex'),
    'gate-ip', 'gate-device', 'gate-qr', 'gate-behavior', 'gate-9'
  )->>'code',
  'RATE_LIMITED',
  '超過時間窗限制時拒絕送單'
);

do $$
begin
  for counter in 1..15 loop
    perform public.check_global_public_request_gate(
      'SESSION', 'unknown-ip', 'unknown-device', 'unknown-behavior', 'global-' || counter
    );
  end loop;
end;
$$;
select is(
  (select count(*)::text from public.rate_limit_buckets),
  '3',
  '未知 QR 前仍計算 IP、裝置與行為全域 gate'
);
select is(
  public.check_global_public_request_gate(
    'SESSION', 'unknown-ip', 'unknown-device', 'unknown-behavior', 'global-16'
  )->>'code',
  'RATE_LIMITED',
  '全域 gate 防止未知 token 無界請求'
);

select ok(
  not has_table_privilege('anon', 'public.orders', 'INSERT'),
  'anon 沒有直接寫入 orders 的權限'
);
select ok(
  not exists (
    select 1
    from information_schema.role_table_grants
    where table_schema = 'public'
      and grantee = 'authenticated'
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
      and not (table_name = 'manual_payment_records' and privilege_type = 'INSERT')
  ),
  'authenticated 除自身待驗證付款送審外，必須經受信任後端執行寫入'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.create_public_order(uuid,text,text,text,text,text,text,uuid,text,text,text,jsonb,text,text,text)',
    'EXECUTE'
  ),
  'anon 無法直接執行受信任建單 RPC'
);
select ok(
  (
    select count(*) = 42 and bool_and(c.relrowsecurity)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = any (array[
        'organizations', 'stalls', 'profiles', 'organization_memberships',
        'stall_memberships', 'auth_sessions',
        'audit_logs', 'rate_limit_buckets', 'product_categories', 'product_groups',
        'products', 'stall_products', 'payments', 'daily_stall_summaries',
        'operational_events', 'operational_alerts', 'qr_codes',
        'stall_ordering_settings', 'order_sessions', 'orders', 'order_items',
        'order_events', 'public_order_attempts', 'public_rate_limit_buckets',
        'stall_order_counters', 'plans', 'subscriptions', 'additional_stall_approvals',
        'invoices', 'invoice_line_items', 'usage_events', 'organization_invitations',
        'product_translations', 'dining_tables', 'payment_options', 'discount_options',
        'product_note_groups', 'product_note_options',
        'product_note_group_translations', 'product_note_option_translations',
        'product_note_group_assignments', 'order_item_note_options'
      ])
  ),
  '所有暴露業務資料表均啟用 RLS'
);
select ok(
  (select count(*) from public.public_order_attempts) >= 10,
  '公開點餐允許與拒絕事件寫入 security log'
);

update public.orders
set confirmation_expires_at = now() - interval '1 second'
where tracking_token_hash = encode(extensions.digest('tracking-success', 'sha256'), 'hex');
select is(
  public.expire_unconfirmed_orders()::text,
  '1',
  '逾時工作會自動處理未確認訂單'
);
select is(
  (select status::text from public.orders where tracking_token_hash = encode(extensions.digest('tracking-success', 'sha256'), 'hex')),
  'EXPIRED',
  '未確認訂單逾時後狀態為 EXPIRED'
);
select ok(
  public.lookup_resumable_public_order(
    'demo-aming-chicken-qr-2026-rotate-me',
    encode(extensions.digest('device-a', 'sha256'), 'hex'),
    'resume-ip-expired', 'resume-qr-expired', 'resume-behavior-expired', 'resume-request-expired'
  ) is null,
  '已逾時訂單不可再由 QR 找回'
);

select lives_ok(
  $$delete from public.products where id = '44444444-4444-4444-8444-444444444441'$$,
  '刪除商品不會破壞歷史訂單品項'
);
select is(
  (
    select product_id::text
    from public.order_items
    where order_id = '70000000-0000-4000-8000-000000000003'
    limit 1
  ),
  null::text,
  '商品刪除後歷史品項改為空外鍵並保留快照'
);

select * from finish();
rollback;
