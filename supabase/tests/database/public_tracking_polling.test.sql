begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(17);

select ok(not has_function_privilege('anon', 'public.check_public_order_tracking_gate(text,text,text,text,text)', 'EXECUTE'), 'anonymous callers cannot call the trusted gate');
select ok(not has_function_privilege('authenticated', 'public.check_public_order_tracking_gate(text,text,text,text,text)', 'EXECUTE'), 'ordinary logins cannot call the trusted gate');
select ok(has_function_privilege('service_role', 'public.check_public_order_tracking_gate(text,text,text,text,text)', 'EXECUTE'), 'trusted runtimes can use the gate');

insert into public.orders(id, organization_id, stall_id, order_no, tracking_token_hash, idempotency_key, source, customer_name, fulfillment_type, status, payment_status, subtotal, total, device_hash, confirmation_expires_at, is_test, created_at, updated_at)
values
('ad190000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','TRACK-IDLE-1',repeat('1',64),'ad190000-0000-4000-8000-000000000001','QR_MENU','Tracking QA','TAKEOUT','WAITING_CONFIRMATION','UNPAID',0,0,repeat('2',64),now()+interval '1 hour',true,now(),now()),
('ad190000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','TRACK-IDLE-2',repeat('3',64),'ad190000-0000-4000-8000-000000000002','QR_MENU','Tracking QA','TAKEOUT','WAITING_CONFIRMATION','UNPAID',0,0,repeat('4',64),now()+interval '1 hour',true,now(),now());

create function pg_temp.track(token text, device text) returns jsonb language sql as $$
  select public.check_public_order_tracking_gate(token, repeat('5',64), device, token, 'tracking-idle-qa')
$$;

select is(pg_temp.track(repeat('1',64),repeat('2',64))->>'ok','true','valid binding starts its own polling budget');
select ok((select bool_and((pg_temp.track(repeat('1',64),repeat('2',64))->>'ok')::boolean) from generate_series(2,60)), '60 reads shared by tabs and circuits fit within one minute');
create temporary table blocked_tracking as select pg_temp.track(repeat('1',64),repeat('2',64)) as result;
select is((select result->>'code' from blocked_tracking),'RATE_LIMITED','the next read is still bounded');
select ok((select (result->>'retryAfterSeconds')::integer between 1 and 60 from blocked_tracking),'retry delay describes the active window');
select ok((select bool_and((pg_temp.track(repeat('3',64),repeat('4',64))->>'ok')::boolean) from generate_series(1,20)), 'other verified orders on the same Wi-Fi have independent polling budgets');
select is(public.check_global_public_request_gate('TRACKING',repeat('5',64),repeat('2',64),'mutation-behavior','mutation-after-idle')->>'ok','true','automatic reads do not exhaust edit and cancel quotas');

select is(public.get_public_order(repeat('1',64),repeat('4',64)),null::jsonb,'another order device cannot read this order');
select ok((select bool_and((pg_temp.track(repeat('1',64),repeat('6',64))->>'ok')::boolean) from generate_series(1,60)), 'unknown bindings use the existing 60-attempt behavior budget');
select is(pg_temp.track(repeat('1',64),repeat('6',64))->>'code','RATE_LIMITED','unknown bindings retain the old five-minute abuse limit');
select is(pg_temp.track(repeat('3',64),repeat('4',64))->>'ok','true','invalid attempts cannot starve another verified customer on the same IP');

update public.rate_limit_buckets set expires_at = clock_timestamp() - interval '1 second'
where key=encode(extensions.digest('PUBLIC|TRACKING_AUTHENTICATED|'||repeat('1',64)||'|'||repeat('2',64),'sha256'),'hex');
select is(pg_temp.track(repeat('1',64),repeat('2',64))->>'ok','true','polling recovers when its window expires');
select is((select count from public.rate_limit_buckets where key=encode(extensions.digest('PUBLIC|TRACKING_AUTHENTICATED|'||repeat('1',64)||'|'||repeat('2',64),'sha256'),'hex')),1,'expired polling bucket resets instead of accumulating forever');
select is(pg_temp.track(repeat('1',64),repeat('6',64))->>'code','RATE_LIMITED','resetting a valid binding does not reset unauthenticated abuse counters');
select is((select status::text from public.orders where id='ad190000-0000-4000-8000-000000000001'),'WAITING_CONFIRMATION','rate checks do not change order or proposal state');

select * from finish();
rollback;
