import { createHash, createHmac, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { sha256Hex } from "../../../supabase/functions/_shared/crypto";
import { errorMessage } from "../../../supabase/functions/_shared/public-order-errors";
import {
  canonicalPublicOrderBehavior,
  type IssueOrderSessionInput,
  type PublicOrderInput,
} from "../../../supabase/functions/_shared/schemas";

vi.mock("@/server/resilience/feature-flag-service", () => ({
  resolveResilienceFeatureFlags: vi.fn(async () => ({
    DUAL_ORDER_INTAKE_ENABLED: {
      code: "DUAL_ORDER_INTAKE_ENABLED",
      enabled: true,
      source: "DEFAULT",
      overrideId: null,
      expiresAt: null,
    },
  })),
}));

const runtimeEnabled = process.env.PUBLIC_ORDER_DB_REPLAY === "1";
const runtimeDescribe = runtimeEnabled ? describe : describe.skip;
const origin = "http://127.0.0.1:3000";
const organizationId = "11111111-1111-4111-8111-111111111111";
const stallId = "22222222-2222-4222-8222-222222222222";
const tableId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const productId = "44444444-4444-4444-8444-444444444441";
const mainQrToken = "demo-aming-chicken-qr-2026-rotate-me";
const tableQrToken = "demo-aming-chicken-table-a1-qr-2026";
const createdRequestIds = new Set<string>();
const createdSessionHashes = new Set<string>();
const createdOrderIds = new Set<string>();
const createdQrIds = new Set<string>();
const createdScheduleIds = new Set<string>();
const createdLocationIds = new Set<string>();
const createdRateLimitHashes = new Set<string>();
const createdGlobalRateLimitKeys = new Set<string>();

type TerminalFunction = "create-order-session" | "create-public-order";
type TerminalExpectation = {
  functionName: TerminalFunction;
  input: IssueOrderSessionInput | PublicOrderInput;
  operationId: string;
  expectedStatus: number;
  expectedCode: string;
  audit?: {
    eventType: "SESSION_ISSUE" | "ORDER_SUBMIT";
    reasonCode: string;
  };
};

runtimeDescribe.sequential("Circuit A / Circuit B DB-backed terminal matrix", () => {
  afterEach(async () => {
    vi.unstubAllEnvs();
    await prisma.publicOrderAttempt.deleteMany({
      where: { requestId: { in: [...createdRequestIds] } },
    });
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { requestId: { in: [...createdRequestIds] } },
          { entityId: { in: [...createdOrderIds] } },
        ],
      },
    });
    await prisma.operationalEvent.deleteMany({
      where: { entityId: { in: [...createdOrderIds] } },
    });
    await prisma.usageEvent.deleteMany({
      where: { referenceId: { in: [...createdOrderIds] } },
    });
    await prisma.order.deleteMany({ where: { id: { in: [...createdOrderIds] } } });
    await prisma.orderSession.deleteMany({
      where: { tokenHash: { in: [...createdSessionHashes] } },
    });
    await prisma.publicRateLimitBucket.deleteMany({
      where: { dimensionHash: { in: [...createdRateLimitHashes] } },
    });
    await prisma.rateLimitBucket.deleteMany({
      where: { key: { in: [...createdGlobalRateLimitKeys] } },
    });
    await prisma.qrCode.deleteMany({ where: { id: { in: [...createdQrIds] } } });
    await prisma.stallSchedule.deleteMany({
      where: { id: { in: [...createdScheduleIds] } },
    });
    await prisma.stallLocation.deleteMany({
      where: { id: { in: [...createdLocationIds] } },
    });
    createdRequestIds.clear();
    createdSessionHashes.clear();
    createdOrderIds.clear();
    createdQrIds.clear();
    createdScheduleIds.clear();
    createdLocationIds.clear();
    createdRateLimitHashes.clear();
    createdGlobalRateLimitKeys.clear();
  });

  it("keeps DELIVERY_UNAVAILABLE canonical and audited in both circuits", async () => {
    const functionsUrl = replayFunctionsUrl();
    const settings = await prisma.stallOrderingSettings.findUniqueOrThrow({
      where: { stallId },
      select: { deliveryModuleEnabled: true },
    });
    await prisma.stallOrderingSettings.update({
      where: { stallId },
      data: { deliveryModuleEnabled: false },
    });

    try {
      const input: IssueOrderSessionInput = {
        qrToken: mainQrToken,
        deviceId: randomUUID(),
        sessionRequestId: randomUUID(),
        orderingMode: "DELIVERY",
        includeMenu: false,
      };
      await expectTerminalParity(functionsUrl, {
        functionName: "create-order-session",
        input,
        operationId: randomUUID(),
        expectedStatus: 409,
        expectedCode: "DELIVERY_UNAVAILABLE",
        audit: { eventType: "SESSION_ISSUE", reasonCode: "DELIVERY_UNAVAILABLE" },
      });
    } finally {
      await prisma.stallOrderingSettings.update({
        where: { stallId },
        data: settings,
      });
    }
  }, 30_000);

  it("keeps TABLE_UNAVAILABLE canonical and audited in both circuits", async () => {
    const functionsUrl = replayFunctionsUrl();
    const table = await prisma.diningTable.findUniqueOrThrow({
      where: { id: tableId },
      select: { isActive: true },
    });
    await prisma.diningTable.update({ where: { id: tableId }, data: { isActive: false } });

    try {
      const input: IssueOrderSessionInput = {
        qrToken: tableQrToken,
        deviceId: randomUUID(),
        sessionRequestId: randomUUID(),
        orderingMode: "DEFAULT",
        includeMenu: false,
      };
      await expectTerminalParity(functionsUrl, {
        functionName: "create-order-session",
        input,
        operationId: randomUUID(),
        expectedStatus: 409,
        expectedCode: "TABLE_UNAVAILABLE",
        audit: { eventType: "SESSION_ISSUE", reasonCode: "TABLE_UNAVAILABLE" },
      });
    } finally {
      await prisma.diningTable.update({ where: { id: tableId }, data: table });
    }
  }, 30_000);

  it("keeps SCHEDULE_CONTEXT_MISMATCH canonical and audited in both circuits", async () => {
    const functionsUrl = replayFunctionsUrl();
    const locationId = randomUUID();
    const scheduleId = randomUUID();
    const qrCodeId = randomUUID();
    const qrToken = `terminal-schedule-${randomUUID()}`;
    const now = Date.now();
    await prisma.stallLocation.create({
      data: {
        id: locationId,
        organizationId,
        stallId,
        name: `Circuit terminal ${locationId}`,
        address: "Local terminal matrix",
        isActive: true,
      },
    });
    createdLocationIds.add(locationId);
    await prisma.stallSchedule.create({
      data: {
        id: scheduleId,
        organizationId,
        stallId,
        locationId,
        startsAt: new Date(now - 60 * 60_000),
        endsAt: new Date(now + 60 * 60_000),
        orderingOpensAt: new Date(now - 60 * 60_000),
        orderingClosesAt: new Date(now + 60 * 60_000),
        status: "OPEN",
      },
    });
    createdScheduleIds.add(scheduleId);
    const latestQr = await prisma.qrCode.findFirst({
      where: { stallId },
      orderBy: { tokenVersion: "desc" },
      select: { tokenVersion: true },
    });
    await prisma.qrCode.create({
      data: {
        id: qrCodeId,
        organizationId,
        stallId,
        token: qrToken,
        label: "Circuit terminal schedule fixture",
        state: "ACTIVE",
        tokenVersion: (latestQr?.tokenVersion ?? 0) + 1,
        locationId,
        stallScheduleId: scheduleId,
        fulfillmentTypeContext: "TAKEOUT",
      },
    });
    createdQrIds.add(qrCodeId);

    const session = await issueSession(functionsUrl, qrToken, "DEFAULT");
    await prisma.qrCode.update({
      where: { id: qrCodeId },
      data: { stallScheduleId: null },
    });
    await expectTerminalParity(functionsUrl, {
      functionName: "create-public-order",
      input: orderInput(session),
      operationId: randomUUID(),
      expectedStatus: 409,
      expectedCode: "SCHEDULE_CONTEXT_MISMATCH",
      audit: { eventType: "ORDER_SUBMIT", reasonCode: "SCHEDULE_CONTEXT_MISMATCH" },
    });
  }, 30_000);

  it("keeps PREORDER_TIME_REQUIRED canonical without a DB audit", async () => {
    const functionsUrl = replayFunctionsUrl();
    const input = orderInput({
      qrToken: mainQrToken,
      deviceId: randomUUID(),
      orderSessionToken: `stos_${"a".repeat(43)}`,
      orderingMode: "PREORDER",
    });
    input.scheduledPickupAt = null;

    await expectTerminalParity(functionsUrl, {
      functionName: "create-public-order",
      input,
      operationId: randomUUID(),
      expectedStatus: 422,
      expectedCode: "PREORDER_TIME_REQUIRED",
    });
  }, 30_000);

  it("keeps IDEMPOTENCY_CONFLICT canonical and audited in both circuits", async () => {
    const functionsUrl = replayFunctionsUrl();
    const session = await issueSession(functionsUrl, mainQrToken, "DEFAULT");
    const original = orderInput(session);
    createdOrderIds.add(original.clientOrderId!);
    const createClientIp = documentationIpv6();
    trackOrderRateLimits(original, createClientIp);
    const createResponse = await postCircuitA(
      functionsUrl,
      "create-public-order",
      original,
      { clientIp: createClientIp, operationId: randomUUID() },
    );
    expect(createResponse.status).toBe(201);
    createdRequestIds.add(requiredResponseHeader(createResponse, "x-request-id"));

    const conflict = {
      ...original,
      scheduledPickupAt: new Date(Date.now() + 4 * 60 * 60_000).toISOString(),
    } satisfies PublicOrderInput;
    await expectTerminalParity(functionsUrl, {
      functionName: "create-public-order",
      input: conflict,
      operationId: randomUUID(),
      expectedStatus: 409,
      expectedCode: "IDEMPOTENCY_CONFLICT",
      audit: { eventType: "ORDER_SUBMIT", reasonCode: "IDEMPOTENCY_CONFLICT" },
    });
  }, 30_000);

  it("keeps CAPACITY_PAUSED canonical and audited in both circuits", async () => {
    const functionsUrl = replayFunctionsUrl();
    const capacity = await snapshotCapacitySettings();
    const stall = await prisma.stall.findUniqueOrThrow({
      where: { id: stallId },
      select: { orderingEnabled: true },
    });

    try {
      await setCapacitySettings({ pauseSource: "AUTO", manualWaitMinutes: null });
      const session = await issueSession(functionsUrl, mainQrToken, "DEFAULT");
      await prisma.stall.update({ where: { id: stallId }, data: { orderingEnabled: false } });
      await expectTerminalParity(functionsUrl, {
        functionName: "create-public-order",
        input: orderInput(session),
        operationId: randomUUID(),
        expectedStatus: 409,
        expectedCode: "CAPACITY_PAUSED",
        audit: { eventType: "ORDER_SUBMIT", reasonCode: "CAPACITY_PAUSED" },
      });
    } finally {
      await prisma.stall.update({ where: { id: stallId }, data: stall });
      await restoreCapacitySettings(capacity);
    }
  }, 30_000);

  it("keeps WAIT_ACKNOWLEDGMENT_REQUIRED payload and audit canonical in both circuits", async () => {
    const functionsUrl = replayFunctionsUrl();
    const capacity = await snapshotCapacitySettings();

    try {
      await setCapacitySettings({
        pauseSource: "NONE",
        manualWaitMinutes: 45,
        acknowledgmentThresholdMinutes: 30,
      });
      const session = await issueSession(functionsUrl, mainQrToken, "DEFAULT");
      const result = await expectTerminalParity(functionsUrl, {
        functionName: "create-public-order",
        input: orderInput(session),
        operationId: randomUUID(),
        expectedStatus: 422,
        expectedCode: "WAIT_ACKNOWLEDGMENT_REQUIRED",
        audit: {
          eventType: "ORDER_SUBMIT",
          reasonCode: "WAIT_ACKNOWLEDGMENT_REQUIRED",
        },
      });
      expect(result.body).toMatchObject({
        capacity: {
          estimatedWaitMinMinutes: 45,
          estimatedWaitMaxMinutes: 45,
          requiresWaitAcknowledgment: true,
        },
      });
    } finally {
      await restoreCapacitySettings(capacity);
    }
  }, 30_000);
});

