import { beforeEach, describe, expect, it, vi } from "vitest";

const { featureFlagMock } = vi.hoisted(() => ({ featureFlagMock: vi.fn() }));

vi.mock("../billing-feature-flags", () => ({ isBillingFeatureEnabled: featureFlagMock }));

import { disabledWebhookResponse } from "./disabled-webhook-response";

describe("disabledWebhookResponse", () => {
  beforeEach(() => featureFlagMock.mockReset());

  it("returns SERVICE_NOT_ENABLED without reading or processing a webhook", async () => {
    featureFlagMock.mockResolvedValue(false);
    const response = await disabledWebhookResponse("ECPAY_BILLING_ENABLED");
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ code: "SERVICE_NOT_ENABLED" });
  });

  it("remains closed when a future flag is enabled before configuration exists", async () => {
    featureFlagMock.mockResolvedValue(true);
    const response = await disabledWebhookResponse("NEWEBPAY_BILLING_ENABLED");
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ code: "BILLING_PROVIDER_NOT_CONFIGURED" });
  });
});
