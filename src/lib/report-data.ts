import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type ProductRow = { stall_id: string; stall_name: string; product_name: string; quantity: bigint; revenue: bigint };
type HourRow = { stall_id: string; stall_name: string; sale_hour: number; order_count: bigint; sales: bigint };
type PaymentRow = { stall_id: string; stall_name: string; method_label: string; payment_count: bigint; amount: bigint };
type CancellationRow = { stall_id: string; stall_name: string; reason: string; cancellation_count: bigint };

export async function getProductAndHourlyReport(
  organizationId: string,
  stallIds: string[],
  dateFrom: string,
  dateTo: string,
) {
  if (stallIds.length === 0) return { products: [], hours: [] };
  const scopedIds = Prisma.join(stallIds.map((id) => Prisma.sql`${id}::uuid`));
  const [productRows, hours] = await Promise.all([
    prisma.$queryRaw<ProductRow[]>(Prisma.sql`
      select
        item.stall_id,
        stall.name as stall_name,
        item.name as product_name,
        sum(item.quantity)::bigint as quantity,
        sum(item.quantity * item.unit_price)::bigint as revenue
      from public.order_items item
      join public.orders order_record on order_record.id = item.order_id
      join public.stalls stall on stall.id = item.stall_id
      where item.organization_id = ${organizationId}::uuid
        and item.stall_id in (${scopedIds})
        and order_record.status = 'COMPLETED'::public.order_status
        and public.stall_business_date(stall.id, order_record.completed_at) between ${dateFrom}::date and ${dateTo}::date
      group by item.stall_id, stall.name, item.name
      order by revenue desc, item.name asc
      limit 500
    `),
    getHourlySalesReport(organizationId, stallIds, dateFrom, dateTo),
  ]);
  return {
    products: productRows.map((row) => ({
      stallId: row.stall_id,
      stallName: row.stall_name,
      productName: row.product_name,
      quantity: Number(row.quantity),
      revenue: Number(row.revenue),
    })),
    hours,
  };
}

export async function getHourlySalesReport(
  organizationId: string,
  stallIds: string[],
  dateFrom: string,
  dateTo: string,
) {
  if (stallIds.length === 0) return [];
  const scopedIds = Prisma.join(stallIds.map((id) => Prisma.sql`${id}::uuid`));
  const rows = await prisma.$queryRaw<HourRow[]>(Prisma.sql`
    select
      order_record.stall_id,
      stall.name as stall_name,
      extract(hour from order_record.completed_at at time zone stall.timezone)::integer as sale_hour,
      count(*)::bigint as order_count,
      sum(order_record.total)::bigint as sales
    from public.orders order_record
    join public.stalls stall on stall.id = order_record.stall_id
    where order_record.organization_id = ${organizationId}::uuid
      and order_record.stall_id in (${scopedIds})
      and order_record.status = 'COMPLETED'::public.order_status
      and public.stall_business_date(stall.id, order_record.completed_at) between ${dateFrom}::date and ${dateTo}::date
    group by order_record.stall_id, stall.name, sale_hour
    order by sale_hour asc, sales desc
  `);
  return rows.map((row) => ({
    stallId: row.stall_id,
    stallName: row.stall_name,
    hour: row.sale_hour,
    orderCount: Number(row.order_count),
    sales: Number(row.sales),
  }));
}

export async function getPaymentMethodReport(
  organizationId: string,
  stallIds: string[],
  dateFrom: string,
  dateTo: string,
) {
  if (stallIds.length === 0) return [];
  const scopedIds = Prisma.join(stallIds.map((id) => Prisma.sql`${id}::uuid`));
  const rows = await prisma.$queryRaw<PaymentRow[]>(Prisma.sql`
    select
      payment.stall_id,
      stall.name as stall_name,
      payment.method_label,
      count(*)::bigint as payment_count,
      sum(payment.amount)::bigint as amount
    from public.payments payment
    join public.stalls stall on stall.id = payment.stall_id
    where payment.organization_id = ${organizationId}::uuid
      and payment.stall_id in (${scopedIds})
      and payment.status = 'PAID'::public.payment_status
      and public.stall_business_date(stall.id, payment.paid_at) between ${dateFrom}::date and ${dateTo}::date
    group by payment.stall_id, stall.name, payment.method_label
    order by amount desc, payment.method_label asc
  `);
  return rows.map((row) => ({
    stallId: row.stall_id,
    stallName: row.stall_name,
    methodLabel: row.method_label,
    paymentCount: Number(row.payment_count),
    amount: Number(row.amount),
  }));
}

export async function getCancellationReasonReport(
  organizationId: string,
  stallIds: string[],
  dateFrom: string,
  dateTo: string,
) {
  if (stallIds.length === 0) return [];
  const scopedIds = Prisma.join(stallIds.map((id) => Prisma.sql`${id}::uuid`));
  const rows = await prisma.$queryRaw<CancellationRow[]>(Prisma.sql`
    select
      order_record.stall_id,
      stall.name as stall_name,
      coalesce(order_record.cancellation_reason::text, 'OTHER') as reason,
      count(*)::bigint as cancellation_count
    from public.orders order_record
    join public.stalls stall on stall.id = order_record.stall_id
    where order_record.organization_id = ${organizationId}::uuid
      and order_record.stall_id in (${scopedIds})
      and order_record.status = 'CANCELLED'::public.order_status
      and public.stall_business_date(stall.id, coalesce(order_record.cancelled_at, order_record.updated_at))
        between ${dateFrom}::date and ${dateTo}::date
    group by order_record.stall_id, stall.name, reason
    order by cancellation_count desc, stall.name asc, reason asc
  `);
  return rows.map((row) => ({
    stallId: row.stall_id,
    stallName: row.stall_name,
    reason: row.reason as "SOLD_OUT" | "CUSTOMER_CANCELLED" | "WAIT_TOO_LONG" | "DUPLICATE_ORDER" | "OTHER",
    count: Number(row.cancellation_count),
  }));
}
