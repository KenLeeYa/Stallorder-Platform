import { createHash, createHmac, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPerformanceTiming } from "@/lib/performance-timing";
import { prisma } from "@/lib/prisma";
import { deriveOrderSessionToken, sha256Hex } from "../../../supabase/functions/_shared/crypto";
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
const createdRequestIds = new Set<string>();
const createdSessionHashes = new Set<string>();
const createdOrderIds = new Set<string>();
const createdRateLimitHashes = new Set<string>();
const createdGlobalRateLimitKeys = new Set<string>();

class SimulatedResponseLoss extends Error {
  constructor(public readonly witness: CircuitAResponseWitness) {
    super("SIMULATED_RESPONSE_LOSS_AFTER_DB_COMMIT");
  }
}

class SimulatedOrderResponseLoss extends Error {
  constructor(public readonly witness: CircuitAOrderResponseWitness) {
    super("SIMULATED_ORDER_RESPONSE_LOSS_AFTER_DB_COMMIT");
  }
}

type CircuitAResponseWitness = {
  status: number;
  body: Record<string, unknown>;
  sessionTokenHash: string;
  operationId: string | null;
  requestId: string | null;
  serverTiming: string | null;
};

type CircuitAOrderResponseWitness = {
  status: number;
  body: Record<string, unknown>;
  orderId: string;
  operationId: string | null;
  requestId: string | null;
  serverTiming: string | null;
};

