import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type ProductRow = { stall_id: string; stall_name: string; product_name: string; quantity: bigint; revenue: bigint };
type HourRow = { stall_id: string; stall_name: string; sale_hour: number; order_count: bigint; sales: bigint };

export async function getProductAndHourlyReport(
  organizationId: string,
  stallIds: string[],
  dateFrom: string,
  dateTo: string,
) {
  if (stallIds.length === 0) return { products: [], hours: [] };
  const scopedIds = Prisma.join(stallIds.map((id) => Prisma.sql`${id}::uuid`));
  const [productRows, hourRows] = await Promise.all([
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
        and (order_record.created_at at time zone stall.timezone)::date between ${dateFrom}::date and ${dateTo}::date
      group by item.stall_id, stall.name, item.name
      order by revenue desc, item.name asc
      limit 500
    `),
    prisma.$queryRaw<HourRow[]>(Prisma.sql`
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
        and (order_record.created_at at time zone stall.timezone)::date between ${dateFrom}::date and ${dateTo}::date
      group by order_record.stall_id, stall.name, sale_hour
      order by sale_hour asc, sales desc
    `),
  ]);
  return {
    products: productRows.map((row) => ({
      stallId: row.stall_id,
      stallName: row.stall_name,
      productName: row.product_name,
      quantity: Number(row.quantity),
      revenue: Number(row.revenue),
    })),
    hours: hourRows.map((row) => ({
      stallId: row.stall_id,
      stallName: row.stall_name,
      hour: row.sale_hour,
      orderCount: Number(row.order_count),
      sales: Number(row.sales),
    })),
  };
}
