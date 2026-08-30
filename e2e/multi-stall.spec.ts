import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { PrismaClient, type Prisma } from "@prisma/client";
import { gotoLocalPath } from "./local-navigation";

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
const authorizedOrganizationSlug = "e2e-authorized-organization-two";
const authorizedOrganizationEmail = "authorized-two.e2e@stallorder.test";
const authorizedStallSlug = "e2e-authorized-stall-two";
const otherOrganizationSlug = "e2e-isolated-organization";
const sharedProductName = "香酥雞排";

let organization: { id: string; businessName: string; operatingMode: string };
let firstStall: { id: string; name: string; slug: string };
let secondStall: { id: string; name: string; slug: string };
let authorizedOrganization: { id: string; businessName: string };
let authorizedStall: { id: string; name: string; slug: string };
let otherStall: { id: string; name: string; slug: string };
let businessDate: Date;

test.describe("多攤位商戶關鍵流程", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    organization = await prisma.organization.findUniqueOrThrow({
      where: { email: ownerEmail },
      select: { id: true, businessName: true, operatingMode: true },
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
    await prisma.organization.update({
      where: { id: organization.id },
      data: { operatingMode: "MULTI_STALL" },
    });
    await deleteTestOrganizations({
      where: {
        OR: [
          { slug: authorizedOrganizationSlug },
          { email: authorizedOrganizationEmail },
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
      select: { id: true, name: true, slug: true },
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
        await prisma.organization.update({
          where: { id: currentOrganization.id },
          data: { operatingMode: organization.operatingMode },
        });
      }
      await deleteTestOrganizations({
        where: {
          OR: [
            { slug: authorizedOrganizationSlug },
            { email: authorizedOrganizationEmail },
            { slug: otherOrganizationSlug },
            { email: "isolated.e2e@stallorder.test" },
          ],
        },
      });
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

    const createStallApiPath = `/api/merchant/organizations/${organization.id}/stalls`;
    if (process.env.PLAYWRIGHT_PRODUCTION_SERVER !== "true") {
      const warmupResponse = await page.context().request.get(createStallApiPath);
      expect(warmupResponse.status()).toBe(405);
      await warmupResponse.dispose();
      await gotoLocalPath(
        page,
        `/merchant/stalls/${firstStall.id}?organizationId=${organization.id}`,
      );
    }
    await gotoLocalPath(page, `/merchant/stalls/new?organizationId=${organization.id}`);
    const createStallButton = page.getByRole("button", { name: "建立攤位" });
    await waitForReactHandler(createStallButton, "onSubmit", "form");
    await page.getByLabel("攤位名稱").fill("E2E 夜市二號攤");
    await page.getByLabel("攤位代碼").fill("E2E-02");
    await page.getByLabel("公開識別名稱").fill(secondStallSlug);
    await page.getByLabel("說明").fill("多攤位自動驗收測試");
    await page.getByLabel("地址").fill("台北市測試夜市二區");
    await page.getByLabel("電話").fill("0900-000-002");
    const createStallResponse = page.waitForResponse((response) => (
      new URL(response.url()).pathname === createStallApiPath
      && response.request().method() === "POST"
      && response.request().postDataJSON()?.slug === secondStallSlug
    ));
    await createStallButton.click();
    expect((await createStallResponse).status()).toBe(201);
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
    await expectDashboardOrganization(page, organization.id);
    const sharedProduct = await prisma.product.findFirstOrThrow({
      where: { organizationId: organization.id, name: sharedProductName },
      select: { id: true },
    });
    const catalogApiPath = `/api/merchant/organizations/${organization.id}/catalog`;
    if (process.env.PLAYWRIGHT_PRODUCTION_SERVER !== "true") {
      for (const path of [
        catalogApiPath,
        `/api/merchant/stalls/${secondStall.id}/products/${sharedProduct.id}`,
      ]) {
        const warmupResponse = await page.context().request.get(path);
        expect(warmupResponse.status()).toBe(405);
        await warmupResponse.dispose();
      }
    }
    await gotoLocalPath(page, `/merchant/catalog?organizationId=${organization.id}`);
    const productActionsButton = page.getByRole("button", { name: `操作：${sharedProductName}` });
    await waitForReactHandler(productActionsButton, "onClick");
    await productActionsButton.click();
    const openAssignmentsButton = page
      .getByRole("dialog", { name: `商品：${sharedProductName}` })
      .getByRole("button", { name: "分派攤位" });
    await waitForReactHandler(openAssignmentsButton, "onClick");
    await openAssignmentsButton.click();
    const assignmentDialog = page.getByRole("dialog", { name: `分派「${sharedProductName}」` });
    const allStallsCheckbox = assignmentDialog.getByLabel("全部授權攤位");
    await waitForReactHandler(allStallsCheckbox, "onChange");
    await allStallsCheckbox.check();
    const saveAssignmentsButton = assignmentDialog.getByRole("button", { name: "儲存分派" });
    await waitForReactHandler(saveAssignmentsButton, "onClick");
    const assignmentResponse = page.waitForResponse((response) => (
      new URL(response.url()).pathname === catalogApiPath
      && response.request().method() === "POST"
      && response.request().postDataJSON()?.operation === "SET_ASSIGNMENTS"
      && response.request().postDataJSON()?.productId === sharedProduct.id
    ));
    await saveAssignmentsButton.click();
    expect((await assignmentResponse).status()).toBe(200);
    await expect(page.getByText("攤位分派已更新。", { exact: true })).toBeVisible();
    await expect.poll(() => prisma.stallProduct.count({
      where: {
        organizationId: organization.id,
        product: { name: sharedProductName },
        stallId: { in: [firstStall.id, secondStall.id] },
      },
    })).toBe(2);

    const secondStallPath = `/merchant/${secondStall.slug}`;
    if (process.env.PLAYWRIGHT_PRODUCTION_SERVER !== "true") {
      const warmupResponse = await page.context().request.get(secondStallPath);
      expect(warmupResponse.status()).toBe(200);
      await warmupResponse.dispose();
    }
    await gotoLocalPath(page, secondStallPath);
    await expect(page).toHaveURL(new RegExp(`/merchant/${secondStall.slug}$`));
    const productRow = page
      .getByRole("heading", { name: sharedProductName, exact: true })
      .locator("../../..");
    await productRow.getByLabel("覆寫價格").fill("109");
    const saveProduct = productRow.getByRole("button", { name: `儲存 ${sharedProductName}` });
    await waitForReactHandler(saveProduct, "onClick");
    const saveProductResponse = page.waitForResponse((response) => (
      new URL(response.url()).pathname.startsWith(`/api/merchant/stalls/${secondStall.id}/products/`)
      && response.request().method() === "PATCH"
      && response.request().postDataJSON()?.priceOverride === 109
    ));
    await saveProduct.click();
    expect((await saveProductResponse).status()).toBe(200);
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
    test.setTimeout(180_000);
    await loginWithPassword(page, ownerEmail);
    if (process.env.PLAYWRIGHT_PRODUCTION_SERVER !== "true") {
      for (const path of [
        `/staff/${firstStall.slug}`,
        `/kitchen?stall=${firstStall.slug}`,
      ]) {
        const warmupResponse = await page.context().request.get(path);
        expect(warmupResponse.status()).toBe(200);
        await warmupResponse.dispose();
      }
    }
    await gotoLocalPath(page, `/merchant/dashboard?organizationId=${organization.id}`);
    await expect(page.getByLabel("選擇商家")).toHaveCount(0);
    await openCompactSwitcher(page, "選擇攤位：全部攤位", "選擇攤位");
    const stallDialog = page.getByRole("dialog", { name: "選擇攤位" });
    await expect(stallDialog.getByRole("button", { name: "全部攤位", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(stallDialog.getByRole("button", { name: firstStall.name, exact: true })).toBeVisible();
    await expect(stallDialog.getByRole("button", { name: secondStall.name, exact: true })).toBeVisible();
    await stallDialog.getByRole("button", { name: firstStall.name, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/merchant/${firstStall.slug}$`));
    await selectCompactOption(page, `選擇攤位：${firstStall.name}`, "選擇攤位", "全部攤位");
    await expect(page).toHaveURL(
      new RegExp(`/merchant/stalls\\?organizationId=${organization.id}$`),
    );
    await gotoLocalPath(page, `/merchant/dashboard?organizationId=${organization.id}`);
    await expect(page.locator("#main-content").getByLabel("營運摘要")).toContainText("1,500");
    await expect(page.getByRole("heading", { name: "攤位比較" })).toBeVisible();
    await expect(page.getByRole("link", { name: firstStall.name, exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: secondStall.name, exact: true })).toBeVisible();

    await openCompactSwitcher(page, "商家管理", "切換工作模式");
    const workModeDialog = page.getByRole("dialog", { name: "切換工作模式" });
    await expect(workModeDialog.getByRole("button", { name: "商家管理", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(workModeDialog.getByRole("button", { name: `店員 · ${firstStall.name}`, exact: true })).toBeVisible();
    await expect(workModeDialog.getByRole("button", { name: `廚房 · ${firstStall.name}`, exact: true })).toBeVisible();
    await workModeDialog.getByRole("button", { name: `店員 · ${firstStall.name}`, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/staff/${firstStall.slug}$`));
    await expect(page.getByRole("heading", { name: firstStall.name, exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: `店員 · ${firstStall.name}`, exact: true })).toBeVisible();

    await selectCompactOption(
      page,
      `店員 · ${firstStall.name}`,
      "切換工作模式",
      `廚房 · ${firstStall.name}`,
    );
    await expect(page).toHaveURL(new RegExp(`/kitchen\\?stall=${firstStall.slug}$`));
    await expect(page.getByRole("heading", { name: "廚房生產系統" })).toBeVisible();
    await expect(page.getByRole("button", { name: `廚房 · ${firstStall.name}`, exact: true })).toBeVisible();

    await selectCompactOption(
      page,
      `廚房 · ${firstStall.name}`,
      "切換工作模式",
      "商家管理",
    );
    await expectDashboardOrganization(page, organization.id);
    await expect(page.getByRole("heading", { name: organization.businessName, exact: true })).toBeVisible();

    await gotoLocalPath(page, `/merchant/dashboard?organizationId=${organization.id}&stallId=${secondStall.id}`);
    const merchantMain = page.locator("#main-content");
    await expect(merchantMain.locator("details").filter({ hasText: "攤位範圍" }).locator("summary"))
      .toContainText("已選 1 個");
    const comparisonTable = merchantMain.getByRole("table");
    await expect(comparisonTable.getByRole("link", { name: secondStall.name, exact: true })).toBeVisible();
    await expect(comparisonTable.getByRole("link", { name: firstStall.name, exact: true })).toHaveCount(0);

    const crossOrganizationResponse = await page.goto(`/merchant/stalls/${otherStall.id}`);
    expect(crossOrganizationResponse?.status()).toBe(404);
    const today = taipeiToday();
    const crossOrganizationOverviewPath = `/api/merchant/dashboard/overview?organizationId=${await otherOrganizationId()}&dateFrom=${today}&dateTo=${today}`;
    if (process.env.PLAYWRIGHT_PRODUCTION_SERVER !== "true") {
      const warmupResponse = await page.context().request.get(crossOrganizationOverviewPath);
      expect(warmupResponse.status()).toBe(404);
      await warmupResponse.dispose();
    }
    const crossOrganizationApiStatus = await page.evaluate(async (url) => {
      const response = await fetch(url, { credentials: "same-origin" });
      return response.status;
    }, crossOrganizationOverviewPath);
    expect(crossOrganizationApiStatus).toBe(404);

    await page.context().clearCookies();
    await loginWithPassword(page, staffEmail);
    await expect(page).toHaveURL(new RegExp(`/staff/${firstStall.slug}$`));
    await expect(page.getByRole("heading", { name: firstStall.name, exact: true })).toBeVisible();
    await expect(page.getByTestId("work-mode-icon-staff")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^選擇攤位/u })).toHaveCount(0);
    const unassignedStaffResponse = await page.goto(`/staff/${secondStall.slug}`);
    // A streamed App Router shell may commit 200 before notFound() resolves.
    expect([200, 404]).toContain(unassignedStaffResponse?.status());
    await expect(page.getByRole("heading", { name: "找不到此頁面", exact: true })).toBeVisible();
    await expect(page.getByText(secondStall.name, { exact: true })).toHaveCount(0);

    await page.context().clearCookies();
    await loginWithPassword(page, financeEmail);
    await expectDashboardOrganization(page, organization.id);
    const financeMutationOrderId = randomUUID();
    const financeOrderApiPath = `/api/stalls/${firstStall.slug}/orders/${financeMutationOrderId}`;
    if (process.env.PLAYWRIGHT_PRODUCTION_SERVER !== "true") {
      const warmupResponse = await page.context().request.get(financeOrderApiPath);
      expect(warmupResponse.status()).toBe(405);
      await warmupResponse.dispose();
    }
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
    }, { stallSlug: firstStall.slug, orderId: financeMutationOrderId });
    expect(financeMutation.status).toBe(403);
    expect(String(financeMutation.payload.error)).toContain("權限");

    await page.context().clearCookies();
    await loginWithPassword(page, kitchenEmail);
    await expect(page).toHaveURL(new RegExp(`/kitchen\\?stall=${firstStall.slug}$`));
    await expect(page.getByRole("heading", { name: "廚房生產系統" })).toBeVisible();
    await expect(page.getByTestId("work-mode-icon-kitchen")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^選擇攤位/u })).toHaveCount(0);
    const kitchenFinanceResponse = await page.goto(
      `/merchant/reports/payments?organizationId=${organization.id}`,
    );
    // A streamed App Router shell may commit 200 before notFound() resolves.
    expect([200, 404]).toContain(kitchenFinanceResponse?.status());
    await expect(page.getByRole("heading", { name: "找不到此頁面", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "付款分析", exact: true })).toHaveCount(0);
  });

  test("多攤位介面在手機寬度無水平溢出", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginWithPassword(page, ownerEmail);
    await gotoLocalPath(page, `/merchant/dashboard?organizationId=${organization.id}`);
    await expect(page.getByRole("navigation", { name: "商戶功能" })).toBeVisible();
    await expect(page.getByLabel("應用程式狀態")).toBeVisible();
    const brand = page.getByRole("link", { name: "攤點通", exact: true });
    const appStatus = page.getByLabel("應用程式狀態");
    const [brandBox, appStatusBox] = await Promise.all([brand.boundingBox(), appStatus.boundingBox()]);
    expect(brandBox).not.toBeNull();
    expect(appStatusBox).not.toBeNull();
    expect(appStatusBox!.x).toBeGreaterThan(brandBox!.x);
    expect(Math.abs(appStatusBox!.y - brandBox!.y)).toBeLessThanOrEqual(4);
    await expect(page.getByRole("button", { name: /^(?:展開|收合)商戶選項$/u })).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "商戶功能" })).toBeVisible();
    await expect(page.getByRole("button", { name: "選擇攤位：全部攤位", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "攤位比較" })).toBeVisible();
    await expect(page.getByRole("article").filter({ hasText: secondStall.name })).toBeVisible();
    const summaryDashboard = page.locator("#main-content").getByLabel("營運摘要");
    const summaryColumnCount = await summaryDashboard.evaluate((element) => (
      window.getComputedStyle(element).gridTemplateColumns.split(" ").length
    ));
    expect(summaryColumnCount).toBe(2);
    await expect(summaryDashboard.locator(":scope > div").nth(6))
      .toHaveCSS("grid-column-end", "auto");
    const dimensions = await page.evaluate(() => ({
      viewport: window.innerWidth,
      document: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
    }));
    expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport + 1);
    expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport + 1);

    await page.setViewportSize({ width: 320, height: 720 });
    await expect(summaryDashboard).toBeVisible();
    const narrowSummaryColumnCount = await summaryDashboard.evaluate((element) => (
      window.getComputedStyle(element).gridTemplateColumns.split(" ").length
    ));
    expect(narrowSummaryColumnCount).toBe(2);
    await expect(summaryDashboard.locator(":scope > div").nth(6))
      .toHaveCSS("grid-column-end", "auto");
    const narrowDimensions = await page.evaluate(() => ({
      viewport: window.innerWidth,
      document: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
    }));
    expect(narrowDimensions.document).toBeLessThanOrEqual(narrowDimensions.viewport + 1);
    expect(narrowDimensions.body).toBeLessThanOrEqual(narrowDimensions.viewport + 1);

    await page.setViewportSize({ width: 768, height: 1024 });
    await expect(summaryDashboard).toBeVisible();
    const tabletSummaryColumnCount = await summaryDashboard.evaluate((element) => (
      window.getComputedStyle(element).gridTemplateColumns.split(" ").length
    ));
    expect(tabletSummaryColumnCount).toBe(4);
    const tabletDimensions = await page.evaluate(() => ({
      viewport: window.innerWidth,
      document: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
    }));
    expect(tabletDimensions.document).toBeLessThanOrEqual(tabletDimensions.viewport + 1);
    expect(tabletDimensions.body).toBeLessThanOrEqual(tabletDimensions.viewport + 1);
  });

  test("手機 Header 以 server route scope 覆蓋 stale 組織 query 並拒絕跨 tenant 攤位", async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await createAuthorizedSecondaryWorkspace();
    await loginWithPassword(page, ownerEmail);

    await page.evaluate(({ organizationId }) => {
      window.localStorage.setItem("stallorder.organization.preference", organizationId);
    }, { organizationId: authorizedOrganization.id });

    await gotoLocalPath(
      page,
      `/merchant/stalls/${firstStall.id}/settings/basic?organizationId=${authorizedOrganization.id}`,
    );
    await expect(page).toHaveURL(new RegExp(
      `/merchant/stalls/${firstStall.id}/settings/basic\\?organizationId=${authorizedOrganization.id}$`,
    ));
    await expect(page.getByRole("heading", { name: "基本資料", exact: true })).toBeVisible();
    await expect(page.getByLabel("攤位名稱")).toHaveValue(firstStall.name);
    await expandMerchantHeader(page);
    await expectRenderedMerchantScope(page, {
      organizationId: organization.id,
      businessName: organization.businessName,
      stall: firstStall,
      unauthorizedBusinessName: "E2E 隔離組織",
    });

    await page.evaluate(({ organizationId }) => {
      window.localStorage.setItem("stallorder.organization.preference", organizationId);
    }, { organizationId: organization.id });
    await gotoLocalPath(
      page,
      `/merchant/stalls/${authorizedStall.id}/settings/basic?organizationId=${organization.id}`,
    );
    await expect(page).toHaveURL(new RegExp(
      `/merchant/stalls/${authorizedStall.id}/settings/basic\\?organizationId=${organization.id}$`,
    ));
    await expect(page.getByRole("heading", { name: "基本資料", exact: true })).toBeVisible();
    await expect(page.getByLabel("攤位名稱")).toHaveValue(authorizedStall.name);
    await expandMerchantHeader(page);
    await expectRenderedMerchantScope(page, {
      organizationId: authorizedOrganization.id,
      businessName: authorizedOrganization.businessName,
      stall: authorizedStall,
      unauthorizedBusinessName: "E2E 隔離組織",
    });

    const unauthorizedResponse = await page.goto(
      `/merchant/stalls/${otherStall.id}/settings/basic?organizationId=${authorizedOrganization.id}`,
    );
    expect(unauthorizedResponse?.status()).toBe(404);
    await expect(page.getByText(otherStall.name, { exact: true })).toHaveCount(0);
    await expect(page.getByText("E2E 隔離組織", { exact: true })).toHaveCount(0);

    const dimensions = await page.evaluate(() => ({
      viewport: window.innerWidth,
      document: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
    }));
    expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport + 1);
    expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport + 1);
  });
});

