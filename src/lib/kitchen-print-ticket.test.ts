import { describe, expect, it } from "vitest";
import {
  createCustomerReceiptPayload,
  createKitchenTicketBatchPayload,
  createKitchenTicketPayload,
  createPrinterTestPayload,
  displayWidth,
  kitchenTicketCommandBytes,
  KITCHEN_TICKET_COLUMNS,
} from "@/lib/kitchen-print-ticket";

const baseInput = {
  stallName: "越好吃一中店",
  timeZone: "Asia/Taipei",
  printedAt: new Date("2026-08-21T10:42:00.000Z"),
  isReprint: false,
  order: {
    orderNo: "A023",
    fulfillmentType: "TAKEOUT" as const,
    tableLabel: null,
    note: "河粉先做，飲料稍後",
    createdAt: new Date("2026-08-21T10:42:00.000Z"),
    scheduledPickupAt: new Date("2026-08-21T11:00:00.000Z"),
    requestedFulfillmentAt: null,
    committedFulfillmentAt: null,
    items: [
      {
        name: "牛肉湯河粉",
        quantity: 2,
        note: "不要香菜",
        noteOptions: [{ optionName: "加麵" }, { optionName: "肉量加倍" }],
      },
      {
        name: "涼拌米線",
        quantity: 1,
        note: null,
        noteOptions: [{ optionName: "小辣" }],
      },
    ],
  },
};

