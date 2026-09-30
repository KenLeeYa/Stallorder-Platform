import { readFile, writeFile } from "node:fs/promises";
import { loadEnvFile } from "node:process";
import { performance } from "node:perf_hooks";
import { chromium, expect } from "@playwright/test";
import { assertResponsiveQaTarget } from "../../../scripts/responsive-qa-target.mjs";

loadEnvFile(".env.local");
assertResponsiveQaTarget(process.env);

const origin = "http://127.0.0.1:3026";
const receipt = JSON.parse(await readFile(new URL("./same-order-receipt.json", import.meta.url), "utf8"));
const qrPath = `/q/responsive-qa-${receipt.runId}`;
const headers = { "x-vercel-forwarded-for": "203.0.113.10", "cf-connecting-ip": "203.0.113.10" };
const visitorHeaders = (index) => ({ "x-vercel-forwarded-for": `203.0.113.${index}`, "cf-connecting-ip": `203.0.113.${index}` });
const browser = await chromium.launch();
const startedAt = new Date().toISOString();
const result = {
  revision: receipt.revision,
  startedAt,
  origin,
  mode: "next start; local Docker DB/API/Edge; loopback network; Chromium",
  browserCold: "new isolated context, navigation to enabled control; not a server or OS cold start",
  browserWarm: "same context, repeated navigation to enabled control",
  samplingNotes: [
    "Customer cold contexts use distinct 203.0.113.x synthetic visitor IPs in this isolated lab.",
    "Customer warm uses one browser context and one synthetic visitor IP; 429 samples are excluded.",
    "Staff and KDS browser states come from normal UI logins; dataset/flags are frozen in dataset-baseline.json.",
  ],
  routes: {},
  api: {},
  vitals: [],
};
const p95 = (values) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1];
const summary = (values) => ({ samplesMs: values, status: values.length === 30 ? "MEASURED" : "NOT_RUN", medianMs: values.length === 30 ? [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] : null, p95Ms: values.length === 30 ? p95(values) : null });

async function login(email) {
  const context = await browser.newContext({ baseURL: origin, viewport: { width: 1024, height: 900 }, extraHTTPHeaders: headers });
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByRole("button", { name: "使用電子郵件與密碼登入", exact: true }).click();
  await page.getByLabel("電子郵件").fill(email);
  await page.getByLabel("密碼").fill("StallOrderDemo!2026");
  await page.getByRole("button", { name: "登入", exact: true }).click();
  await page.waitForURL((url) => !url.pathname.endsWith("/login"));
  const state = await context.storageState();
  await context.close();
  return state;
}

const staffState = await login("staff@stallorder.test");
const kitchenState = await login("kitchen@stallorder.test");
const cases = [
  {
    name: "customer QR 390",
    path: qrPath,
    width: 390,
    state: undefined,
    marker: (page) => page.getByRole("article").filter({ has: page.getByRole("heading", { name: `跨裝置 QA 餐 ${receipt.runId.slice(0, 8)}` }) }).getByTestId("qr-open-product-configurator"),
  },
  {
    name: "staff 1024",
    path: "/staff/aming-chicken",
    width: 1024,
    state: staffState,
    marker: (page) => page.getByTestId("staff-pickup-code-lookup"),
  },
  {
    name: "KDS 1024",
    path: "/kitchen?stall=aming-chicken",
    width: 1024,
    state: kitchenState,
    marker: (page) => page.getByTestId("kitchen-order-items-pane"),
  },
];

