import { describe, expect, it } from "vitest";
import {
  assertCatalogVersionTransition,
  catalogChannelOverrideSchema,
  catalogChannels,
  catalogVersionStatuses,
} from "@/server/catalog-versions/catalog-version-contract";

describe("channel-aware catalog contract", () => {
  it("supports every current and reserved ordering channel", () => {
    expect(catalogChannels).toEqual([
      "QR",
      "STAFF_POS",
      "LINE_ORDERING",
      "BRANDED_WEB",
      "FOODPANDA",
      "UBER_EATS",
      "KIOSK",
      "MARKETPLACE",
      "PHONE_ORDER",
      "DELIVERY_PARTNER",
    ]);
  });

  it("uses the reviewed catalog lifecycle from the Master Prompt", () => {
    expect(catalogVersionStatuses).toEqual([
      "DRAFT",
      "IN_REVIEW",
      "APPROVED",
      "SCHEDULED",
      "PUBLISHING",
      "ACTIVE",
      "SUPERSEDED",
      "ROLLED_BACK",
      "FAILED",
      "ARCHIVED",
    ]);
  });

  it("rejects lifecycle shortcuts that bypass review or publishing", () => {
    expect(() => assertCatalogVersionTransition("DRAFT", "ACTIVE")).toThrow("CATALOG_VERSION_TRANSITION_INVALID");
    expect(() => assertCatalogVersionTransition("DRAFT", "IN_REVIEW")).not.toThrow();
    expect(() => assertCatalogVersionTransition("APPROVED", "PUBLISHING")).not.toThrow();
    expect(() => assertCatalogVersionTransition("PUBLISHING", "ACTIVE")).not.toThrow();
  });

  it("validates money, quantity, time windows and override scope", () => {
    const valid = {
      channel: "QR",
      productId: "11111111-1111-4111-8111-111111111111",
      stallId: "22222222-2222-4222-8222-222222222222",
      regionCode: null,
      priceAmount: 120,
      visible: true,
      availableQuantity: 10,
      dailyReplenishmentQuantity: 20,
      effectiveFrom: "2026-08-26T00:00:00.000Z",
      effectiveUntil: "2026-08-27T00:00:00.000Z",
      hqLocked: false,
    };
    expect(catalogChannelOverrideSchema.safeParse(valid).success).toBe(true);
    expect(catalogChannelOverrideSchema.safeParse({ ...valid, priceAmount: -1 }).success).toBe(false);
    expect(catalogChannelOverrideSchema.safeParse({ ...valid, availableQuantity: -1 }).success).toBe(false);
    expect(catalogChannelOverrideSchema.safeParse({
      ...valid,
      effectiveUntil: "2026-08-25T00:00:00.000Z",
    }).success).toBe(false);
    expect(catalogChannelOverrideSchema.safeParse({
      ...valid,
      stallId: null,
      regionCode: null,
    }).success).toBe(false);
  });
});
