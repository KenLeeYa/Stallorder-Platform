import { describe, expect, it } from "vitest";
import { PublicOrderCircuitBreaker } from "./public-order-circuit-breaker";

describe("PublicOrderCircuitBreaker", () => {
  it("opens only after the configured infrastructure failure threshold", () => {
    const breaker = new PublicOrderCircuitBreaker({
      failureThreshold: 2,
      cooldownMs: 1_000,
    });

    breaker.recordInfrastructureFailure(100);
    expect(breaker.snapshot().state).toBe("CLOSED");
    breaker.recordInfrastructureFailure(200);
    expect(breaker.snapshot().state).toBe("OPEN");
    expect(breaker.allowRequest(1_199)).toBe(false);
  });

  it("permits one half-open probe after cooldown and closes on success", () => {
    const breaker = new PublicOrderCircuitBreaker({
      failureThreshold: 1,
      cooldownMs: 1_000,
    });
    breaker.recordInfrastructureFailure(100);

    expect(breaker.allowRequest(1_100)).toBe(true);
    expect(breaker.snapshot().state).toBe("HALF_OPEN");
    expect(breaker.allowRequest(1_100)).toBe(false);

    breaker.recordSuccess();
    expect(breaker.snapshot()).toMatchObject({
      state: "CLOSED",
      failureCount: 0,
      halfOpenProbeInFlight: false,
    });
  });

  it("reopens when the half-open probe fails", () => {
    const breaker = new PublicOrderCircuitBreaker({
      failureThreshold: 1,
      cooldownMs: 1_000,
    });
    breaker.recordInfrastructureFailure(100);
    expect(breaker.allowRequest(1_100)).toBe(true);

    breaker.recordInfrastructureFailure(1_150);
    expect(breaker.snapshot().state).toBe("OPEN");
    expect(breaker.allowRequest(2_149)).toBe(false);
    expect(breaker.allowRequest(2_150)).toBe(true);
  });
});
