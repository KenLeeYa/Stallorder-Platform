import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { loginLocalTestAccount } from "./local-navigation";

test.skip(process.env.UI_UX_QA !== "true", "Retained local QA only");

test("staff actions cannot accept input before hydration and work after loading", async ({ page }) => {
  if (process.env.PLAYWRIGHT_APP_URL !== "http://127.0.0.1:3023") throw new Error("LOCAL_TARGET_REQUIRED");
  await loginLocalTestAccount(page, "staff@stallorder.test", "StallOrderDemo!2026");
  let resumeHydration!: () => void;
  const hydrationGate = new Promise<void>(resolve => { resumeHydration = resolve; });
  await page.route("**/_next/static/**/*.js", async route => {
    await hydrationGate;
    await route.continue();
  });
  try {
    await page.goto("/staff/aming-chicken", { waitUntil: "commit" });
    const search = page.getByTestId("staff-search-open");
    await expect(search).toBeVisible();
    await search.evaluate(node => (node as HTMLElement).focus());
    await expect(search).not.toBeFocused();
  } finally {
    resumeHydration();
    await page.unrouteAll({ behavior: "wait" });
  }
  await page.getByTestId("staff-search-open").click();
  await expect(page.getByRole("dialog", { name: "搜尋桌號或訂單編號", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
});

test("staff toolbar follows desktop and phone workflow without duplicate details", async ({ page }) => {
  test.setTimeout(150_000);
  if (process.env.PLAYWRIGHT_APP_URL !== "http://127.0.0.1:3023") throw new Error("LOCAL_TARGET_REQUIRED");
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/login");
  await page.getByTestId("local-qa-login-grid").getByRole("button", { name: "商家", exact: true }).click();
  await expect(page).toHaveURL(/merchant\/dashboard/, { timeout: 60_000 });
  await page.goto("/staff/aming-chicken");
  await expect(page.getByRole("heading", { name: "阿明鹽酥雞", exact: true })).toBeVisible();
  const header = page.getByTestId("staff-sticky-header");
  for (const width of [1440, 1024, 768]) {
    await page.setViewportSize({ width, height: 1024 });
    await expect(page.getByTestId("staff-tools-toggle")).toBeHidden();
    await expect(page.getByTestId("staff-push-controls")).toBeVisible();
    await expect(page.getByTestId("staff-queue-toggle")).toBeHidden();
    const capacity = await page.getByTestId("staff-capacity-tool").boundingBox();
    const search = await page.getByTestId("staff-search-open").boundingBox();
    expect(search!.x).toBeGreaterThan(capacity!.x);
    expect(Math.abs(search!.y - capacity!.y)).toBeLessThan(5);
    const filters = await page.getByTestId("staff-queue-filters").boundingBox();
    const source = await page.getByTestId("staff-queue-source").boundingBox();
    expect(source!.x).toBeGreaterThan(filters!.x);
    expect(Math.abs(source!.y - filters!.y)).toBeLessThan(5);
    expect(filters!.height).toBeLessThan(65);
    const pager = await page.getByTestId("staff-queue-pagination").boundingBox();
    expect(pager!.x).toBeGreaterThan(source!.x);
    expect(Math.abs(pager!.y - source!.y)).toBeLessThan(5);
    const sourceLabel = page.getByTestId("staff-queue-source").locator("label > span");
    expect(await sourceLabel.evaluate(node => node.getBoundingClientRect().width)).toBeLessThanOrEqual(1);
    await expect(page.getByRole("combobox", { name: "訂單來源", exact: true })).toBeVisible();
    const lastFilter = page.getByTestId("staff-queue-filters").getByRole("button").last();
    await lastFilter.scrollIntoViewIfNeeded();
    await expect(lastFilter).toBeInViewport();
    await page.getByTestId("staff-queue-filters").evaluate(node => { node.scrollLeft = 0; });
    const logout = page.getByTestId("staff-function-logout").getByRole("button");
    await logout.scrollIntoViewIfNeeded();
    await expect(logout).toBeInViewport();
    await page.getByTestId("staff-function-grid").evaluate(node => { node.scrollLeft = 0; });
    await expect(page.getByTestId("staff-order-master-detail")).toBeVisible();
    await expect(page.getByTestId("staff-order-list-pane")).not.toContainText("訂單備註");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`staff-${width}.png`), fullPage: true });
  }
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.getByTestId("staff-tools-toggle")).toBeVisible();
    await expect(header.getByTestId("theme-toggle")).toBeHidden();
    await expect(header.getByTestId("work-mode-icon-staff")).toBeVisible();
    await expect(page.getByRole("heading", { name: "今日製作／逾期", exact: true })).toHaveCount(0);
    await expect(page.getByTestId("staff-queue-filters")).toBeHidden();
    await expect(page.getByTestId("staff-queue-source")).toBeHidden();
    await page.getByTestId("staff-queue-toggle").click();
    await expect(page.getByTestId("staff-queue-filters")).toBeVisible();
    await page.getByTestId("staff-queue-filters").getByRole("button", { name: /^待接單/ }).click();
    await page.getByTestId("staff-queue-toggle").click();
    await expect(page.getByTestId("staff-queue-toggle")).toContainText("待接單");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`staff-${width}.png`), fullPage: true });
  }
  await page.getByTestId("staff-tools-toggle").click();
  await expect(header.getByTestId("theme-toggle")).toBeVisible();
  await header.getByTestId("theme-toggle").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await header.getByTestId("accessibility-mode-toggle").click();
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const common = page.getByTestId("staff-common-controls");
    const roleControl = header.getByTestId("work-mode-icon-staff").locator("..");
    await roleControl.scrollIntoViewIfNeeded();
    await page.screenshot({ path: test.info().outputPath(`staff-senior-${width}.png`), fullPage: true });
    const roleBox = await roleControl.boundingBox();
    const titleBox = await page.getByRole("heading", { name: "阿明鹽酥雞", exact: true }).boundingBox();
    expect(roleBox!.x).toBeGreaterThanOrEqual(0);
    expect(roleBox!.width).toBeGreaterThanOrEqual(56);
    expect(roleBox!.y).toBeGreaterThanOrEqual(titleBox!.y + titleBox!.height);
    await common.getByRole("status").scrollIntoViewIfNeeded();
    await expect(common.getByRole("status")).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
  await header.getByTestId("accessibility-mode-toggle").click();
  const accessibility = await new AxeBuilder({ page }).include('[data-testid="staff-sticky-header"]').withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(accessibility.violations.map(row => ({ id: row.id, nodes: row.nodes.map(node => node.target) }))).toEqual([]);
  await page.getByTestId("staff-tools-toggle").click();
  await header.getByTestId("work-mode-icon-staff").locator("..").click();
  const modeDialog = page.getByRole("dialog");
  await expect(modeDialog).toBeVisible();
  await modeDialog.getByRole("button", { name: "商家管理 · StallOrder 示範商戶", exact: true }).click();
  await expect(page).toHaveURL(/merchant\//);
  expect(errors).toEqual([]);
});
