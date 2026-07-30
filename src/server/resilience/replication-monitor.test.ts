import { describe, expect, it } from "vitest";
import { classifyReplicationObservation } from "./replication-monitor";

describe("replication health classification", () => {
  it("requires a connected worker, compatible schema, and measured lag", () => {
    expect(classifyReplicationObservation({
      subscriptionPresent: true,
      workerPid: 42,
      lagSeconds: 3,
      schemaCompatible: true,
    })).toBe("CONNECTED");
  });

  it("reports disconnected when the subscription worker is absent", () => {
    expect(classifyReplicationObservation({
      subscriptionPresent: true,
      workerPid: null,
      lagSeconds: 2,
      schemaCompatible: true,
    })).toBe("DISCONNECTED");
  });

  it("reports degraded for schema drift, unknown lag, or excessive lag", () => {
    expect(classifyReplicationObservation({
      subscriptionPresent: true,
      workerPid: 42,
      lagSeconds: 1,
      schemaCompatible: false,
    })).toBe("DEGRADED");
    expect(classifyReplicationObservation({
      subscriptionPresent: true,
      workerPid: 42,
      lagSeconds: null,
      schemaCompatible: true,
    })).toBe("DEGRADED");
    expect(classifyReplicationObservation({
      subscriptionPresent: true,
      workerPid: 42,
      lagSeconds: 31,
      schemaCompatible: true,
    })).toBe("DEGRADED");
  });
});
