begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(16);

-- Exercise the actual deployed CHECK without unrelated order triggers or fixture writes.
create temporary table delivery_contact_contract (
  fulfillment_type public.fulfillment_type default 'DELIVERY',
  source text default 'STAFF_POS',
  origin public.order_origin default 'ONLINE_STAFF',
  external_provider text,
  delivery_address text,
  customer_phone text,
  status public.order_status default 'WAITING_CONFIRMATION',
  customer_name text default 'QA customer',
  note text,
  privacy_erasure_request_id uuid,
  privacy_contact_erased_at timestamptz
);
do $$ begin
  execute 'alter table delivery_contact_contract add constraint orders_delivery_fields_check '
    || (select pg_get_constraintdef(oid) from pg_constraint
        where conrelid = 'public.orders'::regclass and conname = 'orders_delivery_fields_check');
  execute 'alter table delivery_contact_contract add constraint orders_erased_contact_check '
    || (select pg_get_constraintdef(oid) from pg_constraint
        where conrelid = 'public.orders'::regclass and conname = 'orders_erased_contact_check');
end $$;

select lives_ok($$insert into delivery_contact_contract default values$$, 'Staff can omit both contact fields');
select lives_ok($$insert into delivery_contact_contract(customer_phone) values ('0912345678')$$, 'Staff phone only');
select lives_ok($$insert into delivery_contact_contract(delivery_address) values ('QA address')$$, 'Staff address only');
select lives_ok($$insert into delivery_contact_contract(customer_phone, delivery_address) values ('0912345678','QA address')$$, 'Staff full contact');
select lives_ok($$insert into delivery_contact_contract(origin) values ('TEST')$$, 'Staff setup test follows POS contract');
select throws_ok($$insert into delivery_contact_contract(customer_phone) values ('1')$$, '23514', null, 'Invalid provided phone rejected');
select throws_ok($$insert into delivery_contact_contract(delivery_address) values (' ')$$, '23514', null, 'Blank provided address rejected');
select throws_ok($$insert into delivery_contact_contract(source, origin) values ('QR_MENU','ONLINE_QR')$$, '23514', null, 'Public delivery missing contact rejected');
select throws_ok($$insert into delivery_contact_contract(source, origin, customer_phone) values ('QR_MENU','ONLINE_QR','0912345678')$$, '23514', null, 'Public delivery missing address rejected');
select lives_ok($$insert into delivery_contact_contract(source, origin, customer_phone, delivery_address) values ('QR_MENU','ONLINE_QR','0912345678','QA address')$$, 'Public delivery full contact accepted');
select lives_ok($$insert into delivery_contact_contract(source, origin, external_provider) values ('DELIVERY_PLATFORM','IMPORTED','QA')$$, 'Imported provider can omit contact');
select throws_ok($$insert into delivery_contact_contract(fulfillment_type, delivery_address) values ('TAKEOUT','QA address')$$, '23514', null, 'Takeout cannot carry delivery address');
select lives_ok($$insert into delivery_contact_contract(source, origin, status, customer_name, privacy_erasure_request_id, privacy_contact_erased_at) values ('QR_MENU','ONLINE_QR','COMPLETED','[removed]','11111111-1111-4111-8111-111111111111',now())$$, 'Terminal erased delivery may omit contact');
select throws_ok($$insert into delivery_contact_contract(source, origin, customer_name, privacy_erasure_request_id, privacy_contact_erased_at) values ('QR_MENU','ONLINE_QR','[removed]','11111111-1111-4111-8111-111111111111',now())$$, '23514', null, 'Live delivery cannot use erased contact exemption');
select throws_ok($$insert into delivery_contact_contract(source, origin, status, customer_name, privacy_erasure_request_id) values ('QR_MENU','ONLINE_QR','COMPLETED','[removed]','11111111-1111-4111-8111-111111111111')$$, '23514', null, 'Partial erasure marker cannot bypass delivery contact');
select throws_ok($$insert into delivery_contact_contract(source, origin, status, customer_name, customer_phone, privacy_erasure_request_id, privacy_contact_erased_at) values ('QR_MENU','ONLINE_QR','COMPLETED','[removed]','0912345678','11111111-1111-4111-8111-111111111111',now())$$, '23514', null, 'Erased terminal delivery cannot retain contact');
select * from finish();
rollback;
