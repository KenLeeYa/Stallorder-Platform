import { describe, expect, it } from "vitest";
import { reconcileStaffOrderAlerts } from "./staff-order-alert-reconciliation";

describe("staff order alert reconciliation", () => {
  it("distinguishes new orders from confirmed orders returned for customer edits", () => {
    const previous = new Map([
      ["confirmed-edit", "CONFIRMED"],
      ["already-waiting", "WAITING_CONFIRMATION"],
      ["completed", "COMPLETED"],
    ]);

    expect(reconcileStaffOrderAlerts(previous, [
      { id: "confirmed-edit", status: "WAITING_CONFIRMATION" },
      { id: "already-waiting", status: "WAITING_CONFIRMATION" },
      { id: "brand-new", status: "WAITING_CONFIRMATION" },
    ])).toEqual({
      newOrderCount: 1,
      modifiedOrderCount: 1,
    });
    expect(previous).toEqual(new Map([
      ["confirmed-edit", "WAITING_CONFIRMATION"],
      ["already-waiting", "WAITING_CONFIRMATION"],
      ["brand-new", "WAITING_CONFIRMATION"],
    ]));
  });
});
