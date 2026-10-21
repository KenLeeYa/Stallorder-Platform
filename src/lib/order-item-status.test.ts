import { describe, expect, it } from "vitest";
import { canTransitionOrderItem, deriveOrderStatusFromItems } from "./order-item-status";

describe("餐點製作與出餐狀態", () => {
  it("廚房可製作與完成餐點，但不能標記已出餐", () => {
    expect(canTransitionOrderItem("PENDING", "PREPARING", "KITCHEN")).toBe(false);
    expect(canTransitionOrderItem("PREPARING", "READY", "KITCHEN")).toBe(false);
    expect(canTransitionOrderItem("READY", "SERVED", "KITCHEN")).toBe(false);
  });

  it("前場可依序標記餐點已出餐且不能跳過狀態", () => {
    expect(canTransitionOrderItem("READY", "SERVED", "STAFF")).toBe(true);
    expect(canTransitionOrderItem("PENDING", "READY", "STAFF")).toBe(false);
  });

  it("依品項進度彙整整張訂單狀態", () => {
    expect(deriveOrderStatusFromItems("CONFIRMED", ["PENDING", "PENDING"])).toBe("CONFIRMED");
    expect(deriveOrderStatusFromItems("CONFIRMED", ["PREPARING", "PENDING"])).toBe("PREPARING");
    expect(deriveOrderStatusFromItems("PREPARING", ["READY", "SERVED"])).toBe("READY");
  });
  it("部分完成或仍在打包時不提早把整單標為可取餐", () => {
    expect(deriveOrderStatusFromItems("PREPARING", ["READY", "PENDING"])).toBe("PREPARING");
    expect(deriveOrderStatusFromItems("PACKING", ["READY", "PREPARING"])).toBe("PACKING");
    expect(deriveOrderStatusFromItems("PACKING", ["READY", "SERVED"])).toBe("READY");
    expect(deriveOrderStatusFromItems("CONFIRMED", [])).toBe("CONFIRMED");
  });
});
