import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

loadLocalEnv();
assertLocalDatabase();

const prisma = new PrismaClient();
const authUserId = randomUUID();
const runId = authUserId.slice(0, 8);
const applicantEmail = "onboarding.application.e2e@stallorder.test";
const merchantName = `申請流程測試商家 ${runId}`;
const requestedSlug = `onboarding-flow-${runId}`;
let profileId = "";

test.describe("商家申請表單流程", () => {
  test.beforeAll(async () => {
    await prisma.$executeRaw`
      insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data)
      values (
        ${authUserId}::uuid,
        ${applicantEmail},
        now(),
        '{"provider":"google","providers":["google"]}'::jsonb
      )
    `;
    const profile = await prisma.profile.create({
      data: {
        authUserId,
        email: applicantEmail,
        displayName: "申請流程測試人員",
      },
    });
    profileId = profile.id;
  });

  test.afterAll(async () => {
    await prisma.authSession.deleteMany({ where: { profileId } });
    await prisma.merchantApplication.deleteMany({ where: { applicantProfileId: profileId } });
    await prisma.profile.deleteMany({ where: { id: profileId } });
    await prisma.$executeRaw`
      delete from auth.users
      where id = ${authUserId}::uuid
    `;
    await prisma.$disconnect();
  });

  test("已驗證且尚無商戶的帳號可送出申請，但不會直接建立組織", async ({ page }) => {
    await loginForOnboarding(page);
    await expect(page.getByRole("heading", { name: "商家申請" })).toBeVisible();
    await expect(page.getByText("已驗證 Google 身分")).toBeVisible();
    await expect(page.getByText("送出後由平台人工審核，不會立即建立商家工作區。")).toBeVisible();

    await page.getByLabel("聯絡電話").fill("0912345678");
    await advanceToNextStep(page);

    await page.getByLabel("商家或品牌名稱").fill(merchantName);
    await page.getByLabel("商家電話").fill("0223456789");
    await page.getByLabel("縣市").fill("台北市");
    await page.getByLabel("商家地址").fill("台北市測試路 1 號");
    await advanceToNextStep(page);

    await page.getByLabel("第一個攤位名稱").fill(`測試攤位 ${runId}`);
    await page.getByLabel("主要營業地點").fill("測試夜市");
    await page.getByLabel("預估每日訂單").fill("30");
    const slugResponse = page.waitForResponse((response) => (
      response.url().includes(`/api/onboarding?slug=${requestedSlug}`)
      && response.request().method() === "GET"
    ));
    await page.getByLabel("公開網址代稱").fill(requestedSlug);
    await page.getByLabel("公開網址代稱").press("Tab");
    expect((await slugResponse).status()).toBe(200);
    await expect(page.getByText("此網址可使用")).toBeVisible();
    await advanceToNextStep(page);

    for (const consent of [
      "我同意服務條款",
      "我同意隱私權政策",
      "我同意資料處理告知事項",
      "我確認上述申請資料正確",
    ]) {
      await page.getByLabel(consent).check();
    }

    const submitResponse = page.waitForResponse((response) => (
      response.url().endsWith("/api/onboarding")
      && response.request().method() === "POST"
    ));
    await page.getByRole("button", { name: "送出商家申請" }).click();
    expect((await submitResponse).status()).toBe(201);
    await expect(page).toHaveURL(/\/onboarding\/status$/);
    await expect(page.getByRole("heading", { name: merchantName })).toBeVisible();
    await expect(page.getByText("等待審核", { exact: true })).toBeVisible();

    const application = await prisma.merchantApplication.findFirstOrThrow({
      where: { applicantProfileId: profileId },
      select: { status: true, requestedSlug: true },
    });
    expect(application).toEqual({
      status: "PENDING_REVIEW",
      requestedSlug,
    });
    expect(await prisma.organization.count({ where: { email: applicantEmail } })).toBe(0);
    expect(await prisma.organizationMembership.count({ where: { profileId } })).toBe(0);
  });
});

async function loginForOnboarding(page: Page) {
  await page.goto("/login");
  await page.getByRole("link", { name: "使用 Google 申請開通" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
}

async function advanceToNextStep(page: Page) {
  const response = page.waitForResponse((candidate) => (
    candidate.url().endsWith("/api/onboarding")
    && candidate.request().method() === "POST"
  ));
  await page.getByRole("button", { name: "下一步" }).click();
  expect((await response).status()).toBe(200);
}

function assertLocalDatabase() {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error("E2E 測試需要設定 DATABASE_URL");
  const hostname = new URL(value).hostname;
  if (!["127.0.0.1", "localhost"].includes(hostname)) {
    throw new Error(`禁止針對非本機資料庫執行 E2E：${hostname}`);
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
    process.env[match[1]] = value.startsWith("\"") && value.endsWith("\"")
      ? value.slice(1, -1)
      : value;
  }
}
