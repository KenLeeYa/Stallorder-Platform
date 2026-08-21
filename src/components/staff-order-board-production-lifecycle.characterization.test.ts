import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(fileURLToPath(new URL(
  "./staff-order-board-controller.ts",
  import.meta.url,
)), "utf8").replace(/\r\n/g, "\n");
const lifecycleSource = readFileSync(fileURLToPath(new URL(
  "./staff-order-board-production-lifecycle.ts",
  import.meta.url,
)), "utf8").replace(/\r\n/g, "\n");

describe("StaffOrderBoard production lifecycle characterization", () => {
  it("owns production commands and applies authoritative command responses", () => {
    expect(source).toContain("const production = useStaffOrderProductionLifecycle({");
    expect(lifecycleSource).toContain("const result = await dependencies.transitionOrder({");
    expect(lifecycleSource).toContain("const result = await dependencies.transitionItem({");
    expect(lifecycleSource).toContain("const result = await dependencies.transitionAllItems({");
    expect(lifecycleSource).toContain("applyStaffOrderProductionResult(current, result)");
    expect(lifecycleSource).toContain("replaceStaffOrderProductionOrders(current, result.orders)");
  });

  it("preserves order, item, and batch busy/error/success semantics", () => {
    expect(lifecycleSource).toContain("setUpdatingOrderId(orderId);");
    expect(lifecycleSource).toContain("setUpdatingItemId(itemId);");
    expect(lifecycleSource).toContain("setUpdatingItemsOrderId(orderId);");
    expect(lifecycleSource).toContain("setBatchBusy(true);");
    expect(lifecycleSource).toContain('setMessage(error instanceof Error ? error.message : NETWORK_ERROR_MESSAGE);');
    expect(lifecycleSource).toContain("setSelectedItemIds(new Set());");
    expect(lifecycleSource).toContain("setUndoBatch(result.undoBatch);");
    expect(lifecycleSource).toContain('setMessage("已復原上一筆批次餐點操作。");');
  });

  it("reconciles selection against authoritative snapshots and expires undo state", () => {
    expect(source).toContain("reconcileProduction(snapshot.mergedOrders);");
    expect(lifecycleSource).toContain("reconcileStaffOrderProductionSelection(current, authoritativeOrders)");
    expect(lifecycleSource).toContain("new Date(undoBatch.undoExpiresAt).getTime() - Date.now()");
    expect(lifecycleSource).toContain("window.setTimeout(() => setUndoBatch(null), delay)");
  });
});
