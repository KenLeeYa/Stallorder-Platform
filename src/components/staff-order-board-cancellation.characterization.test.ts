import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(fileURLToPath(new URL(
  "./staff-order-board-controller.ts",
  import.meta.url,
)), "utf8").replace(/\r\n/g, "\n");
const cancellationSource = readFileSync(fileURLToPath(new URL(
  "./staff-order-board-cancellation.tsx",
  import.meta.url,
)), "utf8").replace(/\r\n/g, "\n");
const presentationSource = readFileSync(fileURLToPath(new URL(
  "./staff-order-board-presentation.tsx",
  import.meta.url,
)), "utf8").replace(/\r\n/g, "\n");

describe("StaffOrderBoard cancellation characterization", () => {
  it("keeps cancellation state reconciled with authoritative online orders", () => {
    expect(source).toContain("const cancellation = useStaffOrderCancellation({");
    expect(source).toContain("reconcileCancellation(snapshot.onlineOrders);");
    expect(cancellationSource).toContain("const [pending, setPending] = useState<PendingCancellation | null>(null);");
    expect(cancellationSource).toContain("current && !orders.some((order) => order.id === current.id) ? null : current");
  });

  it("preserves the cancellation command payload and success-only dismissal", () => {
    expect(source).toContain('onConfirm: (orderId, options) => updateOrder(orderId, "CANCELLED", options)');
    expect(cancellationSource).toContain("confirmationOrderNo: pending.orderNo");
    expect(cancellationSource).toContain("cancellationReason: pending.reason");
    expect(cancellationSource).toContain("cancellationDetail: pending.detail.trim() || null");
    expect(cancellationSource).toContain("if (cancelled) dismiss();");
  });

  it("preserves the existing modal lifecycle and safety affordances", () => {
    expect(presentationSource).toContain("cancellation.open({");
    expect(presentationSource).toContain("<StaffOrderCancellationDialog controller={cancellation} updatingOrderId={updatingOrderId} />");
    expect(cancellationSource).toContain('if (event.key === "Escape" && updatingOrderId !== pending.id) dismiss();');
    expect(cancellationSource).toContain('role="alertdialog"');
    expect(cancellationSource).toContain('aria-modal="true"');
    expect(cancellationSource).toContain("autoFocus");
    expect(cancellationSource).toContain('reason: "CUSTOMER_CANCELLED"');
    expect(cancellationSource).toContain('pending.reason === "OTHER" && !pending.detail.trim()');
  });
});
