import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(fileURLToPath(new URL(
  "./staff-order-board-controller.ts",
  import.meta.url,
)), "utf8").replace(/\r\n/g, "\n");
const manualPickupSource = readFileSync(fileURLToPath(new URL(
  "./staff-order-board-manual-pickup.tsx",
  import.meta.url,
)), "utf8").replace(/\r\n/g, "\n");
const presentationSource = readFileSync(fileURLToPath(new URL(
  "./staff-order-board-presentation.tsx",
  import.meta.url,
)), "utf8").replace(/\r\n/g, "\n");

describe("StaffOrderBoard manual pickup characterization", () => {
  it("keeps pending manual pickup reconciled with authoritative online orders", () => {
    expect(source).toContain("const manualPickup = useStaffOrderManualPickup({");
    expect(source).toContain("reconcileManualPickup(snapshot.onlineOrders);");
    expect(manualPickupSource).toContain("const [pending, setPending] = useState<PendingManualPickup | null>(null);");
    expect(manualPickupSource).toContain("current && !orders.some((order) => order.id === current.orderId) ? null : current");
  });

  it("preserves manual verification guards, command payload, and success-only dismissal", () => {
    expect(source).toContain("if (verifyingPickupOrderId === orderId) return false;");
    expect(source).toContain("if (!order) return false;");
    expect(source).toContain('mode: "MANUAL"');
    expect(source).toContain("confirmationOrderNo: order.orderNo");
    expect(source).toContain("reason,");
    expect(manualPickupSource).toContain("|| !pending.confirmedCustomerDetails");
    expect(manualPickupSource).toContain("if (verified) dismiss();");
  });

  it("preserves the modal lifecycle, default reason, and customer-detail acknowledgement", () => {
    expect(presentationSource).toContain("onClick={() => manualPickup.open(order.id)}");
    expect(presentationSource).toContain("<StaffOrderManualPickupDialog");
    expect(manualPickupSource).toContain('if (event.key === "Escape" && verifyingPickupOrderId !== pending.orderId) dismiss();');
    expect(manualPickupSource).toContain('role="alertdialog"');
    expect(manualPickupSource).toContain('aria-labelledby="manual-pickup-title"');
    expect(manualPickupSource).toContain('reason: "DEVICE_LOST"');
    expect(manualPickupSource).toContain("confirmedCustomerDetails: false");
  });
});
