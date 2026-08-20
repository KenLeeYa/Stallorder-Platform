import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const boardSource = readFileSync(fileURLToPath(new URL(
  "./staff-order-board.tsx",
  import.meta.url,
)), "utf8").replace(/\r\n/g, "\n");
const controllerSource = readFileSync(fileURLToPath(new URL(
  "./staff-order-board-controller.ts",
  import.meta.url,
)), "utf8").replace(/\r\n/g, "\n");
const presentationSource = readFileSync(fileURLToPath(new URL(
  "./staff-order-board-presentation.tsx",
  import.meta.url,
)), "utf8").replace(/\r\n/g, "\n");

describe("StaffOrderBoard presentation characterization", () => {
  it("keeps the parent composition-only and delegates orchestration to the controller", () => {
    expect(boardSource).toContain("useStaffOrderBoardController(props)");
    expect(boardSource).toContain("<StaffOrderBoardPresentation {...presentation} />");
    expect(boardSource).not.toMatch(/use(?:Callback|Effect|Memo|Ref|State)\(/);
    expect(boardSource).not.toContain("fetch(");
    expect(boardSource).not.toContain("localStorage");
    expect(controllerSource).toContain("filteredOrders,");
    expect(controllerSource).toContain("kitchenGroups,");
    expect(controllerSource).toContain("diningTableGroups,");
    expect(controllerSource).toContain("actions: {");
    expect(presentationSource).not.toContain("filteredOrders.map((order)");
  });

  it("owns toolbar, selected and undo bars, and every board rendering branch", () => {
    expect(presentationSource).toContain("function StaffOrderBoardToolbar(");
    expect(presentationSource).toContain("function StaffOrderBatchBars(");
    expect(presentationSource).toContain("function StaffKdsSummary(");
    expect(presentationSource).toContain("function StaffTableGroups(");
    expect(presentationSource).toContain("function StaffTicketList(");
    expect(presentationSource).toContain("function StaffOrderTicket(");
    expect(presentationSource).toContain("function StaffPosComposerAndDialogs(");
    expect(presentationSource).toContain("<WorkModeSwitcher");
    expect(presentationSource).toContain('role="switch"');
    expect(presentationSource).toContain('t("staff.selection.count", { count: selectedItems.length })');
    expect(presentationSource).toContain('t("staff.selection.updated", { count: undoBatch.itemCount })');
    expect(presentationSource).toContain('account.role === "KITCHEN" && viewMode === "SUMMARY"');
    expect(presentationSource).toContain('viewMode === "TABLES"');
    expect(presentationSource).toContain("orders.map((order) => <StaffOrderTicket");
  });

  it("retains mobile toolbar and ticket layouts plus accessibility contracts", () => {
    expect(presentationSource).toContain('data-testid="staff-function-grid"');
    expect(presentationSource).toContain("relative mt-3 flex w-full min-w-0");
    expect(presentationSource).toContain("sm:overflow-x-visible");
    expect(presentationSource).toContain('data-testid="staff-function-status-group"');
    expect(presentationSource).toContain('data-testid="staff-function-order-group"');
    expect(presentationSource).toContain('data-testid="staff-function-device-group"');
    expect(presentationSource).toContain("sm:flex-row sm:items-center sm:justify-between");
    expect(presentationSource).toContain('aria-label={t("staff.view.kitchenMode")}');
    expect(presentationSource).toContain('aria-label={t("staff.view.orderMode")}');
    expect(presentationSource).toContain("aria-expanded={expanded}");
    expect(presentationSource).toContain('aria-haspopup={option.value === "CANCELLED" ? "dialog" : undefined}');
    expect(presentationSource).toContain('aria-busy={verifyingPickupOrderId === order.id}');
  });
});
