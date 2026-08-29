begin;

select plan(4);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_trigger
    where not tgisinternal
      and tgname = 'backend_writable_guard'
      and tgrelid = any (array[
        'public.dining_floors'::regclass,
        'public.product_bundle_choice_groups'::regclass,
        'public.product_bundle_choices'::regclass,
        'public.public_lottery_draws'::regclass,
        'public.reusable_product_note_translations'::regclass,
        'public.reusable_product_notes'::regclass,
        'public.stall_lottery_discount_chances'::regclass,
        'public.reservations'::regclass,
        'public.reservation_preorder_sessions'::regclass,
        'public.digital_waitlist_entries'::regclass,
        'public.digital_waitlist_notifications'::regclass,
        'public.online_order_payment_intents'::regclass,
        'public.online_order_payment_events'::regclass,
        'public.dynamic_qr_service_points'::regclass,
        'public.dynamic_qr_credentials'::regclass,
        'public.crm_profiles'::regclass,
        'public.crm_consent_records'::regclass,
        'public.loyalty_accounts'::regclass,
        'public.loyalty_points_ledger'::regclass,
        'public.crm_erasure_tombstones'::regclass,
        'public.stall_special_closures'::regclass
      ])
  ),
  21,
  'August and Phase 3 business tables receive the backend write fence'
);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_trigger
    where not tgisinternal
      and tgname = 'backend_writable_guard'
      and tgenabled = 'O'
      and tgrelid = any (array[
        'public.products'::regclass,
        'public.stalls'::regclass
      ])
  ),
  2,
  'private image delivery leaves existing product and stall write fences enabled'
);

update public.backend_runtime_state
set backend_role = 'SEALED',
    writes_enabled = false,
    enforcement_enabled = true
where is_current;

select throws_ok(
  $$ insert into public.reservations default values $$,
  '55000',
  'BACKEND_NOT_WRITABLE',
  'a newly introduced Phase 3 business table rejects writes on a sealed backend'
);

select throws_ok(
  $$ insert into public.stall_special_closures default values $$,
  '55000',
  'BACKEND_NOT_WRITABLE',
  'special closure writes are rejected on a sealed backend'
);

select * from finish();
rollback;
