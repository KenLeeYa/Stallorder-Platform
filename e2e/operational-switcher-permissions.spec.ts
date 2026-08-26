import { expect, test, type Page } from "@playwright/test";

async function quickLogin(page: Page, label: "商家" | "店員" | "廚房", expectedPath: RegExp) {
  const emailByLabel = {
    商家: "owner@stallorder.test",
    店員: "staff@stallorder.test",
    廚房: "kitchen@stallorder.test",
  } as const;
  await page.goto("/login");
  await page.getByRole("button", { name: "使用電子郵件與密碼登入", exact: true }).click();
  await page.getByLabel("電子郵件").fill(emailByLabel[label]);
  await page.getByLabel("密碼").fill("StallOrderDemo!2026");
  await page.getByRole("button", { name: "登入", exact: true }).click();
  await expect(page).toHaveURL(expectedPath, { timeout: 30_000 });
}

test("純店員與純廚房帳號不顯示工作模式或攤位切換", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });

  await quickLogin(page, "店員", /\/staff\/aming-chicken/u);
  await expect(page.getByTestId("work-mode-icon-staff")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /選擇攤位/u })).toHaveCount(0);

  await page.getByRole("button", { name: "登出", exact: true }).click();
  await expect(page).toHaveURL(/\/login/u);

  await quickLogin(page, "廚房", /\/kitchen/u);
  await expect(page.getByTestId("work-mode-icon-kitchen")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /選擇攤位/u })).toHaveCount(0);
});

test("商家進入店員與廚房頁仍可切換工作模式", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await quickLogin(page, "商家", /\/merchant\/dashboard\?organizationId=/u);

  await page.goto("/staff/aming-chicken");
  await expect(page.getByTestId("work-mode-icon-staff")).toHaveCount(1);

  await page.goto("/kitchen?stall=aming-chicken");
  await expect(page.getByTestId("work-mode-icon-kitchen")).toHaveCount(1);
});
