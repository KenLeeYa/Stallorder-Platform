begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(38);

select is(
  (
    select pg_get_expr(def.adbin, def.adrelid)
    from pg_attrdef def
    join pg_attribute attribute
      on attribute.attrelid = def.adrelid
      and attribute.attnum = def.adnum
    where def.adrelid = 'public.stall_ordering_settings'::regclass
      and attribute.attname = 'preorder_slot_minutes'
  ),
  '5',
  'new stalls use the five-minute database default'
);

update public.stall_ordering_settings
set preorder_slot_minutes = 60
where stall_id = '22222222-2222-4222-8222-222222222222';
select is(
  (
    select preorder_slot_minutes::integer
    from public.stall_ordering_settings
    where stall_id = '22222222-2222-4222-8222-222222222222'
  ),
  60,
  'an existing merchant-selected cadence remains stored instead of being forced to five minutes'
);
select ok(
  not (
    select convalidated
    from pg_constraint
    where conname = 'stall_ordering_settings_preorder_slot_check'
      and conrelid = 'public.stall_ordering_settings'::regclass
  ),
  'the expanded cadence constraint avoids a full-table validation scan during release'
);

select lives_ok(
  $$
    update public.stall_ordering_settings
    set preorder_slot_minutes = 5
    where stall_id = '22222222-2222-4222-8222-222222222222'
  $$,
  'five-minute slots remain a supported setting'
);
select is(
  (
    select preorder_slot_minutes::integer
    from public.stall_ordering_settings
    where stall_id = '22222222-2222-4222-8222-222222222222'
  ),
  5,
  'the selected five-minute interval is stored'
);
select throws_ok(
  $$
    update public.stall_ordering_settings
    set preorder_slot_minutes = 10
    where stall_id = '22222222-2222-4222-8222-222222222222'
  $$,
  '23514',
  null,
  'unsupported intervals remain blocked by the database'
);

update public.stall_ordering_settings
set takeout_preorder_enabled = false,
    delivery_module_enabled = true,
    staff_delivery_enabled = true,
    preorder_min_lead_minutes = 15,
    preorder_max_days = 2,
    preorder_slot_minutes = 5
where stall_id = '22222222-2222-4222-8222-222222222222';
update public.stalls
set timezone = 'Asia/Taipei',
    is_active = true,
    is_sold_out = false,
    ordering_enabled = true,
    ordering_state = 'OPEN',
    business_status = 'OPEN'
where id = '22222222-2222-4222-8222-222222222222';
update public.stall_business_hours
set opens_at = '00:03',
    closes_at = '23:58',
    is_closed = false
where stall_id = '22222222-2222-4222-8222-222222222222';
update public.stall_capacity_settings
set pause_source = 'NONE',
    auto_pause_enabled = false,
    manual_wait_minutes = null
where stall_id = '22222222-2222-4222-8222-222222222222';

create temporary table five_minute_test_context (
  reference_time timestamptz not null
) on commit drop;
insert into five_minute_test_context values (now());
create temporary table delivery_only_test_slots (
  slot timestamptz primary key
) on commit drop;
insert into delivery_only_test_slots (slot)
select value::timestamptz
from five_minute_test_context context
cross join lateral jsonb_array_elements_text(
  public.get_takeout_preorder_slots(
    '22222222-2222-4222-8222-222222222222',
    context.reference_time
  )
);

select ok(
  exists (select 1 from delivery_only_test_slots),
  'a delivery-only stall receives shared five-minute fulfillment slots'
);

select is(
  public.validate_requested_fulfillment_slot(
    '22222222-2222-4222-8222-222222222222',
    'DELIVERY',
    'PUBLIC_NEW_ORDER',
    (select min(slot) from delivery_only_test_slots),
    (select reference_time from five_minute_test_context)
  ),
  null::text,
  'the mode-aware validator accepts an offered delivery-only slot'
);
select is(
  public.validate_requested_fulfillment_slot(
    '22222222-2222-4222-8222-222222222222',
    'TAKEOUT',
    'PUBLIC_NEW_ORDER',
    (select min(slot) from delivery_only_test_slots),
    (select reference_time from five_minute_test_context)
  ),
  'PREORDER_DISABLED',
  'the mode-aware validator keeps takeaway disabled at a delivery-only stall'
);
select is(
  public.validate_requested_fulfillment_slot(
    '22222222-2222-4222-8222-222222222222',
    'TAKEOUT',
    'STAFF_NEW_ORDER',
    (select min(slot) from delivery_only_test_slots),
    (select reference_time from five_minute_test_context)
  ),
  null::text,
  'staff takeaway can schedule an offered slot without enabling public preorder'
);

