import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    billingFeatureFlag: {
      findMany: vi.fn(),
    },
  },
}));

import { eInvoiceFeatureFlagCodes, eInvoiceFeatureFlagDefaults } from "./e-invoice-feature-flags";

describe("e-invoice feature flag defaults", () => {
  it("keeps every e-invoice capability disabled until an explicit release gate enables it", () => {
    expect(eInvoiceFeatureFlagCodes).toHaveLength(13);
    expect(Object.values(eInvoiceFeatureFlagDefaults)).toEqual(
      eInvoiceFeatureFlagCodes.map(() => false),
    );
  });
});
