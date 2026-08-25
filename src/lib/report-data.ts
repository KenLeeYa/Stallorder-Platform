import "server-only";

import { Prisma, type PaymentMethod, type PrismaClient } from "@prisma/client";
import { buildOperationsPageMeta, type OperationsPageRequest } from "@/lib/operations-pagination";
import { withDatabaseRead } from "@/server/database/read-router";

type ProductRow = { stall_id: string; stall_name: string; product_name: string; quantity: bigint; revenue: bigint };
type ProductGroupRow = { stall_id: string; stall_name: string; category_name: string; group_name: string; quantity: bigint; revenue: bigint };
type HourRow = { stall_id: string; stall_name: string; sale_hour: number; order_count: bigint; sales: bigint };
type PaymentRow = {
  stall_id: string;
  stall_name: string;
  method: PaymentMethod;
  method_label: string;
  payment_count: bigint;
  amount: bigint;
};
type CancellationRow = { stall_id: string; stall_name: string; reason: string; cancellation_count: bigint };
type CashShiftRow = {
  id: string;
  stall_id: string;
  stall_name: string;
  status: string;
  opened_by_name: string;
  closed_by_name: string | null;
  opened_at: Date;
  closed_at: Date | null;
  opening_amount: bigint;
  cash_sales: bigint;
  cash_refunds: bigint;
  cash_in: bigint;
  cash_out: bigint;
  corrections: bigint;
  expected_amount: bigint;
  actual_amount: bigint | null;
  difference_amount: bigint | null;
  latest_review_decision: string | null;
  latest_reviewer_name: string | null;
};
type CashShiftSummaryRow = {
  total: bigint;
  cash_sales: bigint;
  cash_refunds: bigint;
  expected_amount: bigint;
  actual_amount: bigint;
  difference_amount: bigint;
  review_required: bigint;
};

export function sumPaidAmountByMethod(
  payments: Array<{ method: PaymentMethod; amount: number }>,
  method: PaymentMethod,
) {
  return payments
    .filter((payment) => payment.method === method)
    .reduce((sum, payment) => sum + payment.amount, 0);
}

export async function getProductAndHourlyReport(
  organizationId: string,
  stallIds: string[],
  dateFrom: string,
  dateTo: string,
  locale = "zh-TW",
  ungroupedLabel = "未分組",
) {
  if (stallIds.length === 0) return { products: [], groups: [], hours: [] };
  const scopedIds = Prisma.join(stallIds.map((id) => Prisma.sql`${id}::uuid`));
  const [productRows, groupRows, hours] = await withDatabaseRead(
    {
      policy: "DR_PREFERRED_EVENTUAL",
      operation: "product_and_hourly_report",
      maxLagSeconds: 30,
    },
    (database) => Promise.all([
      database.$queryRaw<ProductRow[]>(Prisma.sql`
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
          and not order_record.is_test
          and order_record.status = 'COMPLETED'::public.order_status
          and public.stall_business_date(stall.id, order_record.completed_at) between ${dateFrom}::date and ${dateTo}::date
        group by item.stall_id, stall.name, item.name
        order by revenue desc, item.name asc
        limit 500
      `),
      database.$queryRaw<ProductGroupRow[]>(Prisma.sql`
        select
          item.stall_id,
          stall.name as stall_name,
          coalesce(category_translation.name, category.name, ${ungroupedLabel}) as category_name,
          coalesce(group_translation.name, product_group.name, ${ungroupedLabel}) as group_name,
          sum(item.quantity)::bigint as quantity,
          sum(item.quantity * item.unit_price)::bigint as revenue
        from public.order_items item
        join public.orders order_record on order_record.id = item.order_id
        join public.stalls stall on stall.id = item.stall_id
        left join public.products product on product.id = item.product_id
        left join public.product_categories category on category.id = product.category_id
        left join public.product_groups product_group on product_group.id = product.group_id
        left join public.product_category_translations category_translation
          on category_translation.category_id = category.id and category_translation.locale = ${locale}
        left join public.product_group_translations group_translation
          on group_translation.group_id = product_group.id and group_translation.locale = ${locale}
        where item.organization_id = ${organizationId}::uuid
          and item.stall_id in (${scopedIds})
          and not order_record.is_test
          and order_record.status = 'COMPLETED'::public.order_status
          and public.stall_business_date(stall.id, order_record.completed_at) between ${dateFrom}::date and ${dateTo}::date
        group by item.stall_id, stall.name, category_name, group_name
        order by revenue desc, group_name asc
        limit 500
      `),
      queryHourlySalesReport(database, organizationId, scopedIds, dateFrom, dateTo),
    ]),
  );
  return {
    products: productRows.map((row) => ({
      stallId: row.stall_id,
      stallName: row.stall_name,
      productName: row.product_name,
      quantity: Number(row.quantity),
      revenue: Number(row.revenue),
    })),
    groups: groupRows.map((row) => ({
      stallId: row.stall_id,
      stallName: row.stall_name,
      categoryName: row.category_name,
      groupName: row.group_name,
      quantity: Number(row.quantity),
      revenue: Number(row.revenue),
    })),
    hours: mapHourlyRows(hours),
  };
}

