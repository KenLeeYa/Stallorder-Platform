import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { chromium, expect } from "@playwright/test";
import { assertIsolatedStorageQa } from "./qa-primary-only-storage";

const ORGANIZATION = "11111111-1111-4111-8111-111111111111";
const STALL = "22222222-2222-4222-8222-222222222222";
let phase = "preflight";
const required = (name: string) => {
  assert.ok(process.env[name]?.trim(), "PREVIEW_ORDER_QA_CONFIGURATION_MISSING");
  return process.env[name]!.trim();
};

async function main() {
  assert.ok(process.env.GITHUB_ACTIONS === "true" && process.env.VERCEL_ENV === "preview"
    && process.env.GITHUB_REPOSITORY === "KenLeeYa/Stallorder-Platform", "PREVIEW_ORDER_QA_INVOCATION_INVALID");
  const ref = required("PREVIEW_ORDER_BRANCH_REF");
  assertIsolatedStorageQa({ ref, parentRef: required("SUPABASE_PARENT_PROJECT_REF"),
    supabaseUrl: required("NEXT_PUBLIC_SUPABASE_URL"), databaseUrl: required("DATABASE_URL") });
  const base = new URL(required("PREVIEW_ORDER_BASE_URL"));
  assert.ok(base.protocol === "https:" && !base.username && !base.password && !base.port
    && /^stallorder-platform-[a-z0-9]+-ada76145-8663s-projects\.vercel\.app$/.test(base.hostname), "PREVIEW_ORDER_QA_HOST_INVALID");
  const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const headers = { "x-vercel-protection-bypass": required("VERCEL_AUTOMATION_BYPASS_SECRET") };
  const version = await fetch(`${base.origin}/api/version`, { headers, redirect: "error", signal: AbortSignal.timeout(20_000) });
  assert.ok(version.ok && (await version.json()).revision === sourceSha, "PREVIEW_ORDER_QA_REVISION_MISMATCH");
  const prisma = new PrismaClient();
  const browser = await chromium.launch();
  let orderId = "";
  try {
    phase = "synthetic-fixture";
    // These are the reviewed synthetic fixtures, never a parent or the retired DR.
    assert.equal(await prisma.stallBusinessHour.count({ where: { organizationId: ORGANIZATION, stallId: STALL } }), 7);
    await prisma.stallBusinessHour.updateMany({ where: { organizationId: ORGANIZATION, stallId: STALL },
      data: { opensAt: "00:00", closesAt: "00:00", lastOrderAt: null, isClosed: false } });
    await prisma.printer.updateMany({ where: { organizationId: ORGANIZATION }, data: { isEnabled: false } });
    const context = await browser.newContext({ locale: "zh-TW", timezoneId: "Asia/Taipei", serviceWorkers: "block" });
    await context.route(`${base.origin}/**`, (route) => route.continue({ headers: { ...route.request().headers(), ...headers } }));
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    const errors: string[] = [];
    page.on("pageerror", () => errors.push("pageerror"));
    const session = page.waitForResponse((response) => response.url().endsWith("/create-order-session") && response.request().method() === "POST");
    phase = "qr-session";
    await page.goto(`${base.origin}/q/demo-aming-chicken-table-a1-qr-2026`);
    assert.equal((await session).status(), 201, "PREVIEW_QR_SESSION_FAILED");
    const add = page.getByRole("button", { name: "增加 冬瓜茶", exact: true });
    await expect(add).toBeEnabled();
    await mkdir("artifacts", { recursive: true });
    phase = "responsive-menu";
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(add).toBeVisible();
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
      await page.screenshot({ path: `artifacts/preview-public-order-${width}.png` });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    phase = "mobile-checkout";
    await add.click();
    await page.getByTestId("qr-mobile-cart-summary").click();
    await page.getByTestId("qr-cart-panel").getByRole("button", { name: "繼續填寫訂購資料", exact: true }).click();
    const upsell = page.getByRole("dialog", { name: "結帳前，再看看", exact: true });
    if (await upsell.isVisible()) await upsell.getByRole("button", { name: "不用，直接結帳", exact: true }).click();
    await page.getByLabel("訂單備註", { exact: true }).fill(`Preview browser QA ${process.env.GITHUB_RUN_ID}`);
    const acknowledgment = page.getByRole("checkbox", { name: /我已了解目前預估等候時間/ });
    if (await acknowledgment.isVisible()) await acknowledgment.check();
    const submitted = page.waitForResponse((response) => response.url().endsWith("/create-public-order") && response.request().method() === "POST");
    phase = "order-submission";
    await page.getByRole("button", { name: "送出訂單", exact: true }).click();
    const result = await submitted;
    assert.ok([200, 201].includes(result.status()), "PREVIEW_QR_SUBMISSION_FAILED");
    orderId = result.request().postDataJSON().clientOrderId;
    assert.match(orderId, /^[a-f0-9-]{36}$/);
    const marked = await prisma.order.updateMany({ where: { id: orderId, organizationId: ORGANIZATION, stallId: STALL }, data: { isTest: true } });
    assert.equal(marked.count, 1, "PREVIEW_QR_ORDER_SCOPE_INVALID");
    phase = "order-tracker";
    await expect(page).toHaveURL(/\/order\/sto_/);
    await expect(page.getByTestId("public-order-tracker-header")).toBeVisible();
    assert.equal(errors.length, 0, "PREVIEW_QR_BROWSER_ERROR");
    await writeFile("artifacts/preview-public-order.json", JSON.stringify({ sourceSha, backend: ref,
      origin: base.origin, widths: [320, 390, 768, 1440], realBrowserSession: true, realBrowserOrderTracker: true,
      physicalPrinting: "disabled", turnstile: "official-test-key", serviceWorkers: "blocked-for-protection-header-test" }, null, 2));
    console.log("PASS: hosted QR session, 4 responsive widths, mobile checkout and actual order tracker.");
  } finally {
    try {
      if (orderId) await prisma.order.deleteMany({ where: { id: orderId, organizationId: ORGANIZATION, stallId: STALL, isTest: true } });
    } finally { await browser.close(); await prisma.$disconnect(); }
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "";
  console.error(/^PREVIEW_[A-Z_]+$/.test(message) ? message : "PREVIEW_PUBLIC_ORDER_BROWSER_QA_FAILED", { phase });
  process.exitCode = 1;
});
