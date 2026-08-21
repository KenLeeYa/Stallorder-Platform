import { describe, expect, it } from "vitest";
import { newStallOrderingSettings } from "./new-stall-ordering-defaults";

describe("new stall ordering defaults", () => {
  it("keeps only cash payment support and Traditional Chinese enabled", () => {
    expect(newStallOrderingSettings("organization-id")).toEqual({
      organizationId: "organization-id",
      dineInEnabled: false,
      deliveryModuleEnabled: false,
      staffDeliveryEnabled: false,
      printModuleEnabled: false,
      kdsModuleEnabled: false,
      paymentModuleEnabled: true,
      discountModuleEnabled: false,
      takeoutPreorderEnabled: false,
      lotteryEnabled: false,
      enabledLocales: ["zh-TW"],
    });
  });
});
