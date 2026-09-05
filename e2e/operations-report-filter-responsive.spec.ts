import { expect, test, type Locator, type Page } from "@playwright/test";
import { gotoLocalPath, loginLocalTestAccount } from "./local-navigation";

const organizationId = "11111111-1111-4111-8111-111111111111";
const password = "StallOrderDemo!2026";

const viewports = [
  { name: "compact-mobile", width: 320, height: 568 },
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
] as const;

test.beforeEach(async ({ page }) => {
  await loginLocalTestAccount(page, "owner@stallorder.test", password);
});

test("稽核與營運警示在各裝置維持參考圖日期排列", async ({ page }) => {
  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await gotoLocalPath(page, `/merchant/operations?organizationId=${organizationId}`);

    const stall = page.getByTestId("operations-filter-stall");
    const status = page.getByTestId("operations-filter-alert-status");
    const severity = page.getByTestId("operations-filter-alert-severity");
    const dateFrom = page.getByTestId("operations-filter-date-from");
    const dateTo = page.getByTestId("operations-filter-date-to");
    const outcome = page.getByTestId("operations-filter-audit-outcome");
    const search = page.getByTestId("operations-filter-audit-query");
    const presets = page.getByTestId("operations-date-presets");
    const actions = page.getByTestId("operations-filter-actions");
    await expect(stall).toBeVisible();
    await expect(dateFrom).toBeVisible();
    await expect(dateTo).toBeVisible();
    await expect(page.getByRole("button", { name: "今天", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "本週", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "本月", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "昨天", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "自訂", exact: true })).toHaveCount(0);

    if (viewport.width < 768) {
      await expectSameRow(stall, dateFrom, `${viewport.name}: stall/start`);
      await expectSameRow(status, dateTo, `${viewport.name}: status/end`);
      await expectSameRow(severity, outcome, `${viewport.name}: severity/outcome`);
      await expectSameRow(presets, actions, `${viewport.name}: presets/actions`);
      expect((await box(search)).top).toBeLessThan((await box(presets)).top);
    } else {
      await expectSameRow(stall, status, `${viewport.name}: primary filters`);
      await expectSameRow(status, severity, `${viewport.name}: primary filters`);
      await expectSameRow(dateFrom, dateTo, `${viewport.name}: date range`);
      await expectSameRow(dateTo, outcome, `${viewport.name}: date/outcome`);
      await expectSameRow(search, presets, `${viewport.name}: search/presets`);
      expect((await box(actions)).top).toBeGreaterThan((await box(presets)).top);
    }

    const controls = await page.getByTestId("operations-filter-grid").locator("input, select, button").evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().height));
    expect(controls.every((height) => height >= 44), `${viewport.name}: 44px controls`).toBe(true);
    await expectDocumentFitsViewport(page, viewport.name);
  }
});

test("攤位報表與營業損益把動作緊接在自訂右側", async ({ page }) => {
  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await assertReportActionRow(
      page,
      `/merchant/reports/stalls?organizationId=${organizationId}`,
      viewport,
      true,
    );
    await assertReportActionRow(
      page,
      `/merchant/operating-profit?organizationId=${organizationId}`,
      viewport,
      false,
    );
  }
});

async function assertReportActionRow(
  page: Page,
  path: string,
  viewport: (typeof viewports)[number],
  expectsExport: boolean,
) {
  await gotoLocalPath(page, path);
  const row = page.getByTestId("report-date-action-row");
  const actions = page.getByTestId("report-filter-actions");
  const custom = row.getByRole("button", { name: "自訂", exact: true });
  const apply = actions.getByRole("button", { name: "套用篩選", exact: true });
  const applyLabel = apply.locator("span");
  await expect(row).toBeVisible();
  await expect(custom).toBeVisible();
  await expect(apply).toBeAttached();

  const metrics = await row.evaluate((element) => {
    const customButton = Array.from(element.querySelectorAll("button")).find((button) => button.textContent?.trim() === "自訂")!;
    const actionGroup = element.querySelector<HTMLElement>('[data-testid="report-filter-actions"]')!;
    const scrollRegion = element.parentElement!;
    return {
      customRight: customButton.offsetLeft + customButton.offsetWidth,
      customTop: customButton.offsetTop,
      actionsLeft: actionGroup.offsetLeft,
      actionsTop: actionGroup.offsetTop,
      actionsRight: actionGroup.offsetLeft + actionGroup.offsetWidth,
      scrollClientWidth: scrollRegion.clientWidth,
    };
  });
  expect(metrics.actionsLeft, `${viewport.name}: actions after custom`).toBeGreaterThanOrEqual(metrics.customRight);
  expect(metrics.actionsTop, `${viewport.name}: actions same row`).toBe(metrics.customTop);
  if (viewport.width >= 390) {
    expect(metrics.actionsRight, `${viewport.name}: actions visible without horizontal scrolling`).toBeLessThanOrEqual(metrics.scrollClientWidth + 1);
  }

  if (expectsExport) {
    const exportButton = actions.getByRole("button", { name: "匯出 CSV", exact: true });
    const exportLabel = exportButton.locator("span");
    await expect(exportButton).toBeAttached();
    await expectResponsiveLabel(exportLabel, viewport.width);
  } else {
    await expect(actions.getByRole("button", { name: "匯出 CSV", exact: true })).toHaveCount(0);
  }
  await expectResponsiveLabel(applyLabel, viewport.width);

  const actionSizes = await row.getByRole("button").evaluateAll((buttons) => buttons.map((button) => {
    const bounds = button.getBoundingClientRect();
    return { width: bounds.width, height: bounds.height };
  }));
  expect(actionSizes.every(({ width, height }) => width >= 44 && height >= 44), `${viewport.name}: report 44px controls`).toBe(true);
  await expectDocumentFitsViewport(page, `${viewport.name}: ${path}`);
}