async function createAuthorizedSecondaryWorkspace() {
  await deleteTestOrganizations({
    where: {
      OR: [
        { slug: authorizedOrganizationSlug },
        { email: authorizedOrganizationEmail },
      ],
    },
  });
  const owner = await prisma.profile.findUniqueOrThrow({
    where: { email: ownerEmail },
    select: { id: true },
  });
  authorizedOrganization = await prisma.organization.create({
    data: {
      name: "E2E 授權第二組織",
      businessName: "E2E 授權第二組織",
      slug: authorizedOrganizationSlug,
      status: "ACTIVE",
      email: authorizedOrganizationEmail,
      phone: "0900-000-088",
    },
    select: { id: true, businessName: true },
  });
  const planVersion = await prisma.planVersion.findFirstOrThrow({
    where: { plan: { code: "TRIAL" }, effectiveUntil: null },
    select: { id: true, planId: true },
  });
  const billingPeriodStart = new Date();
  billingPeriodStart.setUTCHours(0, 0, 0, 0);
  const billingPeriodEnd = new Date(billingPeriodStart);
  billingPeriodEnd.setUTCDate(billingPeriodEnd.getUTCDate() + 30);
  await prisma.subscription.create({
    data: {
      organizationId: authorizedOrganization.id,
      planId: planVersion.planId,
      planVersionId: planVersion.id,
      status: "ACTIVE",
      billingInterval: "MONTHLY",
      billingPeriodStart,
      billingPeriodEnd,
    },
  });
  await prisma.organizationMembership.create({
    data: {
      organizationId: authorizedOrganization.id,
      profileId: owner.id,
      role: "ORGANIZATION_OWNER",
      allStalls: true,
      isPrimaryOwner: true,
    },
  });
  authorizedStall = await prisma.stall.create({
    data: {
      organizationId: authorizedOrganization.id,
      name: "授權第二組織攤位",
      slug: authorizedStallSlug,
      code: "E2E-AUTH-02",
      address: "授權第二組織測試地址",
      location: "授權第二組織測試地址",
    },
    select: { id: true, name: true, slug: true },
  });
}

