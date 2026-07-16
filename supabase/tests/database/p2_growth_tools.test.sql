begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(14);

select ok(
  to_regclass('public.report_schedules') is not null
  and to_regclass('public.report_deliveries') is not null,
  'P2 報表排程與寄送紀錄資料表已建立'
);

select ok(
  (select bool_and(relrowsecurity and relforcerowsecurity)
   from pg_class
   where oid in ('public.report_schedules'::regclass, 'public.report_deliveries'::regclass)),
  'P2 報表資料表均啟用並強制套用 RLS'
);

select ok(
  not has_table_privilege('anon', 'public.report_schedules', 'SELECT')
  and not has_table_privilege('anon', 'public.report_schedules', 'INSERT')
  and not has_table_privilege('anon', 'public.report_deliveries', 'SELECT')
  and not has_table_privilege('anon', 'public.report_deliveries', 'INSERT'),
  '匿名角色無法讀寫報表排程與寄送紀錄'
);

select ok(
  not has_table_privilege('authenticated', 'public.report_schedules', 'INSERT')
  and not has_table_privilege('authenticated', 'public.report_deliveries', 'UPDATE'),
  '已登入角色仍不可繞過應用 API 直接寫入報表資料'
);

insert into auth.users (id, email) values
  ('a7620000-0000-4000-8000-000000000001', 'p2-owner@stallorder.test'),
  ('a7620000-0000-4000-8000-000000000002', 'p2-staff@stallorder.test');
insert into public.profiles (
  id, auth_user_id, email, display_name, is_active, updated_at
) values
  ('76200000-0000-4000-8000-000000000001', 'a7620000-0000-4000-8000-000000000001', 'p2-owner@stallorder.test', 'P2 擁有者', true, now()),
  ('76200000-0000-4000-8000-000000000002', 'a7620000-0000-4000-8000-000000000002', 'p2-staff@stallorder.test', 'P2 店員', true, now());
insert into public.organization_memberships (
  organization_id, profile_id, role, all_stalls, is_active
) values (
  '11111111-1111-4111-8111-111111111111',
  '76200000-0000-4000-8000-000000000001',
  'ORGANIZATION_OWNER', true, true
);
insert into public.stall_memberships (
  id, organization_id, profile_id, stall_id, role, is_active
) values (
  '76200000-0000-4000-8000-000000000003',
  '11111111-1111-4111-8111-111111111111',
  '76200000-0000-4000-8000-000000000002',
  '22222222-2222-4222-8222-222222222222',
  'STAFF', true
);

insert into public.report_schedules (
  id, organization_id, name, report_type, recipients, stall_ids,
  timezone, send_hour, send_minute, day_of_week, next_run_at,
  created_by, updated_by
) values (
  '76200000-0000-4000-8000-000000000010',
  '11111111-1111-4111-8111-111111111111',
  'P2 每日測試', 'DAILY_SALES',
  array['p2-owner@stallorder.test'],
  array['22222222-2222-4222-8222-222222222222'::uuid],
  'Asia/Taipei', 8, 0, null, now() + interval '1 day',
  '76200000-0000-4000-8000-000000000001',
  '76200000-0000-4000-8000-000000000001'
);

select is(
  (select cardinality(stall_ids) from public.report_schedules where id = '76200000-0000-4000-8000-000000000010'),
  1,
  '有效排程可保存授權攤位範圍'
);

select throws_ok(
  $$insert into public.report_schedules (
      organization_id, name, report_type, recipients, stall_ids, timezone,
      send_hour, send_minute, next_run_at, created_by, updated_by
    ) values (
      '11111111-1111-4111-8111-111111111111', '錯誤信箱', 'DAILY_SALES',
      array['INVALID EMAIL'], array['22222222-2222-4222-8222-222222222222'::uuid],
      'Asia/Taipei', 8, 0, now(),
      '76200000-0000-4000-8000-000000000001', '76200000-0000-4000-8000-000000000001'
    )$$,
  'P0001', 'REPORT_SCHEDULE_RECIPIENT_INVALID',
  '資料庫拒絕無效收件人'
);