select is(
  public.issue_order_session_with_schedule(
    'demo-aming-chicken-qr-2026-rotate-me',
    repeat('v', 64), repeat('w', 64), repeat('x', 64),
    repeat('y', 64), repeat('z', 64), 'delivery-only-session', 'DELIVERY'
  )->>'ok',
  'true',
  'a real delivery-only order session is issued'
);

create temporary table delivery_only_writer_results (
  delivery_result jsonb,
  takeaway_result jsonb
) on commit drop;
insert into delivery_only_writer_results default values;
update delivery_only_writer_results
set delivery_result = public.create_public_order_with_fulfillment_time(
  'fb300000-0000-4000-8000-000000000001',
  'demo-aming-chicken-qr-2026-rotate-me',
  repeat('v', 64), repeat('x', 64), repeat('w', 64),
  repeat('y', 64), repeat('z', 64),
  'fb400000-0000-4000-8000-000000000001', repeat('i', 64),
  'Delivery only customer', '0912345678', '台北市測試路 5 號', '',
  jsonb_build_array(jsonb_build_object(
    'product_id', '44444444-4444-4444-8444-444444444444',
    'quantity', 1,
    'note', '',
    'modifier_option_ids', '[]'::jsonb,
    'bundle_choice_ids', '[]'::jsonb
  )),
  repeat('t', 64), repeat('p', 64), 'delivery-only-order', true,
  (select min(slot) from delivery_only_test_slots), null
);
select ok(
  (
    select delivery_result->>'ok' = 'true'
      and delivery_result #>> '{order,order_id}' = 'fb300000-0000-4000-8000-000000000001'
      and exists (
        select 1
        from public.orders order_record
        where order_record.id = 'fb300000-0000-4000-8000-000000000001'
          and order_record.fulfillment_type = 'DELIVERY'
          and order_record.requested_fulfillment_at = (
            select min(slot) from delivery_only_test_slots
          )
          and order_record.fulfillment_time_state = 'REQUESTED'
      )
    from delivery_only_writer_results
  ),
  'the real fulfillment writer accepts and stores a delivery-only requested time'
);

select is(
  public.issue_order_session_with_schedule(
    'demo-aming-chicken-qr-2026-rotate-me',
    repeat('k', 64), repeat('l', 64), repeat('m', 64),
    repeat('n', 64), repeat('o', 64), 'takeaway-disabled-session', 'DEFAULT'
  )->>'ok',
  'true',
  'a live default takeaway session is issued for the negative writer check'
);
update delivery_only_writer_results
set takeaway_result = public.create_public_order_with_fulfillment_time(
  'fb300000-0000-4000-8000-000000000002',
  'demo-aming-chicken-qr-2026-rotate-me',
  repeat('k', 64), repeat('m', 64), repeat('l', 64),
  repeat('n', 64), repeat('o', 64),
  'fb400000-0000-4000-8000-000000000002', repeat('j', 64),
  'Takeaway disabled customer', null, null, '',
  jsonb_build_array(jsonb_build_object(
    'product_id', '44444444-4444-4444-8444-444444444444',
    'quantity', 1,
    'note', '',
    'modifier_option_ids', '[]'::jsonb,
    'bundle_choice_ids', '[]'::jsonb
  )),
  repeat('u', 64), repeat('r', 64), 'takeaway-disabled-order', true,
  (select min(slot) from delivery_only_test_slots), null
);
select is(
  (select takeaway_result->>'code' from delivery_only_writer_results),
  'PREORDER_DISABLED',
  'the real writer rejects a requested takeaway time when takeout preorder is disabled'
);

update public.stall_ordering_settings
set delivery_module_enabled = false,
    staff_delivery_enabled = true
where stall_id = '22222222-2222-4222-8222-222222222222';
select ok(
  jsonb_array_length(public.get_fulfillment_time_slots_raw(
    '22222222-2222-4222-8222-222222222222',
    (select reference_time from five_minute_test_context)
  )) > 0,
  'the staff catalog retains slots when both public fulfillment modules are disabled'
);
select is(
  public.validate_requested_fulfillment_slot(
    '22222222-2222-4222-8222-222222222222',
    'DELIVERY',
    'PUBLIC_NEW_ORDER',
    (select min(slot) from delivery_only_test_slots),
    (select reference_time from five_minute_test_context)
  ),
  'DELIVERY_UNAVAILABLE',
  'the staff-only delivery flag cannot widen public QR delivery access'
);
select is(
  public.validate_requested_fulfillment_slot(
    '22222222-2222-4222-8222-222222222222',
    'DELIVERY',
    'STAFF_NEW_ORDER',
    (select min(slot) from delivery_only_test_slots),
    (select reference_time from five_minute_test_context)
  ),
  null::text,
  'staff delivery can schedule a slot through its dedicated module flag'
);

update public.stall_ordering_settings
set staff_delivery_enabled = false
where stall_id = '22222222-2222-4222-8222-222222222222';
update public.stalls
set ordering_state = 'PAUSED',
    business_status = 'PAUSED'
