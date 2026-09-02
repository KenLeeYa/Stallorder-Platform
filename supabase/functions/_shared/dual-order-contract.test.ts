import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { deriveOrderSessionToken, derivePublicOrderTokens } from "./crypto";
import { createPerformanceTiming } from "../../../src/lib/performance-timing";
import {
  canonicalPublicOrderBehavior,
  createPublicOrderValidationCode,
  createPublicOrderSchema,
  issueOrderSessionSchema,
  publicOrderCustomerDetailsCode,
} from "./schemas";
import {
  normalizePublicOrderOperationId,
  PUBLIC_ORDER_OPERATION_ID_HEADER as CLIENT_OPERATION_ID_HEADER,
} from "../../../src/lib/public-order-operation-id";
import {
  errorMessage as edgeErrorMessage,
  getPublicOrderOperationId,
  PUBLIC_ORDER_OPERATION_ID_HEADER as EDGE_OPERATION_ID_HEADER,
  statusForCode as edgeStatusForCode,
} from "./http";
import {
  errorMessage as circuitBErrorMessage,
  statusForCode as circuitBStatusForCode,
} from "./public-order-errors";
import { createEdgePerformanceTiming } from "./performance";
import {
  canonicalPublicOrderTimestamp,
  publicOrderReplayPickupCodeLength,
} from "./public-order-replay";

const publicOrderErrorSource = readFileSync(
  fileURLToPath(new URL("./public-order-errors.ts", import.meta.url)),
  "utf8",
);
const createPublicOrderSource = readFileSync(
  fileURLToPath(new URL("../create-public-order/index.ts", import.meta.url)),
  "utf8",
);
const createOrderSessionSource = readFileSync(
  fileURLToPath(new URL("../create-order-session/index.ts", import.meta.url)),
  "utf8",
);
const circuitBServiceSource = readFileSync(
  fileURLToPath(new URL("../../../src/server/public-order/circuit-b-service.ts", import.meta.url)),
  "utf8",
);
const trustedRpcRepositorySource = readFileSync(
  fileURLToPath(new URL("../../../src/server/public-order/trusted-rpc-repository.ts", import.meta.url)),
  "utf8",
);

