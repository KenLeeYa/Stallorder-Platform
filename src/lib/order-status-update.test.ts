import { describe, expect, it } from "vitest";
import { cancellationMatchesOrder, orderStatusUpdateSchema } from "./order-status-update";

describe("訂單取消確認", () => {
  it("拒絕未附確認訂單編號的取消請求", () => {
    expect(orderStatusUpdateSchema.safeParse({ status: "CANCELLED" }).success).toBe(false);
  });

  it("只接受與實際訂單相符的確認編號", () => {
    const parsed = orderStatusUpdateSchema.safeParse({
      status: "CANCELLED",
      confirmationOrderNo: "260713-001",
      cancellationReason: "CUSTOMER_CANCELLED",
    });

    expect(parsed.success).toBe(true);
    expect(cancellationMatchesOrder("260713-001", "260713-001")).toBe(true);
    expect(cancellationMatchesOrder("260713-002", "260713-001")).toBe(false);
  });

  it("其他取消原因必須提供補充說明", () => {
    expect(orderStatusUpdateSchema.safeParse({
      status: "CANCELLED",
      confirmationOrderNo: "260713-001",
      cancellationReason: "OTHER",
    }).success).toBe(false);
    expect(orderStatusUpdateSchema.safeParse({
      status: "CANCELLED",
      confirmationOrderNo: "260713-001",
      cancellationReason: "OTHER",
      cancellationDetail: "顧客重複操作",
    }).success).toBe(true);
  });

  it("一般狀態更新不可夾帶取消確認資料", () => {
    expect(orderStatusUpdateSchema.safeParse({
      status: "CONFIRMED",
      confirmationOrderNo: "260713-001",
    }).success).toBe(false);
  });

  it("完成訂單只接受受控付款、折扣與實收欄位", () => {
    expect(orderStatusUpdateSchema.safeParse({
      status: "COMPLETED",
      paymentOptionId: "99999999-9999-4999-8999-999999999991",
      discountOptionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
      cashReceived: 500,
      discountApprovalReason: "熟客補償",
      managerEmail: "manager@example.com",
      managerPassword: "approval-password",
    }).success).toBe(true);
    expect(orderStatusUpdateSchema.safeParse({
      status: "COMPLETED",
      paymentOptionId: "not-a-uuid",
    }).success).toBe(false);
    expect(orderStatusUpdateSchema.safeParse({
      status: "COMPLETED",
      total: 1,
    }).success).toBe(false);
  });
});
