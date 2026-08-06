import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

loadLocalEnv();
assertLocalDatabase();

const prisma = new PrismaClient();
const ownerEmail = "owner@stallorder.test";
const staffEmail = "staff@stallorder.test";
const kitchenEmail = "kitchen@stallorder.test";
const financeEmail = "finance.e2e@stallorder.test";
const password = "StallOrderDemo!2026";
const googleAuthUserId = "11111111-1111-4111-8111-111111111111";
const secondStallSlug = "e2e-night-market-two";
const otherOrganizationSlug = "e2e-isolated-organization";
const sharedProductName = "香酥雞排";

let organization: { id: string; businessName: string };
let firstStall: { id: string; name: string; slug: string };
let secondStall: { id: string; name: string; slug: string };
let otherStall: { id: string; slug: string };
let businessDate: Date;

test.describe("多攤位商戶關鍵流程", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    organization = await prisma.organization.findUniqueOrThrow({
      where: { email: ownerEmail },
      select: { id: true, businessName: true },
    });
    firstStall = await prisma.stall.findUniqueOrThrow({
      where: { slug: "aming-chicken" },
      select: { id: true, name: true, slug: true },
    });

    await prisma.authSession.deleteMany({
      where: { profile: { email: { in: [ownerEmail, staffEmail, kitchenEmail, financeEmail] } } },
    });
    await prisma.rateLimitBucket.deleteMany();
    await prisma.publicOrderAttempt.deleteMany({ where: { organizationId: organization.id } });
    await prisma.orderSession.deleteMany({ where: { organizationId: organization.id } });
    await prisma.publicRateLimitBucket.deleteMany({ where: { organizationId: organization.id } });
    await prisma.stall.deleteMany({ where: { slug: secondStallSlug } });
    await prisma.organization.deleteMany({
      where: {
        OR: [
          { slug: otherOrganizationSlug },
          { email: "isolated.e2e@stallorder.test" },
        ],
      },
    });
    await prisma.profile.deleteMany({ where: { email: financeEmail } });

    const owner = await prisma.profile.findUniqueOrThrow({ where: { email: ownerEmail } });
    if (!owner.passwordHash) throw new Error("示範 owner 缺少密碼雜湊");

    await prisma.profile.update({ where: { id: owner.id }, data: { authUserId: null } });
    await prisma.$executeRaw`delete from auth.users where email = ${ownerEmail}`;
    await prisma.$executeRaw`
      insert into auth.users (
        instance_id, id, aud, role, email, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at
      ) values (
        '00000000-0000-0000-0000-000000000000'::uuid,
        ${googleAuthUserId}::uuid,
        'authenticated',
        'authenticated',
        ${ownerEmail},
        now(),
        '{"provider":"google","providers":["google"]}'::jsonb,
        '{"full_name":"示範商戶"}'::jsonb,
        now(),
        now()
      )
    `;
    await prisma.profile.update({
      where: { id: owner.id },
      data: { authUserId: googleAuthUserId },
    });

    const finance = await prisma.profile.create({
      data: {
        email: financeEmail,
        displayName: "E2E 財務檢視者",
        passwordHash: owner.passwordHash,
      },
    });
    await prisma.organizationMembership.create({
      data: {
        organizationId: organization.id,
        profileId: finance.id,
        role: "FINANCE_VIEWER",
        allStalls: true,
      },
    });

    const isolatedOrganization = await prisma.organization.create({
      data: {
        name: "E2E 隔離組織",
        businessName: "E2E 隔離組織",
        slug: otherOrganizationSlug,
        status: "ACTIVE",
        email: "isolated.e2e@stallorder.test",
        phone: "0900-000-099",
      },
    });
    const isolatedPlanVersion = await prisma.planVersion.findFirstOrThrow({
      where: { plan: { code: "TRIAL" }, effectiveUntil: null },
      select: { id: true, planId: true },
    });
    const isolatedBillingPeriodStart = new Date();
    isolatedBillingPeriodStart.setUTCHours(0, 0, 0, 0);
    const isolatedBillingPeriodEnd = new Date(isolatedBillingPeriodStart);
    isolatedBillingPeriodEnd.setUTCDate(isolatedBillingPeriodEnd.getUTCDate() + 30);
    await prisma.subscription.create({
      data: {
        organizationId: isolatedOrganization.id,
        planId: isolatedPlanVersion.planId,
        planVersionId: isolatedPlanVersion.id,
        status: "ACTIVE",
        billingInterval: "MONTHLY",
        billingPeriodStart: isolatedBillingPeriodStart,
        billingPeriodEnd: isolatedBillingPeriodEnd,
      },
    });
    otherStall = await prisma.stall.create({
      data: {
        organizationId: isolatedOrganization.id,
        name: "隔離測試攤位",
        slug: "e2e-isolated-stall",
        code: "E2E-ISO",
        address: "隔離測試地址",
        location: "隔離測試地址",
      },
      select: { id: true, slug: true },
    });
  });

  test.afterAll(async () => {
    try {
      const currentOrganization = await prisma.organization.findUnique({
        where: { email: ownerEmail },
        select: { id: true },
      });
      if (currentOrganization) {
        await prisma.publicOrderAttempt.deleteMany({ where: { organizationId: currentOrganization.id } });
        await prisma.orderSession.deleteMany({ where: { organizationId: currentOrganization.id } });
        await prisma.publicRateLimitBucket.deleteMany({ where: { organizationId: currentOrganization.id } });
        if (businessDate) {
          await prisma.dailyStallSummary.deleteMany({
            where: { organizationId: currentOrganization.id, businessDate },
          });
        }
        await prisma.stall.deleteMany({ where: { organizationId: currentOrganization.id, slug: secondStallSlug } });
      }
      await prisma.organization.deleteMany({ where: { slug: otherOrganizationSlug } });
      await prisma.profile.deleteMany({ where: { email: financeEmail } });
      await prisma.authSession.deleteMany({
        where: { profile: { email: { in: [ownerEmail, staffEmail, kitchenEmail] } } },
      });
      await prisma.profile.updateMany({
        where: { email: ownerEmail },
        data: { authUserId: null, avatarUrl: null },
      });
      await prisma.$executeRaw`delete from auth.users where id = ${googleAuthUserId}::uuid`;
      await prisma.rateLimitBucket.deleteMany();
    } finally {
      await prisma.$disconnect();
    }
  });

  test("Google 登入 owner 並建立第二攤位", async ({ page }) => {
    await page.goto("/auth/google?next=%2Fmerchant%2Fdashboard");
    await expect(page).toHaveURL(/\/merchant\/dashboard/, { timeout: 20_000 });
    await expect(page.getByRole("heading", { name: organization.businessName, exact: true })).toBeVisible();
    await expect.poll(() => prisma.auditLog.count({
      where: { organizationId: organization.id, action: "GOOGLE_LOGIN_SUCCESS" },
    })).toBeGreaterThan(0);

    await page.goto(`/merchant/stalls/new?organizationId=${organization.id}`);
    await page.getByLabel("攤位名稱").fill("E2E 夜市二號攤");
    await page.getByLabel("攤位代碼").fill("E2E-02");
    await page.getByLabel("公開識別名稱").fill(secondStallSlug);
    await page.getByLabel("說明").fill("多攤位自動驗收測試");
    await page.getByLabel("地址").fill("台北市測試夜市二區");
    await page.getByLabel("電話").fill("0900-000-002");
    await page.getByRole("button", { name: "建立攤位" }).click();
    await expect(page).toHaveURL(/\/merchant\/stalls\/[0-9a-f-]+\?organizationId=/);

    secondStall = await prisma.stall.findUniqueOrThrow({
      where: { slug: secondStallSlug },
      select: { id: true, name: true, slug: true },
    });
    expect(secondStall.name).toBe("E2E 夜市二號攤");

    businessDate = new Date(`${taipeiToday()}T00:00:00.000Z`);
    await prisma.$transaction([
      prisma.dailyStallSummary.upsert({
        where: { stallId_businessDate: { stallId: firstStall.id, businessDate } },
        update: {
          orderCount: 10,
          completedOrderCount: 9,
          cancelledOrderCount: 1,
          pendingOrderCount: 0,
          unpaidOrderCount: 0,
          netSales: 1_000,
          grossSales: 1_000,
          cashAmount: 1_000,
          averageOrderValue: 111,
          lastOrderAt: new Date(),
        },
        create: {
          organizationId: organization.id,
          stallId: firstStall.id,
          businessDate,
          orderCount: 10,
          completedOrderCount: 9,
          cancelledOrderCount: 1,
          pendingOrderCount: 0,
          unpaidOrderCount: 0,
          netSales: 1_000,
          grossSales: 1_000,
          cashAmount: 1_000,
          averageOrderValue: 111,
          lastOrderAt: new Date(),
        },
      }),
      prisma.dailyStallSummary.upsert({
        where: { stallId_businessDate: { stallId: secondStall.id, businessDate } },
        update: {
          orderCount: 5,
          completedOrderCount: 4,
          pendingOrderCount: 1,
          unpaidOrderCount: 1,
          netSales: 500,
          grossSales: 500,
          cashAmount: 400,
          otherPaymentAmount: 100,
          averageOrderValue: 125,
          lastOrderAt: new Date(),
        },
        create: {
          organizationId: organization.id,
          stallId: secondStall.id,
          businessDate,
          orderCount: 5,
          completedOrderCount: 4,
          pendingOrderCount: 1,
          unpaidOrderCount: 1,
          netSales: 500,
          grossSales: 500,
          cashAmount: 400,
          otherPaymentAmount: 100,
          averageOrderValue: 125,
          lastOrderAt: new Date(),
        },
      }),
    ]);
  });

  test("共用商品分派、攤位覆寫價格與顧客菜單一致", async ({ page }) => {
    await loginWithPassword(page, ownerEmail);
    await expect(page).toHaveURL(
      new RegExp(`/merchant/dashboard\\?organizationId=${organization.id}$`),
    );
    await page.goto(`/merchant/catalog?organizationId=${organization.id}`);
    await page.getByRole("button", { name: `分派 ${sharedProductName}` }).click();
    const assignmentDialog = page.getByRole("dialog", { name: `分派「${sharedProductName}」` });
    await assignmentDialog.getByLabel("全部授權攤位").check();
    await assignmentDialog.getByRole("button", { name: "儲存分派" }).click();
    await expect(page.getByRole("status")).toContainText("攤位分派已更新");
    await expect.poll(() => prisma.stallProduct.count({
      where: {
        organizationId: organization.id,
        product: { name: sharedProductName },
        stallId: { in: [firstStall.id, secondStall.id] },
      },
    })).toBe(2);

    await page.goto(`/merchant/${secondStall.slug}`);
    const productRow = page
      .getByRole("heading", { name: sharedProductName, exact: true })
      .locator("../../..");
    await productRow.getByLabel("覆寫價格").fill("109");
    await productRow.getByRole("button", { name: `儲存 ${sharedProductName}` }).click();
    await expect(page.getByRole("status")).toContainText(`「${sharedProductName}」設定已儲存`);
    await expect.poll(async () => {
      const assignment = await prisma.stallProduct.findFirst({
        where: { stallId: secondStall.id, product: { name: sharedProductName } },
        select: { priceOverride: true },
      });
      return assignment?.priceOverride;
    }).toBe(109);

    const firstQr = await prisma.qrCode.findFirstOrThrow({
      where: { stallId: firstStall.id, state: "ACTIVE" },
      orderBy: { tokenVersion: "desc" },
    });
    const secondQr = await prisma.qrCode.findFirstOrThrow({
      where: { stallId: secondStall.id, state: "ACTIVE" },
      orderBy: { tokenVersion: "desc" },
    });

    await openCustomerMenu(page, firstQr.token, firstStall.name);
    await expect(page.getByRole("article").filter({ hasText: sharedProductName })).toContainText(/95/);
    await page.context().clearCookies();
    await openCustomerMenu(page, secondQr.token, secondStall.name);
    await expect(page.getByRole("article").filter({ hasText: sharedProductName })).toContainText(/109/);
  });

  test("儀表板範圍、staff、finance、kitchen 與跨組織 URL 權限", async ({ page }) => {
    await loginWithPassword(page, ownerEmail);
    await page.goto(`/merchant/dashboard?organizationId=${organization.id}`);
    await expect(page.getByLabel("選擇商家")).toHaveCount(0);
    const stallSelector = page.getByLabel("選擇攤位");
    await expect(stallSelector).toBeVisible();
    await expect(stallSelector.locator('option[value="ALL_STALLS"]')).toHaveText("全部攤位");
    await expect(stallSelector.locator(`option[value="${firstStall.id}"]`)).toHaveText(firstStall.name);
    await expect(stallSelector.locator(`option[value="${secondStall.id}"]`)).toHaveText(secondStall.name);
    await stallSelector.selectOption(firstStall.id);
    await expect(page).toHaveURL(new RegExp(`/merchant/${firstStall.slug}$`));
    await page.getByLabel("選擇攤位").selectOption("ALL_STALLS");
    await expect(page).toHaveURL(
      new RegExp(`/merchant/stalls\\?organizationId=${organization.id}$`),
    );
    await page.goto(`/merchant/dashboard?organizationId=${organization.id}`);
    await expect(page.getByLabel("營運摘要")).toContainText("1,500");
    await expect(page.getByRole("heading", { name: "攤位比較" })).toBeVisible();
    await expect(page.getByRole("link", { name: firstStall.name, exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: secondStall.name, exact: true })).toBeVisible();

    const workMode = page.getByLabel("切換工作模式");
    await expect(workMode).toHaveValue(`merchant:${organization.id}`);
    await expect(workMode.locator(`option[value="staff:${firstStall.id}"]`)).toHaveText(`店員 · ${firstStall.name}`);
    await expect(workMode.locator(`option[value="kitchen:${firstStall.id}"]`)).toHaveText(`廚房 · ${firstStall.name}`);

    await workMode.selectOption(`staff:${firstStall.id}`);
    await expect(page).toHaveURL(new RegExp(`/staff/${firstStall.slug}$`));
    await expect(page.getByRole("heading", { name: firstStall.name, exact: true })).toBeVisible();
    await expect(page.getByLabel("切換工作模式")).toHaveValue(`staff:${firstStall.id}`);

    await page.getByLabel("切換工作模式").selectOption(`kitchen:${firstStall.id}`);
    await expect(page).toHaveURL(new RegExp(`/kitchen\\?stall=${firstStall.slug}$`));
    await expect(page.getByRole("heading", { name: "廚房生產系統" })).toBeVisible();
    await expect(page.getByLabel("切換工作模式")).toHaveValue(`kitchen:${firstStall.id}`);

    await page.getByLabel("切換工作模式").selectOption(`merchant:${organization.id}`);
    await expect(page).toHaveURL(new RegExp(`/merchant/dashboard\\?organizationId=${organization.id}$`));
    await expect(page.getByRole("heading", { name: organization.businessName, exact: true })).toBeVisible();

    await page.goto(`/merchant/dashboard?organizationId=${organization.id}&stallId=${secondStall.id}`);
    await expect(page.locator("details").filter({ hasText: "攤位範圍" }).locator("summary")).toContainText("已選 1 個");
    const comparisonTable = page.getByRole("table");
    await expect(comparisonTable.getByRole("link", { name: secondStall.name, exact: true })).toBeVisible();
    await expect(comparisonTable.getByRole("link", { name: firstStall.name, exact: true })).toHaveCount(0);

    const crossOrganizationResponse = await page.goto(`/merchant/stalls/${otherStall.id}`);
    expect(crossOrganizationResponse?.status()).toBe(404);
    const today = taipeiToday();
    const crossOrganizationApiStatus = await page.evaluate(async (url) => {
      const response = await fetch(url, { credentials: "same-origin" });
      return response.status;
    }, `/api/merchant/dashboard/overview?organizationId=${await otherOrganizationId()}&dateFrom=${today}&dateTo=${today}`);
    expect(crossOrganizationApiStatus).toBe(404);

    await page.context().clearCookies();
    await loginWithPassword(page, staffEmail);
    await expect(page).toHaveURL(new RegExp(`/staff/${firstStall.slug}$`));
    await expect(page.getByRole("heading", { name: firstStall.name, exact: true })).toBeVisible();
    await expect(page.getByLabel("切換工作模式")).toHaveCount(0);
    const unassignedStaffResponse = await page.goto(`/staff/${secondStall.slug}`);
    expect(unassignedStaffResponse?.status()).toBe(404);

    await page.context().clearCookies();
    await loginWithPassword(page, financeEmail);
    await expect(page).toHaveURL(
      new RegExp(`/merchant/dashboard\\?organizationId=${organization.id}$`),
    );
    const financeMutation = await page.evaluate(async ({ stallSlug, orderId }) => {
      const csrf = document.cookie
        .split(";")
        .map((part) => part.trim())
        .find((part) => part.startsWith("stallorder_csrf="))
        ?.split("=").slice(1).join("=");
      const response = await fetch(`/api/stalls/${stallSlug}/orders/${orderId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": decodeURIComponent(csrf ?? ""),
        },
        body: JSON.stringify({ status: "CONFIRMED" }),
      });
      return { status: response.status, payload: await response.json() };
    }, { stallSlug: firstStall.slug, orderId: randomUUID() });
    expect(financeMutation.status).toBe(403);
    expect(String(financeMutation.payload.error)).toContain("權限");

    await page.context().clearCookies();
    await loginWithPassword(page, kitchenEmail);
    await expect(page).toHaveURL(new RegExp(`/kitchen\\?stall=${firstStall.slug}$`));
    await expect(page.getByRole("heading", { name: "廚房生產系統" })).toBeVisible();
    await expect(page.getByLabel("切換工作模式")).toHaveCount(0);
    const kitchenFinanceResponse = await page.goto(
      `/merchant/reports/payments?organizationId=${organization.id}`,
    );
    expect(kitchenFinanceResponse?.status()).toBe(404);
  });

  test("多攤位介面在手機寬度無水平溢出", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginWithPassword(page, ownerEmail);
    await page.goto(`/merchant/dashboard?organizationId=${organization.id}`);
    await expect(page.getByRole("heading", { name: "攤位比較" })).toBeVisible();
    await expect(page.getByRole("article").filter({ hasText: secondStall.name })).toBeVisible();
    const dimensions = await page.evaluate(() => ({
      viewport: window.innerWidth,
      document: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
    }));
    expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport + 1);
    expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport + 1);
  });
});

async function loginWithPassword(page: Page, email: string) {
  await page.goto("/login");
  await page.getByRole("button", { name: "使用電子郵件與密碼登入", exact: true }).click();
  await page.getByLabel("電子郵件").fill(email);
  await page.getByLabel("密碼").fill(password);
  await page.getByRole("button", { name: "登入", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/, { timeout: 15_000 });
}

async function openCustomerMenu(page: Page, qrToken: string, stallName: string) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto(`/q/${encodeURIComponent(qrToken)}`);
    try {
      await expect(page.getByRole("heading", { name: stallName, exact: true })).toBeVisible({ timeout: 7_000 });
      return;
    } catch (error) {
      lastError = error;
      await page.waitForTimeout(1_500);
    }
  }
  throw lastError;
}

async function otherOrganizationId() {
  const isolated = await prisma.organization.findUniqueOrThrow({
    where: { slug: otherOrganizationSlug },
    select: { id: true },
  });
  return isolated.id;
}

function taipeiToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function assertLocalDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("E2E 必須設定 DATABASE_URL");
  const hostname = new URL(databaseUrl).hostname;
  if (hostname !== "127.0.0.1" && hostname !== "localhost") {
    throw new Error(`拒絕在非本機資料庫執行 E2E：${hostname}`);
  }
}

function loadLocalEnv() {
  let content: string;
  try {
    content = readFileSync(resolve(process.cwd(), ".env"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    const value = match[2].trim();
    process.env[match[1]] = value.startsWith('"') && value.endsWith('"')
      ? value.slice(1, -1)
      : value;
  }
}
