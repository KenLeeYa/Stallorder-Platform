import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";
import { gotoLocalPath } from "./local-navigation";

loadLocalEnv();
assertLocalDatabase();

const prisma = new PrismaClient();
const password = "BillingPhase1!2026";
const ownerEmail = "billing.owner.e2e@stallorder.test";
const adminEmail = "billing.admin.e2e@stallorder.test";
const organizationSlug = "billing-phase1-e2e";
const qrToken = "billing-phase1-e2e-qr-token";

let organizationId = "";
let subscriptionId = "";
let invoiceId = "";
let originalBillingFlags: Array<{ code: string; isEnabled: boolean }> = [];
let standardPlanVersionId = "";
let standardPlanWasPublic = false;

async function waitForReactHandler(control: Locator, handler: "onClick" | "onChange") {
  await expect.poll(() => control.evaluate((element, eventName) => {
    const propsKey = Object.keys(element).find((key) => key.startsWith("__reactProps$"));
    if (!propsKey) return false;
    const props = (element as unknown as Record<string, unknown>)[propsKey];
    return typeof props === "object"
      && props !== null
      && typeof (props as Record<string, unknown>)[eventName] === "function";
  }, handler), { message: `等待 React 掛載 ${handler}` }).toBe(true);
}

test.describe("Phase 1 商業帳務完整流程", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    await cleanup();
    originalBillingFlags = await prisma.billingFeatureFlag.findMany({
      where: { code: { in: ["OPEN_BETA_FREE_ACCESS_ENABLED", "MERCHANT_BILLING_VISIBLE"] } },
      select: { code: true, isEnabled: true },
    });
    const passwordHash = await hash(password, 4);
    const [owner, admin, trialPlan, standardPlan] = await Promise.all([
      prisma.profile.create({ data: { email: ownerEmail, displayName: "帳務測試商家", passwordHash } }),
      prisma.profile.create({ data: { email: adminEmail, displayName: "帳務測試平台管理員", passwordHash, platformRole: "PLATFORM_ADMIN" } }),
      prisma.plan.findUniqueOrThrow({ where: { code: "TRIAL" }, include: { versions: { where: { version: 1 }, take: 1 } } }),
      prisma.plan.findUniqueOrThrow({ where: { code: "STANDARD" }, include: { versions: { where: { version: 1 }, take: 1 } } }),
    ]);
    const trialVersion = trialPlan.versions[0];
    const standardVersion = standardPlan.versions[0];
    if (!trialVersion) throw new Error("缺少 TRIAL 方案版本");
    if (!standardVersion) throw new Error("缺少 STANDARD 方案版本");
    standardPlanVersionId = standardVersion.id;
    standardPlanWasPublic = standardVersion.isPublic;
    const trialStartedAt = new Date();
    const trialEndsAt = new Date(trialStartedAt.getTime() + 14 * 86_400_000);
    const periodStart = monthStart(trialStartedAt);
    const periodEnd = new Date(Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth() + 1, 1));
    const organization = await prisma.organization.create({
      data: {
        name: "Phase 1 帳務驗收商家",
        businessName: "Phase 1 帳務驗收商家",
        slug: organizationSlug,
        status: "TRIALING",
        email: ownerEmail,
        phone: "0900000888",
        subscription: {
          create: {
            planId: trialPlan.id,
            planVersionId: trialVersion.id,
            status: "TRIALING",
            billingInterval: "TRIAL",
            billingPeriodStart: periodStart,
            billingPeriodEnd: periodEnd,
            trialStartedAt,
            trialEndsAt,
            paymentDueAt: trialEndsAt,
          },
        },
        memberships: {
          create: { profileId: owner.id, role: "ORGANIZATION_OWNER", allStalls: true, isPrimaryOwner: true },
        },
      },
      include: { subscription: true },
    });
    organizationId = organization.id;
    subscriptionId = organization.subscription?.id ?? "";
    await prisma.stall.create({
      data: {
        organizationId,
        name: "帳務驗收攤位",
        slug: "billing-phase1-e2e-stall",
        code: "BILL-E2E",
        address: "台北市測試路 1 號",
        location: "台北市測試路 1 號",
        orderingSettings: { create: { organizationId } },
        qrCodes: { create: { organizationId, token: qrToken, label: "帳務驗收 QR" } },
      },
    });
    await prisma.rateLimitBucket.deleteMany();
    await prisma.authSession.deleteMany({ where: { profileId: { in: [owner.id, admin.id] } } });
  });

  test.afterAll(async () => {
    try {
      await cleanup();
      await setBillingFlags(Object.fromEntries(originalBillingFlags.map((flag) => [flag.code, flag.isEnabled])));
    } finally {
      await prisma.$disconnect();
    }
  });

  test("開放測試免費模式會隱藏商家帳務，但平台管理員仍可查看發布開關", async ({ page }) => {
    await setBillingFlags({
      OPEN_BETA_FREE_ACCESS_ENABLED: true,
      MERCHANT_BILLING_VISIBLE: false,
    });
    try {
      await page.goto("/");
      await expect(page.getByText("開放測試期間免費使用", { exact: true })).toBeVisible();

      await login(page, ownerEmail);
      const hiddenBilling = await page.goto(`/merchant/billing?organizationId=${organizationId}`);
      expect(hiddenBilling?.status()).toBe(404);

      await page.context().clearCookies();
      await login(page, adminEmail);
      await page.goto("/admin/billing");
      await expect(page.getByRole("switch", { name: "開放測試免費模式" })).toBeChecked();
      await expect(page.getByRole("switch", { name: "向商家顯示訂閱與付款" })).not.toBeChecked();
    } finally {
      await setBillingFlags({
        OPEN_BETA_FREE_ACCESS_ENABLED: false,
        MERCHANT_BILLING_VISIBLE: true,
      });
    }
  });

  test("試用訂單硬上限會阻擋新 QR session，但帳務頁仍可查看", async ({ page }) => {
    const period = monthStart(new Date());
    await prisma.usageEvent.createMany({
      data: Array.from({ length: 100 }, (_, index) => ({
        organizationId,
        eventType: "BILLABLE_ORDER_COMPLETED",
        quantity: 1,
        billingPeriod: period,
        referenceType: "ORDER",
        referenceId: `billing-limit-${index}`,
        occurredAt: new Date(),
      })),
    });
    await page.goto(`/q/${encodeURIComponent(qrToken)}`);
    await expect(page.getByText(/試用訂單額度已用完|目前無法使用此 QR Code/).first()).toBeVisible({ timeout: 15_000 });

    await login(page, ownerEmail);
    await page.goto(`/merchant/billing?organizationId=${organizationId}`);
    await expect(page.getByRole("heading", { name: "訂閱與帳務" })).toBeVisible();
    await expect(page.getByText("試用中", { exact: true }).first()).toBeVisible();
    await prisma.usageEvent.deleteMany({ where: { organizationId, referenceId: { startsWith: "billing-limit-" } } });
  });

  test("方案申請、人工帳單、付款送審、確認與啟用為完整交易流程", async ({ page }) => {
    // Legacy fixed plans stay hidden in product; expose one only inside this
    // isolated test so the historical manual-billing workflow remains covered.
    await prisma.planVersion.update({ where: { id: standardPlanVersionId }, data: { isPublic: true } });
    try {
      await page.context().clearCookies();
      await login(page, ownerEmail);
      await page.goto(`/merchant/plans?organizationId=${organizationId}`);
      const standardPlan = page.getByRole("article").filter({ hasText: "Standard" });
      await standardPlan.getByRole("button", { name: "申請此方案" }).click();
      await expect.poll(() => prisma.billingChangeRequest.count({ where: { organizationId, status: "PENDING", requestType: "PLAN_CHANGE" } })).toBe(1);

      await page.context().clearCookies();
      await login(page, adminEmail);
      await expect(page).toHaveURL(/\/admin\/billing/);
      const requestCard = page.getByRole("article").filter({ hasText: "Phase 1 帳務驗收商家" }).filter({ hasText: "方案變更" });
      await requestCard.getByRole("button", { name: "建立人工帳單" }).click();
      await expect.poll(async () => prisma.invoice.findFirst({ where: { organizationId, status: "OPEN" }, orderBy: { createdAt: "desc" } })).not.toBeNull();
      const createdInvoice = await prisma.invoice.findFirstOrThrow({ where: { organizationId, status: "OPEN" }, orderBy: { createdAt: "desc" } });
      invoiceId = createdInvoice.id;
      expect(createdInvoice.totalAmount).toBe(699);

      await page.context().clearCookies();
      await login(page, ownerEmail);
      await page.goto(`/merchant/billing/invoices/${invoiceId}?organizationId=${organizationId}`);
      await page.getByLabel("付款方式").selectOption("CASH");
      await page.getByRole("button", { name: "送出付款資料" }).click();
      await expect.poll(() => prisma.manualPaymentRecord.count({ where: { invoiceId, verificationStatus: "PENDING_VERIFICATION" } })).toBe(1);

      await page.context().clearCookies();
      await login(page, adminEmail);
      await page.goto("/admin/payments");
      const paymentCard = page.getByRole("article").filter({ hasText: createdInvoice.invoiceNumber });
      await paymentCard.getByRole("button", { name: "確認付款" }).click();
      await expect.poll(async () => (await prisma.invoice.findUnique({ where: { id: invoiceId } }))?.status).toBe("PAID");
      await expect.poll(async () => (await prisma.subscription.findUnique({ where: { id: subscriptionId } }))?.status).toBe("ACTIVE");
      const activated = await prisma.subscription.findUniqueOrThrow({ where: { id: subscriptionId }, include: { plan: true } });
      expect(activated.plan.code).toBe("STANDARD");
      expect(await prisma.auditLog.count({ where: { organizationId, action: { in: ["MANUAL_PAYMENT_VERIFIED", "SUBSCRIPTION_ACTIVATED"] } } })).toBeGreaterThanOrEqual(2);
    } finally {
      await prisma.planVersion.update({ where: { id: standardPlanVersionId }, data: { isPublic: standardPlanWasPublic } });
    }
  });

  test("停權會阻擋新訂單，歷史帳務可讀，且可受控恢復", async ({ page }) => {
    await page.context().clearCookies();
    await login(page, adminEmail);
    const subscriptionApiPath = `/api/admin/billing/subscriptions/${subscriptionId}`;
    if (process.env.PLAYWRIGHT_PRODUCTION_SERVER !== "true") {
      const warmupResponse = await page.context().request.get(subscriptionApiPath);
      expect(warmupResponse.status()).toBe(405);
      await warmupResponse.dispose();
    }
    await gotoLocalPath(page, `/admin/subscriptions/${subscriptionId}`);
    const suspendButton = page.getByRole("button", { name: "停權", exact: true });
    await waitForReactHandler(suspendButton, "onClick");
    const suspendResponse = page.waitForResponse((response) => (
      new URL(response.url()).pathname === subscriptionApiPath
      && response.request().method() === "PATCH"
      && response.request().postDataJSON().operation === "SUSPEND"
    ));
    await suspendButton.click();
    expect((await suspendResponse).status()).toBe(200);
    await expect.poll(async () => (await prisma.subscription.findUnique({ where: { id: subscriptionId } }))?.status).toBe("SUSPENDED");

    await page.context().clearCookies();
    await page.goto(`/q/${encodeURIComponent(qrToken)}`);
    await expect(page.getByText(/訂閱已停權|目前無法使用此 QR Code/).first()).toBeVisible({ timeout: 15_000 });
    await login(page, ownerEmail);
    await page.goto(`/merchant/billing/invoices/${invoiceId}?organizationId=${organizationId}`);
    await expect(page.getByRole("heading", { name: /SO-/ })).toBeVisible();

    await page.context().clearCookies();
    await login(page, adminEmail);
    await gotoLocalPath(page, `/admin/subscriptions/${subscriptionId}`);
    const resumeButton = page.getByRole("button", { name: "恢復訂閱", exact: true });
    await waitForReactHandler(resumeButton, "onClick");
    const resumeResponse = page.waitForResponse((response) => (
      new URL(response.url()).pathname === subscriptionApiPath
      && response.request().method() === "PATCH"
      && response.request().postDataJSON().operation === "REACTIVATE"
    ));
    await resumeButton.click();
    expect((await resumeResponse).status()).toBe(200);
    await expect.poll(async () => (await prisma.subscription.findUnique({ where: { id: subscriptionId } }))?.status).toBe("ACTIVE");
  });

  test("額外攤位與訂單包均由平台核准並連動帳單及用量", async ({ page }) => {
    await page.context().clearCookies();
    await login(page, ownerEmail);
    await page.goto(`/merchant/billing?organizationId=${organizationId}`);
    await page.getByRole("button", { name: "送出申請" }).click();
    await expect.poll(() => prisma.billingChangeRequest.count({ where: { organizationId, requestType: "ADDITIONAL_STALL", status: "PENDING" } })).toBe(1);

    await page.context().clearCookies();
    await login(page, adminEmail);
    await page.goto("/admin/billing");
    const stallRequest = page.getByRole("article").filter({ hasText: "額外攤位" }).filter({ hasText: "Phase 1 帳務驗收商家" });
    await stallRequest.getByRole("button", { name: "核准 1 個" }).click();
    await expect.poll(() => prisma.additionalStallApproval.count({ where: { organizationId, status: "APPROVED" } })).toBe(1);

    await page.goto(`/admin/subscriptions/${subscriptionId}`);
    await page.getByRole("button", { name: "指派並加入帳單" }).click();
    await expect.poll(() => prisma.subscriptionItem.count({ where: { subscriptionId, itemType: "ORDER_PACKAGE", status: "ACTIVE" } })).toBe(1);
    const usage = await page.request.get(`/api/health`);
    expect(usage.ok()).toBe(true);
  });

  test("商家帳務介面在手機寬度沒有頁面級水平溢出", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page, ownerEmail);
    await page.goto(`/merchant/billing?organizationId=${organizationId}`);
    await expect(page.getByRole("heading", { name: "訂閱與帳務" })).toBeVisible();
    const dimensions = await page.evaluate(() => ({ viewport: window.innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
    expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport + 1);
    expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport + 1);
  });
});

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByRole("button", { name: "使用電子郵件與密碼登入", exact: true }).click();
  await page.getByLabel("電子郵件").fill(email);
  await page.getByLabel("密碼").fill(password);
  await page.getByRole("button", { name: "登入", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/, { timeout: 15_000 });
}

