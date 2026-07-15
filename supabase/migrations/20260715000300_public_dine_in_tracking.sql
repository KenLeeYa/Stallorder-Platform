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
    'createdAt', order_record.created_at,
    'confirmedAt', order_record.confirmed_at,
    'completedAt', order_record.completed_at,
    'stallName', stall.name,
    'fulfillmentType', order_record.fulfillment_type,
    'tableLabel', order_record.table_label,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', item.id,
        'name', item.name,
        'quantity', item.quantity,
        'status', item.status
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