where id = '22222222-2222-4222-8222-222222222222';
select is(
  public.validate_requested_fulfillment_slot(
    '22222222-2222-4222-8222-222222222222',
    'DELIVERY',
    'STAFF_NEW_ORDER',
    (select min(slot) from delivery_only_test_slots),
    (select reference_time from five_minute_test_context)
  ),
  'DELIVERY_UNAVAILABLE',
  'staff delivery remains disabled when its dedicated module is off'
);
select is(
  public.validate_requested_fulfillment_slot(
    '22222222-2222-4222-8222-222222222222',
    'DELIVERY',
    'EXISTING_ORDER',
    (select min(slot) from delivery_only_test_slots),
    (select reference_time from five_minute_test_context)
  ),
  null::text,
  'an existing delivery order can be rescheduled after new orders are paused and modules are disabled'
);
select is(
  public.validate_requested_fulfillment_slot(
    '22222222-2222-4222-8222-222222222222',
    'TAKEOUT',
    'EXISTING_ORDER',
    (select min(slot) from delivery_only_test_slots),
    (select reference_time from five_minute_test_context)
  ),
  null::text,
  'an existing takeaway order can be rescheduled after new orders are paused and modules are disabled'
);
select is(
  jsonb_array_length(public.get_takeout_preorder_slots(
    '22222222-2222-4222-8222-222222222222',
    (select reference_time from five_minute_test_context)
  )),
  0,
  'the shared slot grid stays unavailable when takeout and delivery are both disabled'
);

update public.stall_ordering_settings
set takeout_preorder_enabled = true
where stall_id = '22222222-2222-4222-8222-222222222222';
update public.stalls
set ordering_state = 'OPEN',
    business_status = 'OPEN'
where id = '22222222-2222-4222-8222-222222222222';
create temporary table five_minute_test_slots (
  slot timestamptz primary key
) on commit drop;
insert into five_minute_test_slots (slot)
select value::timestamptz
from five_minute_test_context context
cross join lateral jsonb_array_elements_text(
  public.get_takeout_preorder_slots(
    '22222222-2222-4222-8222-222222222222',
    context.reference_time
  )
);

select ok(
  exists (select 1 from five_minute_test_slots),
  'the shared fulfillment-slot function returns five-minute choices'
);
select ok(
  not exists (
    select 1
    from five_minute_test_slots
    where extract(minute from slot at time zone 'Asia/Taipei')::integer % 5 <> 0
      or extract(second from slot at time zone 'Asia/Taipei') <> 0
  ),
  'five-minute slots use clock-aligned 00, 05, 10, and 15-style minutes'
);
select ok(
  not exists (
    select 1
    from (
      select
        slot,
        lag(slot) over (
          partition by (slot at time zone 'Asia/Taipei')::date
          order by slot
        ) as previous_slot
      from five_minute_test_slots
    ) ordered_slots
    where previous_slot is not null
      and slot - previous_slot <> interval '5 minutes'
  ),
  'adjacent slots within each service date remain exactly five minutes apart'
);
select is(
  public.validate_takeout_preorder_slot(
    '22222222-2222-4222-8222-222222222222',
    (select min(slot) from five_minute_test_slots),
    (select reference_time from five_minute_test_context)
  ),
  null::text,
  'the shared validator accepts an exact offered slot'
);
select is(
  public.validate_takeout_preorder_slot(
    '22222222-2222-4222-8222-222222222222',
    (select min(slot) + interval '1 minute' from five_minute_test_slots),
    (select reference_time from five_minute_test_context)
  ),
  'PREORDER_TIME_INVALID',
  'the shared validator rejects a time that was not offered'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.get_takeout_preorder_slots(uuid,timestamptz)',
    'EXECUTE'
  ),
  'anonymous clients cannot enumerate trusted fulfillment slots directly'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.get_takeout_preorder_slots(uuid,timestamptz)',
    'EXECUTE'
  ),
  'authenticated clients cannot bypass the server fulfillment contract'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.get_takeout_preorder_slots(uuid,timestamptz)',
    'EXECUTE'
  ),
  'the trusted service role can load shared takeout and delivery slots'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.get_fulfillment_time_slots_raw(uuid,timestamptz)',
    'EXECUTE'
  ),
  'anonymous clients cannot call the ungated fulfillment-slot generator'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.get_fulfillment_time_slots_raw(uuid,timestamptz)',
    'EXECUTE'
  ),
  'authenticated clients cannot call the ungated fulfillment-slot generator'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.get_fulfillment_time_slots_raw(uuid,timestamptz)',
    'EXECUTE'
  ),
  'the trusted service role can load the canonical staff fulfillment grid'
);

