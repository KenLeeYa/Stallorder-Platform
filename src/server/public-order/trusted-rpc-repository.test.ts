import { beforeEach, describe, expect, it, vi } from "vitest";

const queryRaw = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: queryRaw,
  },
}));

describe("trusted public-order fulfillment-time RPC", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryRaw.mockResolvedValue([{ result: { ok: true } }]);
  });

  it("routes takeaway and delivery requested times through the unified trusted RPC", async () => {
    const { createPublicOrderWithSchedule } = await import("./trusted-rpc-repository");
    const requestedFulfillmentAt = "2099-08-03T04:00:00.000Z";

    await createPublicOrderWithSchedule({
      orderingMode: "DELIVERY",
      orderId: "11111111-1111-4111-8111-111111111111",
      qrToken: "demo-aming-chicken-qr-2026-rotate-me",
      sessionTokenHash: "session-hash",
      deviceHash: "device-hash",
      ipHash: "ip-hash",
      qrTokenHash: "qr-hash",
      behaviorHash: "behavior-hash",
      idempotencyKey: "22222222-2222-4222-8222-222222222222",
      idempotencyHash: "idempotency-hash",
      customerName: "王小明",
      customerPhone: "0912345678",
      deliveryAddress: "台北市測試路 1 號",
      customerNote: "請按門鈴",
      items: [{
        product_id: "33333333-3333-4333-8333-333333333333",
        quantity: 1,
        note: "",
        modifier_option_ids: [],
        bundle_choice_ids: [],
      }],
      trackingTokenHash: "tracking-hash",
      pickupCodeHash: "pickup-hash",
      requestId: "request-test",
      waitAcknowledged: true,
      scheduledPickupAt: requestedFulfillmentAt,
      lotteryDrawId: null,
    });

    const query = queryRaw.mock.calls[0]?.[0] as { strings: string[]; values: unknown[] };
    expect(query.strings.join("")).toContain("public.create_public_order_with_fulfillment_time");
    expect(query.values).toContain(requestedFulfillmentAt);
    expect(query.values).toContain("0912345678");
    expect(query.values).toContain("台北市測試路 1 號");
  });

  it.each([
    ["DEFAULT", "lookup_resumable_public_order"],
    ["PREORDER", "lookup_resumable_public_order"],
    ["DELIVERY", "lookup_resumable_public_delivery_order"],
  ] as const)("passes the requested %s mode to the isolated resumable-order RPC", async (orderingMode, rpcName) => {
    queryRaw.mockResolvedValueOnce([{ result: null }]);
    const { lookupResumablePublicOrder } = await import("./trusted-rpc-repository");

    await lookupResumablePublicOrder({
      orderingMode,
      qrToken: "demo-aming-chicken-qr-2026-rotate-me",
      deviceHash: "device-hash",
      ipHash: "ip-hash",
      qrTokenHash: "qr-hash",
      behaviorHash: "behavior-hash",
      requestId: "request-test",
    });

    const query = queryRaw.mock.calls.at(-1)?.[0] as { strings: string[]; values: unknown[] };
    expect(query.strings.join("")).toContain(`public.${rpcName}`);
    expect(query.values.at(-1)).toBe(orderingMode);
  });
});