async function deleteTestOrganizations(args: { where: Prisma.OrganizationWhereInput }) {
  const organizations = await prisma.organization.findMany({
    ...args,
    select: { id: true },
  });
  const organizationIds = organizations.map(({ id }) => id);
  if (organizationIds.length === 0) return;
  await prisma.organizationMembership.deleteMany({
    where: { organizationId: { in: organizationIds } },
  });
  await prisma.usageEvent.deleteMany({
    where: { organizationId: { in: organizationIds } },
  });
  await prisma.organization.deleteMany({
    where: { id: { in: organizationIds } },
  });
}

async function expandMerchantHeader(page: Page) {
  await expect(page.getByRole("button", { name: /^(?:展開|收合)商戶選項$/u })).toHaveCount(0);
  await expect(page.getByTestId("merchant-utility-toolbar")).toBeVisible();
}

async function expectRenderedMerchantScope(
  page: Page,
  expected: {
    organizationId: string;
    businessName: string;
    stall: { id: string; name: string; slug: string };
    unauthorizedBusinessName: string;
  },
) {
  await openCompactSwitcher(
    page,
    `選擇商家：${expected.businessName}`,
    "選擇商家",
  );
  const organizationDialog = page.getByRole("dialog", { name: "選擇商家" });
  await expect(organizationDialog.getByRole("button", { name: expected.businessName, exact: true }))
    .toHaveAttribute("aria-current", "page");
  await expect(organizationDialog.getByText(expected.unauthorizedBusinessName, { exact: true }))
    .toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(organizationDialog).toHaveCount(0);
  await expect(page.getByRole("link", { name: "攤點通", exact: true })).toHaveAttribute(
    "href",
    `/merchant/dashboard?organizationId=${expected.organizationId}`,
  );
  await expect(page.getByRole("button", {
    name: `商家管理 · ${expected.businessName}`,
    exact: true,
  })).toBeVisible();

  const stallTrigger = page.getByRole("button", {
    name: `選擇攤位：${expected.stall.name}`,
    exact: true,
  });
  if (await stallTrigger.count()) {
    await stallTrigger.click();
    const stallDialog = page.getByRole("dialog", { name: "選擇攤位" });
    await expect(stallDialog.getByRole("button", { name: expected.stall.name, exact: true }))
      .toHaveAttribute("aria-current", "page");
    await page.keyboard.press("Escape");
    await expect(stallDialog).toHaveCount(0);
  } else {
    await expect(page.getByRole("link", {
      name: `選擇攤位：${expected.stall.name}`,
      exact: true,
    })).toHaveAttribute("href", `/merchant/${expected.stall.slug}`);
  }
}

