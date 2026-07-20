-- Keep daily operations and sales summaries aligned with the additive PACKING state.
create or replace function public.rebuild_daily_stall_summary(
  p_stall_id uuid,
  p_date_from date,
  p_date_to date
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stall public.stalls%rowtype;
  v_count integer;
begin
  if p_date_from is null or p_date_to is null or p_date_to < p_date_from then
    raise exception 'INVALID_SUMMARY_DATE_RANGE';
  end if;
  if p_date_to - p_date_from > 366 then
    raise exception 'SUMMARY_DATE_RANGE_TOO_LARGE';
  end if;
  select * into v_stall from public.stalls where id = p_stall_id;
  if not found then raise exception 'STALL_NOT_FOUND'; end if;

  with date_range as (
    select day::date as business_date
    from generate_series(p_date_from, p_date_to, interval '1 day') day
  ), order_stats as (
    select
      date_range.business_date,
      count(order_record.id)::integer as order_count,
      count(order_record.id) filter (where order_record.status in (
        'CONFIRMED'::public.order_status,
        'PREPARING'::public.order_status,
        'PACKING'::public.order_status,
        'READY'::public.order_status,
        'COMPLETED'::public.order_status
      ))::integer as confirmed_order_count,
      count(order_record.id) filter (
        where order_record.status = 'COMPLETED'::public.order_status
      )::integer as completed_order_count,
      count(order_record.id) filter (
        where order_record.status = 'CANCELLED'::public.order_status
      )::integer as cancelled_order_count,
      count(order_record.id) filter (where order_record.status in (
        'WAITING_CONFIRMATION'::public.order_status,
        'CONFIRMED'::public.order_status,
        'PREPARING'::public.order_status,
        'PACKING'::public.order_status,
        'READY'::public.order_status
      ))::integer as pending_order_count,
      count(order_record.id) filter (
        where order_record.payment_status = 'UNPAID'::public.payment_status
          and order_record.status not in (
            'CANCELLED'::public.order_status,
            'EXPIRED'::public.order_status
          )
      )::integer as unpaid_order_count,
      coalesce(sum(order_record.subtotal) filter (
        where order_record.status = 'COMPLETED'::public.order_status
      ), 0)::integer as gross_sales,
      coalesce(sum(order_record.discount_amount) filter (
        where order_record.status = 'COMPLETED'::public.order_status
      ), 0)::integer as discount_amount,
      coalesce(sum(order_record.total) filter (
        where order_record.status = 'COMPLETED'::public.order_status
      ), 0)::integer as net_sales,
      max(order_record.created_at) as last_order_at
    from date_range
    left join public.orders order_record
      on order_record.stall_id = v_stall.id
      and not order_record.is_test
      and public.stall_business_date(v_stall.id, order_record.created_at)
        = date_range.business_date
    group by date_range.business_date
  ), payment_stats as (
    select
      date_range.business_date,
      coalesce(sum(payment.amount) filter (
        where payment.status = 'PAID'::public.payment_status
          and payment.method = 'CASH'::public.payment_method
      ), 0)::integer as cash_amount,
      coalesce(sum(payment.amount) filter (
        where payment.status = 'PAID'::public.payment_status
          and payment.method = 'MANUAL_TRANSFER'::public.payment_method
      ), 0)::integer as manual_transfer_amount,
      coalesce(sum(payment.amount) filter (
        where payment.status = 'PAID'::public.payment_status
          and payment.method = 'OTHER'::public.payment_method
      ), 0)::integer as other_payment_amount
    from date_range
    left join public.orders payment_order
      on payment_order.stall_id = v_stall.id
      and not payment_order.is_test
      and public.stall_business_date(v_stall.id, payment_order.created_at)
        = date_range.business_date
    left join public.payments payment on payment.order_id = payment_order.id
    group by date_range.business_date
  )
  insert into public.daily_stall_summaries (
    organization_id, stall_id, business_date, order_count, confirmed_order_count,
    completed_order_count, cancelled_order_count, pending_order_count,
    unpaid_order_count, gross_sales, discount_amount, net_sales, cash_amount,
    manual_transfer_amount, other_payment_amount, average_order_value,
    last_order_at, last_calculated_at, updated_at
  )
  select
    v_stall.organization_id, v_stall.id, order_stats.business_date,
    order_stats.order_count, order_stats.confirmed_order_count,
    order_stats.completed_order_count, order_stats.cancelled_order_count,
    order_stats.pending_order_count, order_stats.unpaid_order_count,
    order_stats.gross_sales, order_stats.discount_amount, order_stats.net_sales,
    payment_stats.cash_amount, payment_stats.manual_transfer_amount,
    payment_stats.other_payment_amount,
    case when order_stats.completed_order_count = 0 then 0
      else round(order_stats.net_sales::numeric / order_stats.completed_order_count)::integer
    end,
    order_stats.last_order_at, now(), now()
  from order_stats
  join payment_stats using (business_date)
  on conflict (stall_id, business_date) do update set
    organization_id = excluded.organization_id,
    order_count = excluded.order_count,
    confirmed_order_count = excluded.confirmed_order_count,
    completed_order_count = excluded.completed_order_count,
    cancelled_order_count = excluded.cancelled_order_count,
    pending_order_count = excluded.pending_order_count,
    unpaid_order_count = excluded.unpaid_order_count,
    gross_sales = excluded.gross_sales,
    discount_amount = excluded.discount_amount,
    net_sales = excluded.net_sales,
    cash_amount = excluded.cash_amount,
    manual_transfer_amount = excluded.manual_transfer_amount,
    other_payment_amount = excluded.other_payment_amount,
    average_order_value = excluded.average_order_value,
    last_order_at = excluded.last_order_at,
    last_calculated_at = excluded.last_calculated_at,
    updated_at = excluded.updated_at;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.rebuild_daily_stall_summary(uuid, date, date)
  from public, anon, authenticated;
grant execute on function public.rebuild_daily_stall_summary(uuid, date, date)
  to service_role;
