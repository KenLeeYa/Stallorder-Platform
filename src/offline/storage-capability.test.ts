import { describe, expect, it } from "vitest";
import { classifyStorageCapability } from "@/offline/storage-capability";

const thresholds = {
  minimumAvailableBytes: 100,
  criticalUsagePercent: 90,
};

describe("offline storage capability", () => {
  it("allows persistent storage with sufficient remaining capacity", () => {
    expect(classifyStorageCapability({
      indexedDbAvailable: true,
      storageApiAvailable: true,
      usageBytes: 100,
      quotaBytes: 1000,
      persisted: true,
    }, thresholds).classification).toBe("PERSISTENT");
  });

  it("classifies non-persistent storage as best effort", () => {
    expect(classifyStorageCapability({
      indexedDbAvailable: true,
      storageApiAvailable: true,
      usageBytes: 100,
      quotaBytes: 1000,
      persisted: false,
    }, thresholds).classification).toBe("BEST_EFFORT");
  });

  it("fails closed when capacity is unknown or nearly exhausted", () => {
    expect(classifyStorageCapability({
      indexedDbAvailable: true,
      storageApiAvailable: true,
      usageBytes: null,
      quotaBytes: null,
      persisted: true,
    }, thresholds).classification).toBe("INSUFFICIENT");
    expect(classifyStorageCapability({
      indexedDbAvailable: true,
      storageApiAvailable: true,
      usageBytes: 950,
      quotaBytes: 1000,
      persisted: true,
    }, thresholds).classification).toBe("INSUFFICIENT");
  });

  it("rejects offline writes when browser storage APIs are unavailable", () => {
    expect(classifyStorageCapability({
      indexedDbAvailable: false,
      storageApiAvailable: false,
      usageBytes: null,
      quotaBytes: null,
      persisted: false,
    }, thresholds).classification).toBe("UNAVAILABLE");
  });
});