async function openCompactSwitcher(
  page: Page,
  triggerName: string,
  dialogName: "選擇商家" | "選擇攤位" | "切換工作模式",
) {
  const trigger = page.getByRole("button", { name: triggerName, exact: true });
  await expect(trigger).toBeVisible();
  await trigger.click();
  await expect(page.getByRole("dialog", { name: dialogName })).toBeVisible();
}

async function selectCompactOption(
  page: Page,
  triggerName: string,
  dialogName: "選擇商家" | "選擇攤位" | "切換工作模式",
  optionName: string,
) {
  await openCompactSwitcher(page, triggerName, dialogName);
  await page.getByRole("dialog", { name: dialogName })
    .getByRole("button", { name: optionName, exact: true })
    .click();
}

async function loginWithPassword(page: Page, email: string) {
  await gotoLocalPath(page, "/login");
  await page.getByRole("button", { name: "使用電子郵件與密碼登入", exact: true }).click();
  await page.getByLabel("電子郵件").fill(email);
  await page.getByLabel("密碼").fill(password);
  await page.getByRole("button", { name: "登入", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/, { timeout: 15_000 });
}

async function expectDashboardOrganization(page: Page, organizationId: string) {
  await expect.poll(() => {
    const url = new URL(page.url());
    return {
      pathname: url.pathname,
      organizationId: url.searchParams.get("organizationId"),
    };
  }).toEqual({
    pathname: "/merchant/dashboard",
    organizationId,
  });
}

async function waitForReactHandler(
  control: Locator,
  handler: "onClick" | "onChange" | "onSubmit",
  target: "self" | "form" = "self",
) {
  await expect.poll(() => control.evaluate((element, options) => {
    const eventTarget = options.target === "form"
      ? (element as HTMLButtonElement).form
      : element;
    if (!eventTarget) return false;
    const propsKey = Object.keys(eventTarget).find((key) => key.startsWith("__reactProps$"));
    if (!propsKey) return false;
    const props = (eventTarget as unknown as Record<string, unknown>)[propsKey];
    return typeof props === "object"
      && props !== null
      && typeof (props as Record<string, unknown>)[options.handler] === "function";
  }, { handler, target }), { message: `等待 React 掛載 ${handler}` }).toBe(true);
}

async function openCustomerMenu(page: Page, qrToken: string, stallName: string) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await gotoLocalPath(page, `/q/${encodeURIComponent(qrToken)}`);
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
