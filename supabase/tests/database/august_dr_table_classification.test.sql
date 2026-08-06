begin;

select plan(1);

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
        'public.stall_lottery_discount_chances'::regclass
      ])
  ),
  7,
  'August business tables receive the backend write fence'
);

select * from finish();
rollback;
