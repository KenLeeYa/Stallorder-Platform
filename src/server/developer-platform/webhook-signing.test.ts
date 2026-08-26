import { describe, expect, it } from "vitest";
import { createWebhookSignature, verifyWebhookSignature } from "@/server/developer-platform/webhook-signing";

describe("outbound webhook signing", () => {
  it("binds the timestamp and exact payload bytes", () => {
    const secret = "test-secret-at-least-thirty-two-characters";
    const timestamp = "1787712000";
    const payload = '{"event":"ORDER_COMPLETED","version":1}';
    const signature = createWebhookSignature({ secret, timestamp, payload });

    expect(signature).toMatch(/^v1=[a-f0-9]{64}$/);
    expect(verifyWebhookSignature({ secret, timestamp, payload, signature })).toBe(true);
    expect(verifyWebhookSignature({ secret, timestamp, payload: `${payload} `, signature })).toBe(false);
    expect(verifyWebhookSignature({ secret, timestamp: "1787712001", payload, signature })).toBe(false);
  });
});
