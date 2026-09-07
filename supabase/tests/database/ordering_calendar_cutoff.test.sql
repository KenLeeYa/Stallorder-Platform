begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(13);
update public.stall_business_hours set opens_at='17:00', closes_at='19:00', is_closed=false
where stall_id='22222222-2222-4222-8222-222222222222';
update public.stall_ordering_settings set preorder_max_days=7, preorder_min_lead_minutes=5, preorder_slot_minutes=5
where stall_id='22222222-2222-4222-8222-222222222222';
delete from public.stall_special_closures where stall_id='22222222-2222-4222-8222-222222222222';
select ok(exists(select 1 from jsonb_array_elements_text(public.get_fulfillment_time_slots_raw('22222222-2222-4222-8222-222222222222','2026-09-01T08:00:00+08:00')) s where s.value::timestamptz='2026-09-08T18:55:00+08:00'), '第 N 天晚間仍可預約');
select ok(not exists(select 1 from jsonb_array_elements_text(public.get_fulfillment_time_slots_raw('22222222-2222-4222-8222-222222222222','2026-09-01T08:00:00+08:00')) s where (s.value::timestamptz at time zone 'Asia/Taipei')::date>'2026-09-08'), '第 N+1 天不得預約');
insert into public.stall_special_closures (organization_id,stall_id,starts_on,ends_on,title,message,opens_at,closes_at,updated_at)
values ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','2026-09-04','2026-09-04','特殊營業','','12:00','15:00',now()),
('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','2026-09-05','2026-09-05','公休','',null,null,now());
select ok(exists(select 1 from jsonb_array_elements_text(public.get_fulfillment_time_slots_raw('22222222-2222-4222-8222-222222222222','2026-09-01T08:00:00+08:00')) s where s.value::timestamptz='2026-09-04T12:00:00+08:00'), '特殊營業新增原本不存在的時段');
select ok(not exists(select 1 from jsonb_array_elements_text(public.get_fulfillment_time_slots_raw('22222222-2222-4222-8222-222222222222','2026-09-01T08:00:00+08:00')) s where s.value::timestamptz='2026-09-04T17:00:00+08:00'), '特殊營業取代一般時段');
select ok(not exists(select 1 from jsonb_array_elements_text(public.get_fulfillment_time_slots_raw('22222222-2222-4222-8222-222222222222','2026-09-01T08:00:00+08:00')) s where (s.value::timestamptz at time zone 'Asia/Taipei')::date='2026-09-05'), '公休日不產生預約時段');
update public.stall_business_hours set last_order_at='18:40' where stall_id='22222222-2222-4222-8222-222222222222';
select is(public.qr_last_order_reached('22222222-2222-4222-8222-222222222222','2026-09-01T18:39:59+08:00'),false,'截單前可點餐');
select is(public.qr_last_order_reached('22222222-2222-4222-8222-222222222222','2026-09-01T18:40:00+08:00'),true,'截單邊界停止 QR');
select is(public.qr_last_order_reached('22222222-2222-4222-8222-222222222222','2026-09-01T19:05:00+08:00'),true,'打烊後不會再次開放截單');
select is(public.qr_last_order_reached('22222222-2222-4222-8222-222222222222','2026-09-02T17:00:00+08:00'),false,'下一營業時段解除昨日截單');
select is(public.qr_last_order_reached('22222222-2222-4222-8222-222222222222','2026-09-04T14:50:00+08:00'),false,'特殊營業不繼承一般截單');
update public.stall_business_hours set opens_at='22:00', closes_at='02:00',last_order_at='01:40' where stall_id='22222222-2222-4222-8222-222222222222';
select is(public.qr_last_order_reached('22222222-2222-4222-8222-222222222222','2026-09-02T01:40:00+08:00'),true,'跨午夜截單');
select ok(not has_function_privilege('anon','public.qr_last_order_reached(uuid,timestamptz)','execute'),'匿名不能直查內部截單設定');
update public.stall_business_hours set opens_at='00:00', closes_at='00:00',last_order_at=null where stall_id='22222222-2222-4222-8222-222222222222';
update public.stall_ordering_settings set preorder_max_days=30 where stall_id='22222222-2222-4222-8222-222222222222';
delete from public.stall_special_closures where stall_id='22222222-2222-4222-8222-222222222222';
select ok(exists(select 1 from jsonb_array_elements_text(public.get_fulfillment_time_slots_raw('22222222-2222-4222-8222-222222222222','2026-09-01T00:00:00+08:00')) s where s.value::timestamptz='2026-10-01T23:55:00+08:00'), '30 天最大範圍不截掉最後晚間時段');
select * from finish();
rollback;