update public.stall_ordering_settings
set preorder_slot_minutes = 15
where stall_id = '22222222-2222-4222-8222-222222222222';
create temporary table fifteen_minute_test_slots (
  slot timestamptz primary key
) on commit drop;
insert into fifteen_minute_test_slots (slot)
select value::timestamptz
from five_minute_test_context context
cross join lateral jsonb_array_elements_text(
  public.get_takeout_preorder_slots(
    '22222222-2222-4222-8222-222222222222',
    context.reference_time
  )
);
select is(
  (
    select array_agg(to_char(first_slots.slot at time zone 'Asia/Taipei', 'HH24:MI') order by first_slots.slot)
    from (
      select slot
      from fifteen_minute_test_slots
      where (slot at time zone 'Asia/Taipei')::date = (
        (select reference_time at time zone 'Asia/Taipei' from five_minute_test_context)::date + 1
      )
      order by slot
      limit 2
    ) first_slots
  ),
  array['00:05', '00:20']::text[],
  'a 15-minute merchant opening at 00:03 starts on 00:05 then keeps its interval'
);
select is(
  public.validate_takeout_preorder_slot(
    '22222222-2222-4222-8222-222222222222',
    (
      select min(slot)
      from fifteen_minute_test_slots
      where (slot at time zone 'Asia/Taipei')::date = (
        (select reference_time at time zone 'Asia/Taipei' from five_minute_test_context)::date + 1
      )
    ),
    (select reference_time from five_minute_test_context)
  ),
  null::text,
  'the validator accepts an exact clock-aligned 15-minute slot'
);
select is(
  public.validate_takeout_preorder_slot(
    '22222222-2222-4222-8222-222222222222',
    (
      select min(slot) + interval '5 minutes'
      from fifteen_minute_test_slots
      where (slot at time zone 'Asia/Taipei')::date = (
        (select reference_time at time zone 'Asia/Taipei' from five_minute_test_context)::date + 1
      )
    ),
    (select reference_time from five_minute_test_context)
  ),
  'PREORDER_TIME_INVALID',
  'the validator rejects a clock-aligned time that was not offered by the 15-minute interval'
);
update public.stall_ordering_settings
set preorder_slot_minutes = 30
where stall_id = '22222222-2222-4222-8222-222222222222';
select is(
  (
    select array_agg(to_char(first_slots.slot at time zone 'Asia/Taipei', 'HH24:MI') order by first_slots.slot)
    from (
      select slot.value::timestamptz as slot
      from five_minute_test_context context
      cross join lateral jsonb_array_elements_text(
        public.get_takeout_preorder_slots(
          '22222222-2222-4222-8222-222222222222',
          context.reference_time
        )
      ) slot
      where (slot.value::timestamptz at time zone 'Asia/Taipei')::date = (
        (context.reference_time at time zone 'Asia/Taipei')::date + 1
      )
      order by slot.value::timestamptz
      limit 2
    ) first_slots
  ),
  array['00:05', '00:35']::text[],
  'a 30-minute merchant opening at 00:03 is also visible on the five-minute clock grid'
);
update public.stall_ordering_settings
set preorder_slot_minutes = 60
where stall_id = '22222222-2222-4222-8222-222222222222';
select is(
  (
    select array_agg(to_char(first_slots.slot at time zone 'Asia/Taipei', 'HH24:MI') order by first_slots.slot)
    from (
      select slot.value::timestamptz as slot
      from five_minute_test_context context
      cross join lateral jsonb_array_elements_text(
        public.get_takeout_preorder_slots(
          '22222222-2222-4222-8222-222222222222',
          context.reference_time
        )
      ) slot
      where (slot.value::timestamptz at time zone 'Asia/Taipei')::date = (
        (context.reference_time at time zone 'Asia/Taipei')::date + 1
      )
      order by slot.value::timestamptz
      limit 2
    ) first_slots
  ),
  array['00:05', '01:05']::text[],
  'a 60-minute merchant keeps its interval after clock-grid alignment'
);
update public.stall_ordering_settings
set preorder_slot_minutes = 120
where stall_id = '22222222-2222-4222-8222-222222222222';
select is(
  (
    select array_agg(to_char(first_slots.slot at time zone 'Asia/Taipei', 'HH24:MI') order by first_slots.slot)
    from (
      select slot.value::timestamptz as slot
      from five_minute_test_context context
      cross join lateral jsonb_array_elements_text(
        public.get_takeout_preorder_slots(
          '22222222-2222-4222-8222-222222222222',
          context.reference_time
        )
      ) slot
      where (slot.value::timestamptz at time zone 'Asia/Taipei')::date = (
        (context.reference_time at time zone 'Asia/Taipei')::date + 1
      )
      order by slot.value::timestamptz
      limit 2
    ) first_slots
  ),
  array['00:05', '02:05']::text[],
  'a 120-minute merchant keeps its interval after clock-grid alignment'
);

select * from finish();
rollback;
