import { describe, expect, it } from "vitest";
import {
  createKitchenTicketPayload,
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
});
