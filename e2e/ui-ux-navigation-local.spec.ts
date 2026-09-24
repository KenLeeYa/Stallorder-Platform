import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

test.skip(process.env.UI_UX_QA !== "true", "Explicit local redesign QA only.");
test.setTimeout(120_000);
const org = "11111111-1111-4111-8111-111111111111";
async function login(page: Page, role: string, url: string) {
  expect(process.env.PLAYWRIGHT_APP_URL).toBe("http://127.0.0.1:3023");
  await page.context().clearCookies();
  await page.goto("/login?next=" + encodeURIComponent(url));
  await page.getByTestId("local-qa-login-grid").getByRole("button", { name: role, exact: true }).click();
  await page.waitForURL(next => next.pathname === url.split("?")[0]);
}

test("merchant directory: discover settings in two actions, search, keyboard return and mobile", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await login(page, "商家", `/merchant/catalog?organizationId=${org}`);
  const nav = page.getByTestId("merchant-function-navigation-desktop");
  expect(await nav.getByRole("link").count()).toBeLessThanOrEqual(5);
  const trigger = nav.getByRole("button", { name: "所有功能" });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "所有功能", exact: true });
  await dialog.getByRole("searchbox").fill("整合");
  await expect(dialog.getByRole("link", { name: "整合設定中心" })).toHaveAttribute("href", `/merchant/integrations?organizationId=${org}`);
  await dialog.getByRole("searchbox").fill("no-function-xyz");
  await expect(dialog.getByRole("status")).toBeVisible();
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("Tab");
    expect(await dialog.evaluate(node => node.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await page.setViewportSize({ width: 360, height: 800 });
  await page.getByTestId("merchant-function-navigation-mobile").getByRole("button", { name: "所有功能" }).click();
  await dialog.getByRole("searchbox").fill("帳號");
  await dialog.getByRole("link", { name: "帳號與安全性" }).click();
  await page.waitForURL("**/merchant/account/security");
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test("staff filters survive reload, remain scoped and preserve source summaries", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await login(page, "店員", "/staff/aming-chicken");
  const actionText = page.getByTestId("staff-function-order-group").getByRole("button").first().locator("span");
  expect(await actionText.evaluate(element => element.getBoundingClientRect().width)).toBeLessThanOrEqual(1);
  await expect(page.getByTestId("staff-attendance")).toBeVisible();
  await expect(page.getByTestId("staff-tools-toggle")).toBeHidden();
  await expect(page.getByTestId("staff-push-controls")).toBeVisible();
  await expect(page.getByTestId("staff-attendance")).toBeVisible();
  const filters = page.getByTestId("staff-queue-filters");
  await filters.getByRole("button", { name: /待接單/ }).click();
  await page.getByRole("combobox", { name: "訂單來源", exact: true }).selectOption("STAFF_POS");
  await page.reload();
  await expect(filters.getByRole("button", { name: /待接單/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("combobox", { name: "訂單來源", exact: true })).toHaveValue("STAFF_POS");
  const stored = await page.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith("stallorder:queue:")).map(key => JSON.parse(sessionStorage.getItem(key)!)));
  expect(stored).toEqual([{ filter: "WAITING", source: "STAFF_POS", recentOnly: false }]);
  await filters.getByRole("button", { name: /^全部/ }).click();
  await page.getByRole("combobox", { name: "訂單來源", exact: true }).selectOption("ALL");
});

test("report export confirms actual scope and downloads a real CSV", async ({ page }) => {
  const dateFrom = "2026-09-01";
  const dateTo = "2026-09-23";
  await login(page, "商家", `/merchant/reports/overview?organizationId=${org}&dateFrom=${dateFrom}&dateTo=${dateTo}`);
  await page.getByRole("button", { name: "匯出 CSV", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "匯出 CSV", exact: true });
  await expect(dialog).toContainText(dateFrom);
  await expect(dialog).toContainText(dateTo);
  await dialog.getByRole("button", { name: "關閉", exact: true }).click();
  await page.getByRole("button", { name: "匯出 CSV", exact: true }).click();
  const responsePromise = page.waitForResponse(response => response.url().endsWith("/api/merchant/reports/export") && response.request().method() === "POST");
  const downloadPromise = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "匯出 CSV", exact: true }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  expect(response.request().postDataJSON()).toEqual({ organizationId: org, stallIds: ["22222222-2222-4222-8222-222222222222"], dateFrom, dateTo });
  const download = await downloadPromise;
  expect(await download.failure()).toBeNull();
  const csv = await readFile((await download.path())!, "utf8");
  expect(csv).toContain("營業日期");
  expect(csv).toContain("攤位代碼");
  expect(csv).not.toMatch(/trackingToken|sessionToken|<html/i);
  await expect(dialog).toHaveCount(0);
});

