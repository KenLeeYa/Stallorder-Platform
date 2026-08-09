import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

loadLocalEnv();
assertLocalDatabase();

const prisma = new PrismaClient();
const password = "StallOrderDemo!2026";
const organizationId = "11111111-1111-4111-8111-111111111111";
const stallId = "22222222-2222-4222-8222-222222222222";
const deliveryFlagCodes = [
  "DELIVERY_PLATFORM_FOUNDATION_ENABLED",
  "DELIVERY_PLATFORM_UI_ENABLED",
  "UBER_EATS_INTEGRATION_ENABLED",
] as const;
const connectionMarker = "central-settings-validation-e2e";

let connectionId = "";
let entitlementId = "";
let entitlementWasEnabled = false;
let originalFlags: Array<{ id: string; defaultEnabled: boolean }> = [];

test.describe("中央設定欄位錯誤", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    const subscription = await prisma.subscription.findUniqueOrThrow({
      where: { organizationId },
      select: { planVersionId: true },
    });
    const entitlement = await prisma.planEntitlement.findUniqueOrThrow({
      where: {
        planVersionId_featureCode: {
          planVersionId: subscription.planVersionId,
          featureCode: "DELIVERY_PLATFORM_INTEGRATIONS",
        },
      },
      select: { id: true, isEnabled: true },
    });
    entitlementId = entitlement.id;
    entitlementWasEnabled = entitlement.isEnabled;
    await prisma.planEntitlement.update({ where: { id: entitlement.id }, data: { isEnabled: true } });

    originalFlags = await prisma.resilienceFeatureFlag.findMany({
      where: { code: { in: [...deliveryFlagCodes] } },
      select: { id: true, defaultEnabled: true },
    });
    expect(originalFlags).toHaveLength(deliveryFlagCodes.length);
    await prisma.resilienceFeatureFlag.updateMany({
      where: { id: { in: originalFlags.map((flag) => flag.id) } },
      data: { defaultEnabled: true },
    });

    await prisma.deliveryPlatformConnection.deleteMany({
      where: { externalAccountReference: connectionMarker },
    });
    const connection = await prisma.deliveryPlatformConnection.findFirst({
      where: { organizationId, stallId },
      select: { id: true },
    }) ?? await prisma.deliveryPlatformConnection.create({
      data: {
        organizationId,
        stallId,
        provider: "MOCK",
        status: "TESTING",
        externalAccountReference: connectionMarker,
        capabilitiesJson: [],
      },
      select: { id: true },
    });
    connectionId = connection.id;
  });

  test.afterAll(async () => {
    await prisma.deliveryPlatformConnection.deleteMany({
      where: { externalAccountReference: connectionMarker },
    });
    if (entitlementId) {
      await prisma.planEntitlement.update({
        where: { id: entitlementId },
        data: { isEnabled: entitlementWasEnabled },
      });
    }
    await Promise.all(originalFlags.map((flag) => prisma.resilienceFeatureFlag.update({
      where: { id: flag.id },
      data: { defaultEnabled: flag.defaultEnabled },
    })));
    await prisma.$disconnect();
  });

  test("同一登入 session 依序顯示六組繁中欄位錯誤並聚焦第一欄", async ({ page }) => {
    test.setTimeout(120_000);
    await login(page);

    if (process.env.PLAYWRIGHT_PRODUCTION_SERVER !== "true") {
      const warmupResponse = await page.context().request.get(
        `/api/merchant/organizations/${organizationId}/profile`,
      );
      expect(warmupResponse.status()).toBe(405);
      await warmupResponse.dispose();
    }
    await page.goto(`/merchant/organization?organizationId=${organizationId}`);
    const saveOrganizationButton = page.getByRole("button", { name: "儲存商家資料" });
    await waitForReactHydration(saveOrganizationButton);
    const businessName = page.getByLabel("商家名稱");
    await businessName.fill("");
    await saveOrganizationButton.click();
    await expectInvalidField(page, businessName, "「商家名稱」輸入不正確，請依欄位限制重新輸入。");
    await expect(businessName).toHaveValue("");

    await page.goto(`/merchant/events?organizationId=${organizationId}`);
    const eventName = page.getByLabel("活動名稱");
    await page.getByRole("button", { name: "新增活動" }).click();
    await expectInvalidField(page, eventName, "請填寫活動名稱。");

    await page.goto(`/merchant/team?organizationId=${organizationId}`);
    const invitationEmail = page.getByLabel("Google 帳號 Email");
    await page.getByRole("button", { name: "建立邀請" }).click();
    await expectInvalidField(page, invitationEmail, "「Google 帳號 Email」輸入不正確，請依欄位限制重新輸入。");

    await page.goto(`/merchant/report-schedules?organizationId=${organizationId}`);
    await page.getByRole("button", { name: "新增排程" }).click();
    const scheduleName = page.getByLabel("排程名稱");
    await scheduleName.fill("");
    await page.getByRole("button", { name: "儲存排程" }).click();
    await expectInvalidField(page, scheduleName, "「排程名稱」輸入不正確，請依欄位限制重新輸入。");
    await expect(scheduleName).toHaveValue("");

    await page.goto(`/merchant/integrations/delivery?stallId=${stallId}`);
    const contactName = page.getByLabel("聯絡人姓名");
    await contactName.fill("甲");
    await page.getByLabel("聯絡電子郵件").fill("invalid-email");
    await page.getByLabel("聯絡電話").fill("123");
    for (const checkbox of await page.locator('input[name="capabilities"]').all()) {
      await checkbox.uncheck();
    }
    await page.getByRole("button", { name: "送出連線申請" }).click();
    await expectInvalidField(page, contactName, "「聯絡人姓名」輸入不正確，請依欄位限制重新輸入。");
    await expect(contactName).toHaveValue("甲");

    await page.goto(`/merchant/integrations/delivery/${connectionId}/menu-mapping?stallId=${stallId}`);
    const internalEntity = page.getByLabel("攤點通項目");
    await page.getByRole("button", { name: "儲存對應" }).click();
    await expectInvalidField(page, internalEntity, "「攤點通項目」輸入不正確，請依欄位限制重新輸入。");
  });
});

async function expectInvalidField(page: Page, field: Locator, message: string) {
  await expect(page.getByText(message, { exact: true }).first()).toBeVisible();
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await expect(field).toBeFocused();
  await expect(field).toHaveAttribute("aria-describedby", /-error$/);
}

async function waitForReactHydration(control: Locator) {
  await expect.poll(() => control.evaluate((element) => (
    Object.keys(element).some((key) => (
      key.startsWith("__reactProps$") || key.startsWith("__reactFiber$")
    ))
  )), { message: "等待 React 完成控制項 hydration" }).toBe(true);
}

async function login(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "使用電子郵件與密碼登入", exact: true }).click();
  await page.getByLabel("電子郵件").fill("owner@stallorder.test");
  await page.getByLabel("密碼").fill(password);
  await page.getByRole("button", { name: "登入", exact: true }).click();
  await expect(page).toHaveURL(/\/merchant\/dashboard\?organizationId=/, { timeout: 30_000 });
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
    content = readFileSync(
      process.env.STALLORDER_E2E_ENV_FILE ?? resolve(process.cwd(), ".env"),
      "utf8",
    );
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
