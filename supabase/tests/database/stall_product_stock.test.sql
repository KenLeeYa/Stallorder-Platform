begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(16);
update public.stall_products set stock_remaining=5
where stall_id='22222222-2222-4222-8222-222222222222' and product_id='44444444-4444-4444-8444-444444444441';
create function pg_temp.stock_order(v_id uuid, v_qty integer, v_source text default 'STAFF_POS') returns void language plpgsql as $$
begin
  insert into public.orders(id,organization_id,stall_id,order_no,tracking_token_hash,idempotency_key,source,customer_name,fulfillment_type,status,payment_status,subtotal,total,device_hash,confirmation_expires_at,created_at,updated_at)
  values(v_id,'11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',v_id::text,encode(extensions.digest(v_id::text,'sha256'),'hex'),v_id,v_source,'Stock QA','TAKEOUT','WAITING_CONFIRMATION','UNPAID',v_qty*100,v_qty*100,'stock-qa',now()+interval '1 hour',clock_timestamp(),now());
  insert into public.order_items(id,organization_id,stall_id,order_id,product_id,name,base_unit_price,unit_price,quantity)
  values(gen_random_uuid(),'11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',v_id,'44444444-4444-4444-8444-444444444441','Stock QA',100,100,v_qty);
  set constraints all immediate;
  set constraints all deferred;
end $$;
create function pg_temp.remaining_stock() returns integer language sql as $$
  select stock_remaining from public.stall_products where stall_id='22222222-2222-4222-8222-222222222222' and product_id='44444444-4444-4444-8444-444444444441'
$$;
select pg_temp.stock_order('ae100000-0000-4000-8000-000000000001',2);
select is(pg_temp.remaining_stock(),3,'成立即占用');
update public.order_items set quantity=2 where order_id='ae100000-0000-4000-8000-000000000001';
set constraints all immediate;
set constraints all deferred;
select is(pg_temp.remaining_stock(),3,'重複 reconciliation 不重扣');
update public.order_items set quantity=4 where order_id='ae100000-0000-4000-8000-000000000001';
set constraints all immediate;
set constraints all deferred;
select is(pg_temp.remaining_stock(),1,'加量只扣差額');
update public.order_items set quantity=1 where order_id='ae100000-0000-4000-8000-000000000001';
set constraints all immediate;
set constraints all deferred;
select is(pg_temp.remaining_stock(),4,'未製作減量回補差額');
select throws_ok($$select pg_temp.stock_order('ae100000-0000-4000-8000-000000000002',5)$$,'P0001','PRODUCT_STOCK_INSUFFICIENT','不足時原子拒絕');
select is(pg_temp.remaining_stock(),4,'失敗不扣庫存');
select ok(not exists(select 1 from public.orders where id='ae100000-0000-4000-8000-000000000002'),'失敗不殘留訂單');
select pg_temp.stock_order('ae100000-0000-4000-8000-000000000003',4,'TAKEOUT_PREORDER');
select is(pg_temp.remaining_stock(),0,'預約也占用可售份數');
update public.orders set status='CANCELLED' where id='ae100000-0000-4000-8000-000000000003';
set constraints all immediate;
set constraints all deferred;
select is(pg_temp.remaining_stock(),4,'預約未製作取消回補');
update public.orders set status='CANCELLED' where id='ae100000-0000-4000-8000-000000000003';
set constraints all immediate;
set constraints all deferred;
select is(pg_temp.remaining_stock(),4,'重複取消不重補');
update public.order_items set status='PREPARING' where order_id='ae100000-0000-4000-8000-000000000001';
update public.orders set status='CANCELLED' where id='ae100000-0000-4000-8000-000000000001';
set constraints all immediate;
set constraints all deferred;
select is(pg_temp.remaining_stock(),4,'已製作取消不回補');
select pg_temp.stock_order('ae100000-0000-4000-8000-000000000004',2,'MERCHANT_SETUP_TEST');
select is(pg_temp.remaining_stock(),4,'教學測試訂單不扣正式可售份數');
update public.stall_products set stock_remaining=null where stall_id='22222222-2222-4222-8222-222222222222' and product_id='44444444-4444-4444-8444-444444444441';
select pg_temp.stock_order('ae100000-0000-4000-8000-000000000005',6);
select is(pg_temp.remaining_stock(),null::integer,'不限量不扣庫存');
update public.stall_products set stock_remaining=10 where stall_id='22222222-2222-4222-8222-222222222222' and product_id='44444444-4444-4444-8444-444444444441';
update public.orders set status='CANCELLED' where id='ae100000-0000-4000-8000-000000000005';
set constraints all immediate;
select is(pg_temp.remaining_stock(),10,'啟用前既有訂單取消不憑空增加庫存');
set constraints all deferred;
select pg_temp.stock_order('ae100000-0000-4000-8000-000000000006',1);
update public.orders set status='CONFIRMED' where id='ae100000-0000-4000-8000-000000000006';
update public.order_production_tasks set status='PREPARING', started_at=now() where order_id='ae100000-0000-4000-8000-000000000006';
select is((select stock_consumed from public.orders where id='ae100000-0000-4000-8000-000000000006'),true,'KDS 已製作會標記不可回補');
update public.orders set status='CANCELLED' where id='ae100000-0000-4000-8000-000000000006';
set constraints all immediate;
select is(pg_temp.remaining_stock(),9,'KDS 開始後取消不回補');
select * from finish();
rollback;