async function expectTerminalParity(
  functionsUrl: URL,
  expectation: TerminalExpectation,
) {
  vi.stubEnv("TRUSTED_APP_ORIGINS", origin);
  const clientIp = documentationIpv6();
  trackRateLimits(expectation.functionName, expectation.input, clientIp);
  const circuitA = await postCircuitA(
    functionsUrl,
    expectation.functionName,
    expectation.input,
    { clientIp, operationId: expectation.operationId },
  );
  const circuitB = await postCircuitB(
    expectation.functionName,
    expectation.input,
    { clientIp, operationId: expectation.operationId },
  );
  const [bodyA, bodyB] = await Promise.all([
    circuitA.json() as Promise<Record<string, unknown>>,
    circuitB.json() as Promise<Record<string, unknown>>,
  ]);
  const requestIdA = requiredResponseHeader(circuitA, "x-request-id");
  const requestIdB = requiredResponseHeader(circuitB, "x-request-id");
  createdRequestIds.add(requestIdA);
  createdRequestIds.add(requestIdB);

  expect(circuitA.status).toBe(expectation.expectedStatus);
  expect(circuitB.status).toBe(expectation.expectedStatus);
  expect(bodyA).toEqual(bodyB);
  expect(bodyA).toMatchObject({
    code: expectation.expectedCode,
    error: errorMessage(expectation.expectedCode),
  });
  expect(circuitA.headers.get("x-stallorder-operation-id")).toBe(expectation.operationId);
  expect(circuitB.headers.get("x-stallorder-operation-id")).toBe(expectation.operationId);
  expect(circuitB.headers.get("x-order-circuit")).toBe("B");
  expect(requestIdA).not.toBe(requestIdB);

  const attempts = await prisma.publicOrderAttempt.findMany({
    where: { requestId: { in: [requestIdA, requestIdB] } },
    orderBy: { requestId: "asc" },
    select: {
      requestId: true,
      eventType: true,
      outcome: true,
      reasonCode: true,
    },
  });
  if (expectation.audit) {
    expect(attempts).toHaveLength(2);
    expect(attempts).toEqual(expect.arrayContaining([
      {
        requestId: requestIdA,
        eventType: expectation.audit.eventType,
        outcome: "DENIED",
        reasonCode: expectation.audit.reasonCode,
      },
      {
        requestId: requestIdB,
        eventType: expectation.audit.eventType,
        outcome: "DENIED",
        reasonCode: expectation.audit.reasonCode,
      },
    ]));
  } else {
    expect(attempts).toEqual([]);
  }

  return { body: bodyA, requestIds: [requestIdA, requestIdB] as const };
}

