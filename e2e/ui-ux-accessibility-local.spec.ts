import { writeFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.skip(process.env.UI_UX_QA !== "true", "Explicit local accessibility QA only.");
const catalog = "/merchant/catalog?organizationId=11111111-1111-4111-8111-111111111111";

test("WCAG 2.2 AA: real staff, catalog, dashboard, admin and menu", async ({ page }) => {
  test.setTimeout(180_000);
  expect(new URL(process.env.PLAYWRIGHT_APP_URL!).hostname).toBe("127.0.0.1");
  const failures: unknown[] = [];
  for (const [role, url] of [
    ["店員", "/staff/aming-chicken"], ["商家", catalog],
    ["商家", "/merchant/dashboard?organizationId=11111111-1111-4111-8111-111111111111"],
    ["平台管理者", "/admin/billing"], ["", "/store/aming-01?view=menu"],
  ]) {
    if (role) {
      await page.goto("/login?next=" + encodeURIComponent(url));
      await page.getByTestId("local-qa-login-grid").getByRole("button", { name: role, exact: true }).click();
      await page.waitForURL((next) => next.pathname === url.split("?")[0]);
    } else await page.goto(url);
    if (url === "/admin/billing") {
      const settings = page.getByTestId("admin-system-settings");
      await expect(settings).not.toHaveAttribute("open");
      await settings.getByText("系統設定", { exact: true }).click();
      await expect(settings).toHaveAttribute("open", "");
    }
    for (const [width, dark] of [[390, false], [1280, true]] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate((darkMode) => { document.documentElement.dataset.theme = darkMode ? "dark" : "light"; }, dark);
      await page.evaluate(async () => { await Promise.all(document.getAnimations().filter((animation) => animation instanceof CSSTransition && animation.playState === "running").map((animation) => animation.finished.catch(() => {}))); });
      const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
      failures.push(...result.violations.map((violation) => ({ url, width, dark, id: violation.id, impact: violation.impact, nodes: violation.nodes.map((node) => ({ target: node.target, summary: node.failureSummary })) })));
    }
  }
  await writeFile(test.info().outputPath("axe-results.json"), JSON.stringify(failures, null, 2));
  await test.info().attach("axe-results", { body: JSON.stringify(failures, null, 2), contentType: "application/json" });
  expect(failures).toEqual([]);
});

test("availability uses six languages and modal keyboard focus stays inside", async ({ page, context }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/login?next=" + encodeURIComponent(catalog));
  await page.getByTestId("local-qa-login-grid").getByRole("button", { name: "商家", exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/merchant/catalog");
  for (const [locale, title] of [["zh-TW", "設定供應狀態"], ["en", "Set availability"], ["ja", "提供状況の設定"], ["ko", "판매 상태 설정"], ["vi", "Đặt trạng thái bán"], ["th", "ตั้งค่าสถานะการขาย"]]) {
    await context.addCookies([{ name: "stallorder_locale", value: locale, url: process.env.PLAYWRIGHT_APP_URL! }]);
    await page.reload();
    const trigger = page.getByTestId("catalog-management-row").getByRole("button", { name: new RegExp(locale === "ja" ? "提供状況を設定" : title, "i") }).first();
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: title, exact: true });
    await expect(dialog).toBeVisible();
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press("Tab");
      expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    }
    const result = await new AxeBuilder({ page }).include('dialog[open]').withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(result.violations).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  }
});
