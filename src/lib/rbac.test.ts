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
    expect(hasPermission("FINANCE_VIEWER", "VIEW_DINING_FLOOR")).toBe(false);
  });

  it("店員與廚房可查看桌位平面圖", () => {
    expect(hasPermission("STAFF", "VIEW_DINING_FLOOR")).toBe(true);
    expect(hasPermission("KITCHEN", "VIEW_DINING_FLOOR")).toBe(false);
  });

  it("只有前台營運角色可建立店員代點訂單", () => {
    expect(hasPermission("ORGANIZATION_OWNER", "CREATE_ORDERS")).toBe(true);
    expect(hasPermission("STALL_MANAGER", "CREATE_ORDERS")).toBe(true);
    expect(hasPermission("STAFF", "CREATE_ORDERS")).toBe(true);
    expect(hasPermission("KITCHEN", "CREATE_ORDERS")).toBe(false);
    expect(hasPermission("FINANCE_VIEWER", "CREATE_ORDERS")).toBe(false);
  });

  it("營運權限區分列印、現金交班與折扣核准", () => {
    expect(hasPermission("STAFF", "MANAGE_PRINT_QUEUE")).toBe(true);
    expect(hasPermission("KITCHEN", "MANAGE_PRINT_QUEUE")).toBe(false);
    expect(hasPermission("STAFF", "MANAGE_CASH_SHIFT")).toBe(true);
    expect(hasPermission("KITCHEN", "MANAGE_CASH_SHIFT")).toBe(false);
    expect(hasPermission("STALL_MANAGER", "APPROVE_DISCOUNT")).toBe(true);
    expect(hasPermission("STAFF", "APPROVE_DISCOUNT")).toBe(false);
    expect(hasPermission("STALL_MANAGER", "MANAGE_OPERATIONAL_ALERTS")).toBe(true);
    expect(hasPermission("STAFF", "MANAGE_OPERATIONAL_ALERTS")).toBe(false);
    expect(hasPermission("ORGANIZATION_ADMIN", "VIEW_AUDIT_LOGS")).toBe(true);
    expect(hasPermission("STALL_MANAGER", "VIEW_AUDIT_LOGS")).toBe(false);
    expect(hasPermission("ORGANIZATION_ADMIN", "MANAGE_REPORT_SCHEDULES")).toBe(true);
    expect(hasPermission("FINANCE_VIEWER", "MANAGE_REPORT_SCHEDULES")).toBe(false);
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

  it("廚房不能繞過 KDS 直接修改共用訂單狀態", () => {
    expect(canTransitionOrder("CONFIRMED", "PREPARING", "KITCHEN")).toBe(false);
    expect(canTransitionOrder("PREPARING", "PACKING", "KITCHEN")).toBe(false);
    expect(canTransitionOrder("PACKING", "READY", "KITCHEN")).toBe(false);
    expect(canTransitionOrder("PREPARING", "READY", "KITCHEN")).toBe(false);
    expect(canTransitionOrder("READY", "COMPLETED", "KITCHEN")).toBe(false);
    expect(canTransitionOrder("CONFIRMED", "CANCELLED", "KITCHEN")).toBe(false);
  });

  it("KDS 權限不會洩漏財務或設定操作給廚房角色", () => {
    expect(hasPermission("KITCHEN", "VIEW_KDS")).toBe(true);
    expect(hasPermission("KITCHEN", "UPDATE_PRODUCTION_TASKS")).toBe(true);
    expect(hasPermission("KITCHEN", "MANAGE_KDS")).toBe(false);
    expect(hasPermission("KITCHEN", "VIEW_ORDERS")).toBe(false);
    expect(hasPermission("KITCHEN", "MANAGE_PRINT_QUEUE")).toBe(false);
    expect(hasPermission("KITCHEN", "VIEW_DINING_FLOOR")).toBe(false);
    expect(hasPermission("KITCHEN", "VIEW_REPORTS")).toBe(false);
    expect(hasPermission("KITCHEN", "MANAGE_CASH_SHIFT")).toBe(false);
    expect(hasPermission("STALL_MANAGER", "MANAGE_KDS")).toBe(true);
  });

  it("CDS 設定僅開放組織管理者與攤位經理", () => {
    expect(hasPermission("ORGANIZATION_OWNER", "MANAGE_CDS")).toBe(true);
    expect(hasPermission("ORGANIZATION_ADMIN", "MANAGE_CDS")).toBe(true);
    expect(hasPermission("STALL_MANAGER", "MANAGE_CDS")).toBe(true);
    expect(hasPermission("FINANCE_VIEWER", "MANAGE_CDS")).toBe(false);
    expect(hasPermission("STAFF", "MANAGE_CDS")).toBe(false);
    expect(hasPermission("KITCHEN", "MANAGE_CDS")).toBe(false);
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
