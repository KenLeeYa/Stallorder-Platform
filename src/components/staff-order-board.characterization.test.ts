import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(fileURLToPath(new URL(
  "./staff-order-board-controller.ts",
  import.meta.url,
)), "utf8").replace(/\r\n/g, "\n");
const productionSource = readFileSync(fileURLToPath(new URL(
  "./staff-order-board-production.ts",
  import.meta.url,
)), "utf8").replace(/\r\n/g, "\n");
const productionLifecycleSource = readFileSync(fileURLToPath(new URL(
  "./staff-order-board-production-lifecycle.ts",
  import.meta.url,
)), "utf8").replace(/\r\n/g, "\n");
const presentationSource = readFileSync(fileURLToPath(new URL(
  "./staff-order-board-presentation.tsx",
  import.meta.url,
)), "utf8").replace(/\r\n/g, "\n");
const posSource = readFileSync(fileURLToPath(new URL(
  "./staff-order-board-pos.ts",
  import.meta.url,
)), "utf8").replace(/\r\n/g, "\n");
const offlineSource = readFileSync(fileURLToPath(new URL(
  "./staff-order-board-offline.ts",
  import.meta.url,
)), "utf8").replace(/\r\n/g, "\n");
const fulfillmentSource = readFileSync(fileURLToPath(new URL(
  "./staff-order-board-fulfillment.ts",
  import.meta.url,
)), "utf8").replace(/\r\n/g, "\n");

describe("StaffOrderBoard characterization", () => {
  it("keeps authoritative staff and offline order intake on the same board", () => {
    expect(source).toContain("function handleStaffOrderCreated(order: OrderWithItems)");
    expect(source).toContain("knownOrderIdsRef.current.add(order.id)");
    expect(source).toContain("current.filter((candidate) => candidate.id !== order.id)");
    expect(source).toContain(".sort((left, right) => left.createdAt.localeCompare(right.createdAt))");
    expect(source).toContain("setComposerOpen(false)");
    expect(source).toContain('setViewMode("TICKETS")');
    expect(source).toContain('order.source === "OFFLINE_POS"');
    expect(source).toContain('order.paymentStatus === "PAID"');
  });

  it("refreshes POS configuration before composing orders or opening checkout", () => {
    expect(posSource).toContain(
      '`/api/stalls/${stallSlug}/pos-configuration${includeCatalog ? "?includeCatalog=true" : ""}`',
    );
    expect(posSource).toContain('{ cache: "no-store" }');
    expect(source).toContain("return await loadStaffOrderPosConfiguration({");
    expect(source).toContain("const latest = await refreshPosConfiguration(true);");
    expect(source).toContain("const latest = await refreshPosConfiguration();");
    expect(source).toContain("prepareStaffOrderComposerIntake(posSnapshot, latest)");
    expect(source).toContain("selectStaffOrderPosSnapshot(posSnapshot, latest)");
    expect(source).toContain("modules: activeSnapshot.modules");
    expect(source).toContain("paymentOptions: activeSnapshot.paymentOptions");
  });

  it("preserves payment reconciliation and authoritative checkout responses", () => {
    expect(productionLifecycleSource).toContain("const result = await dependencies.transitionOrder({");
    expect(productionSource).toContain('...(input.status === "COMPLETED" ? options.checkout : {}),');
    expect(fulfillmentSource).toContain('`/api/stalls/${input.stallSlug}/table-checkout`');
    expect(source).toContain("orderIds: checkoutOrders.map((order) => order.id)");
    expect(source).toContain("const completedIds = new Set(await checkoutStaffDiningTable({");
    expect(fulfillmentSource).toContain("return payload.orderIds ?? [];");
    expect(source).toContain('if (order.paymentStatus !== "PAID") continue;');
    expect(source).toContain('await updateOrder(order.id, "COMPLETED")');
  });

  it("keeps print and pickup commands behind the fulfillment boundary", () => {
    expect(source).toContain("setMessage(await queueStaffOrderPrint({");
    expect(source).toContain("const pickup = await verifyStaffOrderPickup({");
    expect(fulfillmentSource).toContain('import("@/offline/offline-operations")');
    expect(fulfillmentSource).toContain('`/api/stalls/${input.stallSlug}/print-jobs`');
    expect(fulfillmentSource).toContain('{ operation: "QUEUE", orderId: input.orderId }');
    expect(fulfillmentSource).toContain('`/api/stalls/${input.stallSlug}/orders/${input.orderId}/verify-pickup`');
    expect(fulfillmentSource).toContain('input.command.mode === "MANUAL" ? "人工取餐核對失敗。" : "取餐碼驗證失敗。"');
  });

  it("preserves online and offline production transitions", () => {
    expect(productionLifecycleSource).toContain("const result = await dependencies.transitionItem({");
    expect(productionLifecycleSource).toContain("const result = await dependencies.transitionAllItems({");
    expect(productionLifecycleSource).toContain("applyStaffOrderProductionResult(current, result)");
    expect(productionSource).toContain('input.currentOrder?.source === "OFFLINE_POS"');
    expect(productionSource).toContain('input.status === "PREPARING"\n      ? "LOCAL_PREPARING"');
    expect(productionSource).toContain(': input.status === "READY" ? "LOCAL_READY" : "LOCAL_COMPLETED";');
    expect(productionSource).toContain("offline.transitionOfflineOrder(input.orderId, nextState)");
    expect(productionSource).toContain('`/api/stalls/${input.stallSlug}/orders/${input.orderId}/items`');
    expect(productionSource).toContain('body: JSON.stringify({ status: input.status })');
  });

  it("keeps offline synchronization wired to an authoritative order refetch", () => {
    expect(presentationSource).toContain("<OfflineQueueStatus");
    expect(presentationSource).toContain("stallId={stall.id}");
    expect(presentationSource).toContain("stallSlug={stall.slug}");
    expect(source).toContain("loadOfflineOrders: loadOfflineStaffOrders");
    expect(source).toContain("useEffect(() => startStaffOrderOfflineIntake({");
    expect(source).toContain("onSynchronized: () => void refreshStaffOrdersAfterOfflineSync(refreshOrders)");
    expect(offlineSource).toContain('window.addEventListener("stallorder:offline-data-changed", listener)');
    expect(offlineSource).toContain('order.orderStatus !== "LOCAL_COMPLETED"');
    expect(offlineSource).toContain('order.orderStatus !== "LOCAL_CANCELLED"');
    expect(offlineSource).toContain("return refreshOrders(true);");
  });

  it("keeps the existing live badge and manual refresh selectors", () => {
    expect(presentationSource).toContain("<LiveConnectionBadge state={liveConnection} t={t} />");
    expect(presentationSource).toContain('title={t("common.refresh")}');
    expect(presentationSource).toContain('<span className="sr-only">{t("common.refresh")}</span>');
    expect(presentationSource).toContain('role="status"');
  });
});