try {
  for (const item of cases) {
    const cold = [];
    const warm = [];
    const failures = [];
    for (let i = 0; i < 30; i++) {
      const context = await browser.newContext({ baseURL: origin, viewport: { width: item.width, height: 900 }, storageState: item.state, extraHTTPHeaders: item.name === "customer QR 390" ? visitorHeaders(20 + i) : headers });
      const page = await context.newPage();
      let sessionStatus = null;
      page.on("response", (response) => { if (response.url().includes("order-session")) sessionStatus = response.status(); });
      try {
        const t = performance.now();
        await page.goto(item.path);
        await item.marker(page).waitFor({ state: "visible", timeout: 20_000 });
        if (item.name !== "KDS 1024") await expect(item.marker(page)).toBeEnabled({ timeout: 20_000 });
        cold.push(Math.round(performance.now() - t));
      } catch {
        failures.push({ phase: "cold", sample: i + 1, sessionStatus });
      }
      await context.close();
      if (failures.length) break;
    }
    const context = await browser.newContext({ baseURL: origin, viewport: { width: item.width, height: 900 }, storageState: item.state, extraHTTPHeaders: item.name === "customer QR 390" ? visitorHeaders(80) : headers });
    const page = await context.newPage();
    let sessionStatus = null;
    page.on("response", (response) => { if (response.url().includes("order-session")) sessionStatus = response.status(); });
    for (let i = 0; i < 30; i++) {
      try {
        const t = performance.now();
        await page.goto(item.path);
        await item.marker(page).waitFor({ state: "visible", timeout: 20_000 });
        if (item.name !== "KDS 1024") await expect(item.marker(page)).toBeEnabled({ timeout: 20_000 });
        warm.push(Math.round(performance.now() - t));
      } catch {
        failures.push({ phase: "warm", sample: i + 1, sessionStatus });
        break;
      }
    }
    await context.close();
    result.routes[item.name] = { cold: summary(cold), warm: summary(warm), failures };
    process.stdout.write(`${item.name}: ${cold.length} cold, ${warm.length} warm, ${failures.length} invalid\n`);
  }

  const apiContext = await browser.newContext({ baseURL: origin, storageState: staffState, extraHTTPHeaders: headers });
  for (const [name, path] of [["availability config", "/api/availability/config"], ["staff orders", "/api/stalls/aming-chicken/orders"]]) {
    const samples = [];
    for (let i = 0; i < 30; i++) {
      const t = performance.now();
      const response = await apiContext.request.get(path);
      samples.push({ ms: Math.round(performance.now() - t), status: response.status() });
    }
    const accepted = samples.filter((sample) => sample.status === 200);
    result.api[name] = {
      ...summary(accepted.map((sample) => sample.ms)),
      attempted: samples.length,
      statusCounts: Object.fromEntries([...new Set(samples.map((sample) => sample.status))].map((status) => [status, samples.filter((sample) => sample.status === status).length])),
      errorRate: (samples.length - accepted.length) / samples.length,
    };
  }
  await apiContext.close();

  for (let i = 0; i < 5; i++) {
    const context = await browser.newContext({ baseURL: origin, viewport: { width: 390, height: 844 }, extraHTTPHeaders: visitorHeaders(140 + i) });
    const page = await context.newPage();
    await page.addInitScript(() => {
      window.__responsiveVitals = { lcp: null, cls: 0, inp: null };
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) window.__responsiveVitals.lcp = Math.round(entry.startTime);
      }).observe({ type: "largest-contentful-paint", buffered: true });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__responsiveVitals.cls += entry.value;
      }).observe({ type: "layout-shift", buffered: true });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) if (entry.interactionId) window.__responsiveVitals.inp = Math.max(window.__responsiveVitals.inp ?? 0, entry.duration);
      }).observe({ type: "event", buffered: true, durationThreshold: 16 });
    });
    try {
      await page.goto(qrPath);
      const control = cases[0].marker(page);
      await control.click({ timeout: 20_000 });
      await page.getByRole("radio", { name: /QA 必選加料/ }).click();
      await page.waitForTimeout(250);
      result.vitals.push({ status: "MEASURED", ...await page.evaluate(() => window.__responsiveVitals) });
    } catch {
      result.vitals.push({ status: "NOT_RUN", reason: "QR interaction unavailable" });
    }
    await context.close();
  }
} finally {
  await browser.close();
  result.finishedAt = new Date().toISOString();
  await writeFile(new URL("./performance-baseline.json", import.meta.url), JSON.stringify(result, null, 2) + "\n");
}
