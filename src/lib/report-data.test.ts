import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  orderFindMany: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/server/database/read-router", () => ({
  withDatabaseRead: vi.fn(async (_policy, operation) => operation({
    $queryRaw: mocks.queryRaw,
    order: { findMany: mocks.orderFindMany },
  })),
}));

import { getOrderHistoryReport, getPaymentMethodReport, getProductAndHourlyReport, sumPaidAmountByMethod } from "@/lib/report-data";

describe("payment report accounting date", () => {
  beforeEach(() => {
    mocks.queryRaw.mockReset();
    mocks.orderFindMany.mockReset();
  });

  it("groups actual receipts by paid-at business date and retains the payment method", async () => {
    mocks.queryRaw.mockResolvedValueOnce([{
      stall_id: "stall-1",
      stall_name: "越好吃一中店",
      method: "CASH",
      method_label: "現金",
      payment_count: BigInt(2),
      amount: BigInt(520),
    }]);

    await expect(getPaymentMethodReport(
      "organization-1",
      ["stall-1"],
      "2026-08-13",
      "2026-08-13",
    )).resolves.toEqual([{
      stallId: "stall-1",
      stallName: "越好吃一中店",
      method: "CASH",
      methodLabel: "現金",
      paymentCount: 2,
      amount: 520,
    }]);

    const query = mocks.queryRaw.mock.calls[0]?.[0] as { strings: string[] };
    const sql = query.strings.join(" ");
    expect(sql).toContain("payment.paid_at");
    expect(sql).toContain("payment.method");
  });

  it("sums only actual cash receipts for the scheduled report", () => {
    expect(sumPaidAmountByMethod([
      { method: "CASH", amount: 300 },
      { method: "MANUAL_TRANSFER", amount: 200 },
      { method: "CASH", amount: -50 },
    ], "CASH")).toBe(250);
  });

  it("aggregates completed sales by localized product group", async () => {
    mocks.queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        stall_id: "stall-1",
        stall_name: "越好吃一中店",
        category_name: "Noodles",
        group_name: "Beef pho",
        quantity: BigInt(3),
        revenue: BigInt(450),
      }])
      .mockResolvedValueOnce([]);

    const report = await getProductAndHourlyReport(
      "organization-1",
      ["stall-1"],
      "2026-08-23",
      "2026-08-23",
      "en",
      "Ungrouped",
    );

    expect(report.groups).toEqual([{
      stallId: "stall-1",
      stallName: "越好吃一中店",
      categoryName: "Noodles",
      groupName: "Beef pho",
      quantity: 3,
      revenue: 450,
    }]);
    const sql = (mocks.queryRaw.mock.calls[1]?.[0] as { strings: string[] }).strings.join(" ");
    expect(sql).toContain("product_group_translations");
    expect(sql).toContain("order_record.completed_at");
  });

  it("queries all order statuses by order-entry business date", async () => {
    mocks.queryRaw.mockResolvedValueOnce([{ id: "order-1" }]);
    mocks.orderFindMany.mockResolvedValueOnce([{ id: "order-1", orderNo: "001" }]);

    await expect(getOrderHistoryReport(
      "organization-1",
      ["stall-1"],
      "2026-08-01",
      "2026-08-23",
    )).resolves.toEqual([{ id: "order-1", orderNo: "001" }]);

    const sql = (mocks.queryRaw.mock.calls[0]?.[0] as { strings: string[] }).strings.join(" ");
    expect(sql).toContain("order_record.created_at");
    expect(sql).not.toContain("order_record.status =");
  });
});
