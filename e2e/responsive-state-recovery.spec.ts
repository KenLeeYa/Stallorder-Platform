import { createHmac, randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { createResponsiveOrderFixture } from "./helpers/responsive-order-fixture";
import { readResponsiveBuildProvenance } from "../scripts/responsive-build-provenance.mjs";

test.use({ serviceWorkers: "block" });

async function createEdgeOrder(request: APIRequestContext, prisma: PrismaClient) {
  const fixture = await createResponsiveOrderFixture(prisma);
  const deviceId = randomUUID();
  const idempotencyKey = randomUUID();
  const ip = `198.18.${Number.parseInt(fixture.runId.slice(0, 2), 16)}.${Number.parseInt(fixture.runId.slice(2, 4), 16)}`;
  const headers = {
    origin: process.env.PLAYWRIGHT_APP_URL!,
    "x-stallorder-protocol-version": "1",
    "x-stallorder-operation-id": randomUUID(),
    "cf-connecting-ip": ip,
    "x-vercel-forwarded-for": ip,
  };
  const edge = process.env.NEXT_PUBLIC_SUPABASE_URL + "/functions/v1";
  const issued = await request.post(edge + "/create-order-session", {
    headers,
    data: { qrToken: fixture.qrToken, deviceId, orderingMode: "DEFAULT", sessionRequestId: randomUUID() },
  });
  const session = await issued.json() as { orderSessionToken?: string; code?: string };
  expect(issued.status(), session.code).toBe(201);
  expect(session.orderSessionToken).toBeTruthy();
  const noteGroups = await prisma.productNoteGroupAssignment.findMany({
    where: { productId: fixture.productId },
    include: { noteGroup: { include: { options: true } } },
  });
  const noteOptionIds = noteGroups.map((assignment) => assignment.noteGroup.options[0].id);
  expect(noteOptionIds).toHaveLength(2);
  const data = {
    qrToken: fixture.qrToken, deviceId, orderingMode: "DEFAULT",
    orderSessionToken: session.orderSessionToken, clientOrderId: randomUUID(), idempotencyKey,
    turnstileIdempotencyKey: randomUUID(), turnstileToken: "XXXX.DUMMY.TOKEN.XXXX",
    customerName: "同鍵恢復 QA", customerPhone: "0912345678", waitAcknowledged: true,
    items: [{ productId: fixture.productId, quantity: 1, noteOptionIds }],
  };
  const created = await request.post(edge + "/create-public-order", { headers, data });
  const payload = await created.json() as { orderNo?: string; trackingToken?: string; code?: string };
  expect(created.status(), payload.code).toBe(201);
  expect(payload.trackingToken).toBeTruthy();
  const order = await prisma.order.findFirstOrThrow({
    where: { idempotencyKey }, select: { id: true, deviceHash: true },
  });
  return { deviceId, idempotencyKey, headers, edge, data, created, payload, order };
}

test("RSP-Q01: a real Edge retry keeps one order, payment and usage identity", async ({ request }, testInfo) => {
  test.setTimeout(120_000);
  readResponsiveBuildProvenance();
  const prisma = new PrismaClient();
  try {
    const { idempotencyKey, headers, edge, data, created, payload, order } = await createEdgeOrder(request, prisma);
    const before = {
      paymentCount: await prisma.payment.count({ where: { orderId: order.id } }),
      usageEventCount: await prisma.usageEvent.count({ where: { referenceId: order.id } }),
    };
    const replay = await request.post(edge + "/create-public-order", {
      headers: { ...headers, "x-stallorder-operation-id": randomUUID() }, data,
    });
    const replayPayload = await replay.json() as { orderNo?: string; trackingToken?: string; code?: string };
    expect(replay.status(), replayPayload.code).toBe(200);
    expect(replayPayload.orderNo).toBe(payload.orderNo);
    expect(replayPayload.trackingToken).toBe(payload.trackingToken);
    const replayOrder = await prisma.order.findFirstOrThrow({ where: { idempotencyKey }, select: { id: true } });
    expect(replayOrder.id).toBe(order.id);
    expect(await prisma.order.count({ where: { idempotencyKey } })).toBe(1);
    const after = {
      paymentCount: await prisma.payment.count({ where: { orderId: order.id } }),
      usageEventCount: await prisma.usageEvent.count({ where: { referenceId: order.id } }),
    };
    expect(after.paymentCount).toBe(before.paymentCount);
    expect(after.usageEventCount).toBe(before.usageEventCount);
    await testInfo.attach("idempotent-order-receipt", {
      contentType: "application/json",
      body: JSON.stringify({ orderId: order.id, firstStatus: created.status(), replayStatus: replay.status(), before, after }),
    });
  } finally {
    await prisma.$disconnect();
  }
});

test("RSP-Q02: Edge and Node agree on an owned order's device identity", async ({ request }, testInfo) => {
  readResponsiveBuildProvenance();
  const prisma = new PrismaClient();
  try {
    const { deviceId, headers, edge, payload, order } = await createEdgeOrder(request, prisma);
    const expectedDeviceHash = createHmac("sha256", process.env.ABUSE_HASH_SECRET!)
      .update(`device:${deviceId}`).digest("hex");
    const edgeRead = await request.post(edge + "/get-public-order", {
      headers, data: { trackingToken: payload.trackingToken, deviceId },
    });
    const nodeRead = await request.get(`/api/public/orders/${payload.trackingToken}`, {
      headers: { ...headers, "x-stallorder-device-id": deviceId },
    });
    await testInfo.attach("cross-runtime-identity-receipt", {
      contentType: "application/json",
      body: JSON.stringify({ orderId: order.id, edgeRead: edgeRead.status(), nodeRead: nodeRead.status(), deviceHashMatchesNode: order.deviceHash === expectedDeviceHash }),
    });
    expect(edgeRead.status(), "Edge should read its created order").toBe(200);
    expect(order.deviceHash === expectedDeviceHash, "Edge order must use the shared device hash").toBe(true);
    expect(nodeRead.status(), "Node should read the Edge-created order").toBe(200);
  } finally {
    await prisma.$disconnect();
  }
});
