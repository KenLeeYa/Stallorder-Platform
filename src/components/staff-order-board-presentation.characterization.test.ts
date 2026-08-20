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
    expect(presentationSource).toContain("已選 {selectedItems.length} 個餐點品項");
    expect(presentationSource).toContain("已更新 {undoBatch.itemCount} 個餐點，5 秒內可復原。");
    expect(presentationSource).toContain('account.role === "KITCHEN" && viewMode === "SUMMARY"');
    expect(presentationSource).toContain('viewMode === "TABLES"');
    expect(presentationSource).toContain("orders.map((order) => <StaffOrderTicket");
  });

  it("retains mobile toolbar and ticket layouts plus accessibility contracts", () => {
    expect(presentationSource).toContain("overflow-x-auto contain-paint");
    expect(presentationSource).toContain("sm:flex-row sm:items-center sm:justify-between");
    expect(presentationSource).toContain('aria-label="廚房檢視模式"');
    expect(presentationSource).toContain('aria-label="訂單顯示模式"');
    expect(presentationSource).toContain('aria-haspopup={option.value === "CANCELLED" ? "dialog" : undefined}');
    expect(presentationSource).toContain('aria-busy={verifyingPickupOrderId === order.id}');
  });
});
