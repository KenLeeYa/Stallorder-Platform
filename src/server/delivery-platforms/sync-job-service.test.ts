import { describe, expect, it } from "vitest";
import { deterministicExternalOrderUuid } from "./external-order-service";
import { deliveryActionIdempotencyKey } from "./external-order-status-service";
import { deliveryRetryAt } from "./sync-job-service";

describe("delivery job safety helpers", () => {
  it("uses bounded exponential retry windows", () => {
    const now = new Date("2026-07-30T00:00:00.000Z");
    expect(deliveryRetryAt(1, true, now)?.toISOString()).toBe("2026-07-30T00:01:00.000Z");
    expect(deliveryRetryAt(3, true, now)?.toISOString()).toBe("2026-07-30T00:15:00.000Z");
    expect(deliveryRetryAt(99, true, now)?.toISOString()).toBe("2026-07-30T06:00:00.000Z");
    expect(deliveryRetryAt(1, false, now)).toBeNull();
  });

  it("derives stable canonical and provider idempotency keys", () => {
    const first = deterministicExternalOrderUuid("MOCK:external-order-001");
    const second = deterministicExternalOrderUuid("MOCK:external-order-001");
    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
    expect(deliveryActionIdempotencyKey("MOCK", "external-order-001", "READY"))
      .toBe("stallorder:MOCK:external-order-001:READY");
  });
});
