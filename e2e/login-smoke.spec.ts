import { expect, test } from "@playwright/test";

const ownerEmail = "owner@stallorder.test";
const password = "StallOrderDemo!2026";

test("手機登入欄位具備正確語意、焦點與無水平溢位", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("/login");

  await expect(page.getByRole("heading", { name: "商家登入" })).toBeVisible();
  await expect(page.getByText("StallOrder", { exact: true })).toHaveCount(0);
  await expect(page.getByText("已註冊商家請優先使用 Google 帳號登入。", { exact: true })).toBeVisible();
  await expect(page.getByText(/平台管理員請使用/)).toHaveCount(0);

  const email = page.locator('input[name="email"]');
  const passwordInput = page.locator('input[name="password"]');
  const submit = page.locator('button[type="submit"]');
  const googleLogin = page.getByRole("link", { name: "使用 Google 登入", exact: true });
  const passwordLogin = page.getByRole("button", {
    name: "使用電子郵件與密碼登入",
    exact: true,
  });

  await expect(googleLogin).toBeVisible();
  await expect(passwordLogin).toBeVisible();
  await expect(email).toBeHidden();
  await expect(passwordInput).toBeHidden();
  expect((await googleLogin.boundingBox())!.y).toBeLessThan((await passwordLogin.boundingBox())!.y);

  await page.keyboard.press("Tab");
  await expect(page.locator(".skip-link")).toBeFocused();

  await passwordLogin.click();
  const dialog = page.getByRole("dialog", { name: "使用帳密登入" });
  await expect(dialog).toBeVisible();
  await expect(email).toBeFocused();

  await expect(email).toHaveAttribute("type", "email");
  await expect(email).toHaveAttribute("maxlength", "120");
  await expect(passwordInput).toHaveAttribute("type", "password");
  await expect(passwordInput).toHaveAttribute("maxlength", "128");
  expect((await submit.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(passwordLogin).toBeFocused();
});

test("示範 Owner 可登入並建立有效 session", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "使用電子郵件與密碼登入", exact: true }).click();
  await page.getByLabel("電子郵件").fill(ownerEmail);
  await page.getByLabel("密碼").fill(password);

  const loginResponse = page.waitForResponse((response) => (
    response.url().endsWith("/api/auth/login")
    && response.request().method() === "POST"
  ));

  await page.getByRole("button", { name: "登入", exact: true }).click();
  expect((await loginResponse).status()).toBe(200);
  await expect(page).toHaveURL(/\/merchant\/dashboard\?organizationId=/);
  const dashboardLabel = page.locator("#main-content").getByText("營運總覽", { exact: true });
  await expect(dashboardLabel).toBeVisible();
});

test("店員由獨立入口登入並返回店員工作區", async ({ page }) => {
  await page.goto("/staff/login");
  await expect(page.getByRole("heading", { name: "員工登入" })).toBeVisible();
  await expect(page.getByText("供受邀的店員與廚房人員使用。", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "使用電子郵件與密碼登入", exact: true }).click();
  await page.getByLabel("電子郵件").fill("staff@stallorder.test");
  await page.getByLabel("密碼").fill(password);
  await page.getByRole("button", { name: "登入", exact: true }).click();

  await expect(page).toHaveURL(/\/staff\/aming-chicken/);
});

test("本機平台管理員可登入管理後台", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "使用電子郵件與密碼登入", exact: true }).click();
  await page.getByLabel("電子郵件").fill("platform.admin@stallorder.test");
  await page.getByLabel("密碼").fill(password);
  await page.getByRole("button", { name: "登入", exact: true }).click();

  await expect(page).toHaveURL(/\/admin\/billing$/);
  await expect(page.getByRole("link", { name: "平台管理後台", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "平台管理導覽" })).toBeVisible();
});

test("瀏覽器擴充套件修改 body 屬性時不會阻擋登入", async ({ page }) => {
  const hydrationErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && message.text().includes("hydrated")) {
      hydrationErrors.push(message.text());
    }
  });
  await page.addInitScript(() => {
    const annotateBody = () => {
      if (!document.body) return false;
      document.body.setAttribute("monica-id", "playwright-extension-test");
      document.body.setAttribute("monica-version", "test");
      return true;
    };
    if (!annotateBody()) {
      const observer = new MutationObserver(() => {
        if (annotateBody()) observer.disconnect();
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
    }
  });

  await page.goto("/login");
  await page.getByRole("button", { name: "使用電子郵件與密碼登入", exact: true }).click();
  await page.locator('input[name="email"]').fill(ownerEmail);
  await page.locator('input[name="password"]').fill(password);
  const loginResponse = page.waitForResponse((response) => (
    response.url().endsWith("/api/auth/login")
    && response.request().method() === "POST"
  ));
  await page.locator('button[type="submit"]').click();

  expect((await loginResponse).status()).toBe(200);
  await expect(page).toHaveURL(/\/merchant\/dashboard\?organizationId=/);
  await expect(page.locator("[data-nextjs-dialog]")).toHaveCount(0);
  expect(hydrationErrors).toEqual([]);
});
