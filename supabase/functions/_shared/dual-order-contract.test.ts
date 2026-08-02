import { describe, expect, it } from "vitest";
import { deriveOrderSessionToken } from "./crypto";
import {
  canonicalPublicOrderBehavior,
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

  it("allows the same product with distinct options but rejects an identical split line", () => {
    const base = {
      qrToken: "demo-aming-chicken-qr-2026-rotate-me",
      orderSessionToken: `stos_${"a".repeat(43)}`,
      deviceId: "11111111-1111-4111-8111-111111111111",
      idempotencyKey: "22222222-2222-4222-8222-222222222222",
      turnstileToken: "turnstile-token",
    };
    const first = {
      productId: "55555555-5555-4555-8555-555555555555",
      quantity: 1,
      note: "",
      noteOptionIds: ["77777777-7777-4777-8777-777777777777"],
      bundleChoiceIds: [],
    };
    const variant = {
      ...first,
      noteOptionIds: ["88888888-8888-4888-8888-888888888888"],
    };

    expect(createPublicOrderSchema.safeParse({ ...base, items: [first, variant] }).success).toBe(true);
    expect(createPublicOrderSchema.safeParse({ ...base, items: [first, { ...first, quantity: 2 }] }).success).toBe(false);
  });

  it("canonicalizes behavior independent of line and option order", () => {
    const first = {
      productId: "abcdefab-cdef-4abc-8def-abcdefabcdef",
      quantity: 1,
      note: " 少冰 ",
      noteOptionIds: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2"],
      bundleChoiceIds: ["cccccccc-cccc-4ccc-8ccc-ccccccccccc3"],
    };
    const second = { ...first, productId: "fedcbafe-dcba-4fed-8cba-fedcbafedcba" };
    expect(canonicalPublicOrderBehavior([first, second])).toBe(canonicalPublicOrderBehavior([
      {
        ...second,
        productId: second.productId.toUpperCase(),
        noteOptionIds: [...second.noteOptionIds].reverse().map((id) => id.toUpperCase()),
        bundleChoiceIds: second.bundleChoiceIds.map((id) => id.toUpperCase()),
      },
      {
        ...first,
        productId: first.productId.toUpperCase(),
        noteOptionIds: [...first.noteOptionIds].reverse().map((id) => id.toUpperCase()),
        bundleChoiceIds: first.bundleChoiceIds.map((id) => id.toUpperCase()),
      },
    ]));
  });

  it("normalizes UUID inputs and rejects mixed-case duplicate selections", () => {
    const base = {
      qrToken: "demo-aming-chicken-qr-2026-rotate-me",
      orderSessionToken: `stos_${"a".repeat(43)}`,
      deviceId: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAA1",
      idempotencyKey: "BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBB2",
      clientOrderId: "CCCCCCCC-CCCC-4CCC-8CCC-CCCCCCCCCCC3",
      turnstileIdempotencyKey: "DDDDDDDD-DDDD-4DDD-8DDD-DDDDDDDDDDD4",
      lotteryDrawId: "EEEEEEEE-EEEE-4EEE-8EEE-EEEEEEEEEEE5",
      turnstileToken: "turnstile-token",
    };
    const productId = "ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABCDEF";
    const noteOptionId = "FEDCBAFE-DCBA-4FED-8CBA-FEDCBAFEDCBA";
    const bundleChoiceId = "ABCDEFAB-1234-4ABC-8DEF-ABCDEFABCDEF";
    const parsed = createPublicOrderSchema.parse({
      ...base,
      items: [{
        productId,
        quantity: 1,
        noteOptionIds: [noteOptionId],
        bundleChoiceIds: [bundleChoiceId],
      }],
    });

    expect(parsed.deviceId).toBe(base.deviceId.toLowerCase());
    expect(parsed.idempotencyKey).toBe(base.idempotencyKey.toLowerCase());
    expect(parsed.clientOrderId).toBe(base.clientOrderId.toLowerCase());
    expect(parsed.turnstileIdempotencyKey).toBe(base.turnstileIdempotencyKey.toLowerCase());
    expect(parsed.lotteryDrawId).toBe(base.lotteryDrawId.toLowerCase());
    expect(parsed.items[0]).toMatchObject({
      productId: productId.toLowerCase(),
      noteOptionIds: [noteOptionId.toLowerCase()],
      bundleChoiceIds: [bundleChoiceId.toLowerCase()],
    });

    const duplicateResult = createPublicOrderSchema.safeParse({
      ...base,
      items: [{
        productId,
        quantity: 1,
        noteOptionIds: [noteOptionId, noteOptionId.toLowerCase()],
        bundleChoiceIds: [bundleChoiceId, bundleChoiceId.toLowerCase()],
      }],
    });
    expect(duplicateResult.success).toBe(false);
    if (!duplicateResult.success) {
      expect(duplicateResult.error.issues.map((issue) => issue.path.join("."))).toEqual(
        expect.arrayContaining(["items.0.noteOptionIds", "items.0.bundleChoiceIds"]),
      );
    }
  });
});
