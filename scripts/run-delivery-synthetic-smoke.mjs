import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const CONNECTION_ID = "de110000-0000-4000-8000-000000000001";
const PROFILE_ID = "55555555-5555-4555-8555-555555555551";
const STALL_SLUG = "aming-chicken";
const TEST_CONFIRMATION = "EPHEMERAL_PREVIEW_ONLY";

const baseUrl = normalizeBaseUrl(required("DELIVERY_SYNTHETIC_BASE_URL"));
const webhookSecret = required("DELIVERY_MOCK_WEBHOOK_SECRET");
const cronSecret = required("CRON_SECRET");
const confirmation = required("DELIVERY_SYNTHETIC_CONFIRMATION");
const protectionBypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim() ?? "";

if (confirmation !== TEST_CONFIRMATION) {
  fail(`DELIVERY_SYNTHETIC_CONFIRMATION must equal ${TEST_CONFIRMATION}.`);
}
assertSafeSyntheticHost(baseUrl);
if (webhookSecret.length < 32 || cronSecret.length < 32) {
  fail("Synthetic secrets must contain at least 32 characters.");
}

const prisma = new PrismaClient();
let sessionId = null;
let oauthSessionTokenHash = null;
let oauthTransactionId = null;
let syntheticEventId = null;
let syntheticExternalOrderId = null;
let syntheticOrderId = null;

