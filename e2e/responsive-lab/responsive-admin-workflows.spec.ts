import { createHash, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { assertResponsiveQaTarget } from "../../scripts/responsive-qa-target.mjs";
import { gotoLocalPath, loginLocalTestAccount } from "../local-navigation";

const prisma = new PrismaClient();
const password = "StallOrderDemo!2026";
const organizationId = "11111111-1111-4111-8111-111111111111";
const merchantName = `B2 管理檢視 ${randomUUID().slice(0, 8)}`;
let applicationId = "";
let connectionId = "";
let planFixtureId = "";
let applicationNumber = "";

assertResponsiveQaTarget(process.env);

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
  const source = await prisma.planVersion.findFirstOrThrow({ where: { pricingMode: "USAGE_PER_STALL_CAPPED" } });
  planFixtureId = (await prisma.planVersion.create({ data: {
    planId: source.planId,
    version: 10_000 + (parseInt(randomUUID().slice(0, 8), 16) % 1_000_000),
    displayName: "B2 本機封存欄位測試",
    billingInterval: source.billingInterval,
    basePrice: source.basePrice,
    annualPrice: source.annualPrice,
    includedStalls: source.includedStalls,
    maxStalls: source.maxStalls,
    includedOrders: source.includedOrders,
    overagePolicy: source.overagePolicy,
    pricingMode: "USAGE_PER_STALL_CAPPED",
    usageUnitPrice: source.usageUnitPrice,
    usageMetric: source.usageMetric,
    usageScope: source.usageScope,
    monthlyCapAmount: source.monthlyCapAmount,
    billingTimezone: "Asia/Taipei",
    invoiceCloseDelayHours: 24,
    taxTreatment: "INCLUSIVE",
    taxRateBps: 500,
    taxJurisdiction: "TW",
    capTaxBasis: "TAX_INCLUSIVE_TOTAL",
    sealedAt: new Date(),
    sealedByProfileId: admin.id,
    contractHash: createHash("sha256").update("B2 local presentation fixture").digest("hex"),
    isPublic: false,
    effectiveFrom: new Date("2100-01-01T00:00:00.000Z"),
  } })).id;
});

test.afterAll(async () => {
  if (planFixtureId) await prisma.planVersion.delete({ where: { id: planFixtureId } });
  if (connectionId) await prisma.invoiceProviderConnection.delete({ where: { id: connectionId } });
  if (applicationId) await prisma.merchantApplication.delete({ where: { id: applicationId } });
  await prisma.$disconnect();
});

test.beforeEach(async ({ page }, testInfo) => {
  const email = testInfo.title === "direct admin URL and sensitive action reject lower roles"
    ? "owner@stallorder.test"
    : "platform.admin@stallorder.test";
  await loginLocalTestAccount(page, email, password);
});