runtimeDescribe.sequential("Circuit A commit / Circuit B replay against local PostgreSQL", () => {
  afterEach(async () => {
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
    await prisma.order.deleteMany({
      where: { id: { in: [...createdOrderIds] } },
    });
    await prisma.orderSession.deleteMany({
      where: { tokenHash: { in: [...createdSessionHashes] } },
    });
    await prisma.publicRateLimitBucket.deleteMany({
      where: { dimensionHash: { in: [...createdRateLimitHashes] } },
    });
    await prisma.rateLimitBucket.deleteMany({
      where: { key: { in: [...createdGlobalRateLimitKeys] } },
    });
    createdRequestIds.clear();
    createdSessionHashes.clear();
    createdOrderIds.clear();
    createdRateLimitHashes.clear();
    createdGlobalRateLimitKeys.clear();
  });

  it("replays one committed session after the Circuit A response is lost", async () => {
    const functionsUrl = loopbackUrl("PUBLIC_ORDER_DB_REPLAY_FUNCTIONS_URL");
    loopbackUrl("DATABASE_URL", "56322");
    const abuseSecret = requiredEnv("ABUSE_HASH_SECRET");
    const tokenSecret = requiredEnv("TOKEN_DERIVATION_SECRET");
    const operationId = randomUUID();
    const circuitBRequestId = `circuit-b-replay-${randomUUID()}`;
    const clientIp = documentationIpv6();
    const input: IssueOrderSessionInput = {
      qrToken: "demo-aming-chicken-qr-2026-rotate-me",
      deviceId: randomUUID(),
      sessionRequestId: randomUUID(),
      orderingMode: "DEFAULT",
      includeMenu: false,
    };
    const sessionToken = await deriveOrderSessionToken(
      input.sessionRequestId!,
      input.qrToken,
      input.deviceId,
      tokenSecret,
    );
    const expectedSessionTokenHash = await sha256Hex(sessionToken);
    createdSessionHashes.add(expectedSessionTokenHash);
    const sessionRateLimitHashes = [
      `ip:${clientIp}`,
      `device:${input.deviceId}`,
      `scan:${input.orderingMode}:${clientIp}:${input.deviceId}:${input.qrToken}`,
    ].map((value) => createHmac("sha256", abuseSecret).update(value).digest("hex"));
    for (const hash of sessionRateLimitHashes) {
      createdRateLimitHashes.add(hash);
    }
    trackGlobalRateLimitKeys(
      "SESSION",
      sessionRateLimitHashes[0],
      sessionRateLimitHashes[1],
      sessionRateLimitHashes[2],
    );

    let lostResponse: SimulatedResponseLoss | null = null;
    try {
      await commitSessionThenLoseResponse(functionsUrl, input, {
        clientIp,
        operationId,
      });
    } catch (error) {
      if (error instanceof SimulatedResponseLoss) lostResponse = error;
      else throw error;
    }
    expect(lostResponse).not.toBeNull();
    const circuitAWitness = lostResponse!.witness;
    expect(circuitAWitness.status).toBe(201);
    expect(circuitAWitness.operationId).toBe(operationId);
    expect(circuitAWitness.requestId).toBeTruthy();
    expect(dbQueryCount(circuitAWitness.serverTiming)).toBe(4);
    expect(circuitAWitness.body).toMatchObject({
      orderSessionToken: sessionToken,
      orderingMode: "DEFAULT",
    });
    expect(circuitAWitness.sessionTokenHash).toBe(expectedSessionTokenHash);
    createdRequestIds.add(circuitAWitness.requestId!);

    const logs: Array<{
      level: string;
      event: string;
      fields: Record<string, unknown>;
    }> = [];
    const timing = createPerformanceTiming({
      route: "/api/public/order-session",
      requestId: circuitBRequestId,
      operationId,
      logger: (level, event, fields) => logs.push({ level, event, fields }),
    });
    createdRequestIds.add(circuitBRequestId);
    const { issueOrderSessionThroughCircuitB } = await import("./circuit-b-service");
    const circuitB = await issueOrderSessionThroughCircuitB(input, {
      clientIp,
      requestId: circuitBRequestId,
      timing,
    });
    timing.finish({ status: circuitB.status });

    expect(circuitB.status).toBe(200);
    expect(circuitB.body).toEqual(circuitAWitness.body);

    const sessions = await prisma.orderSession.findMany({
      where: { tokenHash: circuitAWitness.sessionTokenHash },
      select: { id: true, status: true, tokenHash: true },
    });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      status: "ACTIVE",
      tokenHash: circuitAWitness.sessionTokenHash,
    });

    const attempts = await prisma.publicOrderAttempt.findMany({
      where: { requestId: { in: [circuitAWitness.requestId!, circuitBRequestId] } },
      orderBy: { createdAt: "asc" },
      select: {
        requestId: true,
        eventType: true,
        outcome: true,
        reasonCode: true,
        orderSessionHash: true,
      },
    });
    expect(attempts).toEqual(expect.arrayContaining([
      {
        requestId: circuitAWitness.requestId,
        eventType: "SESSION_ISSUE",
        outcome: "ALLOWED",
        reasonCode: "SESSION_ISSUED",
        orderSessionHash: circuitAWitness.sessionTokenHash,
      },
      {
        requestId: circuitBRequestId,
        eventType: "SESSION_ISSUE",
        outcome: "ALLOWED",
        reasonCode: "SESSION_IDEMPOTENT_REPLAY",
        orderSessionHash: circuitAWitness.sessionTokenHash,
      },
    ]));
    expect(logs).toContainEqual(expect.objectContaining({
      level: "info",
      event: "request_completed",
      fields: expect.objectContaining({
        requestId: circuitBRequestId,
        operationId,
        status: 200,
        dbQueryCount: 5,
      }),
    }));
  }, 30_000);

  it("replays one committed order after the Circuit A response is lost", async () => {
    const functionsUrl = loopbackUrl("PUBLIC_ORDER_DB_REPLAY_FUNCTIONS_URL");
    loopbackUrl("DATABASE_URL", "56322");
    const abuseSecret = requiredEnv("ABUSE_HASH_SECRET");
    const operationId = randomUUID();
    const circuitBRequestId = `circuit-b-order-replay-${randomUUID()}`;
    const clientIp = documentationIpv6();
    const qrToken = "demo-aming-chicken-qr-2026-rotate-me";
    const deviceId = randomUUID();
    const sessionInput: IssueOrderSessionInput = {
      qrToken,
      deviceId,
      sessionRequestId: randomUUID(),
      orderingMode: "DEFAULT",
      includeMenu: false,
    };
    const sessionResponse = await postCircuitA(functionsUrl, "create-order-session", sessionInput, {
      clientIp,
      operationId: randomUUID(),
    });
    const sessionBody = await sessionResponse.json() as Record<string, unknown>;
    const orderSessionToken = sessionBody.orderSessionToken;
    if (typeof orderSessionToken !== "string") {
      throw new Error(`CIRCUIT_A_ORDER_SESSION_RESPONSE_${sessionResponse.status}`);
    }
    expect(sessionResponse.status).toBe(201);
    const sessionRequestId = requiredResponseHeader(sessionResponse, "x-request-id");
    const sessionHash = await sha256Hex(orderSessionToken);
    createdRequestIds.add(sessionRequestId);
    createdSessionHashes.add(sessionHash);

    const input: PublicOrderInput = {
      qrToken,
      orderSessionToken,
      deviceId,
      idempotencyKey: randomUUID(),
      clientOrderId: randomUUID(),
      turnstileIdempotencyKey: randomUUID(),
      customerName: "Circuit replay",
      customerPhone: "",
      deliveryAddress: "",
      customerNote: "commit-loss replay",
      waitAcknowledged: true,
      orderingMode: "DEFAULT",
      scheduledPickupAt: null,
      lotteryDrawId: null,
      items: [{
        productId: "44444444-4444-4444-8444-444444444441",
        quantity: 1,
        note: "",
        noteOptionIds: [],
        bundleChoiceIds: [],
      }],
      turnstileToken: "XXXX.DUMMY.TOKEN.XXXX",
    };
    createdOrderIds.add(input.clientOrderId!);
    const ipHash = abuseHash(abuseSecret, `ip:${clientIp}`);
    const deviceHash = abuseHash(abuseSecret, `device:${deviceId}`);
    const sessionBehaviorHash = abuseHash(
      abuseSecret,
      `scan:DEFAULT:${clientIp}:${deviceId}:${qrToken}`,
    );
    const orderBehaviorHash = abuseHash(
      abuseSecret,
      `order:DEFAULT:${deviceId}:${qrToken}:::${canonicalPublicOrderBehavior(input.items)}`,
    );
    const idempotencyHash = abuseHash(
      abuseSecret,
      `idempotency:${input.idempotencyKey}`,
    );
    for (const hash of [ipHash, deviceHash, sessionBehaviorHash, orderBehaviorHash, sessionHash]) {
      createdRateLimitHashes.add(hash);
    }
    trackGlobalRateLimitKeys("SESSION", ipHash, deviceHash, sessionBehaviorHash);
    trackGlobalRateLimitKeys("ORDER", ipHash, deviceHash, orderBehaviorHash);

    let lostResponse: SimulatedOrderResponseLoss | null = null;
    try {
      await commitOrderThenLoseResponse(functionsUrl, input, {
        clientIp,
        operationId,
      });
    } catch (error) {
      if (error instanceof SimulatedOrderResponseLoss) lostResponse = error;
      else throw error;
    }
    expect(lostResponse).not.toBeNull();
    const circuitAWitness = lostResponse!.witness;
    expect(circuitAWitness.status).toBe(201);
    expect(circuitAWitness.operationId).toBe(operationId);
    expect(circuitAWitness.requestId).toBeTruthy();
    expect(dbQueryCount(circuitAWitness.serverTiming)).toBe(6);
    expect(circuitAWitness.body).toMatchObject({
      fulfillmentType: "TAKEOUT",
      orderStatus: "WAITING_CONFIRMATION",
      paymentStatus: "UNPAID",
      totalAmount: 95,
    });
    expect(circuitAWitness.body.trackingToken).toEqual(expect.any(String));
    expect(circuitAWitness.body.pickupVerificationCode).toEqual(expect.any(String));
    createdRequestIds.add(circuitAWitness.requestId!);

    const logs: Array<{
      level: string;
      event: string;
      fields: Record<string, unknown>;
    }> = [];
    const timing = createPerformanceTiming({
      route: "/api/public/orders",
      requestId: circuitBRequestId,
      operationId,
      logger: (level, event, fields) => logs.push({ level, event, fields }),
    });
    createdRequestIds.add(circuitBRequestId);
    const { createOrderThroughCircuitB } = await import("./circuit-b-service");
    const circuitB = await createOrderThroughCircuitB(input, {
      clientIp,
      requestId: circuitBRequestId,
      timing,
    });
    timing.finish({ status: circuitB.status });

    expect(circuitB.status).toBe(200);
    expect(circuitB.body).toEqual(circuitAWitness.body);

    const orders = await prisma.order.findMany({
      where: {
        id: input.clientOrderId,
        idempotencyKey: input.idempotencyKey,
      },
      select: {
        id: true,
        orderNo: true,
        status: true,
        paymentStatus: true,
        total: true,
        orderSession: {
          select: { tokenHash: true, status: true, orderId: true },
        },
      },
    });
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({
      id: input.clientOrderId,
      orderNo: circuitAWitness.body.orderNo,
      status: "WAITING_CONFIRMATION",
      paymentStatus: "UNPAID",
      total: 95,
      orderSession: {
        tokenHash: sessionHash,
        status: "CONSUMED",
        orderId: input.clientOrderId,
      },
    });

    const attempts = await prisma.publicOrderAttempt.findMany({
      where: { requestId: { in: [circuitAWitness.requestId!, circuitBRequestId] } },
      orderBy: { createdAt: "asc" },
      select: {
        requestId: true,
        eventType: true,
        outcome: true,
        reasonCode: true,
        orderSessionHash: true,
        idempotencyHash: true,
      },
    });
    expect(attempts).toEqual([{
      requestId: circuitAWitness.requestId,
      eventType: "ORDER_SUBMIT",
      outcome: "ALLOWED",
      reasonCode: "ORDER_CREATED",
      orderSessionHash: sessionHash,
      idempotencyHash,
    }]);

    const auditLogs = await prisma.auditLog.findMany({
      where: {
        action: "PUBLIC_ORDER_CREATED",
        entityType: "ORDER",
        entityId: input.clientOrderId,
      },
      select: {
        requestId: true,
        entityId: true,
        outcome: true,
      },
    });
    expect(auditLogs).toEqual([{
      requestId: circuitAWitness.requestId,
      entityId: input.clientOrderId,
      outcome: "SUCCESS",
    }]);
    expect(logs).toContainEqual(expect.objectContaining({
      level: "info",
      event: "request_completed",
      fields: expect.objectContaining({
        requestId: circuitBRequestId,
        operationId,
        status: 200,
        dbQueryCount: 5,
      }),
    }));
  }, 30_000);
});

