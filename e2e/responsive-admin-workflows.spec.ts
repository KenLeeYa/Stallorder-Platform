import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { assertResponsiveQaTarget } from "../scripts/responsive-qa-target.mjs";
import { gotoLocalPath, loginLocalTestAccount } from "./local-navigation";

const prisma = new PrismaClient();
const password = "StallOrderDemo!2026";
const organizationId = "11111111-1111-4111-8111-111111111111";
const merchantName = `B2 管理檢視 ${randomUUID().slice(0, 8)}`;
let applicationId = "";
let connectionId = "";
let applicationNumber = "";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  assertResponsiveQaTarget(process.env);
  const [owner, admin] = await Promise.all([
    prisma.profile.findUniqueOrThrow({ where: { email: "owner@stallorder.test" } }),
    prisma.profile.findUniqueOrThrow({ where: { email: "platform.admin@stallorder.test" } }),
  ]);
  expect(admin.platformRole).toBe("PLATFORM_ADMIN");
  expect(owner.platformRole).toBeNull();
  const application = await prisma.merchantApplication.create({ data: {
    applicantProfileId: owner.id,
    applicantEmail: "owner@stallorder.test",
    applicantDisplayName: owner.displayName,
    merchantName,
    phone: "0912345678",
    phoneHash: `b2-${randomUUID()}`,
    businessPhone: "0912345678",
    businessType: "NIGHT_MARKET_STALL",
    contactName: "B2 測試聯絡人",
    preferredContactMethod: "PHONE",
    businessAddress: "台北市測試路 2 號",
    city: "台北市",
    stallName: "B2 測試攤位",
    stallLocation: "台北測試夜市",
    requestedSlug: `b2-admin-${randomUUID().slice(0, 8)}`,
    requestedPlanCode: "TRIAL",
    estimatedDailyOrders: 21,
    status: "PENDING_REVIEW",
    termsAccepted: true,
    privacyAccepted: true,
    dataProcessingAccepted: true,
    informationConfirmed: true,
    consentedAt: new Date(),
    submittedAt: new Date(),
  } });
  applicationId = application.id;
  applicationNumber = application.applicationNumber;
  connectionId = (await prisma.invoiceProviderConnection.create({ data: {
    organizationId,
    provider: "ECPAY",
    environment: "MOCK",
    status: "CONFIGURED",
    createdByProfileId: admin.id,
    updatedByProfileId: admin.id,
  } })).id;
});

test.afterAll(async () => {
  if (connectionId) await prisma.invoiceProviderConnection.delete({ where: { id: connectionId } });
  if (applicationId) await prisma.merchantApplication.delete({ where: { id: applicationId } });
  await prisma.$disconnect();
});

test.beforeEach(async ({ page }) => {
  await loginLocalTestAccount(page, "platform.admin@stallorder.test", password);
});

