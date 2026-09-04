import { expect, test, type Page } from "@playwright/test";
import { dismissStaffStartReminder, gotoLocalPath } from "./local-navigation";

const organizationId = "11111111-1111-4111-8111-111111111111";
const viewports = [
  { name: "compact-mobile", width: 320, height: 568 },
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
];

async function loginAsOwner(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "使用電子郵件與密碼登入", exact: true }).click();
  await page.getByLabel("電子郵件").fill("owner@stallorder.test");
  await page.getByLabel("密碼").fill("StallOrderDemo!2026");
  await page.getByRole("button", { name: "登入", exact: true }).click();
  await expect(page).toHaveURL(/\/merchant\/dashboard\?organizationId=/, { timeout: 30_000 });
}

async function loginAsPlatformAdmin(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "使用電子郵件與密碼登入", exact: true }).click();
  await page.getByLabel("電子郵件").fill("platform.admin@stallorder.test");
  await page.getByLabel("密碼").fill("StallOrderDemo!2026");
  await page.getByRole("button", { name: "登入", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/billing/u, { timeout: 30_000 });
}

test("單一啟用攤位從頁首直接進入 QR 管理", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAsOwner(page);
  await gotoLocalPath(page, `/merchant/dashboard?organizationId=${organizationId}`);

  const directLink = page.getByTestId("merchant-single-stall-link");
  await expect(directLink).toBeVisible();
  await expect(directLink).toHaveAttribute("href", "/merchant/aming-chicken");
  await expect(page.getByRole("button", { name: /^選擇攤位/u })).toHaveCount(0);

  await directLink.click();
  await expect(page).toHaveURL(/\/merchant\/aming-chicken$/u);
  await expect(page.getByRole("heading", { name: "阿明鹽酥雞", exact: true })).toBeVisible();
});

