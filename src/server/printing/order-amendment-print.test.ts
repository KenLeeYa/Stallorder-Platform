import { describe, expect, it, vi } from "vitest";
import { getOrderItemChanges, queueOrderAmendmentPrints, type AmendmentItem } from "./order-amendment-print";
import { createKitchenTicketBatchPayload } from "@/lib/kitchen-print-ticket";

const item = (id: string, quantity: number, categoryId = "hot"): AmendmentItem => ({
  id, productId: id, name: id, quantity, unitPrice: 100, note: "不加香菜",
  noteOptions: [{ optionName: "小辣" }], product: { categoryId, groupId: null },
});
describe("immutable kitchen amendment documents", () => {
  it("prints only the quantity difference and preserves option snapshots on removals", () => {
    const delta = getOrderItemChanges([item("A", 3), item("B", 1)], [item("A", 1), item("C", 2)]);
    expect(delta.removed.map((row) => [row.id, row.quantity])).toEqual([["A", 2], ["B", 1]]);
    expect(delta.added.map((row) => [row.id, row.quantity])).toEqual([["C", 2]]);
    expect(delta.removed[0].noteOptions).toEqual([{ optionName: "小辣" }]);
    expect(getOrderItemChanges([item("A", 2)], [item("A", 2)])).toEqual({ removed: [], added: [] });
  });
  it("routes cancellation and addition separately and clearly marks items not to prepare", async () => {
    const create = vi.fn().mockResolvedValue({});
    type Input = Parameters<typeof queueOrderAmendmentPrints>[1];
    const job = {
      id: "original", printerId: "hot-printer", printRuleId: "hot-rule", documentType: "KITCHEN_TICKET", copies: 1,
      printer: { paperWidthMm: 58 }, printRule: { productCategoryIds: ["hot"], productGroupIds: [], fontScale: 1 },
      stall: { name: "測試店", timezone: "Asia/Taipei", currency: "TWD" },
      order: { orderNo: "260911-001", fulfillmentType: "TAKEOUT", tableLabel: null, note: null, createdAt: new Date(), scheduledPickupAt: null, requestedFulfillmentAt: null, committedFulfillmentAt: null },
    } as unknown as Input["originalJobs"][number];
    const db = { printJob: { create }, printRule: { findMany: vi.fn().mockResolvedValue([{ ...job.printRule, id: "hot-rule", printerId: "hot-printer", printer: job.printer, documentType: "KITCHEN_TICKET", copies: 1, orderSources: [], orderOrigins: [], fulfillmentTypes: [] }]) } } as unknown as Parameters<typeof queueOrderAmendmentPrints>[0];
    await queueOrderAmendmentPrints(db, { organizationId: "org", stallId: "stall", actorProfileId: "staff", amendmentId: "change", number: 2,
      originalJobs: [job], before: [item("熱食", 2), item("冷飲", 1, "cold")], after: [item("熱食", 1), item("冷飲", 2, "cold"), item("加點", 1)],
      order: { id: "order", source: "STAFF_POS", origin: "ONLINE", fulfillmentType: "TAKEOUT", total: 400 },
    });
    expect(create).toHaveBeenCalledTimes(1);
    const data = create.mock.calls[0][0].data;
    expect(data).toMatchObject({ amendmentId: "change", printerId: "hot-printer", printRuleId: "hot-rule" });
    expect(data.payload.content).toContain("訂單變更單 #2");
    expect(data.payload.content).toContain("【勿製作】熱食"); expect(data.payload.content).toContain("【加做】加點");
    expect(data.payload.content).toContain("不加香菜"); expect(data.payload.content).not.toContain("冷飲");
    expect(data.payload.content).not.toContain("廚房製作單");
    expect(data.reprintOfId).toBeUndefined();
    expect(Buffer.from(data.payload.dataBase64, "base64").length).toBeGreaterThan(0);
  });
  it("sends cancellations to the original printer after category and printer changes, and additions only to the current printer", async () => {
    const create = vi.fn().mockResolvedValue({});
    type Input = Parameters<typeof queueOrderAmendmentPrints>[1];
    const order = { orderNo: "260911-002", fulfillmentType: "TAKEOUT" as const, tableLabel: null, note: null, createdAt: new Date(), scheduledPickupAt: null, requestedFulfillmentAt: null, committedFulfillmentAt: null };
    const payload = createKitchenTicketBatchPayload({ stallName: "測試店", timeZone: "Asia/Taipei", printedAt: new Date(), isReprint: false, order, sections: [{ label: "原始", items: [item("A", 1)] }] }, 1);
    const rule = { id: "same-rule", printerId: "new-printer", productCategoryIds: ["hot"], productGroupIds: [], fontScale: 1, orderSources: [], orderOrigins: [], fulfillmentTypes: [], printer: { paperWidthMm: 58 }, documentType: "KITCHEN_TICKET", copies: 1 };
    const originalJobs = [{ id: "original", printerId: "old-printer", printRuleId: rule.id, printRule: rule, printer: rule.printer, documentType: "KITCHEN_TICKET", copies: 1, order, stall: { name: "測試店", timezone: "Asia/Taipei", currency: "TWD" }, payload: { ...payload, sourceItemIds: ["A"] } }] as unknown as Input["originalJobs"];
    const db = { printJob: { create }, printRule: { findMany: vi.fn().mockResolvedValue([rule]) } } as unknown as Parameters<typeof queueOrderAmendmentPrints>[0];
    await queueOrderAmendmentPrints(db, { organizationId: "org", stallId: "stall", actorProfileId: "staff", amendmentId: "change", number: 1, originalJobs,
      before: [item("A", 1, "moved-category"), item("other-printer-item", 1)], after: [item("B", 1)],
      order: { id: "order", source: "STAFF_POS", origin: "ONLINE", fulfillmentType: "TAKEOUT", total: 100 },
    });
    expect(create).toHaveBeenCalledTimes(2);
    const documents = create.mock.calls.map(([input]) => input.data);
    const original = documents.find((document) => document.printerId === "old-printer");
    const current = documents.find((document) => document.printerId === "new-printer");
    expect(original.payload.content).toContain("【勿製作】A");
    expect(original.payload.content).not.toContain("【加做】");
    expect(original.payload.content).not.toContain("other-printer-item");
    expect(current.payload.content).toContain("【加做】B");
    expect(current.payload.content).not.toContain("【勿製作】");
    expect(current.payload.sourceItemIds).toEqual(["B"]);
  });
  it("uses earlier amendment item IDs to route a second cancellation after its rule is disabled", async () => {
    const create = vi.fn().mockResolvedValue({});
    type Input = Parameters<typeof queueOrderAmendmentPrints>[1];
    const order = { orderNo: "260911-003", fulfillmentType: "TAKEOUT" as const, tableLabel: null, note: null, createdAt: new Date(), scheduledPickupAt: null, requestedFulfillmentAt: null, committedFulfillmentAt: null };
    const payload = createKitchenTicketBatchPayload({ stallName: "測試店", timeZone: "Asia/Taipei", printedAt: new Date(), isReprint: false, order, sections: [{ label: "加做", items: [item("B", 1)] }] }, 1);
    const originalJobs = [{ id: "earlier-change", amendmentId: "earlier", printerId: "printer", printRuleId: "disabled", printRule: { productCategoryIds: ["unrelated"], productGroupIds: [] }, printer: { paperWidthMm: 58 }, documentType: "KITCHEN_TICKET", copies: 1, order, stall: { name: "測試店", timezone: "Asia/Taipei", currency: "TWD" }, payload: { ...payload, sourceItemIds: ["B"] } }] as unknown as Input["originalJobs"];
    const db = { printJob: { create }, printRule: { findMany: vi.fn().mockResolvedValue([]) } } as unknown as Parameters<typeof queueOrderAmendmentPrints>[0];
    await queueOrderAmendmentPrints(db, { organizationId: "org", stallId: "stall", actorProfileId: "staff", amendmentId: "change", number: 2, originalJobs, before: [item("A", 1), item("B", 2)], after: [item("A", 1)], order: { id: "order", source: "STAFF_POS", origin: "ONLINE", fulfillmentType: "TAKEOUT", total: 100 } });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].data.payload.content).toContain("【勿製作】B");
    expect(create.mock.calls[0][0].data.payload.content).not.toContain("【勿製作】A");
  });
});
