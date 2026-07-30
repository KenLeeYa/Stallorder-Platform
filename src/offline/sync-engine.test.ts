import { describe, expect, it } from "vitest";
import { calculateOfflineRetryDelay } from "@/offline/sync-engine";

describe("offline synchronization retry", () => {
  it("uses exponential backoff with bounded jitter", () => {
    expect(calculateOfflineRetryDelay(1, 0)).toBe(1_500);
    expect(calculateOfflineRetryDelay(1, 1)).toBe(2_500);
    expect(calculateOfflineRetryDelay(2, 0.5)).toBe(4_000);
    expect(calculateOfflineRetryDelay(3, 0.5)).toBe(8_000);
  });

  it("caps retry delay at the five-minute policy", () => {
    expect(calculateOfflineRetryDelay(20, 0.5)).toBe(300_000);
    expect(calculateOfflineRetryDelay(20, 1)).toBe(300_000);
  });
});