try {
  oauthSessionTokenHash = await validateMockOAuthFlow();
  const runId = randomUUID();
  const externalOrderId = `preview-${runId}`;
  syntheticEventId = `preview-event-${runId}`;
  syntheticExternalOrderId = externalOrderId;
  const body = JSON.stringify(createFixture(runId, externalOrderId));
  const signature = createHmac("sha256", webhookSecret).update(body).digest("hex");

  const firstWebhook = await requestJson(
    `/api/webhooks/delivery/mock`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-stallorder-delivery-connection": CONNECTION_ID,
        "x-stallorder-mock-signature": signature,
      },
      body,
    },
  );
  assertStatus(firstWebhook, 202, "first webhook");
  if (firstWebhook.json?.accepted !== true || firstWebhook.json?.duplicate !== false) {
    fail("First webhook response did not confirm a new accepted event.");
  }

  const replayWebhook = await requestJson(
    `/api/webhooks/delivery/mock`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-stallorder-delivery-connection": CONNECTION_ID,
        "x-stallorder-mock-signature": signature,
      },
      body,
    },
  );
  assertStatus(replayWebhook, 200, "replayed webhook");
  if (replayWebhook.json?.accepted !== true || replayWebhook.json?.duplicate !== true) {
    fail("Replayed webhook was not handled idempotently.");
  }

  const externalOrder = await importPendingOrder(externalOrderId);
  if (!externalOrder.internalOrderId) {
    fail("Synthetic external order was not linked to a canonical order.");
  }
  const duplicateCount = await prisma.externalOrder.count({
    where: { provider: "MOCK", externalOrderId },
  });
  if (duplicateCount !== 1) {
    fail(`Expected one external order ledger row, received ${duplicateCount}.`);
  }

  const canonicalOrder = await prisma.order.findUnique({
    where: { id: externalOrder.internalOrderId },
    include: {
      payment: { select: { id: true } },
      items: { select: { id: true } },
    },
  });
  syntheticOrderId = canonicalOrder?.id ?? null;
  if (
    !canonicalOrder
    || canonicalOrder.source !== "MOCK"
    || canonicalOrder.origin !== "IMPORTED"
    || !canonicalOrder.isTest
    || canonicalOrder.status !== "WAITING_CONFIRMATION"
    || canonicalOrder.paymentStatus !== "PENDING_RECONCILIATION"
    || canonicalOrder.payment !== null
    || canonicalOrder.items.length !== 1
  ) {
    fail("Imported order did not satisfy the canonical synthetic-order contract.");
  }

  const session = await createSyntheticSession();
  sessionId = session.id;
  const authenticatedHeaders = {
    "content-type": "application/json",
    "x-csrf-token": session.csrfToken,
    "sec-fetch-site": "same-origin",
    origin: baseUrl.origin,
    referer: `${baseUrl.origin}/staff/orders`,
    cookie: `stallorder_session=${encodeURIComponent(session.token)}; stallorder_csrf=${encodeURIComponent(session.csrfToken)}; stallorder_auth_device=${encodeURIComponent(session.deviceId)}`,
  };

  const confirmationResponse = await requestJson(
    `/api/stalls/${STALL_SLUG}/orders/${canonicalOrder.id}`,
    {
      method: "PATCH",
      headers: authenticatedHeaders,
      body: JSON.stringify({ status: "CONFIRMED" }),
    },
  );
  assertStatus(confirmationResponse, 200, "staff order confirmation");

  const confirmedOrder = await prisma.order.findUnique({
    where: { id: canonicalOrder.id },
    select: {
      status: true,
      paymentStatus: true,
      productionTasks: {
        where: { status: { not: "CANCELLED" } },
        select: { id: true },
      },
    },
  });
  if (
    !confirmedOrder
    || confirmedOrder.status !== "CONFIRMED"
    || confirmedOrder.paymentStatus !== "PENDING_RECONCILIATION"
    || confirmedOrder.productionTasks.length === 0
  ) {
    fail("Order confirmation did not create KDS production tasks.");
  }

  const taskResponse = await requestJson(
    `/api/stalls/${STALL_SLUG}/kitchen/tasks`,
    {
      method: "PATCH",
      headers: authenticatedHeaders,
      body: JSON.stringify({
        operation: "UPDATE_TASK",
        taskId: confirmedOrder.productionTasks[0].id,
        status: "PREPARING",
      }),
    },
  );
  assertStatus(taskResponse, 200, "KDS task start");

  const completeResponse = await requestJson(
    `/api/stalls/${STALL_SLUG}/kitchen/tasks`,
    {
      method: "PATCH",
      headers: authenticatedHeaders,
      body: JSON.stringify({
        operation: "COMPLETE_ORDER",
        orderId: canonicalOrder.id,
      }),
    },
  );
  assertStatus(completeResponse, 200, "KDS complete order");

  await runCron();
  const finalOrder = await prisma.order.findUnique({
    where: { id: canonicalOrder.id },
    select: { status: true, paymentStatus: true },
  });
  const finalExternalOrder = await prisma.externalOrder.findFirst({
    where: { provider: "MOCK", externalOrderId },
    select: { externalStatus: true, processingStatus: true },
  });
  const actionJobs = await prisma.deliverySyncJob.findMany({
    where: {
      provider: "MOCK",
      deduplicationKey: {
        in: [
          `${deliveryActionDeduplicationPrefix(externalOrderId)}PREPARING`,
          `${deliveryActionDeduplicationPrefix(externalOrderId)}READY`,
        ],
      },
    },
    select: { jobType: true, status: true },
  });
  if (
    finalOrder?.status !== "READY"
    || finalOrder.paymentStatus !== "PENDING_RECONCILIATION"
    || finalExternalOrder?.externalStatus !== "READY"
    || actionJobs.length !== 2
    || actionJobs.some((job) => job.status !== "SUCCEEDED")
  ) {
    fail("KDS status changes did not complete the provider synchronization contract.");
  }

  process.stdout.write(JSON.stringify({
    ok: true,
    mockOAuthVerified: true,
    provider: "MOCK",
    webhookReplayProtected: true,
    canonicalOrderCreated: true,
    kdsLinked: true,
    paymentReconciliationProtected: true,
  }) + "\n");
} finally {
  try {
    await cleanupSyntheticState();
  } finally {
    await prisma.$disconnect();
  }
}

async function validateMockOAuthFlow() {
  const start = await requestRaw("/api/auth/google/start?next=%2F", {
    method: "GET",
  });
  assertRedirect(start, "OAuth start");
  const authorizeUrl = sameOriginLocation(start, "/api/auth/mock/authorize");

  const authorization = await requestRaw(authorizeUrl, { method: "GET" });
  assertRedirect(authorization, "Mock OIDC authorization");
  const callbackUrl = sameOriginLocation(authorization, "/api/auth/google/callback");

  const callback = await requestRaw(callbackUrl, { method: "GET" });
  assertRedirect(callback, "OAuth callback");
  sameOriginLocation(callback);
  const sessionCookie = callback.headers.getSetCookie()
    .find((value) => value.startsWith("stallorder_session="));
  const sessionToken = sessionCookie
    ?.split(";", 1)[0]
    .slice("stallorder_session=".length);
  if (!sessionToken) {
    const destination = sameOriginLocation(callback);
    const oauthError = destination.searchParams.get("oauthError");
    fail(
      "Mock OAuth callback did not issue a server session"
      + ` (redirect: ${destination.pathname}, oauthError: ${oauthError ?? "none"}).`,
    );
  }
  const sessionTokenHash = sha256(decodeURIComponent(sessionToken));
  oauthSessionTokenHash = sessionTokenHash;
  const storedSession = await prisma.authSession.findUnique({
    where: { tokenHash: sessionTokenHash },
    select: { id: true },
  });
  if (!storedSession) {
    fail("Mock OAuth callback session was not persisted.");
  }
  const transaction = await prisma.oAuthTransaction.findFirst({
    where: { resultSessionId: storedSession.id },
    select: { id: true },
  });
  oauthTransactionId = transaction?.id ?? null;

  const replay = await requestRaw(callbackUrl, { method: "GET" });
  assertRedirect(replay, "OAuth callback replay");
  const replayLocation = sameOriginLocation(replay, "/login");
  if (replayLocation.searchParams.get("oauthError") !== "already-completed") {
    fail("OAuth callback replay was not rejected.");
  }
  return sessionTokenHash;
}

