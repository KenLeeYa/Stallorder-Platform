// Hosted synthetic acceptance, derived from the reviewed 2026-10-29 local flow.
// Product source remains immutable; only owned runner fixtures are changed.
// No .env loading, service startup, provider calls or credential output.
import assert from "node:assert/strict";
import { createHash, randomInt, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { verifyOwnedEdgeReadiness } from "./delivery-edge-readiness.mjs";
import { verifyNaturalExpiry } from "./delivery-expiry-evidence.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../product");
const origin = "http://127.0.0.1:3000";
const edgeOrigin = "http://127.0.0.1:54321";
let PrismaClient;
const stallId = "22222222-2222-4222-8222-222222222222";
const organizationId = "11111111-1111-4111-8111-111111111111";
const otherOrganizationId = "11111111-1111-4111-8111-111111111112";
const stallSlug = "aming-chicken";
const runId = randomUUID();
const prefix = `ODI-${runId.slice(0, 8)}`;
const owned = {
  productId: randomUUID(), qrId: randomUUID(), otherStallId: randomUUID(),
  otherOrderId: randomUUID(), circuitOverrideId: randomUUID(), orderIds: [], authSessionId: null,
  adminAuthSessionId: null,
};
const cookies = new Map();
const ownedAuthSessions = [];
const checks = [];
const requestIds = [];
const phases = { fixture: false, otherStall: false, otherOrder: false, product: false, qr: false };
let appDatabase;
let controlDatabase;
let originalHours;
let originalSettings;
let originalProfile;
let originalAdminProfile;
let failure = null;
let cleanupFailure = null;
let lastStep = "local-guards";
let orderStream;

function emit(event, detail = {}) {
  console.log(JSON.stringify({ at: new Date().toISOString(), runId, event, ...detail }));
}
function check(name, predicate, detail = {}) {
  lastStep = name;
  assert.equal(Boolean(predicate), true, name);
  checks.push(name);
  emit("check", { name, passed: true, ...detail });
}
function safeError(error) {
  const prismaCode = error?.code ?? error?.errorCode;
  return {
    step: lastStep,
    name: ["AssertionError", "PrismaClientInitializationError", "PrismaClientKnownRequestError"].includes(error?.name)
      ? error.name : "ExecutionError",
    code: typeof prismaCode === "string" && /^P\d{4}$/.test(prismaCode) ? prismaCode : undefined,
  };
}
function localDatabase(value) {
  const url = new URL(value ?? "");
  assert.ok(["postgres:", "postgresql:"].includes(url.protocol), "postgresql-required");
  assert.equal(url.hostname, "127.0.0.1", "loopback-db-required");
  assert.equal(url.port, "54322", "owned-db-port-required");
  assert.equal(url.pathname, "/postgres", "owned-db-name-required");
  assert.ok(!url.searchParams.has("host") && !url.searchParams.has("options"), "no-db-target-override");
  return url;
}
function headers(flow, authenticated = false) {
  return {
    origin, referer: `${origin}/login`, "sec-fetch-site": "same-origin",
    "content-type": "application/json", "x-stallorder-protocol-version": "1",
    "x-stallorder-operation-id": randomUUID(),
    "x-vercel-forwarded-for": flow?.ip ?? "198.18.29.200",
    "cf-connecting-ip": flow?.ip ?? "198.18.29.200",
    ...(flow?.deviceId ? { "x-stallorder-device-id": flow.deviceId } : {}),
    ...(authenticated ? {
      cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join("; "),
      "x-csrf-token": decodeURIComponent(cookies.get("stallorder_csrf") ?? ""),
    } : {}),
  };
}
async function api(name, path, { method = "GET", body, flow, authenticated = false, captureCookies = false, edge = false } = {}) {
  lastStep = name;
  const targetOrigin = edge ? edgeOrigin : origin;
  const url = new URL(path, targetOrigin);
  assert.equal(url.origin, targetOrigin, "owned-loopback-api-only");
  if (edge) {
    assert.ok(["/functions/v1/create-order-session", "/functions/v1/create-public-order", "/functions/v1/get-public-order",
      "/functions/v1/manage-line-link", "/functions/v1/prepare-reorder"].includes(url.pathname));
    assert.equal(method, "POST");
    assert.ok(!authenticated && !captureCookies, "no-staff-cookies-to-edge");
  }
  const response = await fetch(url, {
    method, headers: headers(flow, authenticated),
    ...(body ? { body: JSON.stringify(body) } : {}),
    redirect: "error", cache: "no-store", signal: AbortSignal.timeout(90_000),
  });
  if (captureCookies) {
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";", 1)[0];
      const separator = pair.indexOf("=");
      if (separator > 0) cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
  }
  const requestId = response.headers.get("x-request-id");
  if (requestId) requestIds.push(requestId);
  const data = await response.json().catch(() => null);
  const code = typeof data?.code === "string" && /^[A-Z0-9_]+$/.test(data.code) ? data.code : undefined;
  emit("http", { name, status: response.status, code, requestId,
    transport: edge ? "owned-edge-function" : "owned-next-server",
    circuit: response.headers.get("x-order-circuit"),
    cacheControl: response.headers.get("cache-control") });
  return { status: response.status, data, code, circuit: response.headers.get("x-order-circuit"),
    cacheControl: response.headers.get("cache-control"),
    edgeResponse: edge && response.headers.get("cache-control")?.includes("no-store")
      && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId ?? ""),
    edgeRuntime: edge && Boolean(response.headers.get("server-timing")?.includes("edge-function;"))
      && response.headers.get("cache-control")?.includes("no-store") };
}
async function subscribeOrders() {
  lastStep = "sse-subscribe";
  const abort = new AbortController();
  const state = { abort, reader: null, pump: null, events: [], ended: false, failed: false };
  // Keep this reference before fetch so any failure is still closed in finally.
  orderStream = state;
  const response = await fetch(`${origin}/api/stalls/${stallSlug}/orders/stream`, {
    headers: headers(null, true), redirect: "error", cache: "no-store",
    signal: AbortSignal.any([abort.signal, AbortSignal.timeout(50_000)]),
  });
  const requestId = response.headers.get("x-request-id");
  if (requestId) requestIds.push(requestId);
  check("sse-real-subscription", response.status === 200
    && response.headers.get("content-type")?.includes("text/event-stream")
    && response.headers.get("cache-control")?.includes("no-store"));
  state.reader = response.body.getReader();
  state.pump = (async () => {
    let buffer = "";
    const decoder = new TextDecoder();
    try {
      while (!abort.signal.aborted) {
        const { value, done } = await state.reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true }).replaceAll("\r", "");
        if (buffer.length > 65_536) throw new Error("SSE_BUFFER_LIMIT");
        let boundary;
        while ((boundary = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const event = frame.split("\n").find(line => line.startsWith("event:"))?.slice(6).trim();
          if (event === "ready" || event === "orders") {
            // The existing protocol intentionally sends data: {}, never order IDs.
            state.events.push({ event, receivedAt: Date.now() });
          }
        }
      }
    } catch {
      if (!abort.signal.aborted) state.failed = true;
    } finally {
      state.ended = true;
    }
  })();
  await waitForStreamEvent(state, "ready", 0);
  check("sse-ready-before-mutation", state.events.some(event => event.event === "ready"));
  return state;
}
async function waitForStreamEvent(state, name, after) {
  lastStep = `sse-wait-${name}`;
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const event = state.events.find(item => item.event === name && item.receivedAt >= after);
    if (event) return event;
    if (state.ended || state.failed) break;
    await delay(100);
  }
  assert.fail(`sse-${name}-not-observed`);
}
async function closeOrderStream() {
  if (!orderStream) return;
  const state = orderStream;
  state.abort.abort();
  await state.reader?.cancel().catch(() => undefined);
  await state.pump;
  orderStream = null;
  emit("sse-closed", { observedEvents: state.events.map(item => item.event), failed: state.failed });
}
async function holdForUi(detail) {
  const { chromium, expect } = createRequire(resolve(root, "package.json"))("@playwright/test");
  const browser = await chromium.launch();
  try {
    for (const viewport of [{width:1280,height:900},{width:390,height:844}]) {
      const context = await browser.newContext({ viewport, baseURL:origin, locale:"zh-TW", timezoneId:"Asia/Taipei" });
      let sessionId;
      try {
        const response = await context.request.post("/api/auth/login", { headers:headers(null),
          data:{email:"staff@stallorder.test",password:"StallOrderDemo!2026"} });
        check("browser-login-"+viewport.width, response.status() === 200);
        const sessionCookie = (await context.cookies()).find(item=>item.name === "stallorder_session");
        assert.ok(sessionCookie, "browser session cookie required");
        const tokenHash = createHash("sha256").update(decodeURIComponent(sessionCookie.value)).digest("hex");
        sessionId = (await controlDatabase.authSession.findUniqueOrThrow({where:{tokenHash},select:{id:true}})).id;
        const page = await context.newPage();
        await page.goto(detail.staffPath);
          const reminder = page.getByTestId("staff-start-reminder-backdrop");
          try {
            await reminder.waitFor({state:"visible",timeout:10_000});
            await reminder.getByRole("button",{name:"稍後處理",exact:true}).last().click();
            await reminder.waitFor({state:"detached",timeout:5_000});
          } catch (error) {
            if (error.name !== "TimeoutError" || await reminder.isVisible()) throw error;
          }
        await page.getByRole("button", {name:"訂單歷史查詢",exact:true}).click();
        const panel = page.locator('section[aria-labelledby="completed-orders-heading"]');
        await panel.getByRole("searchbox").fill(detail.searchLabel);
        await panel.locator("select").selectOption("EXPIRED");
        await panel.getByRole("button",{name:"查詢",exact:true}).click();
        await panel.getByRole("button").filter({hasText:detail.expired.orderNo}).click();
        await expect(panel.getByText("商家未在確認期限內接單，訂單已自動逾期。此紀錄僅供查閱，請勿繼續製作或收款。",{exact:true})).toBeVisible();
        await expect(panel.getByTestId("completed-order-change-payment")).toHaveCount(0);
        await expect(panel.getByTestId("completed-order-cancel")).toHaveCount(0);
        await expect(panel.getByTestId("completed-order-print")).toHaveCount(0);
        check("expired-readonly-browser-"+viewport.width,true);
      } finally {
        await context.close();
        if(sessionId) await controlDatabase.authSession.deleteMany({where:{id:sessionId}});
      }
    }
  } finally { await browser.close(); }
}

