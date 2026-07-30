import { describe, expect, it } from "vitest";
import { deriveOrderSessionToken } from "./crypto";
import {
  createPublicOrderSchema,
  issueOrderSessionSchema,
} from "./schemas";

describe("dual public order contract", () => {
  it("derives the same opaque session token for Circuit A and Circuit B", async () => {
    const inputs = [
      "11111111-1111-4111-8111-111111111111",
      "demo-aming-chicken-qr-2026-rotate-me",
      "22222222-2222-4222-8222-222222222222",
      "test-secret",
    ] as const;

    const [circuitA, circuitB] = await Promise.all([
      deriveOrderSessionToken(...inputs),
      deriveOrderSessionToken(...inputs),
    ]);

    expect(circuitA).toBe(circuitB);
    expect(circuitA).toMatch(/^stos_[A-Za-z0-9_-]{43}$/);
  });

  it("accepts stable cross-circuit identifiers and rejects tenant injection", () => {
    expect(issueOrderSessionSchema.safeParse({
      qrToken: "demo-aming-chicken-qr-2026-rotate-me",
      deviceId: "11111111-1111-4111-8111-111111111111",
      sessionRequestId: "22222222-2222-4222-8222-222222222222",
    }).success).toBe(true);

    const result = createPublicOrderSchema.safeParse({
      qrToken: "demo-aming-chicken-qr-2026-rotate-me",
      orderSessionToken: `stos_${"a".repeat(43)}`,
      deviceId: "11111111-1111-4111-8111-111111111111",
      idempotencyKey: "22222222-2222-4222-8222-222222222222",
      clientOrderId: "33333333-3333-4333-8333-333333333333",
      turnstileIdempotencyKey: "44444444-4444-4444-8444-444444444444",
      items: [{
        productId: "55555555-5555-4555-8555-555555555555",
        quantity: 1,
        noteOptionIds: [],
      }],
      turnstileToken: "turnstile-token",
      organizationId: "66666666-6666-4666-8666-666666666666",
    });

    expect(result.success).toBe(false);
  });
});
