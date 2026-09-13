import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { randomUUID, createHash } from "node:crypto";
import { establishLocalTestSession } from "./local-navigation";
import { getPrivacyMessages } from "../src/lib/messages/privacy";
const prisma = new PrismaClient(); const org = "11111111-1111-4111-8111-111111111111";
test.beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  if (url.hostname !== "127.0.0.1" || url.port !== "55992") throw new Error("LOCAL_QA_ONLY");
  const policy = `browser-qa-${randomUUID()}`;
  await prisma.$executeRaw`insert into public.privacy_policy_versions(version,document_sha256,notice_text,lawful_basis,approved_by,effective_at)
    values(${policy},${createHash("sha256").update(policy).digest("hex")},'僅供本機合成測試的資料使用告知，未發布至正式站。','SYNTHETIC_QA',
      '55555555-5555-4555-8555-555555555551',now())`;
});
test.afterAll(() => prisma.$disconnect());
test("本人可提出權利請求、保存憑證並在重新整理後查詢；320至1440px可操作", async ({ page }) => {
  await establishLocalTestSession(page, prisma, "55555555-5555-4555-8555-555555555551");
  await page.goto(`/merchant/privacy?organizationId=${org}`);
  await expect(page.getByRole("heading", { name: "隱私權與資料請求", exact: true })).toBeVisible();
  for (const width of [320,390,768,1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await expect(page.getByRole("button", { name: "送出請求", exact: true })).toBeVisible();
  }
  await page.getByLabel("請說明請求範圍").fill("只取得本人帳戶資料，本機合成測試。");
  const response = page.waitForResponse((r) => r.url().endsWith("/api/privacy/requests") && r.request().method() === "POST");
  await page.getByRole("button", { name: "送出請求", exact: true }).click();
  const created = await response; expect(created.status()).toBe(201);
  expect(created.headers()["cache-control"]).toContain("no-store");
  const receipt = await created.json();
  await expect(page.getByText(receipt.receipt, { exact: false })).toBeVisible();
  await page.reload(); await page.getByText("使用已保存的查詢憑證", { exact: true }).click();
  await page.getByLabel("完整查詢憑證").fill(`${org}:${receipt.receipt}`);
  await page.getByRole("button", { name: "查詢既有案件", exact: true }).click();
  await expect(page.getByText(receipt.id, { exact: true }).first()).toBeVisible();
  const exported = await page.request.post("/api/privacy/export", { headers: { origin: "http://127.0.0.1:3093" }, data: { organizationId: org, receipt: receipt.receipt } });
  expect(exported.status()).toBe(403); // Authenticated request without CSRF never discloses.
});
test("匿名與跨組織管理入口拒絕，錯誤及receipt不進共享cache", async ({ page }) => {
  const anonymous = await page.request.get(`/api/merchant/organizations/${org}/privacy`);
  expect(anonymous.status()).toBe(401); expect(anonymous.headers()["cache-control"]).toContain("no-store");
  await establishLocalTestSession(page, prisma, "55555555-5555-4555-8555-555555555551");
  await page.goto(`/merchant/privacy?organizationId=${org}`);
  const cross = await page.request.get("/api/merchant/organizations/11111111-1111-4111-8111-111111111112/privacy");
  expect(cross.status()).toBe(404);
  expect(JSON.stringify(await cross.json())).not.toMatch(/sql|password|postgres|stack/i);
});
test("六語系窄螢幕可讀，未設定 MFA 時不曝光無法執行的敏感操作", async ({ page }) => {
  await establishLocalTestSession(page, prisma, "55555555-5555-4555-8555-555555555551");
  await page.setViewportSize({ width: 320, height: 900 });
  for (const locale of ["zh-TW", "en", "ja", "ko", "vi", "th"]) {
    await page.context().addCookies([{ name: "stallorder_locale", value: locale, url: "http://127.0.0.1:3093" }]);
    await page.goto(`/merchant/privacy?organizationId=${org}`);
    const text = getPrivacyMessages(locale);
    await expect(page.getByRole("heading", { name: text.title, exact: true })).toBeVisible();
    await expect(page.getByText(text.mfaUnavailableNotice, { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: text.mfaAdd, exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
});
test("訪客權利請求保留協定拒絕狀態，不能注入組織或核准欄位", async ({ page }) => {
  const data = { subject: "ORDER", trackingToken: "x".repeat(40), command: {
    operationId: randomUUID(), type: "ACCESS", policyVersion: "synthetic", details: "Synthetic only" } };
  const invalidProtocol = await page.request.post("/api/privacy/requests", { headers: { origin: "http://127.0.0.1:3093", "x-stallorder-protocol-version": "unsupported" }, data });
  expect(invalidProtocol.status()).toBe(426);
  expect(invalidProtocol.headers()["cache-control"]).toContain("no-store");
  const injected = await page.request.post("/api/privacy/requests", { headers: { origin: "http://127.0.0.1:3093" },
    data: { ...data, organizationId: org, status: "APPROVED" } });
  expect(injected.status()).toBe(400);
});
