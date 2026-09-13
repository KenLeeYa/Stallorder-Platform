-- Preserve delivery requirements for live orders. Approved erasure may remove
-- contact fields only after fulfillment ended; financial snapshots stay intact.
alter table public.orders add column privacy_erasure_request_id uuid;
alter table public.orders add column privacy_contact_erased_at timestamptz;
alter table public.orders add constraint orders_privacy_request_scope_fk
  foreign key(privacy_erasure_request_id, organization_id) references public.privacy_requests(id, organization_id) on delete restrict;
alter table public.orders add constraint orders_erased_contact_check check(
  (privacy_erasure_request_id is null and privacy_contact_erased_at is null) or
  (privacy_erasure_request_id is not null and privacy_contact_erased_at is not null
   and status in ('COMPLETED','CANCELLED','EXPIRED') and customer_name='[removed]'
   and customer_phone is null and delivery_address is null and note is null)
);
do $$ declare original_expression text;
begin
  select pg_get_expr(conbin,conrelid) into strict original_expression from pg_constraint
    where conrelid='public.orders'::regclass and conname='orders_delivery_fields_check';
  alter table public.orders drop constraint orders_delivery_fields_check;
  execute format('alter table public.orders add constraint orders_delivery_fields_check check ((%s) or (privacy_erasure_request_id is not null and privacy_contact_erased_at is not null))', original_expression);
end $$;
create function app_private.guard_order_contact_erasure() returns trigger language plpgsql set search_path='' as $$
begin
  if new.privacy_erasure_request_id is not null and (tg_op='INSERT' or new.privacy_erasure_request_id is distinct from old.privacy_erasure_request_id) then
    perform app_private.assert_backend_writable();
    if not exists(select 1 from public.privacy_requests r where r.id=new.privacy_erasure_request_id and r.organization_id=new.organization_id
      and r.order_id=new.id and r.stall_id=new.stall_id and r.request_type='DELETE' and r.verified_at is not null and r.status in ('APPROVED','EXECUTING')) then
      raise exception 'VERIFIED_ERASURE_REQUEST_REQUIRED' using errcode='42501';
    end if;
  end if;
  if tg_op='UPDATE' and old.privacy_erasure_request_id is not null and new.privacy_erasure_request_id is distinct from old.privacy_erasure_request_id then
    raise exception 'ERASURE_TOMBSTONE_CANNOT_BE_CLEARED' using errcode='42501';
  end if;
  return new;
end $$;
revoke all on function app_private.guard_order_contact_erasure() from public,anon,authenticated,service_role;
create trigger order_contact_erasure_guard before insert or update on public.orders
  for each row execute function app_private.guard_order_contact_erasure();
