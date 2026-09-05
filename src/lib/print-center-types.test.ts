import { describe, expect, it } from "vitest";
import {
  printRuleDraftFromView,
  type PrintRuleView,
} from "./print-center-types";

describe("print rule edit payload", () => {
  it("only returns fields accepted by the strict print-rule command schema", () => {
    const rule = {
      id: "11111111-1111-4111-8111-111111111111",
      name: "廚房出單",
      printerId: "22222222-2222-4222-8222-222222222222",
      isEnabled: true,
      documentType: "KITCHEN_TICKET",
      trigger: "ORDER_CONFIRMED",
      orderSources: ["QR_MENU"],
      orderOrigins: [],
      fulfillmentTypes: ["TAKEOUT"],
      productCategoryIds: [],
      productGroupIds: [],
      copies: 1,
      fontScale: 1,
      splitMode: "NONE",
      aggregateItems: false,
      autoPrint: true,
      showCustomerName: true,
      showCustomerPhone: true,
      showDeliveryAddress: true,
      showOrderNote: true,
      showItemNotes: true,
      showPrices: true,
      showPaymentMethod: true,
      feedLines: 2,
      sortOrder: 0,
      printer: {
        id: "22222222-2222-4222-8222-222222222222",
        name: "Star",
        isEnabled: true,
      },
      organizationId: "33333333-3333-4333-8333-333333333333",
      stallId: "44444444-4444-4444-8444-444444444444",
      deletedAt: null,
      createdAt: "2026-09-05T00:00:00.000Z",
      updatedAt: "2026-09-05T00:00:00.000Z",
    } satisfies PrintRuleView & Record<string, unknown>;

    expect(printRuleDraftFromView(rule)).toEqual({
      name: "廚房出單",
      printerId: "22222222-2222-4222-8222-222222222222",
      isEnabled: true,
      documentType: "KITCHEN_TICKET",
      trigger: "ORDER_CONFIRMED",
      orderSources: ["QR_MENU"],
      orderOrigins: [],
      fulfillmentTypes: ["TAKEOUT"],
      productCategoryIds: [],
      productGroupIds: [],
      copies: 1,
      fontScale: 1,
      splitMode: "NONE",
      aggregateItems: false,
      autoPrint: true,
      showCustomerName: true,
      showCustomerPhone: true,
      showDeliveryAddress: true,
      showOrderNote: true,
      showItemNotes: true,
      showPrices: true,
      showPaymentMethod: true,
      feedLines: 2,
      sortOrder: 0,
    });
  });
});