async function commitSessionThenLoseResponse(
  functionsUrl: URL,
  input: IssueOrderSessionInput,
  context: {
    clientIp: string;
    operationId: string;
  },
): Promise<never> {
  const response = await postCircuitA(functionsUrl, "create-order-session", input, context);
  const body = await response.json() as Record<string, unknown>;
  const responseSessionToken = body.orderSessionToken;
  if (typeof responseSessionToken !== "string") {
    throw new Error(`CIRCUIT_A_SESSION_RESPONSE_${response.status}`);
  }
  const sessionTokenHash = await sha256Hex(responseSessionToken);
  createdSessionHashes.add(sessionTokenHash);
  const witness: CircuitAResponseWitness = {
    status: response.status,
    body,
    sessionTokenHash,
    operationId: response.headers.get("x-stallorder-operation-id"),
    requestId: response.headers.get("x-request-id"),
    serverTiming: response.headers.get("server-timing"),
  };
  const committed = await prisma.orderSession.count({
    where: { tokenHash: sessionTokenHash, status: "ACTIVE" },
  });
  if (committed !== 1) {
    throw new Error(`CIRCUIT_A_SESSION_COMMIT_COUNT_${committed}`);
  }
  throw new SimulatedResponseLoss(witness);
}

async function commitOrderThenLoseResponse(
  functionsUrl: URL,
  input: PublicOrderInput,
  context: {
    clientIp: string;
    operationId: string;
  },
): Promise<never> {
  const response = await postCircuitA(functionsUrl, "create-public-order", input, context);
  const body = await response.json() as Record<string, unknown>;
  const orderId = input.clientOrderId;
  if (!orderId) throw new Error("CIRCUIT_A_ORDER_ID_REQUIRED");
  const witness: CircuitAOrderResponseWitness = {
    status: response.status,
    body,
    orderId,
    operationId: response.headers.get("x-stallorder-operation-id"),
    requestId: response.headers.get("x-request-id"),
    serverTiming: response.headers.get("server-timing"),
  };
  const committed = await prisma.order.count({
    where: { id: orderId, idempotencyKey: input.idempotencyKey },
  });
  if (committed !== 1) {
    throw new Error(`CIRCUIT_A_ORDER_COMMIT_COUNT_${committed}_STATUS_${response.status}`);
  }
  throw new SimulatedOrderResponseLoss(witness);
}