function newFlow(label, edge = false) {
  return { label, edge, id: randomUUID(), deviceId: randomUUID(), ip: `198.18.${randomInt(1, 254)}.${randomInt(1, 254)}` };
}
async function issue(flow) {
  const result = await api(`${flow.label}-session`, flow.edge ? "/functions/v1/create-order-session" : "/api/public/order-session", {
    method: "POST", flow, edge: flow.edge,
    body: { qrToken: `${prefix}-${runId}`, deviceId: flow.deviceId,
      orderingMode: "DELIVERY", sessionRequestId: randomUUID(), includeMenu: true },
  });
  check(`${flow.label}-session-issued`, result.status === 201 && (flow.edge ? result.edgeRuntime : result.circuit === "B"));
  check(`${flow.label}-menu-open`, result.data.orderingMode === "DELIVERY" && result.data.orderingOpenNow === true);
  check(`${flow.label}-session-token-present`, typeof result.data.orderSessionToken === "string" && result.data.orderSessionToken.length >= 40);
  flow.sessionToken = result.data.orderSessionToken;
  return flow;
}
async function submit(flow) {
  owned.orderIds.push(flow.id);
  return api(`${flow.label}-submit`, flow.edge ? "/functions/v1/create-public-order" : "/api/public/orders", {
    method: "POST", flow, edge: flow.edge,
    body: { qrToken: `${prefix}-${runId}`, deviceId: flow.deviceId,
      orderingMode: "DELIVERY", orderSessionToken: flow.sessionToken,
      clientOrderId: flow.id, idempotencyKey: randomUUID(), turnstileIdempotencyKey: randomUUID(),
      turnstileToken: "XXXX.DUMMY.TOKEN.XXXX", customerName: `${prefix} ${flow.label}`,
      customerPhone: "0912345678", deliveryAddress: "隔離測試路 1 號（合成資料，禁止配送）",
      waitAcknowledged: true, items: [{ productId: owned.productId, quantity: 1 }] },
  });
}
async function createDelivery(label, edge = false) {
  const flow = await issue(newFlow(label, edge));
  const result = await submit(flow);
  check(`${label}-order-created`, result.status === 201 && (edge ? result.edgeRuntime : result.circuit === "B")
    && result.data.orderStatus === "WAITING_CONFIRMATION" && result.data.fulfillmentType === "DELIVERY");
  check(`${label}-tracking-token-present`, typeof result.data.trackingToken === "string");
  flow.trackingToken = result.data.trackingToken;
  const order = await appDatabase.order.findUniqueOrThrow({ where: { id: flow.id } });
  check(`${label}-database-order-contract`, order.source === "LINE_DELIVERY"
    && order.fulfillmentType === "DELIVERY" && order.status === "WAITING_CONFIRMATION"
    && order.pickupCodeHash === null && order.deliveryAddress?.includes("合成資料"));
  const tracked = await api(`${label}-tracking`, `/api/public/orders/${encodeURIComponent(flow.trackingToken)}`, { flow });
  check(`${label}-customer-can-track`, tracked.status === 200
    && tracked.data?.order?.orderStatus === "WAITING_CONFIRMATION"
    && tracked.data.order.fulfillmentType === "DELIVERY");
  if (edge) {
    const edgeTracked = await api(`${label}-edge-tracking`, "/functions/v1/get-public-order", {
      method: "POST", flow, edge: true, body: { trackingToken: flow.trackingToken, deviceId: flow.deviceId },
    });
    check(`${label}-edge-and-next-tracking-parity`, edgeTracked.status === 200 && edgeTracked.edgeRuntime
      && edgeTracked.data?.order?.orderStatus === tracked.data.order.orderStatus
      && edgeTracked.data.order.fulfillmentType === "DELIVERY");
  }
  return flow;
}

