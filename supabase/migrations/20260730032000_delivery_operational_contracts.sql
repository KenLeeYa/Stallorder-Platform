alter table public.orders
  drop constraint if exists orders_delivery_fields_check;

alter table public.orders
  add constraint orders_delivery_fields_check check (
    (
      fulfillment_type = 'DELIVERY'::public.fulfillment_type
      and (
        (
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
    or (
      fulfillment_type <> 'DELIVERY'::public.fulfillment_type
      and delivery_address is null
    )
  );

alter table public.operational_alerts
  drop constraint if exists operational_alerts_alert_type_check;

alter table public.operational_alerts
  add constraint operational_alerts_alert_type_check check (alert_type in (
    'EXCESSIVE_PENDING_ORDERS', 'HIGH_CANCELLATION_RATE', 'PAYMENT_MISMATCH',
    'ORDERING_PAUSED', 'STALL_OFFLINE', 'NO_RECENT_ACTIVITY',
    'UNPAID_COMPLETED_ORDER', 'KDS_ORDER_OVERDUE', 'STATION_BACKLOG',
    'CDS_DISCONNECTED', 'CAPACITY_WARNING', 'CAPACITY_AUTO_PAUSED',
    'CASH_SHIFT_NOT_CLOSED', 'CASH_OVER_SHORT', 'SCHEDULE_START_DELAYED',
    'LINE_NOTIFICATION_FAILURE', 'DELIVERY_ORDER_MAPPING_REQUIRED',
    'DELIVERY_JOB_DEAD_LETTER'
  ));

comment on constraint orders_delivery_fields_check on public.orders is
  'Staff-created delivery orders require address and phone; provider-imported delivery orders keep those provider-owned fields out of StallOrder.';
