import { describe, expect, it } from "vitest";
import {
  allPreparationStepsComplete,
  deterministicSetupOrderUuid,
} from "./merchant-setup-service";

const completed = {
  merchantProfileCompleted: true,
  stallProfileCompleted: true,
  catalogCompleted: true,
  paymentOptionsCompleted: true,
  teamSetupCompleted: true,
  qrPreviewCompleted: true,
};

describe("merchant setup policy", () => {
  it("requires every preparation step before a test order", () => {
    expect(allPreparationStepsComplete(completed)).toBe(true);
    expect(allPreparationStepsComplete({ ...completed, qrPreviewCompleted: false })).toBe(false);
  });

  it("builds a stable UUID idempotency key per setup attempt", () => {
    const first = deterministicSetupOrderUuid("setup-id:1");
    expect(first).toBe(deterministicSetupOrderUuid("setup-id:1"));
    expect(first).not.toBe(deterministicSetupOrderUuid("setup-id:2"));
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
