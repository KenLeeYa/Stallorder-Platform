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
    });

    expect(parsed.success).toBe(true);
    expect(cancellationMatchesOrder("260713-001", "260713-001")).toBe(true);
    expect(cancellationMatchesOrder("260713-002", "260713-001")).toBe(false);
  });

  it("一般狀態更新不可夾帶取消確認資料", () => {
    expect(orderStatusUpdateSchema.safeParse({
      status: "CONFIRMED",
      confirmationOrderNo: "260713-001",
    }).success).toBe(false);
  });
});