test("full comparison tables stay labeled and locally scrollable at 2xl", async ({ page }) => {
  await page.setViewportSize({ width: 1536, height: 900 });
  await gotoLocalPath(page, "/admin/merchant-applications?status=PENDING_REVIEW");
  const applicationCard = page.getByTestId("merchant-application-record").filter({ hasText: applicationNumber });
  await expect(applicationCard).toBeVisible();
  const review = applicationCard.getByRole("link", { name: "審核" });
  await expect(review).toBeVisible();
  const actionBounds = await review.boundingBox();
  const mainBounds = await page.locator("main").boundingBox();
  expect(actionBounds!.x + actionBounds!.width).toBeLessThanOrEqual(mainBounds!.x + mainBounds!.width + 1);
  const applicationTable = page.getByTestId("merchant-applications-desktop-table");
  await expect(applicationTable.getByRole("heading", { name: "完整比較表" })).toBeVisible();
  await expect(applicationTable.locator("table")).toBeVisible();
  const applicationScroll = await applicationTable.evaluate((element) => {
    const max = element.scrollWidth - element.clientWidth;
    element.scrollLeft = max;
    return { max, actual: element.scrollLeft };
  });
  expect(applicationScroll.max).toBeGreaterThan(0);
  expect(applicationScroll.actual).toBeGreaterThan(0);
  await review.click();
  await expect(page).toHaveURL(new RegExp(`/admin/merchant-applications/${applicationId}$`));
  await page.getByRole("button", { name: "返回申請列表" }).click();
  await expect(page).toHaveURL(/status=PENDING_REVIEW/);

  await gotoLocalPath(page, "/admin/plan-versions");
  await expect(page.getByTestId("admin-plan-version-record").first()).toBeVisible();
  const planTable = page.getByTestId("admin-plan-versions-desktop-table");
  await expect(planTable.getByRole("heading", { name: "完整比較表" })).toBeVisible();
  await expect(planTable.locator("table")).toBeVisible();
  const planScroll = await planTable.evaluate((element) => {
    const max = element.scrollWidth - element.clientWidth;
    element.scrollLeft = max;
    return { max, actual: element.scrollLeft };
  });
  expect(planScroll.max).toBeGreaterThan(0);
  expect(planScroll.actual).toBeGreaterThan(0);
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
  const details = record.locator("details");
  await expect(details.locator("summary")).toHaveText("完整資料");
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
  const payg = await prisma.planVersion.findUniqueOrThrow({ where: { id: planFixtureId } });
  expect(payg.contractHash).toBeTruthy();
  await gotoLocalPath(page, "/admin/plan-versions");
  for (const width of [390, 768, 820, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const record = page.getByTestId("admin-plan-version-record").filter({ hasText: payg.contractHash!.slice(0, 12) });
    await expect(record).toBeVisible();
    const details = record.locator("details");
    await expect(details.locator("summary")).toHaveText("完整資料");
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
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  const form = page.getByRole("heading", { name: "建立並封存 PAYG 契約版本" }).locator("..").locator("form");
  await form.locator('[name="taxTreatment"]').selectOption("EXEMPT");
  await form.locator('[name="taxJurisdiction"]').fill("TW");
  await form.locator('[name="invoiceCloseDelayHours"]').fill("24");
  await form.locator('[name="reason"]').fill("B2 local confirmation visibility test");
  const confirmButton = form.getByRole("button", { name: "建立並封存" });
  const confirmBounds = await confirmButton.boundingBox();
  const contentBounds = await page.locator("main").boundingBox();
  expect(confirmBounds!.x + confirmBounds!.width).toBeLessThanOrEqual(contentBounds!.x + contentBounds!.width + 1);
  const versionCount = await prisma.planVersion.count({ where: { planId: payg.planId } });
  const prompt = page.waitForEvent("dialog").then(async (dialog) => {
    const message = dialog.message();
    await dialog.dismiss();
    return message;
  });
  await confirmButton.click();
  expect(await prompt).toContain("封存後不可編輯");
  expect(await prisma.planVersion.count({ where: { planId: payg.planId } })).toBe(versionCount);
  expect(await page.evaluate(async () => (await fetch("/api/admin/billing/payg-plan-versions", {
    method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: "{}",
  })).status)).toBe(403);
  expect(await prisma.planVersion.count({ where: { planId: payg.planId } })).toBe(versionCount);
  await page.context().addCookies([{ name: "stallorder_locale", value: "ja", domain: new URL(page.url()).hostname, path: "/" }]);
  await gotoLocalPath(page, "/admin/plan-versions");
  await expect(page.getByRole("heading", { name: "プランバージョン" })).toBeVisible();
  await expect(page.getByTestId("admin-plan-version-record").filter({ hasText: payg.contractHash!.slice(0, 12) }).locator("summary")).toHaveText("すべての詳細");
});

test("invoice monitor remains read-only", async ({ page }) => {
  for (const width of [320, 360, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await gotoLocalPath(page, "/admin/e-invoice");
    await expect(page.getByRole("heading", { name: "電子發票整合" })).toBeVisible();
    const connection = page.getByTestId("admin-einvoice-connection").filter({ hasText: "ECPAY" });
    await expect(connection).toContainText("MOCK");
    await expect(connection).toContainText("CONFIGURED");
    await expect(connection).toContainText("1");
    const bounds = await connection.boundingBox();
    const content = await page.locator("main").boundingBox();
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(content!.x + content!.width + 1);
  }
  await expect(page.getByText("Production Issue：OFF", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: /停用正式連線|強制健康檢查|重試|人工結案/ })).toHaveCount(0);
});

test("direct admin URL and sensitive action reject lower roles", async ({ page }) => {
  await gotoLocalPath(page, `/merchant/dashboard?organizationId=${organizationId}`);
  const identity = await page.evaluate(async () => {
    const response = await fetch("/api/auth/me", { credentials: "include", cache: "no-store" });
    return { status: response.status, body: await response.json() as { user?: { email?: string } } };
  });
  expect(identity.status).toBe(200);
  expect(identity.body.user?.email).toBe("owner@stallorder.test");
  const applicationBefore = await prisma.merchantApplication.findUniqueOrThrow({ where: { id: applicationId }, select: { status: true, riskLevel: true, reviewedAt: true } });
  const businessAuditBefore = await prisma.auditLog.count({ where: { entityType: "MERCHANT_APPLICATION", entityId: applicationId, outcome: "SUCCESS" } });
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
  expect(await prisma.auditLog.count({ where: { entityType: "MERCHANT_APPLICATION", entityId: applicationId, outcome: "SUCCESS" } })).toBe(businessAuditBefore);
  expect(await prisma.auditLog.count({ where: { requestId: denied.requestId!, action: "AUTHORIZATION_DENIED", outcome: "DENIED" } })).toBe(1);
  for (const path of ["/admin/merchant-applications", "/admin/plan-versions", "/admin/e-invoice"]) {
    const response = await page.evaluate(async (path) => (await fetch(path, { credentials: "include", cache: "no-store" })).status, path);
    expect(response).toBe(404);
  }
});
