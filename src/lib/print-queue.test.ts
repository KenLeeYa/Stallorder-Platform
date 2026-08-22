import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getPrintQueueState,
  printQueueCommandSchema,
  reconcileStalePrintJobs,
} from "@/lib/print-queue";

const mocks = vi.hoisted(() => ({
  printJobUpdateMany: vi.fn(),
  settingsFindFirst: vi.fn(),
  printerFindMany: vi.fn(),
  printRuleFindMany: vi.fn(),
  printJobFindMany: vi.fn(),
  categoryFindMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    stallOrderingSettings: { findFirst: mocks.settingsFindFirst },
    printer: { findMany: mocks.printerFindMany },
    printRule: { findMany: mocks.printRuleFindMany },
    printJob: {
      findMany: mocks.printJobFindMany,
      updateMany: mocks.printJobUpdateMany,
    },
    productCategory: { findMany: mocks.categoryFindMany },
  },
}));

const printerId = "44444444-4444-4444-8444-444444444444";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.settingsFindFirst.mockResolvedValue({ printModuleEnabled: true });
  mocks.printerFindMany.mockResolvedValue([]);
  mocks.printRuleFindMany.mockResolvedValue([]);
  mocks.printJobFindMany.mockResolvedValue([]);
  mocks.categoryFindMany.mockResolvedValue([]);
  mocks.printJobUpdateMany.mockResolvedValue({ count: 1 });
});

describe("integrated print center commands", () => {
  it("accepts an explicit CSRF-protected queue refresh command", () => {
    expect(printQueueCommandSchema.parse({ operation: "REFRESH" })).toEqual({ operation: "REFRESH" });
  });

  it("defaults a newly registered iPad printer to MCP31LB Bluetooth and 57–58 mm", () => {
    expect(printQueueCommandSchema.parse({ operation: "REGISTER_PRINTER", name: "櫃台" })).toEqual({
      operation: "REGISTER_PRINTER",
      name: "櫃台",
      connectionType: "WEBPRNT_BLUETOOTH",
      model: "MCP31LB",
      paperWidthMm: 58,
    });
  });

  it("accepts a common kitchen routing rule", () => {
    const parsed = printQueueCommandSchema.safeParse({
      operation: "CREATE_RULE",
      rule: kitchenRule(),
    });

    expect(parsed.success).toBe(true);
  });

  it("rejects partial or split customer receipts to protect total accuracy", () => {
    const scoped = printQueueCommandSchema.safeParse({
      operation: "CREATE_RULE",
      rule: {
        ...kitchenRule(),
        documentType: "CUSTOMER_RECEIPT",
        trigger: "PAYMENT_COMPLETED",
        splitMode: "CATEGORY",
        productGroupIds: ["55555555-5555-4555-8555-555555555555"],
      },
    });

    expect(scoped.success).toBe(false);
    if (!scoped.success) {
      expect(scoped.error.issues.map((issue) => issue.message)).toEqual(expect.arrayContaining([
        "顧客明細不可依品項切單。",
        "顧客明細必須包含完整訂單。",
      ]));
    }
  });
});

describe("print queue query and reconciliation boundaries", () => {
  it("keeps queue state reads free of database writes", async () => {
    await getPrintQueueState(
      "22222222-2222-4222-8222-222222222222",
      "11111111-1111-4111-8111-111111111111",
    );

    expect(mocks.printJobUpdateMany).not.toHaveBeenCalled();
    expect(mocks.printRuleFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        stallId: "22222222-2222-4222-8222-222222222222",
        organizationId: "11111111-1111-4111-8111-111111111111",
        deletedAt: null,
      },
    }));
  });

  it("reconciles stale jobs only through the explicit command helper", async () => {
    await reconcileStalePrintJobs(
      "22222222-2222-4222-8222-222222222222",
      "11111111-1111-4111-8111-111111111111",
    );

    expect(mocks.printJobUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: "11111111-1111-4111-8111-111111111111",
        stallId: "22222222-2222-4222-8222-222222222222",
        status: "PRINTING",
      }),
      data: {
        status: "FAILED",
        lastError: "PRINT_RESULT_UNKNOWN",
        nextRetryAt: null,
      },
    }));
  });
});

function kitchenRule() {
  return {
    name: "熱食工作站",
    printerId,
    isEnabled: true,
    documentType: "KITCHEN_TICKET",
    trigger: "ORDER_CONFIRMED",
    orderSources: ["QR_MENU", "STAFF_POS"],
    orderOrigins: [],
    fulfillmentTypes: ["TAKEOUT", "DINE_IN", "DELIVERY"],
    productCategoryIds: [],
    productGroupIds: [],
    copies: 1,
    fontScale: 1,
    splitMode: "CATEGORY",
    aggregateItems: true,
    autoPrint: true,
    sortOrder: 0,
  };
}
