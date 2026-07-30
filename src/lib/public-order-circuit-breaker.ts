export type PublicOrderCircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

type PublicOrderCircuitBreakerOptions = {
  failureThreshold?: number;
  cooldownMs?: number;
};

export class PublicOrderCircuitBreaker {
  private state: PublicOrderCircuitState = "CLOSED";
  private failureCount = 0;
  private openedAt = 0;
  private halfOpenProbeInFlight = false;
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;

  constructor(options: PublicOrderCircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 2;
    this.cooldownMs = options.cooldownMs ?? 10_000;
  }

  allowRequest(now = Date.now()) {
    if (this.state === "CLOSED") return true;
    if (
      this.state === "OPEN"
      && now - this.openedAt >= this.cooldownMs
    ) {
      this.state = "HALF_OPEN";
      this.halfOpenProbeInFlight = true;
      return true;
    }
    if (this.state === "HALF_OPEN" && !this.halfOpenProbeInFlight) {
      this.halfOpenProbeInFlight = true;
      return true;
    }
    return false;
  }

  recordSuccess() {
    this.state = "CLOSED";
    this.failureCount = 0;
    this.openedAt = 0;
    this.halfOpenProbeInFlight = false;
  }

  recordInfrastructureFailure(now = Date.now()) {
    this.halfOpenProbeInFlight = false;
    if (this.state === "HALF_OPEN") {
      this.open(now);
      return;
    }

    this.failureCount += 1;
    if (this.failureCount >= this.failureThreshold) this.open(now);
  }

  snapshot() {
    return {
      state: this.state,
      failureCount: this.failureCount,
      openedAt: this.openedAt,
      halfOpenProbeInFlight: this.halfOpenProbeInFlight,
    };
  }

  private open(now: number) {
    this.state = "OPEN";
    this.openedAt = now;
    this.halfOpenProbeInFlight = false;
  }
}
