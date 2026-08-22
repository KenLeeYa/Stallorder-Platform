import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, transactionMock } = vi.hoisted(() => {
  const transaction = {
    subscription: {
      findUnique: vi.fn(),
    },
    $queryRaw: vi.fn(),
  };
  return {
    transactionMock: transaction,
    prismaMock: {
      $transaction: vi.fn(async (operation: (client: typeof transaction) => Promise<unknown>) => operation(transaction)),
    },
  };
});

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

import { BillingWorkflowService, billingTransactionOptions } from "./billing-workflow-service";

describe("BillingWorkflowService.rebuildUsageSummary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    transactionMock.subscription.findUnique.mockResolvedValue({ organizationId: "77777777-7777-4777-8777-777777777703" });
    transactionMock.$queryRaw
      .mockResolvedValueOnce([{ billable_order_count: 2_200 }])
      .mockResolvedValueOnce([{ warnings_created: 4 }])
      .mockResolvedValueOnce([{ rebuilt_stalls: 2 }]);
  });

  it("returns a scalar usage count and reconciles warnings in the same transaction", async () => {
    const result = await new BillingWorkflowService().rebuildUsageSummary(
      "77777777-7777-4777-8777-777777777705",
      new Date("2026-07-01T00:00:00.000Z"),
      {
        actorProfileId: "77777777-7777-4777-8777-777777777702",
        requestId: "staging-usage-rebuild-test",
      },
    );

    expect(result).toBe(2_200);
    expect(transactionMock.$queryRaw).toHaveBeenCalledTimes(3);
    expect(transactionMock.$queryRaw.mock.calls[2]?.[0].join(" "))
      .toContain("rebuild_payg_stall_usage_summaries");
    expect(prismaMock.$transaction).toHaveBeenCalledWith(expect.any(Function), billingTransactionOptions);
  });
});
