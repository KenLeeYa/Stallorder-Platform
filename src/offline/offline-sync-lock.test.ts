import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const leaseMocks = vi.hoisted(() => ({
  acquireOfflineSyncLease: vi.fn(),
  releaseOfflineSyncLease: vi.fn(),
  renewOfflineSyncLease: vi.fn(),
}));

vi.mock("@/offline/offline-db", () => leaseMocks);

import { offlineSyncLockName, withOfflineSyncLock } from "@/offline/offline-sync-lock";

describe("offline sync lock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    leaseMocks.acquireOfflineSyncLease.mockResolvedValue(true);
    leaseMocks.releaseOfflineSyncLease.mockResolvedValue(undefined);
    leaseMocks.renewOfflineSyncLease.mockResolvedValue(undefined);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("isolates the browser lock by installation", () => {
    expect(offlineSyncLockName("device-a")).toBe("stallorder-offline-sync:device-a");
    expect(offlineSyncLockName("device-a")).not.toBe(offlineSyncLockName("device-b"));
  });

  it("creates an IndexedDB lease owner when only getRandomValues is available", async () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => bytes.fill(0));
    const setInterval = vi.fn(() => 1);
    const clearInterval = vi.fn();
    vi.stubGlobal("crypto", { getRandomValues });
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("window", { setInterval, clearInterval });
    vi.stubGlobal("BroadcastChannel", undefined);

    const result = await withOfflineSyncLock("installation-a", async () => "completed");

    expect(result).toEqual({ acquired: true, value: "completed" });
    expect(leaseMocks.acquireOfflineSyncLease).toHaveBeenCalledWith(
      "installation-a",
      "00000000-0000-4000-8000-000000000000",
      expect.any(Number),
      60_000,
    );
    expect(leaseMocks.releaseOfflineSyncLease).toHaveBeenCalledWith(
      "installation-a",
      "00000000-0000-4000-8000-000000000000",
    );
    expect(getRandomValues).toHaveBeenCalledOnce();
    expect(setInterval).toHaveBeenCalledOnce();
    expect(clearInterval).toHaveBeenCalledWith(1);
  });
});
