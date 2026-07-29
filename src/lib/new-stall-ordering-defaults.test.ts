import { describe, expect, it } from "vitest";
import { newStallOrderingSettings } from "./new-stall-ordering-defaults";

describe("new stall ordering defaults", () => {
  it("keeps only cash payment support and Traditional Chinese enabled", () => {
    expect(newStallOrderingSettings("organization-id")).toEqual({
      organizationId: "organization-id",
      dineInEnabled: false,
      deliveryModuleEnabled: false,
      printModuleEnabled: false,
      paymentModuleEnabled: true,
      discountModuleEnabled: false,
      enabledLocales: ["zh-TW"],
    });
  });
});
