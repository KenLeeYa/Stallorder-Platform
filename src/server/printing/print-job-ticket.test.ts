import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateMany: vi.fn(),
  update: vi.fn(),
  findUnique: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    printJob: {
      updateMany: mocks.updateMany,
      update: mocks.update,
      findUnique: mocks.findUnique,
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.updateMany.mockResolvedValue({ count: 1 });
});

describe("print rule ticket resolution", () => {
  it("filters by product group, aggregates identical items, and freezes compact copies", async () => {
    const { resolvePrintJobTicketPayload } = await import("./print-job-ticket");
    const payload = await resolvePrintJobTicketPayload(job({
      copies: 2,
      productGroupIds: ["group-hot"],
      splitMode: "NONE",
      aggregateItems: true,
    }) as never);

    expect(payload.content).toContain("3× 牛肉湯河粉");
    expect(payload.content).not.toContain("冰紅茶");
    expect(countSequence(Buffer.from(payload.dataBase64, "base64"), Buffer.from([0x1b, 0x64, 0x02]))).toBe(2);
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ templateVersion: "kitchen-starprnt-v2" }),
    }));
  });

  it("cuts one ticket per selected category", async () => {
    const { resolvePrintJobTicketPayload } = await import("./print-job-ticket");
    const payload = await resolvePrintJobTicketPayload(job({ splitMode: "CATEGORY" }) as never);
    const bytes = Buffer.from(payload.dataBase64, "base64");

    expect(payload.content).toContain("分單：主餐");
    expect(payload.content).toContain("分單：飲料");
    expect(countSequence(bytes, Buffer.from([0x1b, 0x64, 0x02]))).toBe(2);
  });
});

function job(overrides: {
  copies?: number;
  productGroupIds?: string[];
  splitMode?: "NONE" | "CATEGORY" | "PRODUCT" | "ITEM";
  aggregateItems?: boolean;
}) {
  const common = {
    note: null,
    noteOptions: [{ id: "note-1", optionName: "加麵" }],
  };
  return {
    id: "55555555-5555-4555-8555-555555555555",
    reprintOfId: null,
    payload: null,
    copies: overrides.copies ?? 1,
    documentType: "KITCHEN_TICKET",
    printer: { paperWidthMm: 58 },
    printRule: {
      productCategoryIds: [],
      productGroupIds: overrides.productGroupIds ?? [],
      fontScale: 1,
      splitMode: overrides.splitMode ?? "NONE",
      aggregateItems: overrides.aggregateItems ?? false,
    },
    stall: { name: "越好吃一中店", timezone: "Asia/Taipei", currency: "TWD" },
    order: {
      orderNo: "A023",
      fulfillmentType: "TAKEOUT",
      tableLabel: null,
      customerName: "王小姐",
      customerPhone: null,
      deliveryAddress: null,
      note: null,
      createdAt: new Date("2026-08-21T10:42:00.000Z"),
      scheduledPickupAt: null,
      requestedFulfillmentAt: null,
      committedFulfillmentAt: null,
      subtotal: 410,
      discountAmount: 0,
      total: 410,
      paymentStatus: "UNPAID",
      items: [
        item("item-1", "product-hot", "牛肉湯河粉", 1, 150, "category-main", "主餐", "group-hot", common),
        item("item-2", "product-hot", "牛肉湯河粉", 2, 150, "category-main", "主餐", "group-hot", common),
        item("item-3", "product-drink", "冰紅茶", 1, 110, "category-drink", "飲料", "group-drink", { note: null, noteOptions: [] }),
      ],
    },
  };
}

function item(
  id: string,
  productId: string,
  name: string,
  quantity: number,
  unitPrice: number,
  categoryId: string,
  categoryName: string,
  groupId: string,
  detail: { note: string | null; noteOptions: Array<{ id: string; optionName: string }> },
) {
  return {
    id,
    productId,
    name,
    quantity,
    unitPrice,
    ...detail,
    product: {
      categoryId,
      groupId,
      category: { name: categoryName },
      group: { name: groupId },
    },
  };
}

function countSequence(haystack: Buffer, needle: Buffer) {
  let count = 0;
  let offset = 0;
  while ((offset = haystack.indexOf(needle, offset)) >= 0) {
    count += 1;
    offset += needle.length;
  }
  return count;
}