async function cleanupSyntheticState() {
  let orderId = syntheticOrderId;
  if (syntheticExternalOrderId && !orderId) {
    const externalOrder = await prisma.externalOrder.findFirst({
      where: {
        provider: "MOCK",
        externalOrderId: syntheticExternalOrderId,
      },
      select: { internalOrderId: true },
    });
    orderId = externalOrder?.internalOrderId ?? null;
  }

  await prisma.$transaction(async (transaction) => {
    if (syntheticExternalOrderId) {
      await transaction.deliverySyncJob.deleteMany({
        where: {
          provider: "MOCK",
          OR: [
            {
              deduplicationKey:
                `order-import:MOCK:${syntheticExternalOrderId}`,
            },
            {
              deduplicationKey: {
                startsWith:
                  deliveryActionDeduplicationPrefix(syntheticExternalOrderId),
              },
            },
          ],
        },
      });
      if (syntheticEventId) {
        await transaction.deliveryWebhookEvent.deleteMany({
          where: {
            provider: "MOCK",
            externalEventId: syntheticEventId,
          },
        });
      }
      await transaction.externalOrder.deleteMany({
        where: {
          provider: "MOCK",
          externalOrderId: syntheticExternalOrderId,
        },
      });
    }
    if (orderId) {
      await transaction.order.deleteMany({
        where: {
          id: orderId,
          source: "MOCK",
          isTest: true,
        },
      });
    }
    if (oauthTransactionId) {
      await transaction.oAuthTransaction.deleteMany({
        where: { id: oauthTransactionId },
      });
    }
    if (sessionId) {
      await transaction.authSession.deleteMany({
        where: { id: sessionId },
      });
    }
    if (oauthSessionTokenHash) {
      await transaction.authSession.deleteMany({
        where: { tokenHash: oauthSessionTokenHash },
      });
    }
  });
}

async function importPendingOrder(externalOrderId) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await runCron();
    const externalOrder = await prisma.externalOrder.findFirst({
      where: { provider: "MOCK", externalOrderId },
      select: {
        id: true,
        internalOrderId: true,
        processingStatus: true,
      },
    });
    if (externalOrder?.internalOrderId && externalOrder.processingStatus === "IMPORTED") {
      return externalOrder;
    }
    await delay(1_000);
  }
  fail("Synthetic order import did not complete before the timeout.");
}

async function runCron() {
  const response = await requestJson("/api/cron/delivery-jobs", {
    method: "GET",
    headers: { authorization: `Bearer ${cronSecret}` },
  });
  assertStatus(response, 200, "delivery job worker");
}

async function createSyntheticSession() {
  const profile = await prisma.profile.findUnique({
    where: { id: PROFILE_ID },
    select: { id: true, isActive: true, sessionVersion: true },
  });
  if (!profile?.isActive) {
    fail("Synthetic Preview profile is missing or inactive.");
  }
  const token = randomBytes(32).toString("base64url");
  const csrfToken = randomBytes(32).toString("base64url");
  const deviceId = randomUUID();
  const stored = await prisma.authSession.create({
    data: {
      profileId: profile.id,
      tokenHash: sha256(token),
      csrfTokenHash: sha256(csrfToken),
      profileSessionVersion: profile.sessionVersion,
      deviceId,
      userAgentHash: sha256("stallorder-ephemeral-preview-smoke"),
      expiresAt: new Date(Date.now() + 15 * 60_000),
    },
    select: { id: true },
  });
  return { id: stored.id, token, csrfToken, deviceId };
}

