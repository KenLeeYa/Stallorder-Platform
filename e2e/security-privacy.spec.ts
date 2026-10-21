import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { randomUUID, createHash } from "node:crypto";
import { establishLocalTestSession } from "./local-navigation";
import { getPrivacyMessages } from "../src/lib/messages/privacy";
const prisma = new PrismaClient(); const org = "11111111-1111-4111-8111-111111111111";
const enabledProfile = process.env.COMPLIANCE_ENABLED === "true";
function localOrigin(baseURL: string | undefined) {
  const url = new URL(baseURL ?? "");
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || !/^\d+$/.test(url.port) || Number(url.port) < 1024 || Number(url.port) > 65535) throw new Error("LOCAL_QA_ONLY");
  return url.origin;
}
test.beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || !/^\d+$/.test(url.port) || Number(url.port) < 1024 || Number(url.port) > 65535 || url.pathname !== "/postgres") throw new Error("LOCAL_QA_ONLY");
  if (!enabledProfile) return;
  const policy = `browser-qa-${randomUUID()}`;
  await prisma.$executeRaw`insert into public.privacy_policy_versions(version,document_sha256,notice_text,lawful_basis,approved_by,effective_at)
    values(${policy},${createHash("sha256").update(policy).digest("hex")},'僅供本機合成測試的資料使用告知，未發布至正式站。','SYNTHETIC_QA',
      '55555555-5555-4555-8555-555555555551',now())`;
});
test.afterAll(() => prisma.$disconnect());

if (!enabledProfile) {
  test("停用治理時匿名與已登入請求均404且不揭露資料", async ({ page, baseURL }) => {
    const origin = localOrigin(baseURL);
    const body = { organizationId: org, receipt: "synthetic-private-receipt", status: "APPROVED" };
    for (const authenticated of [false, true]) {
      if (authenticated) {
        await establishLocalTestSession(page, prisma, "55555555-5555-4555-8555-555555555551");
        const session = await page.request.get("/api/auth/me");
        expect(session.status()).toBe(200);
        expect((await session.json()).user.id).toBe("55555555-5555-4555-8555-555555555551");
      }
      for (const path of ["/api/privacy/requests", "/api/privacy/receipt", "/api/privacy/export", `/api/merchant/organizations/${org}/privacy`]) {
        const response = path.startsWith("/api/merchant/")
          ? await page.request.get(path) : await page.request.post(path, { headers: { origin }, data: body });
        expect(response.status()).toBe(404);
        expect(response.headers()["cache-control"]).toContain("no-store");
        expect(response.headers()["cdn-cache-control"]).toBe("no-store");
        const result = await response.json();
        expect(result.code).toBe("COMPLIANCE_UNAVAILABLE");
        expect(Object.keys(result).sort()).toEqual(["code", "error", "requestId"]);
        expect(JSON.stringify(result)).not.toMatch(/synthetic-private-receipt|APPROVED|sql|password|postgres|stack/i);
      }
    }
  });
  test("停用治理時隱私頁404且不呈現請求或管理操作", async ({ page, baseURL }) => {
    localOrigin(baseURL);
    await establishLocalTestSession(page, prisma, "55555555-5555-4555-8555-555555555551");
    const response = await page.goto(`/merchant/privacy?organizationId=${org}`);
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "隱私權與資料請求", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "送出請求", exact: true })).toHaveCount(0);
    await expect(page.getByLabel("請說明請求範圍")).toHaveCount(0);
  });
} else {
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
  const exported = await page.request.post("/api/privacy/export", { headers: { origin: localOrigin(page.url()) }, data: { organizationId: org, receipt: receipt.receipt } });
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
test("六語系窄螢幕可讀，未設定 MFA 時不曝光無法執行的敏感操作", async ({ page, baseURL }) => {
  await establishLocalTestSession(page, prisma, "55555555-5555-4555-8555-555555555551");
  await page.setViewportSize({ width: 320, height: 900 });
  for (const locale of ["zh-TW", "en", "ja", "ko", "vi", "th"]) {
    await page.context().addCookies([{ name: "stallorder_locale", value: locale, url: localOrigin(baseURL) }]);
    await page.goto(`/merchant/privacy?organizationId=${org}`);
    const text = getPrivacyMessages(locale);
    await expect(page.getByRole("heading", { name: text.title, exact: true })).toBeVisible();
    await expect(page.getByText(text.mfaUnavailableNotice, { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: text.mfaAdd, exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
});
test("訪客權利請求保留協定拒絕狀態，不能注入組織或核准欄位", async ({ page, baseURL }) => {
  const data = { subject: "ORDER", trackingToken: "x".repeat(40), command: {
    operationId: randomUUID(), type: "ACCESS", policyVersion: "synthetic", details: "Synthetic only" } };
  const invalidProtocol = await page.request.post("/api/privacy/requests", { headers: { origin: localOrigin(baseURL), "x-stallorder-protocol-version": "unsupported" }, data });
  expect(invalidProtocol.status()).toBe(426);
  expect(invalidProtocol.headers()["cache-control"]).toContain("no-store");
  const injected = await page.request.post("/api/privacy/requests", { headers: { origin: localOrigin(baseURL) },
    data: { ...data, organizationId: org, status: "APPROVED" } });
  expect(injected.status()).toBe(400);
});
}
