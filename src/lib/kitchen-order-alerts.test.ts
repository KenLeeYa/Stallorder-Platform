import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  kitchenAlertOrderStatuses,
  reconcileKitchenOrderAlerts,
} from "./kitchen-order-alerts";

describe("kitchen order alerts", () => {
  it("includes customer orders before staff confirmation", () => {
    expect(kitchenAlertOrderStatuses).toEqual([
      "WAITING_CONFIRMATION",
      "CONFIRMED",
      "PREPARING",
      "PACKING",
      "READY",
    ]);
  });

  it("alerts once when an order arrives and not again after confirmation", () => {
    const knownOrderIds = new Set(["existing-order"]);

    expect(reconcileKitchenOrderAlerts(knownOrderIds, [
      "existing-order",
      "new-waiting-order",
    ])).toBe(1);
    expect(reconcileKitchenOrderAlerts(knownOrderIds, [
      "existing-order",
      "new-waiting-order",
    ])).toBe(0);
  });

  it("restores the saved sound preference before starting live intake", () => {
    const staffSource = readFileSync(fileURLToPath(new URL(
      "../components/staff-order-board-controller.ts",
      import.meta.url,
    )), "utf8").replace(/\r\n/g, "\n");
    const kitchenSource = readFileSync(fileURLToPath(new URL(
      "../components/kitchen-board.tsx",
      import.meta.url,
    )), "utf8").replace(/\r\n/g, "\n");

    const staffPreferenceIndex = staffSource.indexOf(
      'alertsEnabledRef.current = enabled;\n    const preferenceTimer',
    );
    const kitchenPreferenceIndex = kitchenSource.indexOf(
      'alertsEnabledRef.current = enabled;\n    const preferenceTimer',
    );
    expect(staffPreferenceIndex).toBeGreaterThan(-1);
    expect(kitchenPreferenceIndex).toBeGreaterThan(-1);
    expect(staffPreferenceIndex).toBeLessThan(staffSource.indexOf("startStaffOrderLiveLifecycle({"));
    expect(kitchenPreferenceIndex).toBeLessThan(kitchenSource.indexOf("new EventSource("));
  });
});
