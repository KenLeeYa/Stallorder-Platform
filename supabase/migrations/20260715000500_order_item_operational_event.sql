alter table public.operational_events
  drop constraint if exists operational_events_event_type_check;
alter table public.operational_events
  add constraint operational_events_event_type_check check (event_type in (
    'ORDER_CREATED',
    'ORDER_CONFIRMED',
    'ORDER_PREPARING',
    'ORDER_READY',
    'ORDER_COMPLETED',
    'ORDER_CANCELLED',
    'ORDER_ITEM_STATUS_CHANGED',
    'PAYMENT_RECORDED',
    'STALL_OPENED',
    'STALL_PAUSED',
    'STALL_CLOSED',
    'PRODUCT_SOLD_OUT_CHANGED'
  ));