describe("dual public order contract", () => {
  it("uses one canonical operation id contract for both circuits", () => {
    const operationId = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA";
    const edgeOperationId = getPublicOrderOperationId(new Request(
      "https://functions.example/create-order-session",
      { headers: { [EDGE_OPERATION_ID_HEADER]: operationId } },
    ));

    expect(CLIENT_OPERATION_ID_HEADER).toBe(EDGE_OPERATION_ID_HEADER);
    expect(normalizePublicOrderOperationId(operationId)).toBe(edgeOperationId);
  });

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

  it("preserves the configured pickup-code length across Circuit A and B replay", async () => {
    const orderId = "11111111-1111-4111-8111-111111111111";
    const secret = "test-secret";

    for (const storedLength of [3, 6] as const) {
      const pickupCodeLength = publicOrderReplayPickupCodeLength(storedLength);
      const [circuitA, circuitB] = await Promise.all([
        derivePublicOrderTokens(orderId, secret, pickupCodeLength),
        derivePublicOrderTokens(orderId, secret, pickupCodeLength),
      ]);

      expect(circuitA).toEqual(circuitB);
      expect(circuitA.pickupCode).toHaveLength(storedLength);
    }
  });

  it("canonicalizes PostgreSQL timestamps with and without an explicit UTC offset", () => {
    expect(canonicalPublicOrderTimestamp("2026-08-12T20:08:30.770455+00:00"))
      .toBe("2026-08-12T20:08:30.770Z");
    expect(canonicalPublicOrderTimestamp("2026-08-12T20:08:30.770455"))
      .toBe("2026-08-12T20:08:30.770Z");
    expect(canonicalPublicOrderTimestamp("2026-08-12T20:08:30.770555+00:00"))
      .toBe("2026-08-12T20:08:30.771Z");
  });

  it("uses one pure formatter contract for successful order and session responses", () => {
    expect(createPublicOrderSource).toContain("buildPublicOrderResponse(");
    expect(circuitBServiceSource).toContain("buildPublicOrderResponse(");
    expect(createPublicOrderSource).not.toMatch(/^function publicOrderResponse/m);
    expect(circuitBServiceSource).not.toMatch(/^function publicOrderResponse/m);

    expect(createOrderSessionSource).toContain("buildPublicOrderSessionResponse(");
    expect(circuitBServiceSource).toContain("buildPublicOrderSessionResponse(");
    expect(createOrderSessionSource).toContain("buildPublicOrderResumeResponse(");
    expect(circuitBServiceSource).toContain("buildPublicOrderResumeResponse(");
  });

  it("keeps every declared public error response identical across both circuits", () => {
    const publicErrorCodes = [...new Set(
      [...publicOrderErrorSource.matchAll(/^\s{4}([A-Z][A-Z0-9_]+):/gm)]
        .map((match) => match[1]),
    )];
    const unknownMessage = edgeErrorMessage("UNKNOWN_GOLDEN_ERROR");

    expect(publicErrorCodes.length).toBeGreaterThan(70);
    for (const code of publicErrorCodes) {
      expect(edgeErrorMessage(code)).not.toBe(unknownMessage);
      expect(edgeErrorMessage(code)).toBe(circuitBErrorMessage(code));
      expect(edgeStatusForCode(code)).toBe(circuitBStatusForCode(code));
      expect(edgeStatusForCode(code)).toBeGreaterThanOrEqual(400);
      expect(edgeStatusForCode(code)).toBeLessThan(600);
    }
  });

  it("maps unavailable table state to a resource conflict in both circuits", () => {
    expect(edgeStatusForCode("TABLE_UNAVAILABLE")).toBe(409);
    expect(circuitBStatusForCode("TABLE_UNAVAILABLE")).toBe(409);
  });

  it("uses one canonical DB preflight while retaining the same transaction RPCs", () => {
    expect(createOrderSessionSource).toMatch(
      /admin\.rpc\(\s*"public_order_preflight_with_special_closure"/,
    );
    expect(createPublicOrderSource).toMatch(
      /admin\.rpc\(\s*"public_order_preflight_with_special_closure"/,
    );
    expect(trustedRpcRepositorySource).toContain(
      "select public.public_order_preflight_with_special_closure(",
    );
    expect(circuitBServiceSource.match(/preflightPublicOrder\(/g)).toHaveLength(2);

    expect(createOrderSessionSource).toContain(
      'admin.rpc("issue_idempotent_order_session_with_schedule_targeted"',
    );
    expect(createPublicOrderSource).toContain(
      '"create_public_order_with_daily_pickup_code_targeted"',
    );
    expect(createOrderSessionSource).not.toContain(
      'admin.rpc("issue_idempotent_order_session_with_schedule",',
    );
    expect(createPublicOrderSource).not.toContain(
      '"create_public_order_with_fulfillment_time",',
    );
    expect(circuitBServiceSource).toContain("issueIdempotentOrderSession({");
    expect(circuitBServiceSource).toContain("createPublicOrderWithSchedule({");

    const forbiddenPreflightCalls = [
      "lookupResumablePublicOrder(",
      "lookupPublicOrderIdempotency(",
      "getOrderSessionMode(sessionHash)",
      "getPublicSessionMenuContext(",
    ];
    for (const call of forbiddenPreflightCalls) {
      expect(circuitBServiceSource).not.toContain(call);
    }
  });

  it("keeps query-budget and audit-correlation fields aligned", async () => {
    const requestId = "request-golden-test";
    const operationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const edgeLogger = vi.fn();
    const circuitBLogger = vi.fn();
    const edgeNowValues = [0, 1, 2, 3];
    const circuitBNowValues = [0, 1, 2, 3];
    const edgeTiming = createEdgePerformanceTiming({
      route: "/functions/v1/create-order-session",
      requestId,
      operationId,
      now: () => edgeNowValues.shift() ?? 3,
      logger: edgeLogger,
    });
    const circuitBTiming = createPerformanceTiming({
      route: "/api/public/order-session",
      requestId,
      operationId,
      now: () => circuitBNowValues.shift() ?? 3,
      logger: circuitBLogger,
    });

    await edgeTiming.measureDb(async () => undefined, 4);
    await circuitBTiming.measureDb(async () => undefined, 5);
    const edgeResult = edgeTiming.finish(201);
    const circuitBResult = circuitBTiming.finish({ status: 201 });

    expect(edgeResult.serverTiming).toContain("db-query-count;dur=4");
    expect(circuitBResult.serverTiming).toContain("db-query-count;dur=5");
    expect(edgeLogger).toHaveBeenCalledWith(expect.objectContaining({
      requestId,
      operationId,
      status: 201,
      dbQueryCount: 4,
    }));
    expect(circuitBLogger).toHaveBeenCalledWith(
      "info",
      "request_completed",
      expect.objectContaining({
        requestId,
        operationId,
        status: 201,
        dbQueryCount: 5,
      }),
    );
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

  it("preserves the specific missing PREORDER time code without weakening strict validation", () => {
    const base = {
      qrToken: "demo-aming-chicken-qr-2026-rotate-me",
      orderSessionToken: `stos_${"a".repeat(43)}`,
      deviceId: "11111111-1111-4111-8111-111111111111",
      idempotencyKey: "22222222-2222-4222-8222-222222222222",
      orderingMode: "PREORDER" as const,
      scheduledPickupAt: null,
      items: [{
        productId: "55555555-5555-4555-8555-555555555555",
        quantity: 1,
        noteOptionIds: [],
        bundleChoiceIds: [],
      }],
      turnstileToken: "turnstile-token",
    };
    const missingTime = createPublicOrderSchema.safeParse(base);
    const tampered = createPublicOrderSchema.safeParse({ ...base, organizationId: crypto.randomUUID() });

    expect(missingTime.success).toBe(false);
    expect(tampered.success).toBe(false);
    if (missingTime.success || tampered.success) throw new Error("expected validation failures");
    expect(createPublicOrderValidationCode(missingTime.error)).toBe("PREORDER_TIME_REQUIRED");
    expect(createPublicOrderValidationCode(tampered.error)).toBe("INVALID_REQUEST");
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

  it("requires a time for PREORDER and accepts an optional requested time for takeaway or delivery", () => {
    const base = {
      qrToken: "demo-aming-chicken-qr-2026-rotate-me",
      orderSessionToken: `stos_${"a".repeat(43)}`,
      deviceId: "11111111-1111-4111-8111-111111111111",
      idempotencyKey: "22222222-2222-4222-8222-222222222222",
      items: [{
        productId: "55555555-5555-4555-8555-555555555555",
        quantity: 1,
      }],
      turnstileToken: "turnstile-token",
    };
    const requestedTime = "2099-08-03T04:00:00.000Z";

    expect(createPublicOrderSchema.safeParse({
      ...base,
      orderingMode: "PREORDER",
    }).success).toBe(false);
    expect(createPublicOrderSchema.safeParse({
      ...base,
      orderingMode: "PREORDER",
      scheduledPickupAt: requestedTime,
    }).success).toBe(true);
    expect(createPublicOrderSchema.safeParse({
      ...base,
      orderingMode: "DEFAULT",
      scheduledPickupAt: requestedTime,
    }).success).toBe(true);
    expect(createPublicOrderSchema.safeParse({
      ...base,
      orderingMode: "DELIVERY",
      customerPhone: "0912345678",
      deliveryAddress: "Taipei",
      scheduledPickupAt: requestedTime,
    }).success).toBe(true);
  });

  it.each([
    {
      name: "shared-link takeaway",
      orderingMode: "PREORDER" as const,
      qrContext: { dining_table_id: null, fulfillment_type_context: "TAKEOUT" },
      customerName: "",
      customerPhone: "0912345678",
      deliveryAddress: "",
      expected: "INVALID_CUSTOMER_DETAILS",
    },
    {
      name: "shared-link takeaway with invalid phone",
      orderingMode: "PREORDER" as const,
      qrContext: { dining_table_id: null, fulfillment_type_context: "TAKEOUT" },
      customerName: "Lin",
      customerPhone: "bad",
      deliveryAddress: "",
      expected: "INVALID_CUSTOMER_DETAILS",
    },
    {
      name: "shared-link delivery",
      orderingMode: "DELIVERY" as const,
      qrContext: { dining_table_id: null, fulfillment_type_context: "DELIVERY" },
      customerName: "Lin",
      customerPhone: "0912345678",
      deliveryAddress: "",
      expected: "INVALID_DELIVERY_DETAILS",
    },
    {
      name: "table QR",
      orderingMode: "DEFAULT" as const,
      qrContext: { dining_table_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", fulfillment_type_context: null },
      customerName: "",
      customerPhone: "",
      deliveryAddress: "",
      expected: null,
    },
    {
      name: "general QR",
      orderingMode: "DEFAULT" as const,
      qrContext: { dining_table_id: null, fulfillment_type_context: null },
      customerName: "",
      customerPhone: "",
      deliveryAddress: "",
      expected: null,
    },
  ])("validates public customer details for $name", ({
    orderingMode,
    qrContext,
    customerName,
    customerPhone,
    deliveryAddress,
    expected,
  }) => {
    expect(publicOrderCustomerDetailsCode({
      customerName,
      customerPhone,
      deliveryAddress,
    }, orderingMode, qrContext)).toBe(expected);
  });

  it("keeps both order circuits on the shared post-preflight customer-details gate", () => {
    const circuitBSource = readFileSync(
      fileURLToPath(new URL("../../../src/server/public-order/circuit-b-service.ts", import.meta.url)),
      "utf8",
    );

    expect(createPublicOrderSource).toContain("publicOrderCustomerDetailsCode(");
    expect(circuitBSource).toContain("publicOrderCustomerDetailsCode(");
    expect(createPublicOrderSource.indexOf("publicOrderCustomerDetailsCode(")).toBeGreaterThan(
      createPublicOrderSource.indexOf("if (!preflight.ok)"),
    );
    expect(circuitBSource.indexOf("publicOrderCustomerDetailsCode(")).toBeGreaterThan(
      circuitBSource.indexOf("if (!preflight?.ok)"),
    );
    expect(createPublicOrderSource.indexOf("publicOrderCustomerDetailsCode(")).toBeGreaterThan(
      createPublicOrderSource.indexOf("const existing = preflight.idempotent_order"),
    );
    expect(circuitBSource.indexOf("publicOrderCustomerDetailsCode(")).toBeGreaterThan(
      circuitBSource.indexOf("const existing = preflight.idempotent_order"),
    );
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