test("staff filtering still works when browser storage is unavailable", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new DOMException("Storage blocked", "SecurityError"); };
    Storage.prototype.setItem = () => { throw new DOMException("Storage blocked", "SecurityError"); };
    Storage.prototype.removeItem = () => { throw new DOMException("Storage blocked", "SecurityError"); };
  });
  await login(page, "店員", "/staff/aming-chicken");
  const waiting = page.getByTestId("staff-queue-filters").getByRole("button", { name: /待接單/ });
  await waiting.click();
  await expect(waiting).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("combobox", { name: "訂單來源", exact: true }).selectOption("LINE_DELIVERY");
  await expect(page.getByRole("combobox", { name: "訂單來源", exact: true })).toHaveValue("LINE_DELIVERY");
  const sound = page.getByTestId("staff-common-controls").getByRole("switch");
  await sound.click();
  await expect(sound).toHaveAttribute("aria-checked", "true");
  await sound.click();
  await expect(sound).toHaveAttribute("aria-checked", "false");
  expect(errors).toEqual([]);
});

test("admin sidebar and subscriptions: search authorized destinations and merchants", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, "平台管理者", "/admin/billing");
  await expect(page.getByRole("heading", { name: "待處理工作" })).toBeVisible();
  const nav = page.getByTestId("admin-function-sidebar");
  await nav.getByRole("searchbox").fill("訂閱");
  await nav.getByRole("link", { name: "訂閱", exact: true }).click();
  await page.waitForURL("**/admin/subscriptions");
  await page.getByRole("searchbox", { name: "搜尋商家名稱或編號" }).fill(org);
  await expect(page.getByRole("table").getByRole("row")).toHaveCount(2);
  await page.getByRole("searchbox", { name: "搜尋商家名稱或編號" }).fill("no-merchant-xyz");
  await expect(page.getByRole("table").getByRole("row")).toHaveCount(1);
  await page.getByRole("searchbox", { name: "搜尋商家名稱或編號" }).fill("");
  for (const width of [360, 768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
});

test("new management surfaces meet automated contrast and keyboard semantics in both themes", async ({ page }) => {
  test.setTimeout(180_000);
  for (const [role, url] of [
    ["平台管理者", "/admin/subscriptions"],
    ["商家", `/merchant/reports/overview?organizationId=${org}`],
    ["商家", `/merchant/catalog?organizationId=${org}`],
  ]) {
    await login(page, role, url);
    if (url.includes("reports/overview")) await page.getByTestId("report-definitions").getByText("資料範圍與計算方式").click();
    for (const theme of ["light", "dark"]) {
      await page.setViewportSize({ width: theme === "light" ? 390 : 1440, height: 900 });
      await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
      if (url.includes("catalog")) await page.getByTestId(theme === "light" ? "merchant-function-navigation-mobile" : "merchant-function-navigation-desktop").getByRole("button", { name: "所有功能" }).click();
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
      expect(results.violations.map(row => ({ id: row.id, nodes: row.nodes.map(node => node.target) }))).toEqual([]);
      if (url.includes("catalog")) await page.keyboard.press("Escape");
    }
  }
});
