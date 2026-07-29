import { describe, expect, it } from "vitest";
import { offlineSyncLockName } from "@/offline/offline-sync-lock";

describe("offline sync lock", () => {
  it("isolates the browser lock by installation", () => {
    expect(offlineSyncLockName("device-a")).toBe("stallorder-offline-sync:device-a");
    expect(offlineSyncLockName("device-a")).not.toBe(offlineSyncLockName("device-b"));
  });
});
