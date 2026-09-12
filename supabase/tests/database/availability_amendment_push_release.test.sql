begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(16);

select ok(public.product_manual_pause_active(true, now() + interval '1 hour'), 'temporary pause remains active before its deadline');
select ok(not public.product_manual_pause_active(true, now() - interval '1 hour'), 'expired pause does not require a reset job');
select ok(not public.product_manual_pause_active(false, now() + interval '1 hour'), 'available product is not paused by a stale deadline');
select ok(not has_function_privilege('anon', 'public.product_next_service_day(uuid)', 'EXECUTE'), 'anonymous clients cannot execute the service-day helper');

select ok(relrowsecurity, 'announcement table enables RLS') from pg_class where oid = 'public.stall_menu_announcements'::regclass;
select ok(relrowsecurity, 'subscription table enables RLS') from pg_class where oid = 'public.staff_push_subscriptions'::regclass;
select ok(relrowsecurity, 'delivery table enables RLS') from pg_class where oid = 'public.staff_push_deliveries'::regclass;
select ok(not has_table_privilege('anon', 'public.stall_menu_announcements', 'SELECT,INSERT,UPDATE,DELETE'), 'announcement table has no direct anonymous access');
select ok(not has_table_privilege('authenticated', 'public.staff_push_subscriptions', 'SELECT,INSERT,UPDATE,DELETE'), 'authenticated clients cannot read or overwrite device credentials');
select ok(not has_table_privilege('authenticated', 'public.staff_push_deliveries', 'SELECT,INSERT,UPDATE,DELETE'), 'authenticated clients cannot alter delivery receipts');

select ok(indisunique and indisvalid and pg_get_expr(indpred, indrelid) like '%amendment_id IS NULL%', 'original tickets retain a valid unique predicate') from pg_index where indexrelid = 'public.print_jobs_initial_order_unique'::regclass;
select ok(indisunique and indisvalid and pg_get_expr(indpred, indrelid) like '%amendment_id IS NULL%', 'routing copies retain original-ticket uniqueness') from pg_index where indexrelid = 'public.print_jobs_order_rule_unique'::regclass;
select ok(indisunique and indisvalid and pg_get_expr(indpred, indrelid) like '%amendment_id IS NOT NULL%', 'amendment destinations have their own valid unique key') from pg_index where indexrelid = 'public.print_jobs_amendment_destination_unique'::regclass;

update public.backend_runtime_state set writes_enabled = false, backend_role = 'READ_ONLY_STANDBY', enforcement_enabled = true where is_current;
select throws_ok($$delete from public.stall_menu_announcements where false$$, '55000', 'BACKEND_NOT_WRITABLE', 'standby refuses announcement writes even with no matched rows');
select throws_ok($$delete from public.staff_push_subscriptions where false$$, '55000', 'BACKEND_NOT_WRITABLE', 'standby refuses subscription writes');
select throws_ok($$delete from public.staff_push_deliveries where false$$, '55000', 'BACKEND_NOT_WRITABLE', 'standby refuses worker writes');
select * from finish();
rollback;
