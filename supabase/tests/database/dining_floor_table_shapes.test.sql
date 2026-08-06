begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(17);

insert into public.organizations (
  id, name, slug, business_name, status, email, phone, updated_at
) values (
  '91111111-1111-4111-8111-111111111111',
  '樓層隔離測試組織',
  'floor-isolation-organization',
  '樓層隔離測試組織',
  'ACTIVE',
  'floor-isolation@stallorder.test',
  '0900-888-888',
  now()
);
alter table public.stalls disable trigger stalls_billing_limit_before_write;
insert into public.stalls (
  id, organization_id, name, slug, code, address, currency, timezone,
  is_active, business_status, ordering_enabled, updated_at
) values (
  '92222222-2222-4222-8222-222222222222',
  '91111111-1111-4111-8111-111111111111',
  '樓層隔離測試攤位',
  'floor-isolation-stall',
  'FLOOR-RLS',
  '台北市測試路 99 號',
  'TWD',
  'Asia/Taipei',
  true,
  'OPEN',
  true,
  now()
);
alter table public.stalls enable trigger stalls_billing_limit_before_write;
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.dining_floors'::regclass),
  '樓層資料啟用並強制 RLS'
);
select ok(has_table_privilege('authenticated', 'public.dining_floors', 'SELECT'), '已登入店員可依 RLS 讀取樓層');
select ok(not has_table_privilege('authenticated', 'public.dining_floors', 'INSERT'), '前端不可直接新增樓層');
select ok(not has_table_privilege('anon', 'public.dining_floors', 'SELECT'), '匿名角色不可讀取樓層');

insert into public.dining_tables (
  id, organization_id, stall_id, code, label, is_active, sort_order,
  layout_x, layout_y, created_at, updated_at
) values (
  '83000000-0000-4000-8000-000000008301',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  'FLOOR-QA-8301',
  'pgTAP 樓層桌位 8301',
  true,
  8301,
  60,
  80,
  now(),
  now()
);

select is(
  (select floor_id from public.dining_tables where id = '83000000-0000-4000-8000-000000008301'),
  null::uuid,
  'floor_id 採 nullable 策略，未分配樓層的獨立桌位 fixture 保持 null'
);
select is(
  (select shape::text from public.dining_tables where id = '83000000-0000-4000-8000-000000008301'),
  'SQUARE',
  '獨立桌位 fixture 使用預設方桌'
);
select is(
  (select rotation_degrees::integer from public.dining_tables where id = '83000000-0000-4000-8000-000000008301'),
  0,
  '獨立桌位 fixture 使用零度旋轉'
);
select is(
  (
    select string_agg(enum_value.enumlabel, ',' order by enum_value.enumsortorder)
    from pg_enum enum_value
    join pg_type enum_type on enum_type.oid = enum_value.enumtypid
    where enum_type.typname = 'dining_table_shape'
  ),
  'CIRCLE,ELLIPSE,SQUARE,RECTANGLE,DIAMOND,TRIANGLE',
  '資料庫完整提供六種指定桌型'
);

insert into public.dining_floors (id, organization_id, stall_id, name, sort_order)
values (
  '81000000-0000-4000-8000-000000008101',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  'pgTAP 樓層 8101',
  8101
);

select lives_ok(
  $$update public.dining_tables
    set floor_id = '81000000-0000-4000-8000-000000008101', shape = 'CIRCLE', rotation_degrees = 45
    where id = '83000000-0000-4000-8000-000000008301'$$,
  '同攤位樓層可指派桌位並保存桌型旋轉'
);
select is((select floor_id from public.dining_tables where id = '83000000-0000-4000-8000-000000008301'), '81000000-0000-4000-8000-000000008101'::uuid, '桌位保存樓層');
select is((select shape::text from public.dining_tables where id = '83000000-0000-4000-8000-000000008301'), 'CIRCLE', '桌位保存桌型');
select is((select rotation_degrees::integer from public.dining_tables where id = '83000000-0000-4000-8000-000000008301'), 45, '桌位保存 15 度倍數旋轉');
select throws_ok(
  $$update public.dining_tables set rotation_degrees = 14 where id = '83000000-0000-4000-8000-000000008301'$$,
  '23514', null,
  '資料庫拒絕非 15 度倍數旋轉'
);
select throws_ok(
  $$insert into public.dining_floors (organization_id, stall_id, name, sort_order)
    values (
      '11111111-1111-4111-8111-111111111111',
      '92222222-2222-4222-8222-222222222222',
      'pgTAP 錯誤範圍 8103',
      8103
    )$$,
  'P0001', 'DINING_FLOOR_STALL_SCOPE_MISMATCH',
  '樓層不可偽造 organization_id 跨租戶寫入'
);

insert into public.dining_floors (id, organization_id, stall_id, name, sort_order)
values (
  '81000000-0000-4000-8000-000000008102',
  '91111111-1111-4111-8111-111111111111',
  '92222222-2222-4222-8222-222222222222',
  'pgTAP 隔離樓層 8102',
  8102
);
select throws_ok(
  $$update public.dining_tables
    set floor_id = '81000000-0000-4000-8000-000000008102'
    where id = '83000000-0000-4000-8000-000000008301'$$,
  'P0001', 'DINING_TABLE_FLOOR_SCOPE_MISMATCH',
  '桌位不可指派其他租戶或攤位樓層'
);

insert into auth.users (id, email) values
  ('a1111111-1111-4111-8111-111111111111', 'floor-owner-rls@stallorder.test');
update public.profiles
set auth_user_id = 'a1111111-1111-4111-8111-111111111111'
where id = '55555555-5555-4555-8555-555555555551';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1111111-1111-4111-8111-111111111111', true);
select is(
  (select count(*)::integer from public.dining_floors where id = '81000000-0000-4000-8000-000000008101'),
  1,
  '組織擁有者可讀取授權攄位的獨立樓層 fixture'
);
select is(
  (select count(*)::integer from public.dining_floors where id = '81000000-0000-4000-8000-000000008102'),
  0,
  '組織擁有者不可讀取其他組織的獨立樓層 fixture'
);

select * from finish();
rollback;
