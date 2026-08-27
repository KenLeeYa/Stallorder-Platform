import { expect, test, type Locator, type Page } from "@playwright/test";
import { waitForDefaultMerchantDashboard } from "./local-navigation";

const organizationId = "11111111-1111-4111-8111-111111111111";

const viewportCases = [
  { width: 320, height: 800, hourlyColumns: 4, summaryColumns: 2, productColumns: 2, paymentColumns: 2, stallColumns: 2 },
  { width: 390, height: 844, hourlyColumns: 6, summaryColumns: 2, productColumns: 3, paymentColumns: 2, stallColumns: 3 },
  { width: 768, height: 1024, hourlyColumns: 8, summaryColumns: 4, productColumns: 4, paymentColumns: 3, stallColumns: 4 },
] as const;

test("報表會依手機與平板寬度呈現緊密 Dashboard", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);

  for (const viewport of viewportCases) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto(`/merchant/reports/overview?organizationId=${organizationId}`);

    const mainContent = page.locator("#main-content");
    const overview = mainContent.getByTestId("report-overview");
    const summary = mainContent.getByTestId("sales-summary-dashboard");
    const hourly = mainContent.getByTestId("hourly-sales-dashboard");
    const hourlyCells = mainContent.getByTestId("hourly-sales-cell");

    await expect(mainContent.getByRole("heading", { name: "銷售趨勢總覽", exact: true })).toBeVisible();
    await expect(summary.locator("dt")).toHaveCount(4);
    await expect(hourlyCells).toHaveCount(24);
    await expect(hourly.getByText("00:00", { exact: true })).toBeVisible();
    await expect(hourly.getByText("23:00", { exact: true })).toBeVisible();

    const dateInputWidths = await mainContent.locator('input[type="date"]').evaluateAll((inputs) => inputs.map((input) => input.getBoundingClientRect().width));
    expect(dateInputWidths.every((width) => width >= 150)).toBe(true);

    expect(await countGridColumns(summary.locator(":scope > div"))).toBe(viewport.summaryColumns);
    expect(await countGridColumns(hourlyCells)).toBe(viewport.hourlyColumns);

    await expectNoHorizontalOverflow(overview);

    const hourlyValues = await mainContent.getByTestId("hourly-sales-value").evaluateAll((elements) => elements.map((element) => {
      const styles = window.getComputedStyle(element);
      return {
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        textOverflow: styles.textOverflow,
        whiteSpace: styles.whiteSpace,
      };
    }));
    expect(hourlyValues.every((value) => value.scrollWidth <= value.clientWidth + 1)).toBe(true);
    expect(hourlyValues.every((value) => value.textOverflow !== "ellipsis" && value.whiteSpace === "normal")).toBe(true);

    if (viewport.width === 390) {
      const firstStallCheckbox = mainContent.locator('form input[name="stallId"]').first();
      const removedStallId = await firstStallCheckbox.getAttribute("value");
      await expect(firstStallCheckbox).toBeChecked();
      await firstStallCheckbox.uncheck();
      await mainContent.getByLabel("開始日期").fill("2026-01-01");

      const exportCapture: { payload?: { stallIds: string[]; dateFrom: string } } = {};
      await page.route("**/api/merchant/reports/export", async (route) => {
        exportCapture.payload = route.request().postDataJSON() as typeof exportCapture.payload;
        await route.fulfill({
          status: 200,
          contentType: "text/csv; charset=utf-8",
          headers: { "content-disposition": 'attachment; filename="report.csv"' },
          body: "order_no,total\n",
        });
      });
      await mainContent.getByRole("button", { name: "匯出 CSV", exact: true }).click();
      await expect.poll(() => exportCapture.payload).toBeDefined();

      const appliedFilter = await firstStallCheckbox.locator("xpath=ancestor::form").evaluate((form) => ({
        stallIds: new FormData(form as HTMLFormElement).getAll("stallId"),
        dateFrom: new FormData(form as HTMLFormElement).get("dateFrom"),
      }));
      expect(exportCapture.payload).toMatchObject(appliedFilter);
      expect(exportCapture.payload?.stallIds).not.toContain(removedStallId);
      await page.unroute("**/api/merchant/reports/export");
    }

    await page.goto(`/merchant/reports/products?organizationId=${organizationId}`);
    const products = mainContent.getByTestId("report-products");
    const productHours = mainContent.getByTestId("product-hourly-dashboard");
    await expect(mainContent.getByRole("heading", { name: "商品與時段分析", exact: true })).toBeVisible();
    await expect(productHours).toBeVisible();
    expect(await countComputedGridColumns(productHours)).toBe(viewport.productColumns);
    await expectNoHorizontalOverflow(products);

    await page.goto(`/merchant/reports/payments?organizationId=${organizationId}`);
    const payments = mainContent.getByTestId("report-payments");
    const paymentSummary = mainContent.getByTestId("payment-summary-dashboard");
    const stallPayments = mainContent.getByTestId("stall-payment-dashboard");
    await expect(mainContent.getByRole("heading", { name: "付款分析", exact: true })).toBeVisible();
    await expect(paymentSummary).toHaveCount(1);
    await expect(stallPayments).toHaveCount(1);
    await expect(paymentSummary.locator("dt")).not.toHaveCount(0);
    expect(await countComputedGridColumns(paymentSummary)).toBe(viewport.paymentColumns);
    await expect(stallPayments.locator("article").first()).toBeVisible();
    await expectNoHorizontalOverflow(payments);

    await page.goto(`/merchant/reports/stalls?organizationId=${organizationId}`);
    const stalls = mainContent.getByTestId("report-stalls");
    const stallDashboard = mainContent.getByTestId("stall-performance-dashboard");
    const firstStallCard = mainContent.getByTestId("stall-performance-card").first();
    await expect(mainContent.getByRole("heading", { name: "攤位績效比較", exact: true })).toBeVisible();
    await expect(stallDashboard).toHaveCount(1);
    await expect(mainContent.getByTestId("stall-performance-table")).toBeHidden();
    await expect(firstStallCard).toBeVisible();
    await expect(firstStallCard.locator("dt")).toHaveCount(7);
    expect(await countComputedGridColumns(firstStallCard.locator("dl"))).toBe(viewport.stallColumns);
    await expectNoHorizontalOverflow(stallDashboard);
    await expectNoHorizontalOverflow(stalls);
  }
});

