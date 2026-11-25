import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { resolveProductionTestQrUrl } from "./lib/production-smoke-qr-url.mjs";
import { verifyQrMenuSearch } from "./qa-qr-menu-search";

const origin = "https://app.qidaigo.com";

async function checkServing() {
  for (const path of ["/api/version", "/api/availability/config"]) {
    const response = await fetch(origin + path, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15000) });
    assert.ok(response.ok);
    const data = await response.json();
    if (path === "/api/version") assert.equal(data.revision, process.env.GITHUB_SHA);
    else assert.ok(data.activeBackend === "PRIMARY" && data.mode === "NORMAL_PRIMARY" && data.promotionEpoch === 3);
  }
}

async function main() {
  assert.ok(process.env.GITHUB_ACTIONS === "true" && process.env.GITHUB_REPOSITORY === "KenLeeYa/Stallorder-Platform"
    && process.env.GITHUB_REF === "refs/heads/main" && /^[0-9a-f]{40}$/.test(process.env.GITHUB_SHA ?? ""));
  const qr = resolveProductionTestQrUrl({ baseUrl: origin, configuredUrl: process.env.PRODUCTION_TEST_QR_URL, required: true });
  assert.ok(qr && !qr.username && !qr.password && !qr.search && !qr.hash);
  await checkServing();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ serviceWorkers: "block", locale: "zh-TW" });
    // Permit only the dedicated same-origin session write while exercising the public search UI.
    await page.route("**/*", route => {
      const request = route.request();
      const url = new URL(request.url());
      const sameOrigin = url.origin === origin;
      const read = ["GET", "HEAD"].includes(request.method());
      const session = request.method() === "POST" && url.pathname === "/api/public-order/create-order-session";
      return sameOrigin && (read || session) ? route.continue() : route.abort();
    });
    let pageError = false;
    page.on("pageerror", () => { pageError = true; });
    const session = page.waitForResponse(r => r.request().method() === "POST" && r.url() === origin + "/api/public-order/create-order-session");
    const [, response] = await Promise.all([page.goto(qr.href), session]);
    assert.ok([200, 201].includes(response.status()));
    await verifyQrMenuSearch(page);
    assert.equal(pageError, false);
  } finally {
    await browser.close();
    await checkServing();
  }
  console.log("PASS: serving revision, Primary epoch, dedicated QR session, product search, empty results and clearing search.");
}

// Browser errors can contain the dedicated URL. Never log the error or attach a trace.
void main().catch(() => { console.error("PRODUCTION_QR_MENU_ACCEPTANCE_FAILED"); process.exitCode = 1; });
