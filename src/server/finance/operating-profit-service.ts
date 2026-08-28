import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { OperatingExpenseCommand } from "@/server/finance/operating-profit-contract";

type SummaryRow = { order_count: bigint; net_sales: bigint; discount_amount: bigint };
type CashRow = { cash_collected: bigint };
type CostRow = { theoretical_cogs: bigint; sold_products: bigint; missing_recipe_products: bigint };
type PayrollRow = { payroll_cost: bigint };
type PurchaseRow = { purchase_spend: bigint; shared_purchase_spend: bigint };
type WasteRow = { waste_cost: bigint };
type InventoryRow = { inventory_value: bigint; negative_balances: bigint; lot_coverage_gaps: bigint };
type FreshnessRow = { expiring_lots: bigint; expired_lots: bigint };
type ProductMarginRow = {
  product_id: string | null;
  product_name: string;
  quantity: bigint;
  revenue: bigint;
  estimated_cost: bigint;
};
type DailyRow = { business_date: Date; net_sales: bigint };

export class OperatingProfitError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "OperatingProfitError";
  }
}

export async function getOperatingProfitDashboard(input: {
  organizationId: string;
  stallIds: string[];
  dateFrom: string;
  dateTo: string;
}) {
  assertDateRange(input.dateFrom, input.dateTo);
  if (!input.stallIds.length) return emptyDashboard(input.dateFrom, input.dateTo);
  const scopedIds = Prisma.join(input.stallIds.map((id) => Prisma.sql`${id}::uuid`));
  const fromDate = new Date(`${input.dateFrom}T00:00:00.000Z`);
  const dayAfterTo = new Date(`${input.dateTo}T00:00:00.000Z`);
  dayAfterTo.setUTCDate(dayAfterTo.getUTCDate() + 1);

  const [
    summaryRows,
    cashRows,
    costRows,
    payrollRows,
    purchaseRows,
    wasteRows,
    inventoryRows,
    freshnessRows,
    productMargins,
    dailyRows,
    expenses,
    payrollDraftCount,
    stalls,
  ] = await Promise.all([
    prisma.$queryRaw<SummaryRow[]>(Prisma.sql`
      select
        count(*)::bigint as order_count,
        coalesce(sum(order_record.total), 0)::bigint as net_sales,
        coalesce(sum(order_record.discount_amount), 0)::bigint as discount_amount
      from public.orders order_record
      join public.stalls stall on stall.id = order_record.stall_id
      where order_record.organization_id = ${input.organizationId}::uuid
        and order_record.stall_id in (${scopedIds})
        and not order_record.is_test
        and order_record.status = 'COMPLETED'::public.order_status
        and public.stall_business_date(stall.id, order_record.completed_at)
          between ${input.dateFrom}::date and ${input.dateTo}::date
    `),
    prisma.$queryRaw<CashRow[]>(Prisma.sql`
      select coalesce(sum(payment_record.amount), 0)::bigint as cash_collected
      from public.payments payment_record
      join public.stalls stall on stall.id = payment_record.stall_id
      where payment_record.organization_id = ${input.organizationId}::uuid
        and payment_record.stall_id in (${scopedIds})
        and payment_record.status = 'PAID'::public.payment_status
        and public.stall_business_date(stall.id, payment_record.paid_at)
          between ${input.dateFrom}::date and ${input.dateTo}::date
    `),
    prisma.$queryRaw<CostRow[]>(Prisma.sql`
      with ingredient_cost as (
        select
          ingredient_id,
          coalesce(
            sum(greatest(quantity_micros, 0)::numeric * average_unit_cost_micros::numeric)
              / nullif(sum(greatest(quantity_micros, 0)), 0),
            0
          ) as average_cost_micros
        from public.supply_inventory_balances
        where organization_id = ${input.organizationId}::uuid
        group by ingredient_id
      ), recipe_cost as (
        select
          component.product_id,
          sum(
            component.quantity_micros::numeric
            * (10000 + component.waste_basis_points)::numeric / 10000
            * coalesce(ingredient_cost.average_cost_micros, 0)
            / 1000000000000
          ) as cost_amount
        from public.supply_recipe_components component
        left join ingredient_cost on ingredient_cost.ingredient_id = component.ingredient_id
        where component.organization_id = ${input.organizationId}::uuid
        group by component.product_id
      ), sold as (
        select item.product_id, sum(item.quantity)::bigint as quantity
        from public.order_items item
        join public.orders order_record on order_record.id = item.order_id
        join public.stalls stall on stall.id = item.stall_id
        where item.organization_id = ${input.organizationId}::uuid
          and item.stall_id in (${scopedIds})
          and not order_record.is_test
          and order_record.status = 'COMPLETED'::public.order_status
          and public.stall_business_date(stall.id, order_record.completed_at)
            between ${input.dateFrom}::date and ${input.dateTo}::date
        group by item.product_id
      )
      select
        coalesce(round(sum(sold.quantity * coalesce(recipe_cost.cost_amount, 0))), 0)::bigint as theoretical_cogs,
        count(*)::bigint as sold_products,
        count(*) filter (where sold.product_id is null or recipe_cost.product_id is null)::bigint as missing_recipe_products
      from sold
      left join recipe_cost on recipe_cost.product_id = sold.product_id
    `),
    prisma.$queryRaw<PayrollRow[]>(Prisma.sql`
      select coalesce(round(sum(
        case
          when (shift_record ->> 'stallId')::uuid in (${scopedIds})
            then (shift_record ->> 'grossAmount')::numeric
          else 0
        end
      )), 0)::bigint as payroll_cost
      from public.workforce_payroll_lines line
      join public.workforce_payroll_periods period on period.id = line.payroll_period_id
      cross join lateral jsonb_array_elements(line.calculation_snapshot -> 'shifts') shift_record
      where line.organization_id = ${input.organizationId}::uuid
        and period.status = 'FINALIZED'
        and period.period_start >= ${input.dateFrom}::date
        and period.period_end <= ${input.dateTo}::date
    `),
    prisma.$queryRaw<PurchaseRow[]>(Prisma.sql`
      select
        coalesce(sum(total_amount), 0)::bigint as purchase_spend,
        coalesce(sum(total_amount) filter (where stall_id is null), 0)::bigint as shared_purchase_spend
      from public.supply_purchase_orders
      where organization_id = ${input.organizationId}::uuid
        and (stall_id is null or stall_id in (${scopedIds}))
        and status in ('PARTIAL', 'RECEIVED')
        and ordered_on between ${input.dateFrom}::date and ${input.dateTo}::date
    `),
    prisma.$queryRaw<WasteRow[]>(Prisma.sql`
      select coalesce(round(sum(
        abs(movement.quantity_delta_micros)::numeric
        * coalesce(movement.unit_cost_micros, balance.average_unit_cost_micros, 0)::numeric
        / 1000000000000
      )), 0)::bigint as waste_cost
      from public.supply_inventory_movements movement
      join public.supply_locations location
        on location.id = movement.location_id
       and location.organization_id = movement.organization_id
      left join public.supply_inventory_balances balance
        on balance.organization_id = movement.organization_id
       and balance.ingredient_id = movement.ingredient_id
       and balance.location_id = movement.location_id
      where movement.organization_id = ${input.organizationId}::uuid
        and movement.movement_type = 'WASTE'
        and (location.stall_id is null or location.stall_id in (${scopedIds}))
        and (movement.created_at at time zone 'Asia/Taipei')::date
          between ${input.dateFrom}::date and ${input.dateTo}::date
    `),
    prisma.$queryRaw<InventoryRow[]>(Prisma.sql`
      select
        coalesce(round(sum(
          greatest(balance.quantity_micros, 0)::numeric * balance.average_unit_cost_micros::numeric / 1000000000000
        )), 0)::bigint as inventory_value,
        count(*) filter (where balance.quantity_micros < 0)::bigint as negative_balances,
        count(*) filter (
          where ingredient.track_expiry
            and greatest(balance.quantity_micros, 0) <> coalesce(lot_balance.remaining_quantity_micros, 0)
        )::bigint as lot_coverage_gaps
      from public.supply_inventory_balances balance
      join public.supply_locations location
        on location.id = balance.location_id
       and location.organization_id = balance.organization_id
      join public.supply_ingredients ingredient
        on ingredient.id = balance.ingredient_id
       and ingredient.organization_id = balance.organization_id
      left join lateral (
        select coalesce(sum(lot.remaining_quantity_micros), 0)::bigint as remaining_quantity_micros
        from public.supply_inventory_lots lot
        where lot.organization_id = balance.organization_id
          and lot.ingredient_id = balance.ingredient_id
          and lot.location_id = balance.location_id
          and lot.remaining_quantity_micros > 0
          and lot.status in ('AVAILABLE', 'QUARANTINED')
      ) lot_balance on true
      where balance.organization_id = ${input.organizationId}::uuid
        and (location.stall_id is null or location.stall_id in (${scopedIds}))
    `),
    prisma.$queryRaw<FreshnessRow[]>(Prisma.sql`
      select
        count(*) filter (
          where expires_on >= current_date and expires_on <= current_date + 7
        )::bigint as expiring_lots,
        count(*) filter (where expires_on < current_date)::bigint as expired_lots
      from public.supply_inventory_lots lot
      join public.supply_locations location
        on location.id = lot.location_id
       and location.organization_id = lot.organization_id
      where lot.organization_id = ${input.organizationId}::uuid
        and (location.stall_id is null or location.stall_id in (${scopedIds}))
        and lot.remaining_quantity_micros > 0
        and lot.status in ('AVAILABLE', 'QUARANTINED')
    `),
    prisma.$queryRaw<ProductMarginRow[]>(Prisma.sql`
      with ingredient_cost as (
        select ingredient_id,
          coalesce(
            sum(greatest(quantity_micros, 0)::numeric * average_unit_cost_micros::numeric)
              / nullif(sum(greatest(quantity_micros, 0)), 0),
            0
          ) as average_cost_micros
        from public.supply_inventory_balances
        where organization_id = ${input.organizationId}::uuid
        group by ingredient_id
      ), recipe_cost as (
        select component.product_id,
          sum(
            component.quantity_micros::numeric
            * (10000 + component.waste_basis_points)::numeric / 10000
            * coalesce(ingredient_cost.average_cost_micros, 0)
            / 1000000000000
          ) as cost_amount
        from public.supply_recipe_components component
        left join ingredient_cost on ingredient_cost.ingredient_id = component.ingredient_id
        where component.organization_id = ${input.organizationId}::uuid
        group by component.product_id
      )
      select
        item.product_id,
        item.name as product_name,
        sum(item.quantity)::bigint as quantity,
        sum(item.quantity * item.unit_price)::bigint as revenue,
        coalesce(round(sum(item.quantity * coalesce(recipe_cost.cost_amount, 0))), 0)::bigint as estimated_cost
      from public.order_items item
      join public.orders order_record on order_record.id = item.order_id
      join public.stalls stall on stall.id = item.stall_id
      left join recipe_cost on recipe_cost.product_id = item.product_id
      where item.organization_id = ${input.organizationId}::uuid
        and item.stall_id in (${scopedIds})
        and not order_record.is_test
        and order_record.status = 'COMPLETED'::public.order_status
        and public.stall_business_date(stall.id, order_record.completed_at)
          between ${input.dateFrom}::date and ${input.dateTo}::date
      group by item.product_id, item.name
      order by revenue desc, item.name asc
      limit 100
    `),
    prisma.$queryRaw<DailyRow[]>(Prisma.sql`
      select
        public.stall_business_date(stall.id, order_record.completed_at) as business_date,
        sum(order_record.total)::bigint as net_sales
      from public.orders order_record
      join public.stalls stall on stall.id = order_record.stall_id
      where order_record.organization_id = ${input.organizationId}::uuid
        and order_record.stall_id in (${scopedIds})
        and not order_record.is_test
        and order_record.status = 'COMPLETED'::public.order_status
        and public.stall_business_date(stall.id, order_record.completed_at)
          between ${input.dateFrom}::date and ${input.dateTo}::date
      group by business_date
      order by business_date asc
    `),
    prisma.operatingExpense.findMany({
      where: {
        organizationId: input.organizationId,
        OR: [{ stallId: null }, { stallId: { in: input.stallIds } }],
        expenseDate: { gte: fromDate, lt: dayAfterTo },
      },
      orderBy: [{ expenseDate: "desc" }, { createdAt: "desc" }],
      take: 2_000,
    }),
    prisma.workforcePayrollPeriod.count({
      where: {
        organizationId: input.organizationId,
        status: "DRAFT",
        periodStart: { lte: new Date(`${input.dateTo}T00:00:00.000Z`) },
        periodEnd: { gte: fromDate },
      },
    }),
    prisma.stall.findMany({
      where: { organizationId: input.organizationId, id: { in: input.stallIds } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const summary = summaryRows[0] ?? { order_count: BigInt(0), net_sales: BigInt(0), discount_amount: BigInt(0) };
  const netSales = Number(summary.net_sales);
  const cashCollected = Number(cashRows[0]?.cash_collected ?? 0);
  const theoreticalCogs = Number(costRows[0]?.theoretical_cogs ?? 0);
  const payrollCost = Number(payrollRows[0]?.payroll_cost ?? 0);
  const purchaseSpend = Number(purchaseRows[0]?.purchase_spend ?? 0);
  const sharedPurchaseSpend = Number(purchaseRows[0]?.shared_purchase_spend ?? 0);
  const operatingExpenseAmount = expenses.reduce((sum, expense) => sum + expense.amount, 0);
  const sharedOperatingExpenseAmount = expenses
    .filter((expense) => expense.stallId === null)
    .reduce((sum, expense) => sum + expense.amount, 0);
  const grossProfit = netSales - theoreticalCogs;
  const operatingProfit = grossProfit - payrollCost - operatingExpenseAmount;
  const netCashMovement = cashCollected - purchaseSpend - payrollCost - operatingExpenseAmount;
  const expenseByCategory = new Map<string, number>();
  for (const expense of expenses) {
    expenseByCategory.set(expense.category, (expenseByCategory.get(expense.category) ?? 0) + expense.amount);
  }

  return {
    dateFrom: input.dateFrom,
    dateTo: input.dateTo,
    stalls,
    summary: {
      orderCount: Number(summary.order_count),
      netSales,
      cashCollected,
      discountAmount: Number(summary.discount_amount),
      theoreticalCogs,
      grossProfit,
      grossMarginBasisPoints: ratio(grossProfit, netSales),
      payrollCost,
      laborCostBasisPoints: ratio(payrollCost, netSales),
      primeCost: theoreticalCogs + payrollCost,
      primeCostBasisPoints: ratio(theoreticalCogs + payrollCost, netSales),
      operatingExpenseAmount,
      operatingProfit,
      operatingProfitBasisPoints: ratio(operatingProfit, netSales),
      purchaseSpend,
      sharedPurchaseSpend,
      sharedOperatingExpenseAmount,
      netCashMovement,
      wasteCost: Number(wasteRows[0]?.waste_cost ?? 0),
      inventoryValue: Number(inventoryRows[0]?.inventory_value ?? 0),
    },
    dataQuality: {
      soldProducts: Number(costRows[0]?.sold_products ?? 0),
      missingRecipeProducts: Number(costRows[0]?.missing_recipe_products ?? 0),
      pendingPayrollPeriods: payrollDraftCount,
      negativeInventoryBalances: Number(inventoryRows[0]?.negative_balances ?? 0),
      lotCoverageGaps: Number(inventoryRows[0]?.lot_coverage_gaps ?? 0),
      expiringLots: Number(freshnessRows[0]?.expiring_lots ?? 0),
      expiredLots: Number(freshnessRows[0]?.expired_lots ?? 0),
    },
    productMargins: productMargins.map((row) => {
      const revenue = Number(row.revenue);
      const estimatedCost = Number(row.estimated_cost);
      return {
        productId: row.product_id,
        productName: row.product_name,
        quantity: Number(row.quantity),
        revenue,
        estimatedCost,
        grossProfit: revenue - estimatedCost,
        grossMarginBasisPoints: ratio(revenue - estimatedCost, revenue),
      };
    }),
    dailySales: dailyRows.map((row) => ({
      businessDate: row.business_date.toISOString().slice(0, 10),
      netSales: Number(row.net_sales),
    })),
    expenseCategories: [...expenseByCategory.entries()]
      .map(([category, amount]) => ({ category, amount }))
      .sort((left, right) => right.amount - left.amount),
    expenses: expenses.map((expense) => ({
      id: expense.id,
      stallId: expense.stallId,
      expenseDate: expense.expenseDate.toISOString().slice(0, 10),
      category: expense.category,
      amount: expense.amount,
      vendorName: expense.vendorName,
      description: expense.description,
      isRecurring: expense.isRecurring,
    })),
  };
}

export async function createOperatingExpense(input: {
  organizationId: string;
  actorProfileId: string;
  command: OperatingExpenseCommand;
}) {
  if (input.command.stallId) {
    const stall = await prisma.stall.findFirst({
      where: { id: input.command.stallId, organizationId: input.organizationId, isActive: true },
      select: { id: true },
    });
    if (!stall) throw new OperatingProfitError("OPERATING_EXPENSE_STALL_NOT_FOUND");
  }
  return prisma.operatingExpense.create({
    data: {
      organizationId: input.organizationId,
      stallId: input.command.stallId ?? null,
      expenseDate: new Date(`${input.command.expenseDate}T00:00:00.000Z`),
      category: input.command.category,
      amount: input.command.amount,
      vendorName: input.command.vendorName ?? null,
      description: input.command.description,
      isRecurring: input.command.isRecurring,
      createdByProfileId: input.actorProfileId,
    },
  });
}

function ratio(value: number, denominator: number) {
  return denominator > 0 ? Math.round(value * 10_000 / denominator) : 0;
}

function assertDateRange(dateFrom: string, dateTo: string) {
  const from = new Date(`${dateFrom}T00:00:00.000Z`);
  const to = new Date(`${dateTo}T00:00:00.000Z`);
  const days = Math.floor((to.getTime() - from.getTime()) / 86_400_000) + 1;
  if (Number.isNaN(days) || days < 1 || days > 366) {
    throw new OperatingProfitError("OPERATING_PROFIT_DATE_RANGE_INVALID");
  }
}

function emptyDashboard(dateFrom: string, dateTo: string) {
  return {
    dateFrom,
    dateTo,
    stalls: [],
    summary: {
      orderCount: 0, netSales: 0, cashCollected: 0, discountAmount: 0,
      theoreticalCogs: 0, grossProfit: 0, grossMarginBasisPoints: 0,
      payrollCost: 0, laborCostBasisPoints: 0, primeCost: 0, primeCostBasisPoints: 0,
      operatingExpenseAmount: 0, operatingProfit: 0, operatingProfitBasisPoints: 0,
      purchaseSpend: 0, sharedPurchaseSpend: 0, sharedOperatingExpenseAmount: 0,
      netCashMovement: 0, wasteCost: 0, inventoryValue: 0,
    },
    dataQuality: {
      soldProducts: 0, missingRecipeProducts: 0, pendingPayrollPeriods: 0,
      negativeInventoryBalances: 0, lotCoverageGaps: 0, expiringLots: 0, expiredLots: 0,
    },
    productMargins: [],
    dailySales: [],
    expenseCategories: [],
    expenses: [],
  };
}