export async function getOrderHistoryReport(
  organizationId: string,
  stallIds: string[],
  dateFrom: string,
  dateTo: string,
) {
  if (stallIds.length === 0) return [];
  const scopedIds = Prisma.join(stallIds.map((id) => Prisma.sql`${id}::uuid`));
  return withDatabaseRead(
    {
      policy: "DR_PREFERRED_EVENTUAL",
      operation: "order_history_report",
      maxLagSeconds: 30,
    },
    async (database) => {
      const rows = await database.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        select order_record.id
        from public.orders order_record
        join public.stalls stall on stall.id = order_record.stall_id
        where order_record.organization_id = ${organizationId}::uuid
          and order_record.stall_id in (${scopedIds})
          and not order_record.is_test
          and public.stall_business_date(stall.id, order_record.created_at) between ${dateFrom}::date and ${dateTo}::date
        order by order_record.created_at desc, order_record.id desc
        limit 1000
      `);
      if (rows.length === 0) return [];
      return queryOrderHistoryRows(database, organizationId, rows.map((row) => row.id));
    },
  );
}

export async function getPaginatedOrderHistoryReport(
  organizationId: string,
  stallIds: string[],
  dateFrom: string,
  dateTo: string,
  request: OperationsPageRequest,
) {
  if (stallIds.length === 0) {
    return { rows: [], pagination: buildOperationsPageMeta(0, request) };
  }
  const scopedIds = Prisma.join(stallIds.map((id) => Prisma.sql`${id}::uuid`));
  return withDatabaseRead(
    {
      policy: "DR_PREFERRED_EVENTUAL",
      operation: "order_history_report_paginated",
      maxLagSeconds: 30,
    },
    async (database) => {
      const [countRow] = await database.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`
        select count(*)::bigint as total
        from public.orders order_record
        join public.stalls stall on stall.id = order_record.stall_id
        where order_record.organization_id = ${organizationId}::uuid
          and order_record.stall_id in (${scopedIds})
          and not order_record.is_test
          and public.stall_business_date(stall.id, order_record.created_at) between ${dateFrom}::date and ${dateTo}::date
      `);
      const pagination = buildOperationsPageMeta(Number(countRow?.total ?? 0), request);
      const offset = (pagination.page - 1) * pagination.pageSize;
      const idRows = await database.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        select order_record.id
        from public.orders order_record
        join public.stalls stall on stall.id = order_record.stall_id
        where order_record.organization_id = ${organizationId}::uuid
          and order_record.stall_id in (${scopedIds})
          and not order_record.is_test
          and public.stall_business_date(stall.id, order_record.created_at) between ${dateFrom}::date and ${dateTo}::date
        order by order_record.created_at desc, order_record.id desc
        limit ${pagination.pageSize}
        offset ${offset}
      `);
      const rows = idRows.length === 0
        ? []
        : await queryOrderHistoryRows(database, organizationId, idRows.map((row) => row.id));
      return { rows, pagination };
    },
  );
}

function queryOrderHistoryRows(database: PrismaClient, organizationId: string, orderIds: string[]) {
  return database.order.findMany({
    where: { organizationId, id: { in: orderIds } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      orderNo: true,
      source: true,
      origin: true,
      customerName: true,
      customerPhone: true,
      fulfillmentType: true,
      tableLabel: true,
      status: true,
      paymentStatus: true,
      subtotal: true,
      discountAmount: true,
      total: true,
      note: true,
      createdAt: true,
      confirmedAt: true,
      completedAt: true,
      cancelledAt: true,
      stall: { select: { id: true, name: true } },
      payment: { select: { methodLabel: true, status: true, paidAt: true } },
      items: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true, name: true, quantity: true, unitPrice: true, note: true },
      },
    },
  });
}

