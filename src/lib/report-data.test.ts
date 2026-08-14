import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/server/database/read-router", () => ({
  withDatabaseRead: vi.fn(async (_policy, operation) => operation({
    $queryRaw: mocks.queryRaw,
  })),
}));

import { getPaymentMethodReport, sumPaidAmountByMethod } from "@/lib/report-data";

describe("payment report accounting date", () => {
  beforeEach(() => {
    mocks.queryRaw.mockReset();
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
});
