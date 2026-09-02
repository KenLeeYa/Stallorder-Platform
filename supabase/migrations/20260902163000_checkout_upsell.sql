alter table public.stall_ordering_settings
  add column if not exists checkout_upsell_enabled boolean not null default false,
  add column if not exists checkout_upsell_product_ids uuid[] not null default '{}'::uuid[];

alter table public.stall_ordering_settings
  add constraint stall_ordering_settings_checkout_upsell_product_count_check check (
    cardinality(checkout_upsell_product_ids) <= 6
    and array_position(checkout_upsell_product_ids, null) is null
  );

comment on column public.stall_ordering_settings.checkout_upsell_enabled is
  'Shows selected add-on recommendations once before a customer enters checkout.';

comment on column public.stall_ordering_settings.checkout_upsell_product_ids is
  'Ordered product IDs selected by the merchant for checkout add-on recommendations.';