select throws_ok(
  $$insert into public.report_schedules (
      organization_id, name, report_type, recipients, stall_ids, timezone,
      send_hour, send_minute, next_run_at, created_by, updated_by
    ) values (
      '11111111-1111-4111-8111-111111111111', '重複信箱', 'DAILY_SALES',
      array['p2-owner@stallorder.test', 'p2-owner@stallorder.test'],
      array['22222222-2222-4222-8222-222222222222'::uuid],
      'Asia/Taipei', 8, 0, now(),
      '76200000-0000-4000-8000-000000000001', '76200000-0000-4000-8000-000000000001'
    )$$,
  'P0001', 'REPORT_SCHEDULE_RECIPIENT_DUPLICATE',
  '資料庫拒絕重複收件人'
);

select throws_ok(
  $$insert into public.report_schedules (
      organization_id, name, report_type, recipients, stall_ids, timezone,
      send_hour, send_minute, next_run_at, created_by, updated_by
    ) values (
      '11111111-1111-4111-8111-111111111111', '缺少星期', 'WEEKLY_SALES',
      array['p2-owner@stallorder.test'], array['22222222-2222-4222-8222-222222222222'::uuid],
      'Asia/Taipei', 8, 0, now(),
      '76200000-0000-4000-8000-000000000001', '76200000-0000-4000-8000-000000000001'
    )$$,
  '23514', null,
  '週報必須指定寄送星期'
);

select throws_ok(
  $$insert into public.report_schedules (
      organization_id, name, report_type, recipients, stall_ids, timezone,
      send_hour, send_minute, next_run_at, created_by, updated_by
    ) values (
      '11111111-1111-4111-8111-111111111111', '跨組織攤位', 'DAILY_SALES',
      array['p2-owner@stallorder.test'], array['92222222-2222-4222-8222-222222222222'::uuid],
      'Asia/Taipei', 8, 0, now(),
      '76200000-0000-4000-8000-000000000001', '76200000-0000-4000-8000-000000000001'
    )$$,
  'P0001', 'REPORT_SCHEDULE_STALL_SCOPE_MISMATCH',
  '排程不可引用未授權或不存在的攤位'
);

insert into public.report_deliveries (
  id, organization_id, report_schedule_id, report_type, status,
  scheduled_for, period_start, period_end, recipients, subject
) values (
  '76200000-0000-4000-8000-000000000020',
  '11111111-1111-4111-8111-111111111111',
  '76200000-0000-4000-8000-000000000010',
  'DAILY_SALES', 'SENT', '2026-07-16 00:00:00+00',
  '2026-07-15', '2026-07-15', array['p2-owner@stallorder.test'], 'P2 測試報告'
);
select throws_ok(
  $$insert into public.report_deliveries (
      organization_id, report_schedule_id, report_type, status,
      scheduled_for, period_start, period_end, recipients, subject
    ) values (
      '11111111-1111-4111-8111-111111111111',
      '76200000-0000-4000-8000-000000000010', 'PAYMENT_VARIANCE', 'SENT',
      '2026-07-17 00:00:00+00', '2026-07-16', '2026-07-16',
      array['p2-owner@stallorder.test'], '錯誤範圍'
    )$$,
  'P0001', 'REPORT_DELIVERY_SCOPE_MISMATCH',
  '寄送紀錄的組織與報告類型必須符合排程'
);
select throws_ok(
  $$insert into public.report_deliveries (
      organization_id, report_schedule_id, report_type, status,
      scheduled_for, period_start, period_end, recipients, subject
    ) values (
      '11111111-1111-4111-8111-111111111111',
      '76200000-0000-4000-8000-000000000010', 'DAILY_SALES', 'SENT',
      '2026-07-16 00:00:00+00', '2026-07-15', '2026-07-15',
      array['p2-owner@stallorder.test'], '重複寄送'
    )$$,
  '23505', null,
  '同一排程時間只能建立一筆寄送紀錄'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a7620000-0000-4000-8000-000000000001', true);
select is(
  (select count(*)::integer from public.report_schedules),
  1,
  '組織擁有者可讀取自己組織的報表排程'
);
select is(
  (select count(*)::integer from public.report_deliveries),
  1,
  '組織擁有者可讀取自己組織的寄送紀錄'
);

select set_config('request.jwt.claim.sub', 'a7620000-0000-4000-8000-000000000002', true);
select is(
  ((select count(*) from public.report_schedules) + (select count(*) from public.report_deliveries))::integer,
  0,
  '店員不可讀取組織報表排程或收件人資料'
);

select * from finish();
rollback;