test("QR 管理在手機維持單欄、平板左右滿版且 QR 不隨桌面無限放大", async ({ page }) => {
  await loginAsOwner(page);

  for (const viewport of [
    { name: "mobile", width: 390, height: 844 },
    { name: "tablet", width: 768, height: 1024 },
    { name: "scaled-desktop", width: 1180, height: 800 },
    { name: "desktop", width: 1440, height: 900 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await gotoLocalPath(page, "/merchant/aming-chicken");

    const qrShell = page.getByTestId("merchant-ordering-qr");
    const qrCode = page.getByTestId("merchant-ordering-qr-code");
    await expect(qrCode, `${viewport.name} QR`).toBeVisible();
    const layout = await qrShell.evaluate((shell, viewportWidth) => {
      const shellBox = shell.getBoundingClientRect();
      const qr = shell.querySelector<SVGElement>('[data-testid="merchant-ordering-qr-code"]');
      const qrBox = qr?.getBoundingClientRect();
      const actions = document.querySelector<HTMLElement>('[data-testid="merchant-ordering-actions"]');
      const actionsBox = actions?.getBoundingClientRect();
      return {
        shell: { left: shellBox.left, right: shellBox.right, width: shellBox.width },
        qr: qrBox ? { width: qrBox.width, height: qrBox.height } : null,
        actions: actionsBox ? { left: actionsBox.left, top: actionsBox.top } : null,
        shellTop: shellBox.top,
        sideBySide: viewportWidth >= 768 && viewportWidth < 1280,
        pageClientWidth: document.documentElement.clientWidth,
        pageScrollWidth: document.documentElement.scrollWidth,
      };
    }, viewport.width);

    if (layout.sideBySide) {
      expect(layout.actions, `${viewport.name} action column`).not.toBeNull();
      expect(layout.shell.right, `${viewport.name} QR precedes actions`).toBeLessThanOrEqual(layout.actions!.left);
      expect(layout.shellTop, `${viewport.name} aligned columns`).toBeCloseTo(layout.actions!.top, 0);
    } else {
      expect(layout.shell.width, `${viewport.name} QR shell width`).toBeLessThanOrEqual(384.5);
    }
    expect(layout.shell.left, `${viewport.name} QR left boundary`).toBeGreaterThanOrEqual(0);
    expect(layout.shell.right, `${viewport.name} QR right boundary`).toBeLessThanOrEqual(layout.pageClientWidth + 1);
    expect(layout.qr, `${viewport.name} QR box`).not.toBeNull();
    expect(layout.qr!.width, `${viewport.name} rendered QR width`).toBeLessThanOrEqual(352.5);
    expect(layout.qr!.width, `${viewport.name} square QR`).toBeCloseTo(layout.qr!.height, 0);
    expect(layout.pageScrollWidth, `${viewport.name} page overflow`).toBeLessThanOrEqual(layout.pageClientWidth + 1);
  }
});

test("工作模式與攤位遮罩在各尺寸保持置中、橫向文字與完整寬度", async ({ page }) => {
  test.setTimeout(120_000);
  await loginAsOwner(page);

  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await gotoLocalPath(page, `/merchant/dashboard?organizationId=${organizationId}`);

    const trigger = page.getByTestId("merchant-utility-toolbar").locator('button[aria-haspopup="dialog"]').first();
    await expect(trigger, `${viewport.name} should expose the compact switcher`).toBeVisible();
    await trigger.click();

    const dialog = page.getByTestId("compact-switcher-dialog");
    const options = page.getByTestId("compact-switcher-option");
    await expect(dialog).toBeVisible();
    await expect(options.first()).toBeVisible();

    const layout = await dialog.evaluate((element) => {
      const dialogBox = element.getBoundingClientRect();
      const optionBoxes = Array.from(element.querySelectorAll<HTMLElement>('[data-testid="compact-switcher-option"]')).map((option) => {
        const box = option.getBoundingClientRect();
        const label = option.querySelector<HTMLElement>("span");
        return {
          width: box.width,
          height: box.height,
          labelWidth: label?.getBoundingClientRect().width ?? 0,
          writingMode: label ? getComputedStyle(label).writingMode : "",
        };
      });
      return {
        dialog: { x: dialogBox.x, y: dialogBox.y, width: dialogBox.width, height: dialogBox.height },
        optionBoxes,
        pageClientWidth: document.documentElement.clientWidth,
        pageScrollWidth: document.documentElement.scrollWidth,
      };
    });

    expect(Math.abs(layout.dialog.x + layout.dialog.width / 2 - viewport.width / 2), `${viewport.name} dialog x center`).toBeLessThanOrEqual(2);
    expect(Math.abs(layout.dialog.y + layout.dialog.height / 2 - viewport.height / 2), `${viewport.name} dialog y center`).toBeLessThanOrEqual(2);
    expect(layout.optionBoxes.length).toBeGreaterThan(0);
    expect(layout.optionBoxes.every((option) => option.width >= layout.dialog.width * 0.75), `${viewport.name} full-width options: ${JSON.stringify(layout)}`).toBe(true);
    expect(layout.optionBoxes.every((option) => option.labelWidth >= 160), `${viewport.name} readable labels: ${JSON.stringify(layout)}`).toBe(true);
    expect(layout.optionBoxes.every((option) => option.height <= 72 && option.writingMode === "horizontal-tb"), `${viewport.name} horizontal labels: ${JSON.stringify(layout)}`).toBe(true);
    expect(layout.pageScrollWidth).toBeLessThanOrEqual(layout.pageClientWidth + 1);

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  }
});

test("廚房只保留一組共用工具並使用不同工作模式人像", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAsOwner(page);

  await expect(page.getByTestId("work-mode-icon-merchant")).toHaveCount(1);
  await gotoLocalPath(page, "/staff/aming-chicken");
  await dismissStaffStartReminder(page);
  await expect(page.getByTestId("work-mode-icon-staff")).toHaveCount(1);

  await gotoLocalPath(page, "/kitchen?stall=aming-chicken");
  await expect(page.getByTestId("work-mode-icon-kitchen")).toHaveCount(1);
  await expect(page.getByTestId("pwa-controls")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "登出", exact: true })).toHaveCount(1);
  await expect(page.getByTestId("kitchen-primary-navigation")).toBeVisible();
  await expect(page.getByTestId("kitchen-board-utility-toolbar")).toHaveCount(0);
  await expect(page.getByTestId("kitchen-primary-navigation").getByRole("link")).toHaveCount(3);

  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await gotoLocalPath(page, "/kitchen?stall=aming-chicken");

    const visibleToolbars = page.locator('[data-testid="kitchen-toolbar-row"]:visible');
    await expect(visibleToolbars, `${viewport.name} visible kitchen toolbar`).toHaveCount(1);
    const headerLayout = await visibleToolbars.last().evaluate((toolbar) => {
      const header = toolbar.closest("header");
      const box = (testId: string) => toolbar.querySelector<HTMLElement>(`[data-testid="${testId}"]`)?.getBoundingClientRect();
      const headerBox = header?.getBoundingClientRect();
      const orders = box("kitchen-mode-order");
      const items = box("kitchen-mode-item");
      const workstation = box("kitchen-mode-station");
      const kitchenSwitch = box("kitchen-work-mode-control");
      const languageBox = toolbar.querySelector<HTMLElement>('[data-testid="kitchen-language-control"] label')?.getBoundingClientRect();
      const theme = box("theme-toggle");
      const network = box("pwa-network-status");
      const wake = box("pwa-wake-control");
      const live = box("kitchen-live-status");
      const stations = box("kitchen-nav-stations");
      const settings = box("kitchen-nav-settings");
      const alert = box("kitchen-alert-control");
      const refresh = box("kitchen-refresh-control");
      const logout = box("kitchen-logout-control");
      return {
        headerHeight: headerBox?.height ?? -1,
        orders: orders ? { left: orders.left, top: orders.top, width: orders.width, height: orders.height } : null,
        items: items ? { left: items.left, top: items.top } : null,
        workstation: workstation ? { left: workstation.left, top: workstation.top } : null,
        kitchenSwitch: kitchenSwitch ? { left: kitchenSwitch.left, top: kitchenSwitch.top } : null,
        stations: stations ? { left: stations.left, right: stations.right, top: stations.top } : null,
        language: languageBox ? { left: languageBox.left, top: languageBox.top, width: languageBox.width, height: languageBox.height } : null,
        theme: theme ? { left: theme.left, top: theme.top } : null,
        network: network ? { left: network.left, top: network.top } : null,
        wake: wake ? { left: wake.left, top: wake.top } : null,
        live: live ? { left: live.left, top: live.top } : null,
        settings: settings ? { left: settings.left, top: settings.top } : null,
        alert: alert ? { left: alert.left, top: alert.top } : null,
        refresh: refresh ? { left: refresh.left, right: refresh.right, top: refresh.top } : null,
        logout: logout ? { left: logout.left, right: logout.right, top: logout.top, height: logout.height } : null,
        pageClientWidth: document.documentElement.clientWidth,
        pageScrollWidth: document.documentElement.scrollWidth,
      };
    });

    expect(headerLayout.headerHeight, `${viewport.name} header height`).toBeLessThanOrEqual(64);
    expect(headerLayout.orders, `${viewport.name} orders`).not.toBeNull();
    expect(headerLayout.items, `${viewport.name} items`).not.toBeNull();
    expect(headerLayout.workstation, `${viewport.name} workstation`).not.toBeNull();
    expect(headerLayout.kitchenSwitch, `${viewport.name} kitchen switch`).not.toBeNull();
    expect(headerLayout.stations, `${viewport.name} stations`).not.toBeNull();
    expect(headerLayout.language, `${viewport.name} language`).not.toBeNull();
    expect(headerLayout.theme, `${viewport.name} theme`).not.toBeNull();
    expect(headerLayout.network, `${viewport.name} network`).not.toBeNull();
    expect(headerLayout.wake, `${viewport.name} wake lock`).not.toBeNull();
    expect(headerLayout.live, `${viewport.name} SSE`).not.toBeNull();
    expect(headerLayout.settings, `${viewport.name} settings`).not.toBeNull();
    expect(headerLayout.alert, `${viewport.name} sound`).not.toBeNull();
    expect(headerLayout.refresh, `${viewport.name} refresh`).not.toBeNull();
    expect(headerLayout.logout, `${viewport.name} logout`).not.toBeNull();
    for (const control of [headerLayout.items, headerLayout.workstation, headerLayout.kitchenSwitch, headerLayout.language, headerLayout.theme, headerLayout.network, headerLayout.wake, headerLayout.live, headerLayout.stations, headerLayout.settings, headerLayout.alert, headerLayout.refresh, headerLayout.logout]) {
      expect(Math.abs(headerLayout.orders!.top - control!.top), `${viewport.name} one toolbar row`).toBeLessThanOrEqual(1);
    }
    expect(headerLayout.orders!.left, `${viewport.name} orders first`).toBeLessThan(headerLayout.items!.left);
    expect(headerLayout.items!.left, `${viewport.name} items before workstation`).toBeLessThan(headerLayout.workstation!.left);
    expect(headerLayout.workstation!.left, `${viewport.name} workstation before kitchen switch`).toBeLessThan(headerLayout.kitchenSwitch!.left);
    expect(headerLayout.kitchenSwitch!.left, `${viewport.name} kitchen switch before language`).toBeLessThan(headerLayout.language!.left);
    expect(headerLayout.language!.left, `${viewport.name} language before theme`).toBeLessThan(headerLayout.theme!.left);
    expect(headerLayout.theme!.left, `${viewport.name} theme before network`).toBeLessThan(headerLayout.network!.left);
    expect(headerLayout.network!.left, `${viewport.name} network before wake lock`).toBeLessThan(headerLayout.wake!.left);
    expect(headerLayout.wake!.left, `${viewport.name} wake lock before SSE`).toBeLessThan(headerLayout.live!.left);
    expect(headerLayout.live!.left, `${viewport.name} SSE before station settings`).toBeLessThan(headerLayout.stations!.left);
    expect(headerLayout.stations!.left, `${viewport.name} station settings before KDS settings`).toBeLessThan(headerLayout.settings!.left);
    expect(headerLayout.settings!.left, `${viewport.name} KDS settings before sound`).toBeLessThan(headerLayout.alert!.left);
    expect(headerLayout.alert!.left, `${viewport.name} sound before refresh`).toBeLessThan(headerLayout.refresh!.left);
    expect(headerLayout.refresh!.left, `${viewport.name} refresh before logout`).toBeLessThan(headerLayout.logout!.left);
    expect(headerLayout.logout!.left - headerLayout.refresh!.right, `${viewport.name} logout follows refresh`).toBeGreaterThanOrEqual(0);
    expect(headerLayout.logout!.left - headerLayout.refresh!.right, `${viewport.name} logout follows refresh`).toBeLessThanOrEqual(8);
    expect(headerLayout.language!.width, `${viewport.name} language width`).toBeCloseTo(headerLayout.orders!.width, 0);
    expect(headerLayout.language!.height, `${viewport.name} language height`).toBeCloseTo(headerLayout.orders!.height, 0);
    expect(headerLayout.pageScrollWidth, `${viewport.name} page overflow`).toBeLessThanOrEqual(headerLayout.pageClientWidth + 1);
  }

  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  await expect(page.locator("header").first()).toHaveCSS("background-color", "rgb(28, 25, 23)");
  const kitchenOverflow = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    offenders: Array.from(document.querySelectorAll<HTMLElement>("body *"))
      .map((element) => {
        const box = element.getBoundingClientRect();
        return {
          tag: element.tagName,
          testId: element.dataset.testid ?? "",
          className: typeof element.className === "string" ? element.className : "",
          left: Math.round(box.left),
          right: Math.round(box.right),
          width: Math.round(box.width),
        };
      })
      .filter((box) => box.left < -1 || box.right > document.documentElement.clientWidth + 1)
      .slice(0, 10),
  }));
  expect(
    kitchenOverflow.scrollWidth,
    JSON.stringify(kitchenOverflow),
  ).toBeLessThanOrEqual(kitchenOverflow.clientWidth + 1);
});