function postCircuitA(
  functionsUrl: URL,
  functionName: "create-order-session" | "create-public-order",
  input: IssueOrderSessionInput | PublicOrderInput,
  context: {
    clientIp: string;
    operationId: string;
  },
) {
  return fetch(
    new URL(functionName, `${functionsUrl.toString().replace(/\/$/, "")}/`),
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://127.0.0.1:3000",
        "cf-connecting-ip": context.clientIp,
        "x-stallorder-operation-id": context.operationId,
        "x-stallorder-protocol-version": "1",
      },
      body: JSON.stringify(input),
    },
  );
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

function requiredResponseHeader(response: Response, name: string) {
  const value = response.headers.get(name);
  if (!value) throw new Error(`CIRCUIT_A_RESPONSE_HEADER_${name.toUpperCase()}_MISSING`);
  return value;
}

function documentationIpv6() {
  const groups = randomUUID().replaceAll("-", "").match(/.{4}/g)?.slice(0, 6);
  if (!groups || groups.length !== 6) throw new Error("RANDOM_IPV6_GENERATION_FAILED");
  return `2001:db8:${groups.join(":")}`;
}

function dbQueryCount(serverTiming: string | null) {
  const match = serverTiming?.match(/(?:^|,\s*)db-query-count;dur=(\d+)(?:,|$)/);
  return match ? Number(match[1]) : null;
}

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the DB replay harness.`);
  return value;
}

function loopbackUrl(name: string, requiredPort?: string) {
  const url = new URL(requiredEnv(name));
  if (!["127.0.0.1", "localhost", "::1"].includes(url.hostname)) {
    throw new Error(`${name} must target a loopback host.`);
  }
  if (requiredPort && url.port !== requiredPort) {
    throw new Error(`${name} must target port ${requiredPort}.`);
  }
  return url;
}
