import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(fileURLToPath(new URL(
  "./staff-order-board-controller.ts",
  import.meta.url,
)), "utf8").replace(/\r\n/g, "\n");
const proposalSource = readFileSync(fileURLToPath(new URL(
  "./staff-order-board-time-proposal.tsx",
  import.meta.url,
)), "utf8").replace(/\r\n/g, "\n");
const presentationSource = readFileSync(fileURLToPath(new URL(
  "./staff-order-board-presentation.tsx",
  import.meta.url,
)), "utf8").replace(/\r\n/g, "\n");

describe("StaffOrderBoard fulfillment-time proposal characterization", () => {
  it("builds selectable slots and chooses a different default from the requested time", () => {
    expect(source).toContain("const timeProposal = useStaffOrderTimeProposal({");
    expect(source).toContain("slotValues: orderCatalog?.fulfillmentSlots");
    expect(source).toContain("timeZone: stall.timezone");
    expect(proposalSource).toContain("buildFulfillmentTimeSlots(slotValues ?? [], timeZone)");
    expect(proposalSource).toContain("slots.find((slot) => slot.iso !== order.requestedFulfillmentAt)?.iso");
    expect(proposalSource).toContain('reason: "目前訂單較多，建議調整時間"');
  });

  it("preserves the proposal command and success-only modal dismissal", () => {
    expect(source).toContain("const updatedOrder = await updateStaffOrderFulfillmentTime({");
    expect(source).toContain('command.operation === "PROPOSE"');
    expect(source).toContain("return updateFulfillmentTime(order, command);");
    expect(proposalSource).toContain('operation: "PROPOSE"');
    expect(proposalSource).toContain("if (updated) dismiss();");
  });

  it("owns reconcile, Escape, busy, and validation guards in the proposal boundary", () => {
    expect(source).toContain("reconcileTimeProposal(snapshot.onlineOrders);");
    expect(presentationSource).toContain("<StaffOrderTimeProposalDialog");
    expect(proposalSource).toContain('if (event.key === "Escape" && updatingOrderId !== pending.orderId) dismiss();');
    expect(proposalSource).toContain('role="dialog"');
    expect(proposalSource).toContain('aria-labelledby="time-proposal-title"');
    expect(proposalSource).toContain('testId="staff-time-proposal-fields"');
    expect(proposalSource).toContain("pending.reason.trim().length < 2");
    expect(proposalSource).toContain("const busy = updatingOrderId === order.id;");
  });
});
