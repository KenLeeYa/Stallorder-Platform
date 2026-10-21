-- The later optional staff-contact migration replaced the delivery CHECK and
-- removed the earlier terminal privacy-erasure exemption. Preserve both contracts.
do $$ declare delivery_expression text;
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid='public.orders'::regclass and conname='orders_erased_contact_check'
      and contype='c' and convalidated
  ) then
    raise exception 'TERMINAL_CONTACT_ERASURE_CONSTRAINT_REQUIRED';
  end if;
  select pg_catalog.pg_get_expr(conbin,conrelid) into strict delivery_expression
    from pg_catalog.pg_constraint
    where conrelid='public.orders'::regclass and conname='orders_delivery_fields_check';
  alter table public.orders drop constraint orders_delivery_fields_check;
  execute format(
    'alter table public.orders add constraint orders_delivery_fields_check check ((%s) or (privacy_erasure_request_id is not null and privacy_contact_erased_at is not null))',
    delivery_expression
  );
end $$;
comment on constraint orders_delivery_fields_check on public.orders is
  'Staff POS contact is optional; public delivery requires address and phone; provider imports may omit both; terminal contact erasure also requires orders_erased_contact_check and the verified request trigger.';
