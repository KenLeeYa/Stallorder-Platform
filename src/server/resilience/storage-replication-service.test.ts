import { describe, expect, it } from "vitest";
import {
  sha256Hex,
  storageReplicationRetryDelayMs,
} from "./storage-replication-service";

describe("storage replication helpers", () => {
  it("creates a stable SHA-256 checksum without retaining object bytes", () => {
    expect(sha256Hex(new TextEncoder().encode("stallorder"))).toBe(
      "1697fb34109498ffd3341b2b20f277cb0cbf341902077a4b81a68589a38b07bc",
    );
  });

  it("uses bounded exponential retry delays", () => {
    expect(storageReplicationRetryDelayMs(1)).toBe(15_000);
    expect(storageReplicationRetryDelayMs(2)).toBe(30_000);
    expect(storageReplicationRetryDelayMs(20)).toBe(900_000);
  });
});
