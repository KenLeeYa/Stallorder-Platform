import { describe, expect, it } from "vitest";
import {
  createEventAttributionToken,
  verifyEventAttributionToken,
} from "@/server/event-growth/event-attribution-token";

describe("signed event attribution token", () => {
  it("detects tampering and expiry", () => {
    const secret = "event-test-secret-at-least-thirty-two-chars";
    const payload = {
      organizationId: "11111111-1111-4111-8111-111111111111",
      marketEventId: "22222222-2222-4222-8222-222222222222",
      campaignId: "33333333-3333-4333-8333-333333333333",
      expiresAt: 1_800_000_000,
    };
    const token = createEventAttributionToken(payload, secret);

    expect(verifyEventAttributionToken(token, secret, 1_790_000_000)).toEqual(payload);
    expect(() => verifyEventAttributionToken(`${token}x`, secret, 1_790_000_000)).toThrow("EVENT_ATTRIBUTION_TOKEN_INVALID");
    expect(() => verifyEventAttributionToken(token, secret, 1_800_000_001)).toThrow("EVENT_ATTRIBUTION_TOKEN_EXPIRED");
  });
});
