import { describe, expect, it, vi } from "vitest";
import { EntitlementError } from "@/server/billing/entitlement-service";
import { assertOfflinePrintEntitlement } from "@/server/offline/offline-sync-service";

describe("offline print synchronization entitlement", () => {
  it("reauthorizes non-empty print jobs against the current subscription", async () => {
    const checker = { assertFeatureEnabled: vi.fn().mockResolvedValue({}) };

    await expect(assertOfflinePrintEntitlement(
      "organization-1",
      true,
      checker,
    )).resolves.toBeUndefined();
    expect(checker.assertFeatureEnabled).toHaveBeenCalledWith(
      "organization-1",
      "PRINTER_INTEGRATION",
    );
  });

  it.each([
    "FEATURE_NOT_INCLUDED",
    "SUBSCRIPTION_SUSPENDED",
  ] as const)("rejects stale print permits with %s", async (code) => {
    const checker = {
      assertFeatureEnabled: vi.fn().mockRejectedValue(new EntitlementError(code)),
    };

    await expect(assertOfflinePrintEntitlement(
      "organization-1",
      true,
      checker,
    )).rejects.toMatchObject({ code });
  });

  it("does not query billing for orders without print jobs", async () => {
    const checker = { assertFeatureEnabled: vi.fn() };

    await expect(assertOfflinePrintEntitlement(
      "organization-1",
      false,
      checker,
    )).resolves.toBeUndefined();
    expect(checker.assertFeatureEnabled).not.toHaveBeenCalled();
  });
});
