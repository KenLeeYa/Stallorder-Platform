import { describe, expect, it } from "vitest";
import {
  classifyDatabaseLatency,
  probeDatabase,
  providerDependency,
  summarizeCoreHealth,
  unknownDependency,
  type DependencyHealth,
} from "./health-service";

function dependency(status: DependencyHealth["status"]): DependencyHealth {
  return {
    key: "database",
    status,
    checkedAt: "2026-07-29T00:00:00.000Z",
    latencyMs: null,
    reasonCode: null,
  };
}

describe("resilience health service", () => {
  it("classifies database latency without exposing connection details", () => {
    expect(classifyDatabaseLatency(799, 800)).toBe("HEALTHY");
    expect(classifyDatabaseLatency(801, 800)).toBe("DEGRADED");
  });

  it("records a successful probe using a controlled response shape", async () => {
    const result = await probeDatabase("primaryDatabase", async () => 1, {
      degradedAfterMs: 5_000,
    });

    expect(result).toMatchObject({
      key: "primaryDatabase",
      status: "HEALTHY",
      reasonCode: null,
    });
    expect(result.latencyMs).toBeTypeOf("number");
  });

  it("replaces probe errors with a fixed reason code", async () => {
    const result = await probeDatabase("primaryDatabase", async () => {
      throw new Error("postgresql://user:secret@example.invalid/database");
    });

    expect(result.status).toBe("UNAVAILABLE");
    expect(result.reasonCode).toBe("PROBE_FAILED");
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("bounds a stalled probe with a timeout", async () => {
    const result = await probeDatabase(
      "primaryDatabase",
      () => new Promise(() => undefined),
      { timeoutMs: 5 },
    );

    expect(result.status).toBe("UNAVAILABLE");
    expect(result.reasonCode).toBe("PROBE_TIMEOUT");
  });

  it("treats primary failure as unavailable and DR failure as degraded", () => {
    expect(summarizeCoreHealth(
      dependency("UNAVAILABLE"),
      dependency("HEALTHY"),
    )).toBe("UNAVAILABLE");
    expect(summarizeCoreHealth(
      dependency("HEALTHY"),
      dependency("UNAVAILABLE"),
    )).toBe("DEGRADED");
  });

  it("represents unavailable probes as unknown instead of healthy", () => {
    expect(unknownDependency("replication", "NOT_CONFIGURED")).toMatchObject({
      key: "replication",
      status: "UNKNOWN",
      latencyMs: null,
      reasonCode: "NOT_CONFIGURED",
    });
  });

  it("maps provider availability without treating configuration as health", () => {
    expect(providerDependency("linePay", "AVAILABLE")).toMatchObject({
      status: "HEALTHY",
      reasonCode: null,
    });
    expect(providerDependency("linePay", "UNKNOWN")).toMatchObject({
      status: "UNKNOWN",
      reasonCode: "PROVIDER_UNKNOWN",
    });
  });
});