test("報表導覽在手機僅顯示圖示，平板恢復文字", async ({ page }) => {
  await loginAsOwner(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await gotoLocalPath(page, `/merchant/reports/stalls?organizationId=${organizationId}`);
  const reportMain = page.locator("#main-content");
  await expect(reportMain).toHaveCount(1);
  const navigation = reportMain.getByTestId("report-navigation");
  await expect(navigation).toHaveCount(1);
  await expect(navigation).toBeVisible();
  await expect(navigation.getByRole("link")).toHaveCount(6);
  expect(await navigation.getByRole("link").evaluateAll((links) => new Set(
    links.map((link) => Math.round(link.getBoundingClientRect().top)),
  ).size)).toBe(1);
  const mobileLabel = navigation.getByRole("link", { name: "攤位比較", exact: true }).locator("span");
  expect((await mobileLabel.boundingBox())?.width).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);

  await page.setViewportSize({ width: 768, height: 1024 });
  await expect(mobileLabel).toBeVisible();
  expect((await mobileLabel.boundingBox())?.width).toBeGreaterThan(20);
  expect(await navigation.getByRole("link").evaluateAll((links) => new Set(
    links.map((link) => Math.round(link.getBoundingClientRect().top)),
  ).size)).toBe(1);
});

test("平台帳務總覽使用與銷售趨勢一致的獨立 Dashboard 卡片", async ({ page }) => {
  await loginAsPlatformAdmin(page);

  for (const viewport of [
    { width: 320, height: 800, columns: 2 },
    { width: 390, height: 844, columns: 2 },
    { width: 768, height: 1024, columns: 4 },
    { width: 1440, height: 900, columns: 5 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/admin/billing");
    const dashboard = page.getByTestId("admin-billing-dashboard");
    const cards = dashboard.locator(":scope > div");
    await expect(cards.first()).toBeVisible();

    const layout = await dashboard.evaluate((element) => {
      const style = getComputedStyle(element);
      const firstCard = element.firstElementChild as HTMLElement | null;
      const cardStyle = firstCard ? getComputedStyle(firstCard) : null;
      return {
        columns: style.gridTemplateColumns.split(" ").length,
        columnGap: Number.parseFloat(style.columnGap),
        rowGap: Number.parseFloat(style.rowGap),
        cardRadius: Number.parseFloat(cardStyle?.borderRadius ?? "0"),
        cardShadow: cardStyle?.boxShadow ?? "none",
        pageWidth: document.documentElement.clientWidth,
        pageScrollWidth: document.documentElement.scrollWidth,
      };
    });

    expect(layout.columns).toBe(viewport.columns);
    expect(layout.columnGap).toBeGreaterThanOrEqual(8);
    expect(layout.rowGap).toBeGreaterThanOrEqual(8);
    expect(layout.cardRadius).toBeGreaterThan(0);
    expect(layout.cardShadow).not.toBe("none");
    expect(layout.pageScrollWidth).toBeLessThanOrEqual(layout.pageWidth + 1);
  }
});