async function issueSession(
  functionsUrl: URL,
  qrToken: string,
  orderingMode: "DEFAULT" | "DELIVERY" | "PREORDER",
) {
  const clientIp = documentationIpv6();
  const input: IssueOrderSessionInput = {
    qrToken,
    deviceId: randomUUID(),
    sessionRequestId: randomUUID(),
    orderingMode,
    includeMenu: false,
  };
  trackSessionRateLimits(input, clientIp);
  const response = await postCircuitA(functionsUrl, "create-order-session", input, {
    clientIp,
    operationId: randomUUID(),
  });
  const body = await response.json() as Record<string, unknown>;
  expect(response.status).toBe(201);
  expect(body.orderSessionToken).toEqual(expect.any(String));
  const orderSessionToken = String(body.orderSessionToken);
  createdRequestIds.add(requiredResponseHeader(response, "x-request-id"));
  createdSessionHashes.add(await sha256Hex(orderSessionToken));
  return { qrToken, deviceId: input.deviceId, orderSessionToken, orderingMode };
}

function orderInput(session: {
  qrToken: string;
  deviceId: string;
  orderSessionToken: string;
  orderingMode: "DEFAULT" | "DELIVERY" | "PREORDER";
}): PublicOrderInput {
  return {
    qrToken: session.qrToken,
    orderSessionToken: session.orderSessionToken,
    deviceId: session.deviceId,
    idempotencyKey: randomUUID(),
    clientOrderId: randomUUID(),
    turnstileIdempotencyKey: randomUUID(),
    customerName: "Terminal parity",
    customerPhone: session.orderingMode === "DELIVERY" ? "0912345678" : "",
    deliveryAddress: session.orderingMode === "DELIVERY" ? "台北市測試路 1 號" : "",
    customerNote: "terminal matrix",
    waitAcknowledged: false,
    orderingMode: session.orderingMode,
    scheduledPickupAt: null,
    lotteryDrawId: null,
    items: [{
      productId,
      quantity: 1,
      note: "",
      noteOptionIds: [],
      bundleChoiceIds: [],
    }],
    turnstileToken: "XXXX.DUMMY.TOKEN.XXXX",
  };
}