async function expectResponsiveLabel(label: Locator, width: number) {
  const labelWidth = (await label.boundingBox())?.width ?? 0;
  if (width < 640) expect(labelWidth).toBeLessThanOrEqual(1);
  else expect(labelWidth).toBeGreaterThan(20);
}

async function box(locator: Locator) {
  return locator.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return { left: Math.round(bounds.left), top: Math.round(bounds.top) };
  });
}

async function expectSameRow(first: Locator, second: Locator, label: string) {
  expect((await box(first)).top, label).toBeCloseTo((await box(second)).top, 0);
}

async function expectDocumentFitsViewport(page: Page, label: string) {
  const layout = await page.evaluate(() => {
    const initialScrollX = window.scrollX;
    window.scrollTo(99_999, window.scrollY);
    const maxWindowScrollX = window.scrollX;
    window.scrollTo(initialScrollX, window.scrollY);
    return {
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    maxWindowScrollX,
    containers: [
      document.body,
      document.querySelector<HTMLElement>("#main-content"),
      document.querySelector<HTMLElement>('main[data-testid="report-stalls"]'),
      document.querySelector<HTMLElement>('main[data-testid="report-stalls"] form'),
      document.querySelector<HTMLElement>('[data-testid="report-date-action-row"]'),
      document.querySelector<HTMLElement>('[data-testid="merchant-workspace-header"]'),
      document.querySelector<HTMLElement>('[data-testid="merchant-workspace-header"] > div'),
      document.querySelector<HTMLElement>('[data-testid="merchant-utility-toolbar"]'),
      document.querySelector<HTMLElement>('[data-testid="pwa-controls"]'),
      document.querySelector<HTMLElement>("nextjs-portal"),
    ].filter((element): element is HTMLElement => Boolean(element)).map((element) => {
      const bounds = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        tag: element.tagName,
        testId: element.dataset.testid ?? element.id,
        left: Math.round(bounds.left),
        right: Math.round(bounds.right),
        width: Math.round(bounds.width),
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        minWidth: style.minWidth,
        overflowX: style.overflowX,
      };
    }),
    offenders: Array.from(document.querySelectorAll<HTMLElement>("body *"))
      .map((element) => {
        const bounds = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          tag: element.tagName,
          testId: element.dataset.testid ?? "",
          className: typeof element.className === "string" ? element.className : "",
          left: Math.round(bounds.left),
          right: Math.round(bounds.right),
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
          overflowX: style.overflowX,
        };
      })
      .filter((element) => element.scrollWidth > element.clientWidth + 1 && element.overflowX === "visible")
      .slice(0, 12),
    crossing: Array.from(document.querySelectorAll<HTMLElement>("body *"))
      .map((element) => {
        const bounds = element.getBoundingClientRect();
        return {
          tag: element.tagName,
          testId: element.dataset.testid ?? "",
          className: typeof element.className === "string" ? element.className : "",
          left: Math.round(bounds.left),
          right: Math.round(bounds.right),
          position: getComputedStyle(element).position,
          scrollParent: element.closest<HTMLElement>('[data-testid="report-date-action-row"]')?.dataset.testid ?? "",
        };
      })
      .filter((element) => element.left < -1 || element.right > document.documentElement.clientWidth + 1)
      .sort((left, right) => right.right - left.right)
      .slice(0, 24),
    rootOverflowX: getComputedStyle(document.documentElement).overflowX,
    bodyOverflowX: getComputedStyle(document.body).overflowX,
    scrollingElement: document.scrollingElement?.tagName ?? "",
  };
  });
  expect(layout.scrollWidth, `${label}: page overflow ${JSON.stringify(layout)}`).toBeLessThanOrEqual(layout.clientWidth + 1);
}
