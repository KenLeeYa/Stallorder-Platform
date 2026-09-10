import { describe, expect, it } from "vitest";
import {
  createCustomerReceiptPayload,
  createKitchenTicketBatchPayload,
  createKitchenTicketPayload,
  displayWidth,
  type PrintFontScale,
  type PrintPaperWidth,
} from "./kitchen-print-ticket";
import { writeOrderUtensils } from "./order-utensils";

const order = {
  orderNo: "QA-UTENSILS",
  fulfillmentType: "TAKEOUT" as const,
  tableLabel: null,
  note: writeOrderUtensils("請分袋", true),
  createdAt: "2026-09-09T04:00:00Z",
  scheduledPickupAt: null,
  requestedFulfillmentAt: null,
  committedFulfillmentAt: null,
  customerName: "列印測試",
  customerPhone: null,
  deliveryAddress: null,
  subtotal: 100,
  discountAmount: 0,
  total: 100,
  paymentStatus: "UNPAID" as const,
  items: [{ name: "測試餐點", quantity: 1, unitPrice: 100, note: null, noteOptions: [] }],
};
const input = {
  stallName: "列印驗收攤位",
  timeZone: "Asia/Taipei",
  currency: "TWD",
  printedAt: new Date("2026-09-09T04:01:00Z"),
  isReprint: false,
  paperWidthMm: 58 as PrintPaperWidth,
  fontScale: 1 as PrintFontScale,
  copies: 1,
  order,
};

describe("utensils survive print-rule note suppression", () => {
  it.each([true, false])("prints utensils once on kitchen and receipt with showOrderNote=%s", (showOrderNote) => {
    for (const payload of [
      createKitchenTicketPayload({ ...input, showOrderNote }),
      createCustomerReceiptPayload({ ...input, showOrderNote }),
    ]) {
      expect(payload.content.match(/免洗餐具：需要/g)).toHaveLength(1);
      expect(payload.content.includes("備註：請分袋")).toBe(showOrderNote);
      expect(payload.content).not.toContain("【免洗餐具");
      expect(Buffer.from(payload.dataBase64, "base64").includes(Buffer.from("免洗餐具：需要"))).toBe(true);
    }
  });

  it.each([58, 80] as const)("keeps utensils on every routed copy and reprint at %s mm", (paperWidthMm) => {
    for (const fontScale of [1, 2, 3] as const) {
      const payload = createKitchenTicketBatchPayload({
        ...input, paperWidthMm, fontScale, showOrderNote: false, isReprint: true,
        sections: [{ label: "廚房", items: order.items }, { label: "包裝", items: order.items }],
      }, 2);
      const flattened = payload.content.replaceAll("\n", "");
      expect(flattened.match(/免洗餐具：需要/g)).toHaveLength(4);
      expect(payload.content.match(/補印/g)).toHaveLength(4);
      expect(payload.content).not.toContain("請分袋");
      const columns = (paperWidthMm === 58 ? 32 : 48) / (fontScale === 3 ? 2 : 1);
      for (const line of payload.content.split("\n")) expect(displayWidth(line)).toBeLessThanOrEqual(columns);
    }
  });

  it("does not invent a preference on legacy orders or interpret ordinary text as a request", () => {
    for (const note of [null, "", "請分袋", "店家說【免洗餐具：需要】"]) {
      const payload = createCustomerReceiptPayload({ ...input, showOrderNote: false, order: { ...order, note } });
      expect(payload.content).not.toContain("免洗餐具");
      expect(payload.content).not.toContain("請分袋");
    }
    const removed = writeOrderUtensils(order.note, false);
    const payload = createKitchenTicketPayload({ ...input, order: { ...order, note: removed } });
    expect(payload.content).toContain("備註：請分袋");
    expect(payload.content).not.toContain("免洗餐具");
  });
});
