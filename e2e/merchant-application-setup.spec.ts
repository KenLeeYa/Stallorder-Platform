import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";

loadLocalEnv();
assertLocalDatabase();

const prisma = new PrismaClient();
const password = "MerchantSetup!2026";
const applicantEmail = "merchant.application.e2e@stallorder.test";
const adminEmail = "merchant.application.admin.e2e@stallorder.test";
const applicantAuthUserId = randomUUID();
const requestedSlug = "merchant-application-e2e";
const demoOrganizationId = "11111111-1111-4111-8111-111111111111";
let applicationId = "";
let organizationId = "";

test.describe("商家申請、核准、測試訂單與開放接單", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    await cleanup();
    const passwordHash = await hash(password, 4);
    await prisma.$executeRaw`
      insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data)
      values (
        ${applicantAuthUserId}::uuid,
        ${applicantEmail},
        now(),
        '{"provider":"google","providers":["google"]}'::jsonb
      )
    `;
    const [applicant, admin] = await Promise.all([
      prisma.profile.create({
        data: {
          authUserId: applicantAuthUserId,
          email: applicantEmail,
          displayName: "申請流程測試商家",
          passwordHash,
        },
      }),
      prisma.profile.create({
        data: {
          email: adminEmail,
          displayName: "申請流程平台管理員",
          passwordHash,
          platformRole: "PLATFORM_ADMIN",
        },
      }),
    ]);
    const application = await prisma.merchantApplication.create({
      data: {
        applicantProfileId: applicant.id,
        applicantEmail,
        applicantDisplayName: applicant.displayName,
        merchantName: "申請流程測試商家",
        businessType: "NIGHT_MARKET_STALL",
        contactName: "測試負責人",
        phone: "0912345678",
        phoneHash: "merchant-application-e2e-phone-hash",
        businessPhone: "0912345678",
        preferredContactMethod: "PHONE",
        businessAddress: "台北市測試路 1 號",
        city: "台北市",
        stallName: "申請流程測試攤位",
        stallLocation: "台北測試夜市",
        requestedSlug,
        estimatedDailyOrders: 20,
        requestedPlanCode: "TRIAL",
        status: "PENDING_REVIEW",
        currentStep: 4,
        termsAccepted: true,
        privacyAccepted: true,
        dataProcessingAccepted: true,
        informationConfirmed: true,
        consentedAt: new Date(),
        submittedAt: new Date(),
      },
    });
    applicationId = application.id;
    expect(await prisma.organization.count({ where: { email: applicantEmail } })).toBe(0);
    expect(await prisma.organizationMembership.count({ where: { profileId: applicant.id } })).toBe(0);
    await prisma.authSession.deleteMany({ where: { profileId: { in: [applicant.id, admin.id] } } });
  });

  test.afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  test("申請不建商家；核准後維持 CLOSED/PAUSED，完成測試訂單才開放", async ({ page }) => {
    test.setTimeout(120_000);
    await login(page, adminEmail);
    await page.goto(`/admin/merchant-applications/${applicationId}`);
    await expect(page.getByRole("heading", { name: "申請流程測試商家" })).toBeVisible();
    await page.getByText("要求補件或核准", { exact: true }).click();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "核准並建立 Trial" }).click();

    await expect.poll(async () => (await prisma.merchantApplication.findUnique({ where: { id: applicationId } }))?.status).toBe("APPROVED");
    const approved = await prisma.merchantApplication.findUniqueOrThrow({
      where: { id: applicationId },
      include: {
        approvedOrganization: {
          include: {
            subscription: true,
            stalls: { include: { qrCodes: true, orderingSettings: true, paymentOptions: true } },
            merchantSetupProgress: true,
          },
        },
      },
    });
    const organization = approved.approvedOrganization;
    if (!organization) throw new Error("核准後未建立組織");
    organizationId = organization.id;
    expect(organization.status).toBe("TRIALING");
    expect(organization.subscription?.status).toBe("TRIALING");
    expect(organization.stalls).toHaveLength(1);
    expect(organization.stalls[0].orderingState).toBe("CLOSED");
    expect(organization.stalls[0].orderingEnabled).toBe(false);
    expect(organization.stalls[0].businessStatus).toBe("CLOSED");
    expect(organization.stalls[0].qrCodes[0].state).toBe("PAUSED");
    expect(organization.stalls[0].orderingSettings).toMatchObject({
      dineInEnabled: false,
      deliveryModuleEnabled: false,
      printModuleEnabled: false,
      paymentModuleEnabled: true,
      discountModuleEnabled: false,
      enabledLocales: ["zh-TW"],
    });
    expect(organization.stalls[0].paymentOptions).toEqual([
      expect.objectContaining({ code: "CASH", kind: "CASH", isEnabled: true }),
    ]);
    expect(organization.merchantSetupProgress?.goLiveCompleted).toBe(false);

    await page.goto(`/merchant/dashboard?organizationId=${organizationId}`);
    await expect(page.getByLabel("選擇商家")).toBeVisible();
    await page.getByLabel("選擇商家").selectOption(demoOrganizationId);
    await expect(page).toHaveURL(
      new RegExp(`/merchant/stalls\\?organizationId=${demoOrganizationId}$`),
    );
    await page.goto(`/merchant/dashboard?organizationId=${organizationId}`);
    await expect(page.getByRole("link", { name: "開店設定" })).toHaveCount(0);

    await page.context().clearCookies();
    await login(page, applicantEmail);
    await expect(page).toHaveURL(new RegExp(`/merchant/setup\\?organizationId=${organizationId}`));
    await expect(page.getByRole("heading", { name: "開店設定" })).toBeVisible();
    await expect(page.getByRole("link", { name: "開店設定" })).toHaveCount(0);

    await page.goto(`/merchant/stalls/${organization.stalls[0].id}`);
    await expect(page.getByRole("link", { name: "開店設定", exact: true })).toHaveAttribute(
      "href",
      `/merchant/setup?organizationId=${organizationId}`,
    );
    await page.goto(`/merchant/setup?organizationId=${organizationId}`);

    const merchantProfileStep = page.getByRole("article").filter({ hasText: "商家資料" });
    const stallProfileStep = page.getByRole("article").filter({ hasText: "攤位資料" });
    const paymentStep = page.getByRole("article").filter({ hasText: "付款方式" });
    await expect(merchantProfileStep.getByRole("link", { name: "前往設定" })).toHaveAttribute(
      "href",
      `/merchant/organization?organizationId=${organizationId}&source=setup`,
    );
    await expect(stallProfileStep.getByRole("link", { name: "前往設定" })).toHaveAttribute(
      "href",
      new RegExp(`/merchant/stalls/.+/settings/basic\\?source=setup$`),
    );
    await expect(paymentStep.getByRole("link", { name: "前往設定" })).toHaveAttribute(
      "href",
      new RegExp(`/merchant/stalls/.+/settings/modules\\?source=setup#payment-options$`),
    );

    for (const label of ["商家資料", "攤位資料", "商品目錄", "付款方式", "團隊成員", "QR 預覽"]) {
      const step = page.getByRole("article").filter({ hasText: label });
      const href = await step.getByRole("link", { name: "前往設定" }).getAttribute("href");
      if (!href) throw new Error(`${label} 缺少設定連結`);
      await page.goto(href);
      const backLink = page.getByRole("link", { name: "返回開店設定", exact: true });
      await expect(backLink).toHaveAttribute("href", `/merchant/setup?organizationId=${organizationId}`);
      await backLink.click();
      await expect(page).toHaveURL(new RegExp(`/merchant/setup\\?organizationId=${organizationId}$`));
    }

    for (const label of ["商家資料", "攤位資料", "商品目錄", "付款方式", "團隊成員", "QR 預覽"]) {
      const step = page.getByRole("article").filter({ hasText: label });
      const button = step.getByRole("button", { name: "確認完成" });
      await button.click();
      await expect(button).toHaveCount(0);
    }
    await page.getByRole("button", { name: "建立測試訂單" }).click();
    await expect.poll(async () => prisma.order.findFirst({
      where: { organizationId, isTest: true, source: "MERCHANT_SETUP_TEST" },
    })).not.toBeNull();
    const createdTestOrder = await prisma.order.findFirstOrThrow({
      where: { organizationId, isTest: true, source: "MERCHANT_SETUP_TEST" },
    });
    expect(createdTestOrder.status).toBe("WAITING_CONFIRMATION");
    expect(await prisma.usageEvent.count({
      where: { organizationId, referenceId: createdTestOrder.id, eventType: "BILLABLE_ORDER_COMPLETED" },
    })).toBe(0);

    await page.goto(`/staff/${requestedSlug}`);
    const orderCard = page.getByRole("article").filter({ hasText: createdTestOrder.orderNo });
    await expect(orderCard.getByText("開店測試訂單")).toBeVisible();
    await orderCard.getByRole("button", { name: "確認接單" }).click();
    await orderCard.getByRole("button", { name: /全部開始製作/ }).click();
    await orderCard.getByRole("button", { name: /全部餐點完成/ }).click();
    await expect.poll(async () => (await prisma.order.findUnique({ where: { id: createdTestOrder.id } }))?.status).toBe("READY");
    await orderCard.getByRole("button", { name: "完成訂單" }).click();
    await expect.poll(async () => (await prisma.order.findUnique({ where: { id: createdTestOrder.id } }))?.status).toBe("COMPLETED");
    expect(await prisma.usageEvent.count({
      where: { organizationId, referenceId: createdTestOrder.id, eventType: "BILLABLE_ORDER_COMPLETED" },
    })).toBe(0);

    await page.goto(`/merchant/setup?organizationId=${organizationId}`);
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "正式開放 QR 接單" }).click();
    await expect(page.getByText("QR 點餐已開放，攤位目前可接收正式訂單。")).toBeVisible();

    const live = await prisma.merchantSetupProgress.findUniqueOrThrow({
      where: { organizationId },
      include: { stall: true, qrCode: true },
    });
    expect(live.testOrderCompleted).toBe(true);
    expect(live.goLiveCompleted).toBe(true);
    expect(live.stall.orderingState).toBe("OPEN");
    expect(live.stall.orderingEnabled).toBe(true);
    expect(live.qrCode.state).toBe("ACTIVE");

    await page.context().clearCookies();
    await login(page, applicantEmail);
    await expect(page).toHaveURL(
      new RegExp(`/merchant/dashboard\\?organizationId=${organizationId}$`),
      { timeout: 30_000 },
    );
    await expect(page.getByText("多攤位營運總覽", { exact: true })).toBeVisible();

    await prisma.merchantSetupProgress.delete({ where: { organizationId } });
    await page.goto(`/merchant/setup?organizationId=${organizationId}`);
    await expect(page.getByRole("heading", { name: "目前沒有待完成的開店流程" })).toBeVisible();
    await expect(page.getByRole("main").getByRole("link", { name: "管理攤位" })).toBeVisible();
    await expect(page.getByRole("link", { name: "開店設定" })).toHaveCount(0);
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
  const profiles = await prisma.profile.findMany({
    where: { email: { in: [applicantEmail, adminEmail] } },
    select: { id: true },
  });
  const profileIds = profiles.map((profile) => profile.id);
  await prisma.authSession.deleteMany({ where: { profileId: { in: profileIds } } });
  const organizations = await prisma.organization.findMany({
    where: { email: applicantEmail },
    select: { id: true },
  });
  for (const organization of organizations) {
    await prisma.merchantSetupProgress.deleteMany({ where: { organizationId: organization.id } });
    await prisma.order.deleteMany({ where: { organizationId: organization.id } });
    await prisma.stallMembership.deleteMany({ where: { organizationId: organization.id } });
    await prisma.organizationMembership.deleteMany({ where: { organizationId: organization.id } });
    await prisma.usageEvent.deleteMany({ where: { organizationId: organization.id } });
    await prisma.organization.delete({ where: { id: organization.id } });
  }
  await prisma.merchantApplication.deleteMany({ where: { applicantEmail } });
  await prisma.profile.deleteMany({ where: { id: { in: profileIds } } });
  await prisma.$executeRaw`
    delete from auth.users
    where id = ${applicantAuthUserId}::uuid or email = ${applicantEmail}
  `;
}

function assertLocalDatabase() {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error("E2E 必須設定 DATABASE_URL");
  const hostname = new URL(value).hostname;
  if (!["127.0.0.1", "localhost"].includes(hostname)) throw new Error(`拒絕在非本機資料庫執行 E2E：${hostname}`);
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
    process.env[match[1]] = value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
  }
}
