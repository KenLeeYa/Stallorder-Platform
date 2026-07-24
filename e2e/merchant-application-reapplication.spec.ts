import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";

loadLocalEnv();
assertLocalDatabase();

const prisma = new PrismaClient();
const password = "MerchantReapply!2026";
const applicantEmail = "onboarding.application.e2e@stallorder.test";
const adminEmail = "merchant.reapplication.admin.e2e@stallorder.test";
const applicantAuthUserId = randomUUID();
let withdrawnApplicationId = "";

test.describe("撤回後重新申請與平台追蹤", () => {
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
          displayName: "重新申請測試商家",
          passwordHash,
        },
      }),
      prisma.profile.create({
        data: {
          email: adminEmail,
          displayName: "重新申請平台管理員",
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
        merchantName: "撤回後重新申請測試商家",
        businessType: "FOOD_TRUCK",
        contactName: "測試負責人",
        phone: "0916665504",
        phoneHash: "merchant-reapplication-e2e-phone-hash",
        businessPhone: "0916665504",
        preferredContactMethod: "PHONE",
        businessAddress: "台北市測試路 2 號",
        city: "台北市",
        stallName: "撤回後重新申請測試攤位",
        stallLocation: "台北測試市集",
        requestedSlug: "merchant-reapplication-e2e",
        estimatedDailyOrders: 30,
        requestedPlanCode: "TRIAL",
        status: "WITHDRAWN",
        currentStep: 4,
        termsAccepted: true,
        privacyAccepted: true,
        dataProcessingAccepted: true,
        informationConfirmed: true,
        consentedAt: new Date(Date.now() - 86_400_000),
        submittedAt: new Date(Date.now() - 86_400_000),
        withdrawnAt: new Date(),
      },
    });
    withdrawnApplicationId = application.id;
    await prisma.authSession.deleteMany({ where: { profileId: { in: [applicant.id, admin.id] } } });
  });

  test.afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  test("保留撤回案件、建立新草稿，並讓平台追蹤完整歷程", async ({ page }) => {
    test.setTimeout(90_000);
    await loginForOnboarding(page);
    await page.goto("/onboarding/status");

    await expect(page.getByText("已撤回", { exact: true })).toBeVisible();
    await expect(page.getByText(/舊案仍會保留供日後查閱/)).toBeVisible();
    await page.getByRole("link", { name: "重新提出申請" }).click();

    await expect(page).toHaveURL(/\/onboarding$/);
    await expect(page.getByRole("heading", { name: "重新申請商家" })).toBeVisible();
    await expect(page.getByRole("status")).toContainText("前次申請會保留為歷史紀錄");
    await expect(page.getByLabel("聯絡電話")).toHaveValue("0916665504");
    await page.getByRole("button", { name: "儲存草稿" }).click();
    await expect(page.getByText("草稿已儲存", { exact: true })).toBeVisible();

    const applications = await prisma.merchantApplication.findMany({
      where: { applicantEmail },
      orderBy: { createdAt: "desc" },
    });
    expect(applications).toHaveLength(2);
    const [newDraft, withdrawn] = applications;
    expect(newDraft.id).not.toBe(withdrawnApplicationId);
    expect(newDraft.status).toBe("DRAFT");
    expect(newDraft.currentStep).toBe(1);
    expect(newDraft.merchantName).toBe("撤回後重新申請測試商家");
    expect(newDraft.stallName).toBe("撤回後重新申請測試攤位");
    expect(newDraft.termsAccepted).toBe(false);
    expect(newDraft.privacyAccepted).toBe(false);
    expect(newDraft.dataProcessingAccepted).toBe(false);
    expect(newDraft.informationConfirmed).toBe(false);
    expect(withdrawn.id).toBe(withdrawnApplicationId);
    expect(withdrawn.status).toBe("WITHDRAWN");
    expect(await prisma.auditLog.count({
      where: {
        action: "MERCHANT_APPLICATION_REAPPLICATION_STARTED",
        entityId: newDraft.id,
        actorProfileId: newDraft.applicantProfileId,
        outcome: "SUCCESS",
      },
    })).toBe(1);

    await page.context().clearCookies();
    await login(page, adminEmail);
    await page.goto("/admin/merchant-applications?status=WITHDRAWN");
    const withdrawnRow = page.getByRole("row").filter({ hasText: withdrawn.applicationNumber });
    await expect(withdrawnRow.getByRole("link", { name: "查看紀錄" })).toBeVisible();
    await withdrawnRow.getByRole("link", { name: "查看紀錄" }).click();

    await expect(page.getByRole("heading", { name: "案件處理" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "此案件已結束" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "申請歷程" })).toBeVisible();
    await expect(page.getByRole("link", { name: withdrawn.applicationNumber })).toBeVisible();
    await expect(page.getByRole("link", { name: newDraft.applicationNumber })).toBeVisible();
    await expect(page.getByText("目前案件", { exact: true })).toHaveCount(1);
  });
});

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("電子郵件").fill(email);
  await page.getByLabel("密碼").fill(password);
  await page.getByRole("button", { name: "登入", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/, { timeout: 15_000 });
}

async function loginForOnboarding(page: Page) {
  await page.goto("/login");
  await page.getByRole("link", { name: "使用 Google 申請開通" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
}

async function cleanup() {
  const profiles = await prisma.profile.findMany({
    where: { email: { in: [applicantEmail, adminEmail] } },
    select: { id: true },
  });
  const profileIds = profiles.map((profile) => profile.id);
  await prisma.authSession.deleteMany({ where: { profileId: { in: profileIds } } });
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
  if (!["127.0.0.1", "localhost"].includes(hostname)) {
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
