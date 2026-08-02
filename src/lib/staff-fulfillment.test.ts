import { describe, expect, it } from "vitest";
import { getStaffFulfillmentError, getStaffFulfillmentModules } from "./staff-fulfillment";

describe("staff fulfillment settings", () => {
  it("keeps dine-in tied to the dine-in module", () => {
    expect(getStaffFulfillmentModules({
      dineInEnabled: true,
      staffDeliveryEnabled: false,
    })).toEqual({ dineIn: true, delivery: false });
    expect(getStaffFulfillmentError("DINE_IN", {
      dineInEnabled: false,
      staffDeliveryEnabled: true,
    })).toBe("TABLE_UNAVAILABLE");
  });

  it("does not use the public delivery module for staff delivery", () => {
    const settings = {
      dineInEnabled: true,
      staffDeliveryEnabled: false,
      deliveryModuleEnabled: true,
    };

    expect(getStaffFulfillmentModules(settings)).toEqual({ dineIn: true, delivery: false });
    expect(getStaffFulfillmentError("DELIVERY", settings)).toBe("DELIVERY_UNAVAILABLE");
  });

  it("allows staff delivery when its dedicated module is enabled", () => {
    const settings = {
      dineInEnabled: false,
      staffDeliveryEnabled: true,
      deliveryModuleEnabled: false,
    };

    expect(getStaffFulfillmentModules(settings)).toEqual({ dineIn: false, delivery: true });
    expect(getStaffFulfillmentError("DELIVERY", settings)).toBeNull();
    expect(getStaffFulfillmentError("TAKEOUT", settings)).toBeNull();
  });

  it("defaults both optional modules to disabled when settings are absent", () => {
    expect(getStaffFulfillmentModules(null)).toEqual({ dineIn: false, delivery: false });
  });
});