function createFixture(runId, externalOrderId) {
  return {
    eventId: syntheticEventId ?? `preview-event-${runId}`,
    eventType: "ORDER_CREATED",
    order: {
      externalOrderId,
      externalOrderNumber: `P-${runId.slice(0, 8)}`,
      externalStoreId: "mock-store-taipei-001",
      currency: "TWD",
      placedAt: new Date().toISOString(),
      scheduledPickupAt: null,
      customerDisplayName: "合成測試顧客",
      customerPhoneMasked: "***-***-000",
      customerNote: "Ephemeral Preview synthetic order",
      items: [{
        externalItemId: `preview-item-${runId}`,
        externalProductId: "mock-product-001",
        name: "合成雞排",
        quantity: 1,
        unitPrice: 95,
        totalPrice: 95,
        modifiers: [],
        notes: null,
      }],
      pricing: {
        subtotal: 95,
        platformDiscount: 0,
        merchantDiscount: 0,
        deliveryFee: 20,
        serviceFee: 0,
        tax: 0,
        total: 115,
        merchantReceivable: 95,
      },
      payment: {
        status: "PAID_BY_PLATFORM",
        merchantCollectedCash: false,
      },
      fulfillment: { type: "DELIVERY" },
      providerMetadata: {
        synthetic: true,
        runId,
      },
    },
  };
}

async function requestJson(path, init) {
  const response = await requestRaw(path, init);
  let json = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }
  return { status: response.status, json };
}

async function requestRaw(path, init) {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  headers.set("user-agent", "stallorder-ephemeral-preview-smoke");
  if (protectionBypass) {
    headers.set("x-vercel-protection-bypass", protectionBypass);
  }
  return fetch(new URL(path, baseUrl), {
    ...init,
    headers,
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  });
}

function assertStatus(response, expected, label) {
  if (response.status === expected) return;
  if (
    (response.status === 401 || response.status === 403)
    && !protectionBypass
  ) {
    fail(`${label} was blocked. Configure VERCEL_AUTOMATION_BYPASS_SECRET for the Preview environment.`);
  }
  fail(`${label} returned HTTP ${response.status}; expected ${expected}.`);
}

function assertRedirect(response, label) {
  if ([302, 303, 307, 308].includes(response.status)) return;
  if (
    (response.status === 401 || response.status === 403)
    && !protectionBypass
  ) {
    fail(`${label} was blocked. Configure VERCEL_AUTOMATION_BYPASS_SECRET for the Preview environment.`);
  }
  fail(`${label} returned HTTP ${response.status}; expected a redirect.`);
}

function sameOriginLocation(response, expectedPath) {
  const location = response.headers.get("location");
  if (!location) fail("Expected redirect Location header.");
  const target = new URL(location, baseUrl);
  if (target.origin !== baseUrl.origin) {
    fail("Synthetic OAuth flow attempted to leave the ephemeral Preview origin.");
  }
  if (expectedPath && target.pathname !== expectedPath) {
    fail(`Expected redirect path ${expectedPath}, received ${target.pathname}.`);
  }
  return target;
}

function assertSafeSyntheticHost(url) {
  const hostname = url.hostname.toLowerCase();
  const blocked = new Set([
    "app.qidaigo.com",
    "qidaigo.com",
    "www.qidaigo.com",
    "stallorder-platform.vercel.app",
  ]);
  if (blocked.has(hostname)) {
    fail("Synthetic delivery smoke tests are forbidden against Production.");
  }
  const allowedOverride = process.env.DELIVERY_SYNTHETIC_ALLOWED_HOST?.trim().toLowerCase();
  if (
    hostname !== "localhost"
    && hostname !== "127.0.0.1"
    && !hostname.endsWith(".vercel.app")
    && hostname !== allowedOverride
  ) {
    fail("Synthetic delivery smoke target is not an approved ephemeral host.");
  }
}

function normalizeBaseUrl(value) {
  const url = new URL(value);
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url;
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) fail(`Missing required environment variable: ${name}.`);
  return value;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function deliveryActionDeduplicationPrefix(externalOrderId) {
  return `order-action:MOCK:${CONNECTION_ID}:${sha256(externalOrderId)}:`;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function fail(message) {
  throw new Error(message);
}
