export type StaffFulfillmentType = "TAKEOUT" | "DINE_IN" | "DELIVERY";

type StaffFulfillmentSettings = {
  dineInEnabled: boolean;
  staffDeliveryEnabled: boolean;
};

export function getStaffFulfillmentModules(settings: StaffFulfillmentSettings | null | undefined) {
  return {
    dineIn: settings?.dineInEnabled ?? false,
    delivery: settings?.staffDeliveryEnabled ?? false,
  };
}

export function getStaffFulfillmentError(
  fulfillmentType: StaffFulfillmentType,
  settings: StaffFulfillmentSettings,
): "TABLE_UNAVAILABLE" | "DELIVERY_UNAVAILABLE" | null {
  if (fulfillmentType === "DINE_IN" && !settings.dineInEnabled) return "TABLE_UNAVAILABLE";
  if (fulfillmentType === "DELIVERY" && !settings.staffDeliveryEnabled) return "DELIVERY_UNAVAILABLE";
  return null;
}