export async function getHourlySalesReport(
  organizationId: string,
  stallIds: string[],
  dateFrom: string,
  dateTo: string,
) {
  if (stallIds.length === 0) return [];
  const scopedIds = Prisma.join(stallIds.map((id) => Prisma.sql`${id}::uuid`));
  const rows = await withDatabaseRead(
    {
      policy: "DR_PREFERRED_EVENTUAL",
      operation: "hourly_sales_report",
      maxLagSeconds: 30,
    },
    (database) => queryHourlySalesReport(database, organizationId, scopedIds, dateFrom, dateTo),
  );
  return mapHourlyRows(rows);
}

function queryHourlySalesReport(
  database: PrismaClient,
  organizationId: string,
  scopedIds: Prisma.Sql,
  dateFrom: string,
  dateTo: string,
) {
  return database.$queryRaw<HourRow[]>(Prisma.sql`
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
      and not order_record.is_test
      and order_record.status = 'COMPLETED'::public.order_status
      and public.stall_business_date(stall.id, order_record.completed_at) between ${dateFrom}::date and ${dateTo}::date
    group by order_record.stall_id, stall.name, sale_hour
    order by sale_hour asc, sales desc
  `);
}

function mapHourlyRows(rows: HourRow[]) {
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
  const rows = await withDatabaseRead(
    {
      policy: "DR_PREFERRED_EVENTUAL",
      operation: "payment_method_report",
      maxLagSeconds: 30,
    },
    (database) => database.$queryRaw<PaymentRow[]>(Prisma.sql`
      select
        payment.stall_id,
        stall.name as stall_name,
        payment.method,
        payment.method_label,
        count(*)::bigint as payment_count,
        sum(payment.amount)::bigint as amount
      from public.payments payment
      join public.orders order_record on order_record.id = payment.order_id
      join public.stalls stall on stall.id = payment.stall_id
      where payment.organization_id = ${organizationId}::uuid
        and payment.stall_id in (${scopedIds})
        and not order_record.is_test
        and payment.status = 'PAID'::public.payment_status
        and public.stall_business_date(stall.id, payment.paid_at) between ${dateFrom}::date and ${dateTo}::date
      group by payment.stall_id, stall.name, payment.method, payment.method_label
      order by amount desc, payment.method_label asc
    `),
  );
  return rows.map((row) => ({
    stallId: row.stall_id,
    stallName: row.stall_name,
    method: row.method,
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
  const rows = await withDatabaseRead(
    {
      policy: "DR_PREFERRED_EVENTUAL",
      operation: "cancellation_reason_report",
      maxLagSeconds: 30,
    },
    (database) => database.$queryRaw<CancellationRow[]>(Prisma.sql`
      select
        order_record.stall_id,
        stall.name as stall_name,
        coalesce(order_record.cancellation_reason::text, 'OTHER') as reason,
        count(*)::bigint as cancellation_count
      from public.orders order_record
      join public.stalls stall on stall.id = order_record.stall_id
      where order_record.organization_id = ${organizationId}::uuid
        and order_record.stall_id in (${scopedIds})
        and not order_record.is_test
        and order_record.status = 'CANCELLED'::public.order_status
        and public.stall_business_date(stall.id, coalesce(order_record.cancelled_at, order_record.updated_at))
          between ${dateFrom}::date and ${dateTo}::date
      group by order_record.stall_id, stall.name, reason
      order by cancellation_count desc, stall.name asc, reason asc
    `),
  );
  return rows.map((row) => ({
    stallId: row.stall_id,
    stallName: row.stall_name,
    reason: row.reason as "SOLD_OUT" | "CUSTOMER_CANCELLED" | "WAIT_TOO_LONG" | "DUPLICATE_ORDER" | "OTHER",
    count: Number(row.cancellation_count),
  }));
}

export async function getCashShiftReport(
  organizationId: string,
  stallIds: string[],
  dateFrom: string,
  dateTo: string,
) {
  if (stallIds.length === 0) return [];
  const scopedIds = Prisma.join(stallIds.map((id) => Prisma.sql`${id}::uuid`));
  const rows = await withDatabaseRead(
    {
      policy: "DR_PREFERRED_EVENTUAL",
      operation: "cash_shift_report",
      maxLagSeconds: 30,
    },
    (database) => queryCashShiftRows(database, organizationId, scopedIds, dateFrom, dateTo),
  );
  return mapCashShiftRows(rows);
}

export async function getPaginatedCashShiftReport(
  organizationId: string,
  stallIds: string[],
  dateFrom: string,
  dateTo: string,
  request: OperationsPageRequest,
) {
  if (stallIds.length === 0) {
    return {
      rows: [],
      pagination: buildOperationsPageMeta(0, request),
      summary: emptyCashShiftSummary(),
    };
  }
  const scopedIds = Prisma.join(stallIds.map((id) => Prisma.sql`${id}::uuid`));
  return withDatabaseRead(
    {
      policy: "DR_PREFERRED_EVENTUAL",
      operation: "cash_shift_report_paginated",
      maxLagSeconds: 30,
    },
    async (database) => {
      const [summaryRow] = await database.$queryRaw<CashShiftSummaryRow[]>(Prisma.sql`
        select
          count(*)::bigint as total,
          coalesce(sum(movement.cash_sales), 0)::bigint as cash_sales,
          coalesce(sum(movement.cash_refunds), 0)::bigint as cash_refunds,
          coalesce(sum(coalesce(
            shift.system_expected_amount,
            shift.opening_amount
              + movement.cash_sales
              + movement.cash_in
              - movement.cash_out
              - movement.cash_refunds
              + movement.corrections
          )), 0)::bigint as expected_amount,
          coalesce(sum(shift.counted_amount), 0)::bigint as actual_amount,
          coalesce(sum(shift.variance_amount), 0)::bigint as difference_amount,
          count(*) filter (where shift.status::text in ('CLOSING', 'REVIEW_REQUIRED'))::bigint as review_required
        from public.cash_shifts shift
        join public.stalls stall on stall.id = shift.stall_id
        left join lateral (
          select
            coalesce(sum(entry.amount) filter (where entry.type = 'CASH_SALE'::public.cash_movement_type), 0)::bigint as cash_sales,
            coalesce(sum(entry.amount) filter (where entry.type = 'CASH_REFUND'::public.cash_movement_type), 0)::bigint as cash_refunds,
            coalesce(sum(entry.amount) filter (where entry.type = 'CASH_IN'::public.cash_movement_type), 0)::bigint as cash_in,
            coalesce(sum(entry.amount) filter (where entry.type = 'CASH_OUT'::public.cash_movement_type), 0)::bigint as cash_out,
            coalesce(sum(entry.amount) filter (where entry.type = 'CORRECTION'::public.cash_movement_type), 0)::bigint as corrections
          from public.cash_movements entry
          where entry.cash_shift_id = shift.id
        ) movement on true
        where shift.organization_id = ${organizationId}::uuid
          and shift.stall_id in (${scopedIds})
          and public.stall_business_date(stall.id, shift.opened_at) between ${dateFrom}::date and ${dateTo}::date
      `);
      const total = Number(summaryRow?.total ?? 0);
      const pagination = buildOperationsPageMeta(total, request);
      const offset = (pagination.page - 1) * pagination.pageSize;
      const rows = await queryCashShiftRows(
        database,
        organizationId,
        scopedIds,
        dateFrom,
        dateTo,
        { limit: pagination.pageSize, offset },
      );
      return {
        rows: mapCashShiftRows(rows),
        pagination,
        summary: summaryRow ? mapCashShiftSummary(summaryRow) : emptyCashShiftSummary(),
      };
    },
  );
}

function queryCashShiftRows(
  database: PrismaClient,
  organizationId: string,
  scopedIds: Prisma.Sql,
  dateFrom: string,
  dateTo: string,
  pagination?: { limit: number; offset: number },
) {
  const paginationSql = pagination
    ? Prisma.sql`limit ${pagination.limit} offset ${pagination.offset}`
    : Prisma.sql`limit 1000`;
  return database.$queryRaw<CashShiftRow[]>(Prisma.sql`
    select
      shift.id,
      shift.stall_id,
      stall.name as stall_name,
      shift.status::text as status,
      opener.display_name as opened_by_name,
      closer.display_name as closed_by_name,
      shift.opened_at,
      shift.closed_at,
      shift.opening_amount::bigint as opening_amount,
      movement.cash_sales,
      movement.cash_refunds,
      movement.cash_in,
      movement.cash_out,
      movement.corrections,
      coalesce(
        shift.system_expected_amount,
        shift.opening_amount
          + movement.cash_sales
          + movement.cash_in
          - movement.cash_out
          - movement.cash_refunds
          + movement.corrections
      )::bigint as expected_amount,
      shift.counted_amount::bigint as actual_amount,
      shift.variance_amount::bigint as difference_amount,
      latest_review.decision::text as latest_review_decision,
      latest_reviewer.display_name as latest_reviewer_name
    from public.cash_shifts shift
    join public.stalls stall on stall.id = shift.stall_id
    join public.profiles opener on opener.id = shift.opened_by
    left join public.profiles closer on closer.id = shift.closed_by
    left join lateral (
      select
        coalesce(sum(entry.amount) filter (where entry.type = 'CASH_SALE'::public.cash_movement_type), 0)::bigint as cash_sales,
        coalesce(sum(entry.amount) filter (where entry.type = 'CASH_REFUND'::public.cash_movement_type), 0)::bigint as cash_refunds,
        coalesce(sum(entry.amount) filter (where entry.type = 'CASH_IN'::public.cash_movement_type), 0)::bigint as cash_in,
        coalesce(sum(entry.amount) filter (where entry.type = 'CASH_OUT'::public.cash_movement_type), 0)::bigint as cash_out,
        coalesce(sum(entry.amount) filter (where entry.type = 'CORRECTION'::public.cash_movement_type), 0)::bigint as corrections
      from public.cash_movements entry
      where entry.cash_shift_id = shift.id
    ) movement on true
    left join lateral (
      select review.decision, review.reviewed_by_profile_id
      from public.cash_shift_reviews review
      where review.cash_shift_id = shift.id
      order by review.reviewed_at desc
      limit 1
    ) latest_review on true
    left join public.profiles latest_reviewer on latest_reviewer.id = latest_review.reviewed_by_profile_id
    where shift.organization_id = ${organizationId}::uuid
      and shift.stall_id in (${scopedIds})
      and public.stall_business_date(stall.id, shift.opened_at) between ${dateFrom}::date and ${dateTo}::date
    order by shift.opened_at desc
    ${paginationSql}
  `);
}

function mapCashShiftRows(rows: CashShiftRow[]) {
  return rows.map((row) => ({
    id: row.id,
    stallId: row.stall_id,
    stallName: row.stall_name,
    status: row.status as "OPEN" | "CLOSING" | "REVIEW_REQUIRED" | "CLOSED",
    openedByName: row.opened_by_name,
    closedByName: row.closed_by_name,
    openedAt: row.opened_at,
    closedAt: row.closed_at,
    openingAmount: Number(row.opening_amount),
    cashSales: Number(row.cash_sales),
    cashRefunds: Number(row.cash_refunds),
    cashIn: Number(row.cash_in),
    cashOut: Number(row.cash_out),
    corrections: Number(row.corrections),
    expectedAmount: Number(row.expected_amount),
    actualAmount: row.actual_amount === null ? null : Number(row.actual_amount),
    differenceAmount: row.difference_amount === null ? null : Number(row.difference_amount),
    latestReviewDecision: row.latest_review_decision as "APPROVED" | "REJECTED" | "ADJUSTMENT_REQUIRED" | null,
    latestReviewerName: row.latest_reviewer_name,
  }));
}

function mapCashShiftSummary(row: CashShiftSummaryRow) {
  return {
    cashSales: Number(row.cash_sales),
    cashRefunds: Number(row.cash_refunds),
    expected: Number(row.expected_amount),
    actual: Number(row.actual_amount),
    difference: Number(row.difference_amount),
    reviewRequired: Number(row.review_required),
  };
}

function emptyCashShiftSummary() {
  return { cashSales: 0, cashRefunds: 0, expected: 0, actual: 0, difference: 0, reviewRequired: 0 };
}
