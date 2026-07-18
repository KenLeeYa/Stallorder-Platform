import { expect, test } from "@playwright/test";

const ownerEmail = "owner@stallorder.test";
const password = "StallOrderDemo!2026";

test("示範 Owner 可登入並建立有效 session", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("電子郵件").fill(ownerEmail);
  await page.getByLabel("密碼").fill(password);

  const loginResponse = page.waitForResponse((response) => (
    response.url().endsWith("/api/auth/login")
    && response.request().method() === "POST"
  ));

  await page.getByRole("button", { name: "登入", exact: true }).click();
  expect((await loginResponse).status()).toBe(200);
  await expect(page).toHaveURL(/\/merchant\/dashboard\?organizationId=/);
  await expect(page.getByText("多攤位營運總覽", { exact: true })).toBeVisible();
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