describe("58mm kitchen ticket", () => {
  it("renders the approved compact layout without drafting labels or blank rows", () => {
    const payload = createKitchenTicketPayload(baseInput);

    expect(payload).toMatchObject({
      kind: "KITCHEN_58MM_STARPRNT",
      version: "kitchen-58mm-starprnt-v1",
      mediaType: "application/vnd.star.starprnt",
      content: [
        "越好吃一中店｜廚房製作單",
        "外帶自取 #A023 ★預約",
        "取餐 08/21 19:00｜下單 18:42",
        "--------------------------------",
        "2× 牛肉湯河粉",
        "   加麵／肉量加倍／★不要香菜",
        "1× 涼拌米線",
        "   小辣",
        "--------------------------------",
        "備註：河粉先做，飲料稍後",
        "共2品項／3份｜列印18:42",
        "",
      ].join("\n"),
    });
    expect(payload.content).not.toMatch(/\[[A-D]\d\]/);
    expect(payload.content).not.toContain("\n\n");
  });

  it("wraps UTF-8 Traditional Chinese in deterministic StarPRNT commands and one partial cut", () => {
    const payload = createKitchenTicketPayload(baseInput);
    const bytes = Buffer.from(kitchenTicketCommandBytes(payload));

    expect(bytes.subarray(0, 29)).toEqual(Buffer.from([
      0x1b, 0x40,
      0x1b, 0x1d, 0x29, 0x55, 0x02, 0x00, 0x30, 0x01,
      0x1b, 0x1d, 0x29, 0x55, 0x02, 0x00, 0x40, 0x01,
      0x1b, 0x1d, 0x29, 0x55, 0x05, 0x00, 0x41, 0x03, 0x02, 0x01, 0x04,
    ]));
    expect(bytes.includes(Buffer.from("越好吃一中店", "utf8"))).toBe(true);
    expect(bytes.subarray(-3)).toEqual(Buffer.from([0x1b, 0x64, 0x03]));
    expect(Buffer.from(kitchenTicketCommandBytes(payload))).toEqual(bytes);
  });

  it("omits empty optional sections and marks a reprint", () => {
    const payload = createKitchenTicketPayload({
      ...baseInput,
      isReprint: true,
      order: {
        ...baseInput.order,
        note: null,
        scheduledPickupAt: null,
        items: [{ name: "紅茶", quantity: 1, note: null, noteOptions: [] }],
      },
    });

    expect(payload.content).toContain("*** 補印 ***\n");
    expect(payload.content).toContain("下單 08/21 18:42\n");
    expect(payload.content).not.toContain("★預約");
    expect(payload.content).not.toContain("備註：");
  });

  it("keeps every emitted line within the 32-column 58mm profile", () => {
    const payload = createKitchenTicketPayload({
      ...baseInput,
      order: {
        ...baseInput.order,
        items: [{
          name: "超級加長版招牌牛肉湯河粉加大份",
          quantity: 12,
          note: "不要香菜不要蔥花並且湯與麵分開包裝",
          noteOptions: [{ optionName: "肉量加倍" }, { optionName: "加麵" }],
        }],
      },
    });

    for (const line of payload.content.trimEnd().split("\n")) {
      expect(displayWidth(line)).toBeLessThanOrEqual(KITCHEN_TICKET_COLUMNS);
    }
  });

  it("removes control characters from printer-bound content", () => {
    const payload = createKitchenTicketPayload({
      ...baseInput,
      order: {
        ...baseInput.order,
        note: "正常\u001b@\n不要香菜",
      },
    });

    expect(payload.content).not.toContain("\u001b");
    expect(payload.content).not.toContain("\n不要香菜");
  });

  it("creates compact category-split copies with one physical cut per section and copy", () => {
    const payload = createKitchenTicketBatchPayload({
      ...baseInput,
      paperWidthMm: 58,
      fontScale: 1,
      order: {
        orderNo: baseInput.order.orderNo,
        fulfillmentType: baseInput.order.fulfillmentType,
        tableLabel: baseInput.order.tableLabel,
        note: baseInput.order.note,
        createdAt: baseInput.order.createdAt,
        scheduledPickupAt: baseInput.order.scheduledPickupAt,
        requestedFulfillmentAt: baseInput.order.requestedFulfillmentAt,
        committedFulfillmentAt: baseInput.order.committedFulfillmentAt,
      },
      sections: [
        { label: "主餐", items: [baseInput.order.items[0]] },
        { label: "涼菜", items: [baseInput.order.items[1]] },
      ],
    }, 2);
    const bytes = Buffer.from(kitchenTicketCommandBytes(payload));

    expect(payload.version).toBe("kitchen-starprnt-v2");
    expect(payload.content.match(/分單：/g)).toHaveLength(4);
    expect(countSequence(bytes, Buffer.from([0x1b, 0x64, 0x02]))).toBe(4);
  });

  it("renders a customer receipt with prices, discount and payment state", () => {
    const payload = createCustomerReceiptPayload({
      stallName: baseInput.stallName,
      timeZone: baseInput.timeZone,
      currency: "TWD",
      printedAt: baseInput.printedAt,
      isReprint: false,
      paperWidthMm: 58,
      fontScale: 1,
      copies: 2,
      order: {
        orderNo: baseInput.order.orderNo,
        fulfillmentType: "TAKEOUT",
        tableLabel: null,
        customerName: "王小姐",
        customerPhone: "0912345678",
        deliveryAddress: null,
        note: null,
        createdAt: baseInput.order.createdAt,
        subtotal: 320,
        discountAmount: 20,
        total: 300,
        paymentStatus: "PAID",
        items: [{
          name: "牛肉湯河粉",
          quantity: 2,
          unitPrice: 160,
          note: null,
          noteOptions: [],
        }],
      },
    });

    expect(payload.kind).toBe("CUSTOMER_RECEIPT_STARPRNT");
    expect(payload.content).toContain("2× 牛肉湯河粉");
    expect(payload.content).toContain("折扣");
    expect(payload.content).toContain("$300");
    expect(payload.content).toContain("付款：已付款");
    expect(payload.content.match(/2× 牛肉湯河粉/g)).toHaveLength(2);
  });

  it("honors compact receipt content and feed settings", () => {
    const payload = createCustomerReceiptPayload({
      stallName: baseInput.stallName,
      timeZone: baseInput.timeZone,
      currency: "TWD",
      printedAt: baseInput.printedAt,
      isReprint: false,
      paperWidthMm: 58,
      fontScale: 1,
      feedLines: 1,
      showCustomerName: false,
      showCustomerPhone: false,
      showDeliveryAddress: false,
      showOrderNote: false,
      showItemNotes: false,
      showPrices: false,
      showPaymentMethod: false,
      copies: 1,
      order: {
        orderNo: baseInput.order.orderNo,
        fulfillmentType: "DELIVERY",
        tableLabel: null,
        customerName: "王小姐",
        customerPhone: "0912345678",
        deliveryAddress: "台中市測試路 1 號",
        note: "整單備註",
        createdAt: baseInput.order.createdAt,
        subtotal: 150,
        discountAmount: 0,
        total: 150,
        paymentStatus: "PAID",
        paymentMethodLabel: "LINE Pay",
        items: [{
          name: "牛肉湯河粉",
          quantity: 1,
          unitPrice: 150,
          note: "不要香菜",
          noteOptions: [{ optionName: "加麵" }],
        }],
      },
    });
    const bytes = Buffer.from(kitchenTicketCommandBytes(payload));

    expect(payload.content).toContain("1× 牛肉湯河粉");
    expect(payload.content).not.toContain("王小姐");
    expect(payload.content).not.toContain("0912345678");
    expect(payload.content).not.toContain("台中市測試路");
    expect(payload.content).not.toContain("不要香菜");
    expect(payload.content).not.toContain("$150");
    expect(payload.content).not.toContain("LINE Pay");
    expect(bytes.subarray(-3)).toEqual(Buffer.from([0x1b, 0x64, 0x01]));
  });

  it("creates a self-contained printer test for a 57–58 mm roll", () => {
    const payload = createPrinterTestPayload({
      stallName: "越好吃一中店",
      printerName: "櫃台",
      model: "MCP31LB",
      connectionLabel: "iPad 藍牙",
      paperWidthMm: 58,
      printedAt: baseInput.printedAt,
      timeZone: "Asia/Taipei",
    });

    expect(payload.kind).toBe("PRINTER_TEST_STARPRNT");
    expect(payload.content).toContain("57–58 mm");
    expect(payload.content).not.toMatch(/\[[A-D]\d\]/);
  });
});

function countSequence(haystack: Buffer, needle: Buffer) {
  let count = 0;
  let offset = 0;
  while ((offset = haystack.indexOf(needle, offset)) >= 0) {
    count += 1;
    offset += needle.length;
  }
  return count;
}