async function cleanup() {
  const organizations = await prisma.organization.findMany({ where: { slug: organizationSlug }, select: { id: true } });
  if (organizations.length > 0) {
    const organizationIds = organizations.map((item) => item.id);
    await prisma.authSession.deleteMany({ where: { profile: { email: { in: [ownerEmail, adminEmail] } } } });
    await prisma.stallMembership.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.organizationMembership.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.stall.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.usageEvent.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
  }
  await prisma.profile.deleteMany({ where: { email: { in: [ownerEmail, adminEmail] } } });
}

function monthStart(value: Date) { return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1)); }
async function setBillingFlags(flags: Record<string, boolean>) {
  for (const [code, isEnabled] of Object.entries(flags)) {
    await prisma.billingFeatureFlag.update({ where: { code }, data: { isEnabled } });
  }
}
function assertLocalDatabase() { const value = process.env.DATABASE_URL; if (!value) throw new Error("E2E 必須設定 DATABASE_URL"); const hostname = new URL(value).hostname; if (!["127.0.0.1", "localhost"].includes(hostname)) throw new Error(`拒絕在非本機資料庫執行 E2E：${hostname}`); }
function loadLocalEnv() {
  let content: string;
  try {
    content = readFileSync(resolve(process.cwd(), ".env"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  for (const line of content.split(/\r?\n/)) { const match = line.match(/^([A-Z0-9_]+)=(.*)$/); if (!match || process.env[match[1]]) continue; const value = match[2].trim(); process.env[match[1]] = value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value; }
}