test("application review action stays visible at tablet width", async ({ page }) => {
  await gotoLocalPath(page, "/admin/merchant-applications?status=PENDING_REVIEW");
  await expect(page.getByRole("heading", { name: "商家申請審核" })).toBeVisible();
  for (const width of [320, 360, 390, 768, 820, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const record = page.locator("article:visible, tr:visible").filter({ hasText: applicationNumber });
    const action = record.getByRole("link", { name: "審核" });
    await expect(action).toBeVisible();
    const bounds = await action.boundingBox();
    const content = await page.locator("main").boundingBox();
    expect(bounds).not.toBeNull();
    expect(content).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(content!.x);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(content!.x + content!.width + 1);
    expect(bounds!.height).toBeGreaterThanOrEqual(44);
  }
  const record = page.locator("article:visible, tr:visible").filter({ hasText: applicationNumber });
  const details = record.getByRole("group", { name: "完整資料" });
  await details.locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(details).toContainText("0912345678");
  await page.keyboard.press("Enter");
  await expect(details.locator("summary")).toBeFocused();
  await page.setViewportSize({ width: 320, height: 900 });
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  const zoomedAction = record.getByRole("link", { name: "審核" });
  const zoomedBounds = await zoomedAction.boundingBox();
  const zoomedContent = await page.locator("main").boundingBox();
  expect(zoomedBounds!.x + zoomedBounds!.width).toBeLessThanOrEqual(zoomedContent!.x + zoomedContent!.width + 1);
  await page.evaluate(() => { document.documentElement.style.fontSize = ""; });
  await record.getByRole("link", { name: "審核" }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/merchant-applications/${applicationId}$`));
  await page.getByRole("button", { name: "返回申請列表" }).click();
  await expect(page).toHaveURL(/status=PENDING_REVIEW/);
});

test("plan version details retain all billing fields", async ({ page }) => {
  const payg = await prisma.planVersion.findFirstOrThrow({ where: { pricingMode: "USAGE_PER_STALL_CAPPED" } });
  expect(payg.contractHash).toBeTruthy();
  await gotoLocalPath(page, "/admin/plan-versions");
  for (const width of [390, 768, 820, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const record = page.getByTestId("admin-plan-version-record").filter({ hasText: payg.contractHash!.slice(0, 12) });
    await expect(record).toBeVisible();
    const details = record.getByRole("group", { name: "完整資料" });
    await details.locator("summary").focus();
    await page.keyboard.press("Enter");
    await expect(details).toContainText(payg.taxTreatment);
    await expect(details).toContainText(payg.contractHash!.slice(0, 12));
    await expect(details).toContainText(payg.billingTimezone);
    await expect(details).toContainText(String(payg.taxRateBps));
    const bounds = await details.locator("summary").boundingBox();
    const content = await page.locator("main").boundingBox();
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(content!.x + content!.width + 1);
    await page.keyboard.press("Enter");
  }
});

test("invoice monitor remains read-only", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoLocalPath(page, "/admin/e-invoice");
  await expect(page.getByRole("heading", { name: "電子發票整合" })).toBeVisible();
  const connection = page.getByTestId("admin-einvoice-connection").filter({ hasText: "ECPAY" });
  await expect(connection).toContainText("MOCK");
  await expect(connection).toContainText("CONFIGURED");
  await expect(connection).toContainText("1");
  await expect(page.getByText("Production Issue：OFF", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: /停用正式連線|強制健康檢查|重試|人工結案/ })).toHaveCount(0);
});

test("direct admin URL and sensitive action reject lower roles", async ({ page }) => {
  await page.context().clearCookies();
  await loginLocalTestAccount(page, "owner@stallorder.test", password);
  await gotoLocalPath(page, `/merchant/dashboard?organizationId=${organizationId}`);
  const identity = await page.evaluate(async () => {
    const response = await fetch("/api/auth/me", { credentials: "include", cache: "no-store" });
    return { status: response.status, body: await response.json() as { user?: { email?: string } } };
  });
  expect(identity.status).toBe(200);
  expect(identity.body.user?.email).toBe("owner@stallorder.test");
  const applicationBefore = await prisma.merchantApplication.findUniqueOrThrow({ where: { id: applicationId }, select: { status: true, riskLevel: true, reviewedAt: true } });
  const denied = await page.evaluate(async (applicationId) => {
    const response = await fetch(`/api/admin/merchant-applications/${applicationId}`, {
      method: "PATCH", credentials: "include", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "MARK_RISK", riskLevel: "HIGH", reason: "B2 denied role test" }),
    });
    return { status: response.status, requestId: response.headers.get("x-request-id") };
  }, applicationId);
  expect(denied.status).toBe(404);
  expect(denied.requestId).toBeTruthy();
  expect(await prisma.merchantApplication.findUniqueOrThrow({ where: { id: applicationId }, select: { status: true, riskLevel: true, reviewedAt: true } })).toEqual(applicationBefore);
  expect(await prisma.auditLog.count({ where: { requestId: denied.requestId!, action: "AUTHORIZATION_DENIED", outcome: "DENIED" } })).toBe(1);
  for (const path of ["/admin/merchant-applications", "/admin/plan-versions", "/admin/e-invoice"]) {
    const response = await page.evaluate(async (path) => (await fetch(path, { credentials: "include", cache: "no-store" })).status, path);
    expect(response).toBe(404);
  }
});
