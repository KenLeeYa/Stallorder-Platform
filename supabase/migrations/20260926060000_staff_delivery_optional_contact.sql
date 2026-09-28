-- Keep the database aligned with the authenticated staff POS contract.
-- Public delivery still requires contact details; imported orders keep provider-owned data out.
alter table public.orders drop constraint orders_delivery_fields_check;
alter table public.orders add constraint orders_delivery_fields_check check (
  (
    fulfillment_type = 'DELIVERY'::public.fulfillment_type
    and (
      (
        source = 'STAFF_POS'
        and origin in ('ONLINE_STAFF'::public.order_origin, 'TEST'::public.order_origin)
        and (delivery_address is null or char_length(btrim(delivery_address)) between 1 and 300)
        and (customer_phone is null or char_length(btrim(customer_phone)) between 6 and 30)
      )
      or (
        origin = 'IMPORTED'::public.order_origin
        and external_provider is not null
        and delivery_address is null
        and customer_phone is null
      )
      or (
        delivery_address is not null
        and char_length(btrim(delivery_address)) between 1 and 300
        and customer_phone is not null
        and char_length(btrim(customer_phone)) between 6 and 30
      )
    )
  )
  or (fulfillment_type <> 'DELIVERY'::public.fulfillment_type and delivery_address is null)
);
comment on constraint orders_delivery_fields_check on public.orders is
  'Authenticated staff POS delivery contact fields are optional; public delivery requires address and phone; provider imports may omit both.';
