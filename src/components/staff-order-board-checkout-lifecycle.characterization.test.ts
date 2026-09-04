import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(fileURLToPath(new URL(
  "./staff-order-board-controller.ts",
  import.meta.url,
)), "utf8").replace(/\r\n/g, "\n");
const checkoutSource = readFileSync(fileURLToPath(new URL(
  "./staff-order-board-checkout-lifecycle.tsx",
  import.meta.url,
)), "utf8").replace(/\r\n/g, "\n");
const presentationSource = readFileSync(fileURLToPath(new URL(
  "./staff-order-board-presentation.tsx",
  import.meta.url,
)), "utf8").replace(/\r\n/g, "\n");

describe("StaffOrderBoard checkout lifecycle characterization", () => {
  it("owns reducer state, authoritative reconcile, and Escape busy guard", () => {
    expect(source).toContain("const checkout = useStaffOrderCheckout({");
    expect(source).toContain("reconcileCheckout(snapshot.onlineOrders);");
    expect(checkoutSource).toContain("const [state, dispatch] = useReducer(");
    expect(checkoutSource).toContain('type: "RECONCILE_ORDERS"');
    expect(checkoutSource).toContain('if (event.key === "Escape" && updatingOrderId !== checkoutOrder.id) dismiss();');
  });

  it("selects single or same-table completion and closes only after success", () => {
    expect(source).toContain('const completed = await updateOrder(order.id, "COMPLETED", { checkout: checkoutRequest });');
    expect(source).toContain("if (completed && checkoutUsesCash(checkoutRequest)) notifyCashPaymentCompleted();");
    expect(source).toContain("const completedIds = new Set(await checkoutStaffDiningTable({");
    expect(checkoutSource).toContain("if (state.orders.length === 1)");
    expect(checkoutSource).toContain("state.orders.some((order) => order.diningTableId !== diningTableId)");
    expect(checkoutSource).toContain("if (completed) dismiss();");
    expect(checkoutSource).toContain('else dispatch({ type: "RESET_MANAGER_AUTHORIZATION_CODE" });');
  });

  it("preserves checkout dialog controls, validation, and recovery link", () => {
    expect(presentationSource).toContain("<StaffOrderCheckoutDialog");
    expect(checkoutSource).toContain('aria-labelledby="checkout-title"');
    expect(checkoutSource).toContain("<StaffDiscountSelector");
    expect(checkoutSource).toContain("controller.setCashReceived");
    expect(checkoutSource).toContain("controller.setManagerAuthorizationCode");
    expect(checkoutSource).toContain("disabled={!model.ready || busy}");
    expect(checkoutSource).toContain("前往現金交班");
    expect(checkoutSource).toContain('checkoutOrder.source === "QR_MENU"');
    expect(checkoutSource).toContain("收款後訂單會保留；餐點交付後再按「完成訂單」。");
    expect(checkoutSource).toContain('qrPaymentOnly ? "確認收款" : "完成訂單"');
  });
});