async function waitForOwnedEdge() {
  lastStep = "owned-edge-startup";
  const deadline = Date.now() + 45_000;
  let lastObservation = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${edgeOrigin}/functions/v1/create-order-session`, {
        method: "OPTIONS", headers: { origin }, redirect: "error", signal: AbortSignal.timeout(3000),
      });
      const observation = { status: response.status,
        allowOrigin: response.headers.get("access-control-allow-origin"),
        serverTiming: response.headers.get("server-timing") };
      if (JSON.stringify(observation) !== JSON.stringify(lastObservation)) {
        emit("edge-startup-observation", observation);
        lastObservation = observation;
      }
      if (response.status === 204 && response.headers.get("server-timing")?.includes("edge-function;")) {
        const probe = async probeOrigin => {
          const result = await fetch(`${edgeOrigin}/functions/v1/create-order-session`, {
            method: "POST", headers: { origin: probeOrigin, "content-type": "application/json",
              "x-stallorder-protocol-version": "1" }, body: "{}", redirect: "error",
            signal: AbortSignal.timeout(5000), cache: "no-store",
          });
          const body = await result.json();
          return { status: result.status, code: body.code,
            allowOrigin: result.headers.get("access-control-allow-origin"),
            serverTiming: result.headers.get("server-timing"),
            cacheControl: result.headers.get("cache-control"), requestId: result.headers.get("x-request-id") };
        };
        const allowed = await probe(origin);
        const denied = await probe("https://untrusted.invalid");
        const evidence = verifyOwnedEdgeReadiness({ options: observation, allowed, denied });
        emit("edge-origin-boundary", { ...evidence, allowedStatus: allowed.status, deniedStatus: denied.status });
        return;
      }
    } catch { /* The owned functions process may still be starting. */ }
    await delay(500);
  }
  assert.fail("owned-edge-runtime-not-ready");
}

try {
  check("hosted-owned-runner", process.env.GITHUB_ACTIONS === "true"
    && process.env.GITHUB_REPOSITORY === "KenLeeYa/Stallorder-Platform"
    && process.env.RUNNER_ENVIRONMENT === "github-hosted" && process.env.RUNNER_OS === "Linux");
  check("exact-product-cwd", resolve(process.cwd()) === root);
  check("exact-product-commit", execFileSync("git", ["rev-parse", "HEAD"], {cwd:root}).toString().trim()
    === "36046cca7b8ec1be7156bc0eada03dd196cc191c");
  ({ PrismaClient } = createRequire(resolve(root, "package.json"))("@prisma/client"));
  check("explicit-owned-execution", process.env.DELIVERY_ACCEPTANCE_LOCAL_ONLY === "20261029-owned-synthetic");
  check("test-environment", process.env.APP_ENV === "test"
    && ![process.env.NODE_ENV, process.env.VERCEL_ENV].includes("production"));
  const appUrl = localDatabase(process.env.DATABASE_URL);
  const controlUrl = localDatabase(process.env.ACCEPTANCE_DATABASE_URL);
  check("same-owned-database", appUrl.host === controlUrl.host && appUrl.pathname === controlUrl.pathname);
  check("expected-app-login", decodeURIComponent(appUrl.username) === "postgres");
  appDatabase = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } }, log: [] });
  controlDatabase = new PrismaClient({ datasources: { db: { url: process.env.ACCEPTANCE_DATABASE_URL } }, log: [] });
  lastStep = "role-readback";
  const role = (await appDatabase.$queryRaw`
    select current_user::text as current_user, session_user::text as session_user,
      current_database()::text as database, current_setting('TimeZone') as timezone,
      r.rolsuper, r.rolbypassrls, pg_has_role(current_user, 'service_role', 'MEMBER') as service_member,
      has_function_privilege(current_user, 'public.delivery_ordering_unavailable_code(uuid,timestamp with time zone)', 'EXECUTE') as delivery_execute,
      has_function_privilege(current_user, 'public.get_takeout_preorder_slots(uuid,timestamp with time zone)', 'EXECUTE') as slots_execute,
      has_function_privilege('anon', 'public.delivery_ordering_unavailable_code(uuid,timestamp with time zone)', 'EXECUTE') as anon_execute,
      has_function_privilege('authenticated', 'public.delivery_ordering_unavailable_code(uuid,timestamp with time zone)', 'EXECUTE') as authenticated_execute
    from pg_roles r where r.rolname = current_user`)[0];
  emit("runtime-role", { ...role, evidenceScope: "same-DATABASE_URL-as-Next; synthetic local role, not Production" });
  check("restricted-app-role", role.current_user === "postgres" && role.session_user === "postgres" && role.rolsuper === false);
  check("helper-acl", role.service_member && role.delivery_execute && role.slots_execute && !role.anon_execute && !role.authenticated_execute);
  await waitForOwnedEdge();
  check("owned-edge-runtime-ready", true);
  const sourceHashes = {};
  for (const path of [
    "supabase/migrations/20261029090000_public_delivery_ordering_hours.sql",
    "src/lib/public-menu.ts", "src/lib/prisma.ts",
    "src/app/api/stalls/[stallSlug]/completed-orders/route.ts",
  ]) sourceHashes[path] = createHash("sha256").update(await readFile(resolve(root, path))).digest("hex");
  emit("sources", { sourceHashes, controlFlowSha256: createHash("sha256").update(await readFile(fileURLToPath(import.meta.url))).digest("hex") });

  lastStep = "seed-and-preservation-preflight";
  const [stall, profile, otherOrganization, specialClosures] = await Promise.all([
    controlDatabase.stall.findUniqueOrThrow({ where: { id: stallId } }),
    controlDatabase.profile.findUniqueOrThrow({ where: { email: "staff@stallorder.test" }, select: { id: true, lastLoginAt: true } }),
    controlDatabase.organization.findUniqueOrThrow({ where: { id: otherOrganizationId }, select: { id: true, slug: true } }),
    controlDatabase.stallSpecialClosure.count({ where: { stallId } }),
  ]);
  check("synthetic-seed-identity", stall.slug === stallSlug && stall.organizationId === organizationId
    && otherOrganization.slug === "stallorder-legacy-billing-fixture");
  check("no-preexisting-special-closures", specialClosures === 0);
  originalProfile = profile;
  originalHours = await controlDatabase.stallBusinessHour.findMany({ where: { stallId }, orderBy: { dayOfWeek: "asc" } });
  check("complete-weekly-seed", originalHours.length === 7);
  originalSettings = await controlDatabase.stallOrderingSettings.findUniqueOrThrow({
    where: { stallId }, select: { deliveryModuleEnabled: true },
  });
  const category = await controlDatabase.productCategory.findFirstOrThrow({ where: { organizationId, isActive: true }, select: { id: true } });
  const circuitFlag = await controlDatabase.resilienceFeatureFlag.findUniqueOrThrow({
    where: { code: "DUAL_ORDER_INTAKE_ENABLED" },
    select: { id: true, defaultEnabled: true, overrides: true },
  });
  check("circuit-b-default-deny-preserved", circuitFlag.defaultEnabled === false
    && circuitFlag.overrides.every(row => row.expiresAt && row.expiresAt <= new Date()));
  phases.fixture = true;
  lastStep = "fixture-short-lived-circuit-b-override";
  // The production-mode server must use its real feature gate. This lease is
  // confined to the owned disposable runner database and removed in finally.
  await controlDatabase.resilienceFeatureFlagOverride.create({ data: {
    id: owned.circuitOverrideId, flagId: circuitFlag.id, scopeType: "GLOBAL", enabled: true,
    reason: `${prefix} isolated delivery acceptance`, expiresAt: new Date(Date.now() + 20 * 60_000),
  } });
  lastStep = "fixture-open-hours-and-delivery-settings";
  await controlDatabase.stallBusinessHour.updateMany({ where: { stallId },
    data: { opensAt: "00:00", closesAt: "00:00", lastOrderAt: null, isClosed: false } });
  await controlDatabase.stallOrderingSettings.update({ where: { stallId }, data: { deliveryModuleEnabled: true } });
  lastStep = "fixture-product";
  await controlDatabase.product.create({ data: {
    id: owned.productId, organizationId, categoryId: category.id, name: `${prefix} synthetic meal`,
    description: "Isolated delivery acceptance fixture", defaultPrice: 50, isLotteryEligible: false,
    stallProducts: { create: { organizationId, stallId, isEnabled: true, stockRemaining: 20 } },
  } });
  phases.product = true;
  lastStep = "fixture-qr";
  const version = await controlDatabase.qrCode.aggregate({ where: { stallId }, _max: { tokenVersion: true } });
  await controlDatabase.qrCode.create({ data: {
    id: owned.qrId, organizationId, stallId, token: `${prefix}-${runId}`, label: `${prefix} synthetic delivery`,
    state: "ACTIVE", tokenVersion: (version._max.tokenVersion ?? 0) + 1,
  } });
  phases.qr = true;
  const otherSlug = `odi-other-${runId.slice(0, 8)}`;
  lastStep = "fixture-other-tenant-stall";
  await controlDatabase.stall.create({ data: {
    id: owned.otherStallId, organizationId: otherOrganizationId, slug: otherSlug, code: prefix,
    name: `${prefix} other tenant`, address: "Synthetic isolated address", location: "Synthetic isolated location",
    timezone: "Asia/Taipei", isActive: true, businessStatus: "OPEN", orderingEnabled: true,
  } });
  phases.otherStall = true;
  lastStep = "fixture-other-tenant-delivery-order";
  await controlDatabase.order.create({ data: {
    id: owned.otherOrderId, organizationId: otherOrganizationId, stallId: owned.otherStallId,
    orderNo: `${prefix}-foreign`, trackingTokenHash: createHash("sha256").update(randomUUID()).digest("hex"),
    idempotencyKey: randomUUID(), source: "STAFF_POS", origin: "ONLINE_STAFF", isTest: true,
    customerName: `${prefix} other tenant`, customerPhone: "0912345678",
    fulfillmentType: "DELIVERY", deliveryAddress: "Synthetic only",
    status: "EXPIRED", expiredAt: new Date(), confirmationExpiresAt: new Date(Date.now() - 1_000),
    subtotal: 50, total: 50, deviceHash: createHash("sha256").update(runId).digest("hex"),
  } });
  phases.otherOrder = true;
  emit("fixture", { stallId, organizationId, productId: owned.productId, qrId: owned.qrId,
    otherStallId: owned.otherStallId, otherOrderId: owned.otherOrderId, syntheticOnly: true });

  const unauthenticated = await api("staff-without-login", `/api/stalls/${stallSlug}/completed-orders?status=EXPIRED`);
  check("staff-login-required", unauthenticated.status === 401);
  const anonymousPrincipal = await api("anonymous-principal-refused", "/api/health/database-principal");
  check("anonymous-cannot-read-runtime-principal", anonymousPrincipal.status === 401
    && anonymousPrincipal.cacheControl?.includes("no-store") && !anonymousPrincipal.data?.currentUser);
  originalAdminProfile = await controlDatabase.profile.findUniqueOrThrow({
    where: { email: "platform.admin@stallorder.test" },
    select: { id: true, lastLoginAt: true, platformRole: true },
  });
  check("synthetic-platform-admin", originalAdminProfile.platformRole === "PLATFORM_ADMIN");
  check("no-preexisting-stale-admin-sessions", await controlDatabase.authSession.count({ where: {
    profileId: originalAdminProfile.id, expiresAt: { lte: new Date(Date.now() - 30 * 24 * 60 * 60_000) },
  } }) === 0);
  const adminLogin = await api("real-platform-admin-password-login", "/api/auth/login", {
    method: "POST", captureCookies: true,
    body: { email: "platform.admin@stallorder.test", password: "StallOrderDemo!2026" },
  });
  check("real-admin-password-session", adminLogin.status === 200 && cookies.has("stallorder_session"));
  const adminTokenHash = createHash("sha256").update(decodeURIComponent(cookies.get("stallorder_session"))).digest("hex");
  ownedAuthSessions.push({ tokenHash: adminTokenHash, profileId: originalAdminProfile.id });
  const adminSession = await appDatabase.authSession.findUniqueOrThrow({ where: { tokenHash: adminTokenHash },
    select: { id: true, profileId: true, revokedAt: true } });
  owned.adminAuthSessionId = adminSession.id;
  check("stored-admin-session", adminSession.profileId === originalAdminProfile.id && adminSession.revokedAt === null);
  const principalStartedAt = new Date();
  const principalResponse = await api("actual-next-principal", "/api/health/database-principal", { authenticated: true });
  const principalFinishedAt = new Date();
  const principal = principalResponse.data;
  check("actual-next-http-runtime-principal", principalResponse.status === 200
    && principalResponse.cacheControl?.includes("private") && principalResponse.cacheControl.includes("no-store")
    && principal?.schema === "stallorder-database-principal/v1"
    && principal.currentUser === role.current_user && principal.sessionUser === role.session_user
    && principal.database === role.database && principal.superuser === false && principal.bypassRls === true
    && principal.helperExists === true && principal.helperExecute === true
    && Date.parse(principal.observedAt) >= principalStartedAt.getTime()
    && Date.parse(principal.observedAt) <= principalFinishedAt.getTime());
  emit("next-http-runtime-principal", { ...principal, requestStartedAt: principalStartedAt.toISOString(),
    requestFinishedAt: principalFinishedAt.toISOString(),
    evidenceScope: "exact candidate owned runner Next HTTP process; not old Production", productionRuntimeVerified: false });
  await controlDatabase.authSession.update({ where: { id: owned.adminAuthSessionId }, data: { revokedAt: new Date() } });
  const revokedPrincipal = await api("revoked-admin-principal-refused", "/api/health/database-principal", { authenticated: true });
  check("revoked-admin-cannot-read-runtime-principal", revokedPrincipal.status === 401
    && revokedPrincipal.cacheControl?.includes("no-store") && !revokedPrincipal.data?.currentUser);
  cookies.clear();
  lastStep = "pre-login-stale-session-preservation";
  const staleAuthSessions = await controlDatabase.authSession.count({
    where: {
      profileId: profile.id,
      expiresAt: { lte: new Date(Date.now() - 30 * 24 * 60 * 60_000) },
    },
  });
  check("no-preexisting-stale-auth-sessions", staleAuthSessions === 0);
  const login = await api("real-staff-password-login", "/api/auth/login", {
    method: "POST", captureCookies: true,
    body: { email: "staff@stallorder.test", password: "StallOrderDemo!2026" },
  });
  check("real-password-session", login.status === 200 && cookies.has("stallorder_session")
    && cookies.has("stallorder_csrf") && cookies.has("stallorder_auth_device"));
  const tokenHash = createHash("sha256").update(decodeURIComponent(cookies.get("stallorder_session"))).digest("hex");
  ownedAuthSessions.push({ tokenHash, profileId: profile.id });
  const authSession = await appDatabase.authSession.findUniqueOrThrow({ where: { tokenHash }, select: { id: true, profileId: true, revokedAt: true } });
  owned.authSessionId = authSession.id;
  check("stored-staff-session", authSession.profileId === profile.id && authSession.revokedAt === null);
  const staffPrincipal = await api("staff-principal-refused", "/api/health/database-principal", { authenticated: true });
  check("staff-cannot-read-runtime-principal", staffPrincipal.status === 404
    && staffPrincipal.cacheControl?.includes("no-store") && !staffPrincipal.data?.currentUser);

  const stream = await subscribeOrders();
  const mutationStarted = Date.now();
  const confirmed = await createDelivery("confirm");
  const orderSignal = await waitForStreamEvent(stream, "orders", mutationStarted);
  const latestEvent = await appDatabase.orderEvent.findFirstOrThrow({
    where: { stallId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true, orderId: true, eventType: true },
  });
  check("sse-own-order-mutation-correlated", latestEvent.orderId === confirmed.id, {
    event: orderSignal.event, orderId: confirmed.id, databaseEventId: latestEvent.id,
    databaseEventType: latestEvent.eventType, streamPayloadContainsOrderId: false,
  });
  const active = await api("staff-visible-before-confirmation", `/api/stalls/${stallSlug}/orders`, { authenticated: true });
  check("staff-sees-waiting-delivery", active.status === 200 && active.data.orders.some(order => order.id === confirmed.id && order.status === "WAITING_CONFIRMATION"));
  await closeOrderStream();
  const confirmation = await api("staff-confirm-order", `/api/stalls/${stallSlug}/orders/${confirmed.id}`, {
    method: "PATCH", authenticated: true, body: { status: "CONFIRMED" },
  });
  check("staff-confirmation-accepted", confirmation.status === 200);
  const confirmedReadback = await appDatabase.order.findUniqueOrThrow({ where: { id: confirmed.id }, select: { status: true, confirmedAt: true, orderNo: true } });
  check("confirmed-order-persisted", confirmedReadback.status === "CONFIRMED" && confirmedReadback.confirmedAt !== null);

  const edgeConfirmed = await createDelivery("edge-confirm", true);
  const lineStatus = await api("edge-line-link-status", "/functions/v1/manage-line-link", {
    method: "POST", edge: true, flow: edgeConfirmed,
    body: { trackingToken: edgeConfirmed.trackingToken, deviceId: edgeConfirmed.deviceId, action: "STATUS" },
  });
  check("edge-line-link-status-without-external-message", lineStatus.status === 200 && lineStatus.edgeResponse
    && typeof lineStatus.data.available === "boolean" && lineStatus.data.linked === false
    && typeof lineStatus.data.repeatOrderAvailable === "boolean");
  const reorder = await api("edge-prepare-delivery-reorder", "/functions/v1/prepare-reorder", {
    method: "POST", edge: true, flow: edgeConfirmed,
    body: { trackingToken: edgeConfirmed.trackingToken, deviceId: edgeConfirmed.deviceId },
  });
  check("edge-reorder-preserves-delivery-context", reorder.status === 200 && reorder.edgeResponse
    && reorder.data.orderingMode === "DELIVERY" && reorder.data.qrToken === `${prefix}-${runId}`
    && reorder.data.orderPath === `/store/${encodeURIComponent(stall.code)}?view=delivery`
    && reorder.data.availableItems.some(item => item.productId === owned.productId && item.quantity === 1));
  const edgeConfirmation = await api("staff-confirm-edge-order", `/api/stalls/${stallSlug}/orders/${edgeConfirmed.id}`, {
    method: "PATCH", authenticated: true, body: { status: "CONFIRMED" },
  });
  check("edge-order-staff-confirmation", edgeConfirmation.status === 200
    && (await appDatabase.order.findUniqueOrThrow({ where: { id: edgeConfirmed.id }, select: { status: true } })).status === "CONFIRMED");
  const confirmedReorder = await api("edge-confirmed-reorder-refused", "/functions/v1/prepare-reorder", {
    method: "POST", edge: true, flow: edgeConfirmed,
    body: { trackingToken: edgeConfirmed.trackingToken, deviceId: edgeConfirmed.deviceId },
  });
  check("edge-confirmed-order-cannot-reorder", confirmedReorder.status === 409 && confirmedReorder.edgeResponse
    && confirmedReorder.code === "ORDER_ALREADY_CONFIRMED");

  const expired = await createDelivery("expire");
  const natural = await createDelivery("natural-expire", true);
  const naturalSelect = { id: true, status: true, createdAt: true, confirmationExpiresAt: true, expiredAt: true };
  const naturalBefore = await appDatabase.order.findUniqueOrThrow({ where: { id: natural.id }, select: naturalSelect });
  const naturalStartedAt = new Date();
  check("natural-expiry-original-ten-minute-window", naturalBefore.status === "WAITING_CONFIRMATION"
    && naturalBefore.confirmationExpiresAt.getTime() - naturalBefore.createdAt.getTime() === 600_000);
  const unopened = await issue(newFlow("close-after-session"));
  const edgeUnopened = await issue(newFlow("edge-close-after-session", true));
  const countBeforeClosed = await controlDatabase.order.count();
  await controlDatabase.stallBusinessHour.updateMany({ where: { stallId }, data: { isClosed: true } });
  const closedGate = (await appDatabase.$queryRaw`select public.delivery_ordering_unavailable_code(${stallId}::uuid) as code`)[0];
  check("database-closed-gate", closedGate.code === "DELIVERY_OUTSIDE_ORDERING_HOURS");
  const deniedSession = await api("closed-new-session", "/api/public/order-session", {
    method: "POST", flow: newFlow("closed-new-session"), body: {
      qrToken: `${prefix}-${runId}`, deviceId: randomUUID(), orderingMode: "DELIVERY", sessionRequestId: randomUUID(),
    },
  });
  check("closed-session-refused", deniedSession.status === 409 && deniedSession.code === "DELIVERY_OUTSIDE_ORDERING_HOURS");
  const deniedOrder = await submit(unopened);
  check("closed-existing-session-submit-refused", deniedOrder.status === 409 && deniedOrder.code === "DELIVERY_OUTSIDE_ORDERING_HOURS");
  const edgeDeniedSession = await api("edge-closed-new-session", "/functions/v1/create-order-session", {
    method: "POST", edge: true, flow: newFlow("edge-closed-new-session", true), body: {
      qrToken: `${prefix}-${runId}`, deviceId: randomUUID(), orderingMode: "DELIVERY", sessionRequestId: randomUUID(),
    },
  });
  check("edge-closed-session-refused", edgeDeniedSession.status === 409 && edgeDeniedSession.edgeRuntime
    && edgeDeniedSession.code === "DELIVERY_OUTSIDE_ORDERING_HOURS");
  const edgeDeniedOrder = await submit(edgeUnopened);
  check("edge-closed-existing-session-submit-refused", edgeDeniedOrder.status === 409 && edgeDeniedOrder.edgeRuntime
    && edgeDeniedOrder.code === "DELIVERY_OUTSIDE_ORDERING_HOURS");
  check("closed-does-not-create-order", await controlDatabase.order.count() === countBeforeClosed
    && await controlDatabase.order.count({ where: { id: { in: [unopened.id, edgeUnopened.id] } } }) === 0);

  lastStep = "owned-expiry-preconditions";
  const foreignDueOrders = await controlDatabase.order.count({ where: {
    id: { notIn: owned.orderIds }, status: "WAITING_CONFIRMATION", confirmationExpiresAt: { lte: new Date() },
  } });
  const foreignDueSessions = await controlDatabase.orderSession.count({ where: {
    qrCodeId: { not: owned.qrId }, status: "ACTIVE",
    OR: [{ expiresAt: { lte: new Date() } }, { qrCode: { expiresAt: { lte: new Date() } } }],
  } });
  const foreignDueQr = await controlDatabase.qrCode.count({ where: {
    id: { not: owned.qrId }, state: { in: ["ACTIVE", "PAUSED"] }, expiresAt: { lte: new Date() },
  } });
  const retention = (await controlDatabase.$queryRaw`
    select (
      (select count(*) from public.public_rate_limit_buckets where expires_at < now() - interval '1 day')
      + (select count(*) from public.rate_limit_buckets where expires_at < now() - interval '1 day')
      + (select count(*) from public.public_order_attempts where created_at < now() - interval '180 days')
    )::integer as due`)[0];
  check("expiry-cannot-touch-foreign-due-fixtures", foreignDueOrders === 0 && foreignDueSessions === 0 && foreignDueQr === 0 && retention.due === 0);
  // Only these owned order deadlines are advanced. The production function and
  // app/history API remain real; this is not a ten-minute scheduler timing test.
  await controlDatabase.order.update({ where: { id: expired.id }, data: {
    confirmationExpiresAt: new Date(Date.now() - 1_000), createdAt: new Date(Date.now() - 86_400_000),
  } });
  await controlDatabase.order.update({ where: { id: confirmed.id }, data: { confirmationExpiresAt: new Date(Date.now() - 1_000) } });
  const expiration = (await controlDatabase.$queryRaw`select public.expire_unconfirmed_orders() as count`)[0];
  check("real-expiry-function-one-order", expiration.count === 1, { deadlineAdvancedForOwnedFixturesOnly: true });
  const expiredReadback = await appDatabase.order.findUniqueOrThrow({ where: { id: expired.id }, select: { status: true, expiredAt: true, orderNo: true } });
  check("expiry-persisted", expiredReadback.status === "EXPIRED" && expiredReadback.expiredAt !== null);
  check("confirmed-order-does-not-expire", (await appDatabase.order.findUniqueOrThrow({ where: { id: confirmed.id }, select: { status: true } })).status === "CONFIRMED");
  check("expiry-event-once", await appDatabase.orderEvent.count({ where: { orderId: expired.id, eventType: "UNCONFIRMED_ORDER_EXPIRED" } }) === 1);
  check("expiry-is-idempotent", (await controlDatabase.$queryRaw`select public.expire_unconfirmed_orders() as count`)[0].count === 0);
  const history = await api("expired-today-history", `/api/stalls/${stallSlug}/completed-orders?status=EXPIRED&query=${encodeURIComponent(prefix)}`, { authenticated: true });
  check("expired-visible-on-expiration-day", history.status === 200 && history.data.orders.some(order =>
    order.id === expired.id && order.status === "EXPIRED" && order.expiredAt === expiredReadback.expiredAt.toISOString()));
  check("history-does-not-leak-other-tenant", history.data.orders.every(order => order.id !== owned.otherOrderId));
  const allHistory = await api("default-history-includes-expired", `/api/stalls/${stallSlug}/completed-orders?query=${encodeURIComponent(prefix)}`, { authenticated: true });
  check("default-history-shows-expired", allHistory.status === 200 && allHistory.data.orders.some(order => order.id === expired.id));
  for (const [name, dayOffset] of [["yesterday", -1], ["tomorrow", 1]]) {
    await controlDatabase.order.update({ where: { id: expired.id }, data: {
      expiredAt: new Date(expiredReadback.expiredAt.getTime() + dayOffset * 86_400_000),
    } });
    const outOfDay = await api(`history-excludes-${name}`, `/api/stalls/${stallSlug}/completed-orders?status=EXPIRED&query=${encodeURIComponent(prefix)}`, { authenticated: true });
    check(`history-excludes-expiry-${name}`, outOfDay.status === 200 && outOfDay.data.orders.every(order => order.id !== expired.id));
  }
  await controlDatabase.order.update({ where: { id: expired.id }, data: { expiredAt: expiredReadback.expiredAt } });
  const noLongerActive = await api("active-list-after-expiry", `/api/stalls/${stallSlug}/orders`, { authenticated: true });
  check("expired-removed-from-active-list", noLongerActive.status === 200 && noLongerActive.data.orders.every(order => order.id !== expired.id));
  const readonlySelect = {
    status: true, paymentStatus: true, expiredAt: true, confirmedAt: true, completedAt: true,
    cancelledAt: true, cancellationReason: true, cancellationDetail: true, total: true,
  };
  const readonlyBefore = await appDatabase.order.findUniqueOrThrow({ where: { id: expired.id }, select: readonlySelect });
  const invalidConfirmation = await api("expired-cannot-confirm", `/api/stalls/${stallSlug}/orders/${expired.id}`, {
    method: "PATCH", authenticated: true, body: { status: "CONFIRMED" },
  });
  check("expired-order-read-only", invalidConfirmation.status === 409);
  const invalidHistoryEdit = await api("expired-cannot-cancel-history", `/api/stalls/${stallSlug}/completed-orders`, {
    method: "PATCH", authenticated: true, body: {
      operation: "CANCEL_COMPLETED_ORDER", orderId: expired.id,
      confirmationOrderNo: expiredReadback.orderNo, cancellationReason: "CUSTOMER_CANCELLED",
    },
  });
  check("expired-history-edit-refused", invalidHistoryEdit.status === 409);
  const paymentOption = await appDatabase.paymentOption.findFirstOrThrow({ where: { stallId, isEnabled: true }, select: { id: true } });
  const invalidPaymentEdit = await api("expired-cannot-change-payment", `/api/stalls/${stallSlug}/completed-orders`, {
    method: "PATCH", authenticated: true, body: {
      operation: "CHANGE_COMPLETED_PAYMENT", orderId: expired.id,
      paymentOptionId: paymentOption.id, reason: "Isolated negative verification",
    },
  });
  check("expired-payment-edit-refused", invalidPaymentEdit.status === 409);
  const readonlyAfter = await appDatabase.order.findUniqueOrThrow({ where: { id: expired.id }, select: readonlySelect });
  check("rejected-expired-mutations-have-no-database-effect", JSON.stringify(readonlyAfter) === JSON.stringify(readonlyBefore));
  const crossHistory = await api("cross-tenant-history", `/api/stalls/${otherSlug}/completed-orders?status=EXPIRED`, { authenticated: true });
  check("cross-tenant-history-refused", crossHistory.status === 404);
  const crossMutation = await api("foreign-order-through-own-stall", `/api/stalls/${stallSlug}/orders/${owned.otherOrderId}`, {
    method: "PATCH", authenticated: true, body: { status: "CONFIRMED" },
  });
  check("cross-stall-order-mutation-refused", crossMutation.status === 404);
  check("foreign-order-unchanged", (await controlDatabase.order.findUniqueOrThrow({ where: { id: owned.otherOrderId }, select: { status: true } })).status === "EXPIRED");
  // No deadline writes or manual expiry calls below. Wait for the installed
  // pg_cron job, and bind the order transition to its actual execution record.
  lastStep = "natural-cron-expiry";
  const precisionCases = await controlDatabase.$queryRaw`
    with cases(start_at, end_at, expired_at, expected) as (values
      ('2026-11-04T19:10:01.000100Z'::timestamptz, '2026-11-04T19:10:01.000450Z'::timestamptz,
       '2026-11-04T19:10:01.000'::timestamp(3), true),
      ('2026-11-04T19:10:00.999500Z'::timestamptz, '2026-11-04T19:10:01.000350Z'::timestamptz,
       '2026-11-04T19:10:01.000'::timestamp(3), true),
      ('2026-11-04T19:10:01.001100Z'::timestamptz, '2026-11-04T19:10:01.002000Z'::timestamptz,
       '2026-11-04T19:10:01.000'::timestamp(3), false))
    select ((start_at at time zone 'UTC')::timestamp(3) <= expired_at
      and (end_at at time zone 'UTC')::timestamp(3) >= expired_at) = expected as correct from cases`;
  check("postgres-microsecond-boundary-regressions", precisionCases.length === 3 && precisionCases.every(row => row.correct));
  const cronRows = await controlDatabase.$queryRaw`
    select jobid::integer, jobname, schedule, command, database, username, active
    from cron.job where jobname = 'stallorder-expire-unconfirmed-orders'`;
  check("natural-expiry-single-installed-cron", cronRows.length === 1);
  const cronJob = cronRows[0];
  const naturalDeadline = naturalBefore.confirmationExpiresAt.getTime();
  check("natural-wait-starts-before-deadline", Date.now() < naturalDeadline);
  emit("natural-expiry-wait-started", { before: naturalBefore, startedAt: naturalStartedAt, job: cronJob });
  let naturalAfter;
  let cronExecution;
  let progressAt = 0;
  while (Date.now() <= naturalDeadline + 180_000) {
    naturalAfter = await appDatabase.order.findUniqueOrThrow({ where: { id: natural.id }, select: naturalSelect });
    assert.equal(naturalAfter.createdAt.getTime(), naturalBefore.createdAt.getTime(), "natural creation time changed");
    assert.equal(naturalAfter.confirmationExpiresAt.getTime(), naturalDeadline, "natural deadline changed");
    assert.ok(["WAITING_CONFIRMATION", "EXPIRED"].includes(naturalAfter.status), "unexpected natural order state");
    if (naturalAfter.status === "EXPIRED") {
      const executions = await controlDatabase.$queryRaw`
        select jobid::integer, runid::integer, command, database, username, status,
          (start_time at time zone 'UTC')::timestamp(3) as start_time,
          (end_time at time zone 'UTC')::timestamp(3) as end_time,
          to_char(start_time at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as start_time_raw,
          to_char(end_time at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as end_time_raw
        from cron.job_run_details where jobid = ${cronJob.jobid} and status = 'succeeded'
          and (start_time at time zone 'UTC')::timestamp(3) <= ${naturalAfter.expiredAt}::timestamp(3)
          and (end_time at time zone 'UTC')::timestamp(3) >= ${naturalAfter.expiredAt}::timestamp(3)
        order by runid desc limit 2`;
      if (executions.length) {
        assert.equal(executions.length, 1, "ambiguous cron execution");
        cronExecution = executions[0];
        break;
      }
    }
    if (Date.now() >= progressAt) {
      emit("natural-expiry-wait", { elapsedMs: Date.now() - naturalBefore.createdAt.getTime(), status: naturalAfter.status });
      progressAt = Date.now() + 60_000;
    }
    await delay(2_000);
  }
  const naturalEvidence = {
    before: naturalBefore, after: naturalAfter, job: cronJob, execution: cronExecution,
    startedAt: naturalStartedAt, observedAt: new Date(),
    eventCount: await appDatabase.orderEvent.count({ where: { orderId: natural.id, eventType: "UNCONFIRMED_ORDER_EXPIRED" } }),
    confirmedStatus: (await appDatabase.order.findUniqueOrThrow({ where: { id: edgeConfirmed.id }, select: { status: true } })).status,
  };
  const naturalResult = verifyNaturalExpiry(naturalEvidence);
  emit("natural-expiry-evidence", { ...naturalEvidence, ...naturalResult, deadlineModified: false, manualExpiryDuringWait: false });
  check("natural-ten-minute-cron-expiry", naturalResult.realCronTimingVerified);
  const naturalHistory = await api("natural-expired-history", `/api/stalls/${stallSlug}/completed-orders?status=EXPIRED&query=${encodeURIComponent(prefix)}`, { authenticated: true });
  check("natural-expiry-visible-in-history", naturalHistory.status === 200
    && naturalHistory.data.orders.some(order => order.id === natural.id && order.status === "EXPIRED"));
  const naturalActive = await api("natural-expiry-removed-from-active", `/api/stalls/${stallSlug}/orders`, { authenticated: true });
  check("natural-expiry-not-active", naturalActive.status === 200 && naturalActive.data.orders.every(order => order.id !== natural.id));
  const expiredReorder = await api("edge-expired-reorder-refused", "/functions/v1/prepare-reorder", {
    method: "POST", edge: true, flow: natural,
    body: { trackingToken: natural.trackingToken, deviceId: natural.deviceId },
  });
  check("edge-expired-order-cannot-reorder", expiredReorder.status === 409 && expiredReorder.edgeResponse
    && expiredReorder.code === "ORDER_ALREADY_STARTED");
  emit("flow-complete", { checkCount: checks.length, browserUiVerified: false,
    edgeCircuitAOrderFlowVerified: true,
    edgeFunctionsExercised: ["create-order-session", "create-public-order", "get-public-order", "manage-line-link", "prepare-reorder"],
    realCronTimingVerified: true, productionSchedulerVerified: false, notificationDeliveryVerified: false,
    evidenceScope: "isolated actual Edge + Next API + PostgreSQL + password auth; offline Turnstile test mode" });
  await holdForUi({
    staffPath: `/staff/${stallSlug}`, searchLabel: prefix,
    confirmed: { orderId: confirmed.id, orderNo: confirmedReadback.orderNo, customerLabel: `${prefix} confirm` },
    expired: { orderId: expired.id, orderNo: expiredReadback.orderNo, customerLabel: `${prefix} expire` },
    calendarClosedDuringHold: true,
  });
} catch (error) {
  failure = safeError(error);
  emit("failure", failure);
} finally {
  try { await closeOrderStream(); } catch { emit("sse-close-failed", { failure: true }); cleanupFailure = { step: "sse-close", name: "ExecutionError" }; }
  if (controlDatabase && phases.fixture) {
    try {
      lastStep = "owned-fixture-cleanup";
      await controlDatabase.resilienceFeatureFlagOverride.deleteMany({ where: { id: owned.circuitOverrideId } });
      check("owned-circuit-override-removed", await controlDatabase.resilienceFeatureFlagOverride.count({
        where: { id: owned.circuitOverrideId },
      }) === 0);
      if (owned.authSessionId) await controlDatabase.authSession.deleteMany({ where: { id: owned.authSessionId } });
      if (owned.adminAuthSessionId) await controlDatabase.authSession.deleteMany({ where: { id: owned.adminAuthSessionId } });
      if (ownedAuthSessions.length) {
        await controlDatabase.authSession.deleteMany({ where: { OR: ownedAuthSessions } });
        check("owned-auth-sessions-removed", await controlDatabase.authSession.count({ where: { OR: ownedAuthSessions } }) === 0);
      }
      await controlDatabase.order.deleteMany({ where: { id: { in: owned.orderIds } } });
      if (phases.otherOrder) await controlDatabase.order.deleteMany({ where: { id: owned.otherOrderId } });
      if (phases.qr) {
        await controlDatabase.publicOrderAttempt.deleteMany({ where: { qrCodeId: owned.qrId } });
        await controlDatabase.orderSession.deleteMany({ where: { qrCodeId: owned.qrId } });
        await controlDatabase.qrCode.deleteMany({ where: { id: owned.qrId } });
      }
      if (phases.product) {
        await controlDatabase.stallProduct.deleteMany({ where: { productId: owned.productId } });
        await controlDatabase.product.deleteMany({ where: { id: owned.productId } });
      }
      if (phases.otherStall) await controlDatabase.stall.deleteMany({ where: { id: owned.otherStallId } });
      if (phases.fixture) {
        for (const row of originalHours) await controlDatabase.stallBusinessHour.update({ where: { id: row.id }, data: {
          opensAt: row.opensAt, closesAt: row.closesAt, lastOrderAt: row.lastOrderAt, isClosed: row.isClosed,
        } });
        await controlDatabase.stallOrderingSettings.update({ where: { stallId }, data: originalSettings });
        if (originalProfile) await controlDatabase.profile.update({ where: { id: originalProfile.id }, data: { lastLoginAt: originalProfile.lastLoginAt } });
        if (originalAdminProfile) await controlDatabase.profile.update({ where: { id: originalAdminProfile.id }, data: { lastLoginAt: originalAdminProfile.lastLoginAt } });
      }
      const remainingOrders = await controlDatabase.order.count({ where: { id: { in: [...owned.orderIds, owned.otherOrderId] } } });
      const remainingQr = await controlDatabase.qrCode.count({ where: { id: owned.qrId } });
      const remainingProduct = await controlDatabase.product.count({ where: { id: owned.productId } });
      const remainingStall = await controlDatabase.stall.count({ where: { id: owned.otherStallId } });
      check("owned-primary-fixtures-removed", remainingOrders === 0 && remainingQr === 0 && remainingProduct === 0 && remainingStall === 0);
      emit("cleanup", { completed: true, remainingOrders, remainingQr, remainingProduct, remainingStall,
        servicesTouched: false, auditAndRateLimitEvidenceRetainedInOwnedDatabase: true,
        cleanupBoundary: "Root must remove the owned disposable database; no global reset or prune" });
    } catch (error) {
      cleanupFailure = safeError(error);
      emit("cleanup-failure", { ...cleanupFailure, ownedIds: owned });
    }
  } else {
    emit("cleanup", { completed: true, fixtureNeverStarted: true, servicesTouched: false });
  }
  await Promise.allSettled([appDatabase?.$disconnect(), controlDatabase?.$disconnect()]);
  emit("summary", { passed: !failure && !cleanupFailure, checkCount: checks.length, failure, cleanupFailure,
    requestIds, releaseQualified: false, servicesStarted: false, syntheticOnly: true });
  process.exitCode = failure || cleanupFailure ? 1 : 0;
}