async function login(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "使用電子郵件與密碼登入", exact: true }).click();
  await page.getByLabel("電子郵件").fill("owner@stallorder.test");
  await page.getByLabel("密碼").fill("StallOrderDemo!2026");
  const response = page.waitForResponse((candidate) => (
    candidate.url().endsWith("/api/auth/login") && candidate.request().method() === "POST"
  ));
  await page.getByRole("button", { name: "登入", exact: true }).click();
  expect((await response).status()).toBe(200);
  await waitForDefaultMerchantDashboard(page, organizationId);
}

async function countGridColumns(locator: Locator) {
  return locator.evaluateAll((elements) => new Set(
    elements.map((element) => Math.round(element.getBoundingClientRect().left)),
  ).size);
}

async function countComputedGridColumns(locator: Locator) {
  return locator.evaluate((element) => window.getComputedStyle(element).gridTemplateColumns.split(" ").length);
}

async function expectNoHorizontalOverflow(locator: Locator) {
  const layout = await locator.evaluate((element) => ({
    viewportWidth: document.documentElement.clientWidth,
    documentWidth: document.documentElement.scrollWidth,
    elementWidth: element.clientWidth,
    elementScrollWidth: element.scrollWidth,
  }));
  expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth + 1);
  expect(layout.elementScrollWidth).toBeLessThanOrEqual(layout.elementWidth + 1);
}