function postCircuitA(
  functionsUrl: URL,
  functionName: TerminalFunction,
  input: IssueOrderSessionInput | PublicOrderInput,
  context: { clientIp: string; operationId: string },
) {
  return fetch(new URL(functionName, `${functionsUrl.toString().replace(/\/$/, "")}/`), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
      "cf-connecting-ip": context.clientIp,
      "x-stallorder-operation-id": context.operationId,
      "x-stallorder-protocol-version": "1",
    },
    body: JSON.stringify(input),
  });
}

async function postCircuitB(
  functionName: TerminalFunction,
  input: IssueOrderSessionInput | PublicOrderInput,
  context: { clientIp: string; operationId: string },
) {
  const request = new Request(
    `${origin}/api/public/${functionName === "create-order-session" ? "order-session" : "orders"}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin,
        "sec-fetch-site": "same-origin",
        "x-real-ip": context.clientIp,
        "x-vercel-forwarded-for": context.clientIp,
        "x-stallorder-operation-id": context.operationId,
        "x-stallorder-protocol-version": "1",
      },
      body: JSON.stringify(input),
    },
  );
  if (functionName === "create-order-session") {
    const route = await import("@/app/api/public/order-session/route");
    return route.POST(request);
  }
  const route = await import("@/app/api/public/orders/route");
  return route.POST(request);
}

function trackRateLimits(
  functionName: TerminalFunction,
  input: IssueOrderSessionInput | PublicOrderInput,
  clientIp: string,
) {
  if (functionName === "create-order-session") {
    trackSessionRateLimits(input as IssueOrderSessionInput, clientIp);
  } else {
    trackOrderRateLimits(input as PublicOrderInput, clientIp);
  }
}

function trackSessionRateLimits(input: IssueOrderSessionInput, clientIp: string) {
  const secret = requiredEnv("ABUSE_HASH_SECRET");
  const hashes = [
    abuseHash(secret, `ip:${clientIp}`),
    abuseHash(secret, `device:${input.deviceId}`),
    abuseHash(secret, `scan:${input.orderingMode}:${clientIp}:${input.deviceId}:${input.qrToken}`),
  ];
  hashes.forEach((hash) => createdRateLimitHashes.add(hash));
  trackGlobalRateLimitKeys("SESSION", hashes[0], hashes[1], hashes[2]);
}

function trackOrderRateLimits(input: PublicOrderInput, clientIp: string) {
  const secret = requiredEnv("ABUSE_HASH_SECRET");
  const ipHash = abuseHash(secret, `ip:${clientIp}`);
  const deviceHash = abuseHash(secret, `device:${input.deviceId}`);
  const sessionHash = createHash("sha256").update(input.orderSessionToken).digest("hex");
  const behaviorHash = abuseHash(
    secret,
    `order:${input.orderingMode}:${input.deviceId}:${input.qrToken}:${input.scheduledPickupAt ?? ""}:${input.lotteryDrawId ?? ""}:${canonicalPublicOrderBehavior(input.items)}`,
  );
  const hashes = [ipHash, deviceHash, sessionHash, behaviorHash];
  hashes.forEach((hash) => createdRateLimitHashes.add(hash));
  trackGlobalRateLimitKeys("ORDER", ipHash, deviceHash, behaviorHash);
}

function abuseHash(secret: string, value: string) {
  return createHmac("sha256", secret).update(value).digest("hex");
}

function trackGlobalRateLimitKeys(
  scope: "SESSION" | "ORDER",
  ipHash: string,
  deviceHash: string,
  behaviorHash: string,
) {
  for (const value of [
    `PUBLIC|${scope}|IP|${ipHash}`,
    `PUBLIC|${scope}|DEVICE|${deviceHash}`,
    `PUBLIC|${scope}|BEHAVIOR|${behaviorHash}`,
  ]) {
    createdGlobalRateLimitKeys.add(createHash("sha256").update(value).digest("hex"));
  }
}

type CapacitySnapshot = Awaited<ReturnType<typeof snapshotCapacitySettings>>;

async function snapshotCapacitySettings() {
  return prisma.stallCapacitySettings.findUnique({
    where: { stallId },
    select: {
      windowMinutes: true,
      maxOrdersPerWindow: true,
      maxItemsPerWindow: true,
      warningUtilizationPercent: true,
      pauseUtilizationPercent: true,
      defaultPrepMinutes: true,
      minimumQuoteMinutes: true,
      maximumQuoteMinutes: true,
      quoteBufferMinutes: true,
      acknowledgmentThresholdMinutes: true,
      manualWaitMinutes: true,
      autoPauseEnabled: true,
      autoResumeEnabled: true,
      pauseSource: true,
      isActive: true,
      lastCalculatedAt: true,
    },
  });
}

async function setCapacitySettings(input: {
  pauseSource: string;
  manualWaitMinutes: number | null;
  acknowledgmentThresholdMinutes?: number;
}) {
  await prisma.stallCapacitySettings.upsert({
    where: { stallId },
    create: {
      organizationId,
      stallId,
      pauseSource: input.pauseSource,
      manualWaitMinutes: input.manualWaitMinutes,
      acknowledgmentThresholdMinutes: input.acknowledgmentThresholdMinutes ?? 30,
      autoPauseEnabled: false,
      autoResumeEnabled: false,
      isActive: true,
    },
    update: {
      pauseSource: input.pauseSource,
      manualWaitMinutes: input.manualWaitMinutes,
      acknowledgmentThresholdMinutes: input.acknowledgmentThresholdMinutes ?? 30,
      autoPauseEnabled: false,
      autoResumeEnabled: false,
      isActive: true,
    },
  });
}

async function restoreCapacitySettings(snapshot: CapacitySnapshot) {
  if (snapshot) {
    await prisma.stallCapacitySettings.update({ where: { stallId }, data: snapshot });
  } else {
    await prisma.stallCapacitySettings.deleteMany({ where: { stallId } });
  }
}

function requiredResponseHeader(response: Response, name: string) {
  const value = response.headers.get(name);
  if (!value) throw new Error(`TERMINAL_MATRIX_HEADER_${name.toUpperCase()}_MISSING`);
  return value;
}

function documentationIpv6() {
  const groups = randomUUID().replaceAll("-", "").match(/.{4}/g)?.slice(0, 6);
  if (!groups || groups.length !== 6) throw new Error("RANDOM_IPV6_GENERATION_FAILED");
  return `2001:db8:${groups.join(":")}`;
}

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the terminal matrix.`);
  return value;
}

function replayFunctionsUrl() {
  const databaseUrl = new URL(requiredEnv("DATABASE_URL"));
  if (!["127.0.0.1", "localhost", "::1"].includes(databaseUrl.hostname)
    || databaseUrl.port !== "56322") {
    throw new Error("DATABASE_URL must target the local replay database on port 56322.");
  }
  const url = new URL(requiredEnv("PUBLIC_ORDER_DB_REPLAY_FUNCTIONS_URL"));
  if (!["127.0.0.1", "localhost", "::1"].includes(url.hostname)) {
    throw new Error("PUBLIC_ORDER_DB_REPLAY_FUNCTIONS_URL must target a loopback host.");
  }
  return url;
}
