import { describe, expect, it } from "vitest";
import {
  authorizedStallIdsForPermission,
  canTransitionOrder,
  hasPermission,
  resolvePrimaryRole,
} from "./rbac";

describe("RBAC", () => {
  it("只允許組織或攤位管理角色變更商品", () => {
    expect(hasPermission("ORGANIZATION_OWNER", "MANAGE_PRODUCTS")).toBe(true);
    expect(hasPermission("ORGANIZATION_ADMIN", "MANAGE_PRODUCTS")).toBe(true);
    expect(hasPermission("STALL_MANAGER", "MANAGE_PRODUCTS")).toBe(true);
    expect(hasPermission("FINANCE_VIEWER", "MANAGE_PRODUCTS")).toBe(false);
    expect(hasPermission("STAFF", "MANAGE_PRODUCTS")).toBe(false);
    expect(hasPermission("KITCHEN", "MANAGE_PRODUCTS")).toBe(false);
  });

  it("限制財務檢視者只能讀取報表", () => {
    expect(hasPermission("FINANCE_VIEWER", "VIEW_REPORTS")).toBe(true);
    expect(hasPermission("FINANCE_VIEWER", "UPDATE_ORDERS")).toBe(false);
    expect(hasPermission("FINANCE_VIEWER", "MANAGE_STAFF")).toBe(false);
    expect(hasPermission("FINANCE_VIEWER", "MANAGE_SUBSCRIPTION")).toBe(false);
  });

  it("只有組織擁有者可管理訂閱", () => {
    expect(hasPermission("ORGANIZATION_OWNER", "MANAGE_SUBSCRIPTION")).toBe(true);
    expect(hasPermission("ORGANIZATION_ADMIN", "MANAGE_SUBSCRIPTION")).toBe(false);
    expect(hasPermission("STALL_MANAGER", "MANAGE_SUBSCRIPTION")).toBe(false);
  });

  it("複合角色優先使用可執行攤位操作的角色", () => {
    expect(resolvePrimaryRole(["FINANCE_VIEWER", "STALL_MANAGER"])).toBe("STALL_MANAGER");
    expect(resolvePrimaryRole(["KITCHEN", "ORGANIZATION_ADMIN"])).toBe("ORGANIZATION_ADMIN");
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
    expect(canTransitionOrder("COMPLETED", "CANCELLED", "ORGANIZATION_OWNER")).toBe(false);
  });

  it("只回傳具備指定權限的攤位", () => {
    const stalls = [
      { id: "stall-manager", roles: ["STALL_MANAGER" as const] },
      { id: "stall-finance", roles: ["FINANCE_VIEWER" as const] },
      { id: "stall-staff", roles: ["STAFF" as const] },
    ];

    expect(authorizedStallIdsForPermission(stalls, "VIEW_REPORTS")).toEqual([
      "stall-manager",
      "stall-finance",
    ]);
    expect(authorizedStallIdsForPermission(stalls, "MANAGE_STAFF")).toEqual(["stall-manager"]);
  });
});
