import { describe, expect, it } from "vitest";
import { canTransitionOrder, hasPermission } from "./rbac";

describe("RBAC", () => {
  it("只允許商戶管理角色變更商品", () => {
    expect(hasPermission("MERCHANT_OWNER", "MANAGE_PRODUCTS")).toBe(true);
    expect(hasPermission("MERCHANT_MANAGER", "MANAGE_PRODUCTS")).toBe(true);
    expect(hasPermission("STAFF", "MANAGE_PRODUCTS")).toBe(false);
    expect(hasPermission("KITCHEN", "MANAGE_PRODUCTS")).toBe(false);
  });

  it("廚房只能推進製作與可取餐狀態", () => {
    expect(canTransitionOrder("CONFIRMED", "PREPARING", "KITCHEN")).toBe(true);
    expect(canTransitionOrder("PREPARING", "READY", "KITCHEN")).toBe(true);
    expect(canTransitionOrder("READY", "COMPLETED", "KITCHEN")).toBe(false);
    expect(canTransitionOrder("CONFIRMED", "CANCELLED", "KITCHEN")).toBe(false);
  });

  it("拒絕跳過或反向訂單狀態", () => {
    expect(canTransitionOrder("WAITING_CONFIRMATION", "READY", "STAFF")).toBe(false);
    expect(canTransitionOrder("WAITING_CONFIRMATION", "CONFIRMED", "STAFF")).toBe(true);
    expect(canTransitionOrder("READY", "PREPARING", "STAFF")).toBe(false);
    expect(canTransitionOrder("COMPLETED", "CANCELLED", "MERCHANT_OWNER")).toBe(false);
  });
});
