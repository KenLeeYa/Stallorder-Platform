import { expect, test, type Page } from "@playwright/test";
import { dismissStaffStartReminder, openStaffMobileTools } from "./local-navigation";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
test.setTimeout(120_000);
const stallId = "22222222-2222-4222-8222-222222222222";
let originalKds: boolean | undefined;
test.beforeAll(async () => {
  if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(process.env.DATABASE_URL!).hostname)) throw new Error("LOCAL_SWITCHER_QA_REQUIRED");
  originalKds = (await db.stallOrderingSettings.findUniqueOrThrow({ where: { stallId }, select: { kdsModuleEnabled: true } })).kdsModuleEnabled;
  await db.stallOrderingSettings.update({ where: { stallId }, data: { kdsModuleEnabled: true } });
});
test.afterAll(async () => {
  try { if (originalKds !== undefined) await db.stallOrderingSettings.update({ where: { stallId }, data: { kdsModuleEnabled: originalKds } }); }
  finally { await db.$disconnect(); }
});

async function quickLogin(page: Page, label: "商家" | "店員" | "廚房", expectedPath: RegExp) {
  const emailByLabel = {
    商家: "owner@stallorder.test",
    店員: "staff@stallorder.test",
    廚房: "kitchen@stallorder.test",
  } as const;
  const next = label === "商家" ? "/merchant/dashboard?organizationId=11111111-1111-4111-8111-111111111111" : label === "店員" ? "/staff/aming-chicken" : "/kitchen?stall=aming-chicken";
  await page.goto("/login?next=" + encodeURIComponent(next));
  await page.getByRole("button", { name: "使用電子郵件與密碼登入", exact: true }).click();
  await page.getByLabel("電子郵件").fill(emailByLabel[label]);
  await page.getByLabel("密碼").fill("StallOrderDemo!2026");
  await page.getByRole("button", { name: "登入", exact: true }).click();
  await expect(page).toHaveURL(expectedPath, { timeout: 30_000 });
}

test("純店員與純廚房帳號不顯示工作模式或攤位切換", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });

  await quickLogin(page, "店員", /\/staff\/aming-chicken/u);
  await dismissStaffStartReminder(page);
  await openStaffMobileTools(page);
  await expect(page.getByTestId("work-mode-icon-staff")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /選擇攤位/u })).toHaveCount(0);

  const logoutResponse = page.waitForResponse(response => response.url().endsWith("/api/auth/logout") && response.request().method() === "POST", { timeout: 45_000 });
  await page.getByRole("button", { name: "登出", exact: true }).click();
  expect((await logoutResponse).status()).toBe(200);
  await expect(page).toHaveURL(/\/login/u);

  await quickLogin(page, "廚房", /\/kitchen/u);
  await expect(page.getByTestId("work-mode-icon-kitchen")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /選擇攤位/u })).toHaveCount(0);
});

test("商家進入店員與廚房頁仍可切換工作模式", async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new DOMException("blocked", "SecurityError"); };
    Storage.prototype.setItem = () => { throw new DOMException("blocked", "SecurityError"); };
  });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await quickLogin(page, "商家", /\/merchant\/dashboard\?organizationId=/u);

  await page.goto("/staff/aming-chicken");
  await dismissStaffStartReminder(page);
  await expect(page.getByTestId("work-mode-icon-staff")).toHaveCount(1);
  await openStaffMobileTools(page);
  await page.getByTestId("work-mode-icon-staff").click();
  const switcher = page.getByTestId("compact-switcher-dialog");
  await expect(switcher).toBeVisible();
  await switcher.getByRole("button", { name: /^廚房 · 阿明鹽酥雞(?: · StallOrder 示範商戶)?$/u }).click();
  await expect(page).toHaveURL(/\/kitchen\?stall=aming-chicken$/u);

  await expect(page.getByTestId("work-mode-icon-kitchen")).toHaveCount(1);
  const sound = page.getByTestId("kitchen-alert-control");
  await sound.click();
  await expect(sound).toHaveAttribute("aria-checked", "true");
  await sound.click();
  await expect(sound).toHaveAttribute("aria-checked", "false");
  expect(errors).toEqual([]);
});
