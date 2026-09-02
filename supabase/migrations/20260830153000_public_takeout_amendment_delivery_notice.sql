-- Customer-visible public-order amendments, five-minute takeout lead time,
-- and an optional delivery reminder shown before public delivery ordering.

alter table public.stall_ordering_settings
  add column if not exists delivery_customer_notice varchar(500) not null default '',
  alter column preorder_min_lead_minutes set default 5;

alter table public.stall_ordering_settings
  drop constraint if exists stall_ordering_settings_preorder_min_lead_check;

update public.stall_ordering_settings
set preorder_min_lead_minutes = 5
where preorder_min_lead_minutes < 5;

alter table public.stall_ordering_settings
  add constraint stall_ordering_settings_preorder_min_lead_check
  check (preorder_min_lead_minutes between 5 and 1440);

create or replace function public.get_public_order(
  p_tracking_token_hash text,
  p_device_hash text
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'orderId', order_record.id,
    'orderNo', order_record.order_no,
    'orderStatus', order_record.status,
    'paymentStatus', order_record.payment_status,
    'totalAmount', order_record.total,
    'currency', stall.currency,
    'createdAt', order_record.created_at,
    'confirmedAt', order_record.confirmed_at,
    'completedAt', order_record.completed_at,
    'stallName', stall.name,
    'stallTimezone', stall.timezone,
    'fulfillmentType', order_record.fulfillment_type,
    'tableLabel', order_record.table_label,
    'customerPhone', order_record.customer_phone,
    'deliveryAddress', order_record.delivery_address,
    'pickupCodeLength', order_record.pickup_code_length,
    'scheduledPickupAt', order_record.scheduled_pickup_at,
    'requestedFulfillmentAt', order_record.requested_fulfillment_at,
    'committedFulfillmentAt', order_record.committed_fulfillment_at,
    'pendingFulfillmentAt', order_record.pending_fulfillment_at,
    'fulfillmentTimeState', order_record.fulfillment_time_state,
    'fulfillmentTimeVersion', order_record.fulfillment_time_version,
    'fulfillmentTimeResponseExpiresAt', order_record.fulfillment_time_response_expires_at,
    'fulfillmentTimeChangeReason', order_record.fulfillment_time_change_reason,
    'merchantAmendment', (
      select jsonb_build_object(
        'id', amendment.id,
        'reason', amendment.metadata_json ->> 'reason',
        'message', amendment.metadata_json ->> 'customerMessage',
        'previousTotal', nullif(amendment.metadata_json -> 'before' ->> 'total', '')::integer,
        'total', nullif(amendment.metadata_json -> 'after' ->> 'total', '')::integer,
        'createdAt', amendment.created_at
      )
      from public.order_events amendment
      where amendment.order_id = order_record.id
        and amendment.event_type = 'PUBLIC_ORDER_ITEMS_ADJUSTED'
      order by amendment.created_at desc, amendment.id desc
      limit 1
    ),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', item.id,
        'name', item.name,
        'quantity', item.quantity,
        'status', item.status,
        'note', item.note,
        'noteOptions', coalesce((
          select jsonb_agg(jsonb_build_object(
            'groupName', note.group_name,
            'optionName', note.option_name,
            'priceDelta', note.price_delta
          ) order by note.sort_order, note.id)
          from public.order_item_note_options note where note.order_item_id = item.id
        ), '[]'::jsonb)
      ) order by item.created_at, item.id)
      from public.order_items item where item.order_id = order_record.id
    ), '[]'::jsonb)
  )
  from public.orders order_record
  join public.stalls stall on stall.id = order_record.stall_id
  where order_record.tracking_token_hash = p_tracking_token_hash
    and order_record.device_hash = p_device_hash;
$$;

revoke all on function public.get_public_order(text, text) from public, anon, authenticated;
grant execute on function public.get_public_order(text, text) to service_role;
