import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import { parseEnv } from "node:util";
import { performance } from "node:perf_hooks";
import { chromium, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { assertResponsiveQaTarget } from "./responsive-qa-target.mjs";
import { summarize as stats, labVitals } from "./responsive-performance-stats.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "artifacts/ux-responsive-20260930/b3-performance");
const [phase, sourceDirectory = root, mode = "full"] = process.argv.slice(2);
if (!["before", "after"].includes(phase) || !["full", "pilot"].includes(mode)) throw Error("Expected before|after, source directory, full|pilot");
Object.assign(process.env, parseEnv(readFileSync(path.join(root, ".env.local"), "utf8")));
assertResponsiveQaTarget(process.env);
process.chdir(sourceDirectory);
const { readResponsiveBuildProvenance } = await import(pathToFileURL(path.join(sourceDirectory, "scripts/responsive-build-provenance.mjs")));
const source = readResponsiveBuildProvenance();
const fixture = JSON.parse(readFileSync(path.join(output, "fixture-initial.json")));
const initialFreeze = JSON.parse(readFileSync(path.join(output, "freeze-initial.json")));
const hash = value => createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
const prisma = new PrismaClient();
const origin = "http://127.0.0.1:3026";
const headers = { "x-vercel-forwarded-for": "203.0.113.10", "cf-connecting-ip": "203.0.113.10" };
const count = mode === "pilot" ? 1 : 30;
const rounds = mode === "pilot" ? 1 : 5;
let qrRateWindowSeconds = 300;
let attendanceCode;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const result = {
  phase, mode, source, originalSourceCommit: phase === "before" ? "a0c635bc8177abd953fd7381d85fbbaf22cf1fe1" : source.head,
  startedAt: new Date().toISOString(), measurementSha256: hash(readFileSync(fileURLToPath(import.meta.url), "utf8")),
  statisticsSha256: hash(readFileSync(new URL("./responsive-performance-stats.mjs", import.meta.url), "utf8")),
  environment: { origin, database: "127.0.0.1:56822/postgres", primaryApi: "http://127.0.0.1:56821", platform: os.platform(), arch: os.arch(), cpus: os.cpus()[0].model, node: process.version },
  semantics: { cold: "New Chromium context and page with authenticated storage copied in memory; empty browser HTTP cache. Server/OS remain warm.", warm: "One context/page/identity for all repeated full navigations; one unmeasured priming interaction. No identity rotation or cache clearing.", timing: "Before page.goto until genuine readonly interaction and observable state assertion complete. Includes normal navigation/load/actionability.", pacing: "Serial, one fixed synthetic visitor IP. Staff/KDS navigate about:blank and wait1s outside timing for normal SSE teardown (profile concurrency2, leaseTTL60s). On429 wait actual Retry-After+1s, minimum QR configured window+1 or other61s. No rate bucket changes.", clocks: "Wall clock not changed; fixed explicit report date 2026-09-30; order age and report refreshed timestamp naturally advance, retained timestamps quantify this.", vitals: "Chromium PerformanceObserver LCP last entry before first input; CLS maximum session window (1s gap/5s cap); INP max duration per interaction, worst interaction for these <50-interaction rounds. EventTiming below 16ms is left-censored, never called 0. Local lab, not RUM.", privacy: "No cookies, password, response bodies or QR tokens persisted." },
  freeze: [], routes: {}, api: {}, vitals: {}, diagnostics: [],
};
const save = () => writeFileSync(path.join(output, `${phase}-${mode}.json`), JSON.stringify(result, null, 2) + "\n");
async function freeze() {
  const ids = fixture.orders.map(row => row.id);
  const orders = await prisma.order.findMany({ where: { id: { in: ids } }, select: { id: true, orderNo: true, status: true, createdAt: true, total: true, updatedAt: true }, orderBy: { orderNo: "asc" } });
  const items = await prisma.orderItem.findMany({ where: { orderId: { in: ids } }, select: { id: true, orderId: true, productId: true, name: true, note: true, quantity: true, unitPrice: true, createdAt: true }, orderBy: { id: "asc" } });
  const tasks = await prisma.orderProductionTask.findMany({ where: { orderId: { in: ids } }, select: { id: true, orderId: true, orderItemId: true, stationId: true, status: true, quantity: true, createdAt: true, updatedAt: true }, orderBy: { id: "asc" } });
  const settings = await prisma.stallOrderingSettings.findUniqueOrThrow({ where: { stallId: fixture.stallId }, select: { kdsModuleEnabled: true, printModuleEnabled: true, paymentModuleEnabled: true, enabledLocales: true, kdsWarningMinutes: true, kdsCriticalMinutes: true, kdsDefaultView: true } });
  const flags = await prisma.resilienceFeatureFlagOverride.findMany({ select: { id: true, flag: { select: { code: true } }, scopeType: true, organizationId: true, stallId: true, enabled: true, rolloutPercentage: true, expiresAt: true } });
  const fullSettings = await prisma.stallOrderingSettings.findUniqueOrThrow({ where: { stallId: fixture.stallId } });
  fullSettings.managerAuthorizationCodeHash = fullSettings.managerAuthorizationCodeHash ? "PRESENT" : "MISSING";
  qrRateWindowSeconds = fullSettings.orderWindowSeconds;
  const flagDefaults = await prisma.resilienceFeatureFlag.findMany({ select: { code: true, defaultEnabled: true }, orderBy: { code: "asc" } });
  const contract = JSON.parse(JSON.stringify({ fullSettings, flagDefaults }));
  const contractFile = path.join(output, "runtime-contract-initial.json");
  try { writeFileSync(contractFile, JSON.stringify(contract, null, 2) + "\n", { flag: "wx" }); }
  catch (error) { if (error.code !== "EEXIST") throw error; }
  expect(contract).toEqual(JSON.parse(readFileSync(contractFile)));
  const surroundings = { orders: await prisma.order.groupBy({ by: ["status"], where: { stallId: fixture.stallId }, _count: true }), products: await prisma.stallProduct.count({ where: { stallId: fixture.stallId } }), tasks: await prisma.orderProductionTask.groupBy({ by: ["status"], where: { stallId: fixture.stallId }, _count: true }) };
  const canonical = rows => [...rows].sort((a, b) => (a.id ?? a.status).localeCompare(b.id ?? b.status));
  expect(hash(orders)).toBe(initialFreeze.orderDigest);
  expect(hash({ orders, items, tasks })).toBe(initialFreeze.fullDatasetDigest);
  expect(settings).toEqual(initialFreeze.settings);
  expect(JSON.parse(JSON.stringify(canonical(flags)))).toEqual(canonical(initialFreeze.flags));
  expect(canonical(surroundings.orders)).toEqual(canonical(initialFreeze.surroundings.orders));
  expect(canonical(surroundings.tasks)).toEqual(canonical(initialFreeze.surroundings.tasks));
  expect(surroundings.products).toBe(initialFreeze.surroundings.products);
  expect(flags.filter(f => f.expiresAt && f.expiresAt <= new Date())).toEqual([]);
  result.freeze.push({ at: new Date().toISOString(), orderDigest: hash(orders), fullDatasetDigest: hash({ orders, items, tasks }), settings, flags, surroundings, runtimeContractSha256: hash(contract) });
  save();
}
mkdirSync(output, { recursive: true });
await freeze();
const qr = await prisma.qrCode.findFirstOrThrow({ where: { id: fixture.qrId, organizationId: fixture.organizationId, stallId: fixture.stallId, state: "ACTIVE" }, select: { token: true } });
const product = await prisma.product.findUniqueOrThrow({ where: { id: fixture.productId }, select: { name: true } });
const redact = value => String(value).replaceAll(qr.token, "[REDACTED_QR]").slice(0, 1200);
const browser = await chromium.launch();
result.environment.browser = browser.version();
const options = { baseURL: origin, viewport: { width: 1024, height: 900 }, locale: "zh-TW", timezoneId: "Asia/Taipei", extraHTTPHeaders: headers, serviceWorkers: "block" };
async function login(email) {
  const context = await browser.newContext(options);
  try {
    const page = await context.newPage();
    await page.goto("/login");
    await page.getByRole("button", { name: "使用電子郵件與密碼登入", exact: true }).click();
    await page.getByLabel("電子郵件").fill(email);
    await page.getByLabel("密碼").fill("StallOrderDemo!2026");
    await page.getByRole("button", { name: "登入", exact: true }).click();
    await page.waitForURL(url => !url.pathname.endsWith("/login"));
    const auth = await page.evaluate(async () => { const r = await fetch("/api/auth/me"); return r.status; });
    expect(auth).toBe(200);
    if (email === "staff@stallorder.test") {
      const optional = await page.evaluate(async () => { const r = await fetch("/api/stalls/aming-chicken/attendance", { signal: AbortSignal.timeout(15_000) }); const body = await r.json(); return { status: r.status, code: body.code }; });
      result.optionalAttendancePreflight = optional;
      if (optional.status === 409 && ["ATTENDANCE_DISABLED", "ATTENDANCE_POLICY_INCOMPLETE"].includes(optional.code)) attendanceCode = optional.code;
      save();
    }
    return await context.storageState();
  } finally { await context.close(); }
}
let cases;
async function interaction(page, item) {
  if (item.name === "QR") {
    await page.getByRole("article").filter({ has: page.getByRole("heading", { name: product.name, exact: true }) }).getByTestId("qr-open-product-configurator").click();
    const option = page.getByTestId("qr-product-configuration").getByRole("radio").first();
    await option.click();
    await expect(option).toHaveAttribute("aria-checked", "true");
  } else if (item.name === "Staff") {
    const reminder = page.getByTestId("staff-start-reminder-backdrop");
    // Wait for the hydrated primary control; reminder exists synchronously after hydration.
    await expect(page.getByRole("button", { name: "輸入取餐碼", exact: true })).toBeEnabled();
    if (await reminder.isVisible()) await reminder.getByRole("button", { name: "稍後處理", exact: true }).last().click();
    await page.locator('[data-testid="staff-search-open"]:visible').click();
    const search = page.getByRole("searchbox");
    await search.fill("B3-001");
    await expect(search).toHaveValue("B3-001");
    await page.getByRole("dialog").getByRole("button", { name: "確認", exact: true }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await expect(page.locator('[data-testid="staff-order-master-detail"]:visible')).toContainText("B3-001");
  } else if (item.name === "KDS") {
    const choice = page.locator('[data-testid="kitchen-order-queue-button"]:visible').filter({ hasText: "B3-002" });
    await choice.click();
    await expect(choice).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator('[data-testid="kitchen-order-items-pane"]:visible')).toContainText("B3-002");
  } else {
    await page.getByRole("button", { name: "本週", exact: true }).click();
    await expect(page.getByRole("button", { name: "本週", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "自訂", exact: true }).click();
    await page.getByLabel("開始日期", { exact: true }).fill("2026-09-30");
    await expect(page.getByLabel("開始日期", { exact: true })).toHaveValue("2026-09-30");
  }
}
function monitor(page, tag) {
  const responses = [];
  page.on("response", response => {
    if (response.status() < 400) return;
    const row = { status: response.status(), path: redact(new URL(response.url()).pathname), retryAfter: response.headers()["retry-after"] ?? null };
    responses.push(row);
    if (row.status === 409 && row.path === "/api/stalls/aming-chicken/attendance" && attendanceCode) {
      row.preflightCode = attendanceCode;
      row.expectedOptionalModuleResponse = true;
    }
  });
  page.on("pageerror", error => result.diagnostics.push({ tag, at: new Date().toISOString(), type: "pageerror", message: redact(error.message) }));
  page.on("console", event => { if (event.type() === "error") result.diagnostics.push({ tag, type: "console", message: redact(event.text()) }); });
  page.setDefaultTimeout(20_000);
  return responses;
}
async function sampleRoute(item, cache) {
  const data = { samples: [], attempts: [], priming: null };
  result.routes[item.name][cache] = data;
  let context, page, responses;
  const open = async () => { context = await browser.newContext({ ...options, viewport: { width: item.width, height: 900 }, storageState: item.state }); page = await context.newPage(); responses = monitor(page, `${item.name}/${cache}`); };
  await open();
  try {
    if (cache === "warm") {
      await page.goto(item.path); await interaction(page, item);
      data.priming = { at: new Date().toISOString(), errors: [...responses] };
      expect(responses.filter(response => !response.expectedOptionalModuleResponse)).toEqual([]);
      if (["Staff", "KDS"].includes(item.name)) { await page.goto("about:blank"); await wait(1000); }
      responses.length = 0;
    }
    while (data.samples.length < count && data.attempts.length < count + 8) {
      if (cache === "cold" && data.attempts.length) { await context.close(); await open(); }
      responses.length = 0;
      const attempt = { at: new Date().toISOString(), index: data.attempts.length + 1 };
      const started = performance.now();
      try {
        const response = await page.goto(item.path);
        expect(response.status()).toBe(200);
        await interaction(page, item);
        attempt.ms = Math.round((performance.now() - started) * 10) / 10;
        expect(responses.filter(response => !response.expectedOptionalModuleResponse)).toEqual([]);
        attempt.valid = true;
        data.samples.push(attempt.ms);
      } catch (error) { attempt.valid = false; attempt.error = redact(error.message); }
      attempt.responses = [...responses];
      data.attempts.push(attempt);
      data.summary = stats(data.samples);
      data.errorRate = data.attempts.filter(a => !a.valid).length / data.attempts.length;
      save();
      if (!attempt.valid) {
        if (responses.some(r => r.status === 429)) { const seconds = Math.max(item.name === "QR" ? qrRateWindowSeconds + 1 : 61, ...responses.map(r => (Number(r.retryAfter) || 0) + 1)); console.log(`${item.name}/${cache} genuine rate window: waiting ${seconds}s`); await wait(seconds * 1000); }
        else throw Error(`${item.name}/${cache} invalid attempt; retained diagnostics`);
      }
      if (["Staff", "KDS"].includes(item.name)) { await page.goto("about:blank"); await wait(1000); }
      if (data.samples.length % 10 === 0) console.log(`${item.name}/${cache}: ${data.samples.length}/${count}`);
    }
    expect(data.samples.length).toBe(count);
  } finally { await context.close(); }
}
try {
  const states = { staff: await login("staff@stallorder.test"), kitchen: await login("kitchen@stallorder.test"), owner: await login("owner@stallorder.test") };
  cases = [
    { name: "QR", path: `/q/${qr.token}`, width: 390 },
    { name: "Staff", path: "/staff/aming-chicken", width: 1024, state: states.staff },
    { name: "KDS", path: "/kitchen?stall=aming-chicken", width: 1024, state: states.kitchen },
    { name: "Report", path: `/merchant/reports/overview?organizationId=${fixture.organizationId}&stallId=${fixture.stallId}&dateFrom=2026-09-30&dateTo=2026-09-30`, width: 390, state: states.owner },
  ];
  for (const item of cases) {
    result.routes[item.name] = { width: item.width, route: item.name === "QR" ? "/q/[frozen main QR]" : item.path, role: item.name === "QR" ? "anonymous" : item.name === "Report" ? "OWNER" : item.name.toUpperCase() };
    for (const cache of ["cold", "warm"]) await sampleRoute(item, cache);
  }
  for (const item of cases.filter(item => item.name !== "QR")) {
    const endpoint = item.name === "Staff" ? "/api/stalls/aming-chicken/orders" : item.name === "KDS" ? "/api/stalls/aming-chicken/kitchen/board" : "/api/availability/config";
    const context = await browser.newContext({ ...options, storageState: item.state });
    try {
      const page = await context.newPage(); await page.goto(item.path);
      const data = { endpoint, role: item.name, attempts: [], samples: [] }; result.api[item.name] = data;
      while (data.samples.length < count && data.attempts.length < count + 8) {
        const sample = await page.evaluate(async ({ endpoint, fixedOrderId }) => {
          const t = performance.now();
          const r = await fetch(endpoint, { credentials: "include", cache: "no-store", signal: AbortSignal.timeout(20_000) });
          const text = await r.text();
          const ms = Math.round((performance.now() - t) * 10) / 10;
          const body = r.headers.get("content-type")?.includes("application/json") ? JSON.parse(text) : null;
          return { ms, status: r.status, contentType: r.headers.get("content-type"), retryAfter: r.headers.get("retry-after"),
            bodyContractVerified: endpoint === "/api/availability/config" ? body?.activeBackend === "PRIMARY" : text.includes(fixedOrderId),
            rowCount: body?.orders?.length ?? body?.tasks?.length ?? null };
        }, { endpoint, fixedOrderId: fixture.orders[0].id });
        data.attempts.push(sample);
        if (sample.status === 200 && sample.contentType?.includes("application/json") && sample.bodyContractVerified) data.samples.push(sample.ms);
        data.summary = stats(data.samples); data.errorRate = (data.attempts.length - data.samples.length) / data.attempts.length; save();
        if (sample.status === 429) await wait(Math.max(61, Number(sample.retryAfter) || 0) * 1000);
        else { expect(sample.status).toBe(200); expect(sample.bodyContractVerified).toBe(true); }
      }
      expect(data.samples.length).toBe(count);
    } finally { await context.close(); }
  }
  for (const item of cases) {
    const records = []; result.vitals[item.name] = records;
    for (let round = 0; round < rounds; round++) {
      const context = await browser.newContext({ ...options, viewport: { width: item.width, height: 900 }, storageState: item.state });
      try {
        const page = await context.newPage(); const responses = monitor(page, `${item.name}/vitals`);
        await page.addInitScript(() => {
          window.__pairedVitals = { lcp: null, cls: 0, events: [], shifts: [], firstInput: null };
          const v = window.__pairedVitals;
          addEventListener("pointerdown", () => { v.firstInput ??= performance.now(); }, { capture: true });
          new PerformanceObserver(list => { for (const entry of list.getEntries()) if (!v.firstInput || entry.startTime < v.firstInput) v.lcp = entry.startTime; }).observe({ type: "largest-contentful-paint", buffered: true });
          new PerformanceObserver(list => { for (const entry of list.getEntries()) if (!entry.hadRecentInput) v.shifts.push({ start: entry.startTime, value: entry.value }); }).observe({ type: "layout-shift", buffered: true });
          new PerformanceObserver(list => { for (const entry of list.getEntries()) if (entry.interactionId) v.events.push({ id: entry.interactionId, duration: entry.duration, name: entry.name }); }).observe({ type: "event", buffered: true, durationThreshold: 16 });
        });
        await page.goto(item.path); await interaction(page, item); await page.waitForTimeout(500);
        expect(responses.filter(response => !response.expectedOptionalModuleResponse)).toEqual([]);
        const v = await page.evaluate(() => window.__pairedVitals);
        records.push({ round: round + 1, at: new Date().toISOString(), responses: [...responses], ...v, ...labVitals(v) }); save();
      } finally { await context.close(); }
    }
  }
  await freeze();
  result.status = "MEASURED";
} catch (error) { result.status = "INCOMPLETE"; result.failure = redact(error.stack); process.exitCode = 1; }
finally { await browser.close(); await prisma.$disconnect(); result.finishedAt = new Date().toISOString(); save(); }
