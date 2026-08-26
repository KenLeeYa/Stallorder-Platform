import { describe, expect, it } from "vitest";
import {
  createPublicApiCredential,
  publicApiKeyHash,
} from "@/server/developer-platform/public-api-credentials";

describe("Public API credentials", () => {
  it("returns a one-time key while persisting only its prefix and hash", () => {
    const credential = createPublicApiCredential();

    expect(credential.rawKey).toMatch(/^slo_v1_[A-Za-z0-9_-]{8,24}_[A-Za-z0-9_-]{40,60}$/);
    expect(credential.keyPrefix).toMatch(/^slo_v1_[A-Za-z0-9_-]{8,24}$/);
    expect(credential.keyHash).toMatch(/^[a-f0-9]{64}$/);
    expect(credential.keyHash).not.toContain(credential.rawKey);
    expect(publicApiKeyHash(credential.rawKey)).toBe(credential.keyHash);
  });
});
