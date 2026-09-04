import { expect, test } from "@playwright/test";

const quickLoginDestinations = [
  ["商家", /\/merchant\/dashboard\?organizationId=/],
  ["店員", /\/staff\/aming-chicken/],
  ["廚房", /\/kitchen\?stall=aming-chicken/],
  ["平台管理者", /\/admin\/billing$/],
] as const;

test.skip(
  process.env.LOCAL_QA_READINESS !== "true",
  "Only the explicit local QA readiness command may exercise development quick login.",
);

for (const [role, destination] of quickLoginDestinations) {
  test(`本機快速登入：${role}`, async ({ page }) => {
    await page.goto("/login");
    const grid = page.getByTestId("local-qa-login-grid");
    await expect(grid).toBeVisible();

    const responsePromise = page.waitForResponse((response) => (
      response.url().endsWith("/api/auth/login")
      && response.request().method() === "POST"
    ));
    await grid.getByRole("button", { name: role, exact: true }).click();

    expect((await responsePromise).status()).toBe(200);
    await expect(page).toHaveURL(destination);
  });
}

test("本機公開 Menu、QR、外帶自取與現金交班可實際操作", async ({ page }) => {
  test.setTimeout(180_000);
  const menuResponse = await page.goto("/store/aming-01?view=menu");
  expect(menuResponse?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "發生錯誤", exact: true })).toHaveCount(0);

  for (const path of [
    "/q/demo-aming-chicken-qr-2026-rotate-me",
    "/store/aming-01?view=pickup",
  ]) {
    const sessionResponse = page.waitForResponse((response) => (
      response.request().method() === "POST"
      && ["/create-order-session", "/api/public/order-session"].some((suffix) => (
        new URL(response.url()).pathname.endsWith(suffix)
      ))
    ));
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    expect((await sessionResponse).status()).toBeLessThan(300);
    await expect(page.getByRole("heading", { name: "發生錯誤", exact: true })).toHaveCount(0);
    await expect(page.getByText("線上送單暫時停用", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "送出訂單", exact: true })).toBeVisible();
  }

  await page.goto("/login");
  await page.getByTestId("local-qa-login-grid").getByRole("button", { name: "店員", exact: true }).click();
  await expect(page).toHaveURL(/\/staff\/aming-chicken/);
  const cashResponse = await page.goto("/staff/aming-chicken/cash");
  expect(cashResponse?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "發生錯誤", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "現金交班與對帳", exact: true })).toBeVisible();
});

test("本機 QR 印刷按鈕會開啟瀏覽器列印／另存 PDF", async ({ page }) => {
  await page.addInitScript(() => {
    window.print = () => {
      const count = Number(window.sessionStorage.getItem("qa-print-count") ?? "0") + 1;
      window.sessionStorage.setItem("qa-print-count", String(count));
      document.documentElement.dataset.qaPrintCount = String(count);
    };
  });
  await page.goto("/login");
  await page
    .getByTestId("local-qa-login-grid")
    .getByRole("button", { name: "商家", exact: true })
    .click();
  await expect(page).toHaveURL(/\/merchant\/dashboard\?organizationId=/);

  const response = await page.goto(
    "/merchant/stalls/22222222-2222-4222-8222-222222222222/qr-print?target=stall&paper=A5",
  );
  expect(response?.status()).toBe(200);

  const printButton = page.getByTestId("qr-print-button");
  await expect(printButton).toBeVisible();
  await expect(printButton).toBeEnabled();
  await printButton.click();
  await expect(page.locator("html")).toHaveAttribute("data-qa-print-count", "1");
  await expect(page.getByRole("status")).toContainText("已送出列印指令");

  const tableResponse = await page.goto(
    "/merchant/stalls/22222222-2222-4222-8222-222222222222/qr-print?target=tables&paper=A4",
  );
  expect(tableResponse?.status()).toBe(200);
  const tablePrintButton = page.getByTestId("qr-print-button");
  await expect(tablePrintButton).toBeEnabled();
  await tablePrintButton.click();
  await expect(page.locator("html")).toHaveAttribute("data-qa-print-count", "2");
});

test("商家 QR 管理在平板寬度左右滿版排列且印刷標籤整齊換行", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/login");
  await page
    .getByTestId("local-qa-login-grid")
    .getByRole("button", { name: "商家", exact: true })
    .click();
  await expect(page).toHaveURL(/\/merchant\/dashboard\?organizationId=/);
  await page.goto("/merchant/aming-chicken");

  const management = page.getByTestId("merchant-ordering-management");
  const qr = page.getByTestId("merchant-ordering-qr");
  const actions = page.getByTestId("merchant-ordering-actions");
  await expect(management).toBeVisible();
  await expect(actions).toBeVisible();
  const layout = await page.evaluate(() => {
    const rect = (testId: string) => {
      const element = document.querySelector(`[data-testid="${testId}"]`);
      if (!(element instanceof HTMLElement)) throw new Error(`MISSING_${testId}`);
      const box = element.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, right: box.right };
    };
    return {
      viewportWidth: window.innerWidth,
      management: rect("merchant-ordering-management"),
      qr: rect("merchant-ordering-qr"),
      actions: rect("merchant-ordering-actions"),
    };
  });
  expect(layout.management.width).toBeGreaterThan(layout.viewportWidth * 0.85);
  expect(layout.qr.x).toBeLessThan(layout.actions.x);
  expect(layout.qr.right).toBeLessThanOrEqual(layout.actions.x);
  expect(Math.abs(layout.qr.y - layout.actions.y)).toBeLessThanOrEqual(2);

  for (const paper of ["A4", "A5", "A6"]) {
    const printLink = qr.getByRole("link", { name: `${paper} 印刷版`, exact: true });
    await expect(printLink).toBeVisible();
    const labelLines = printLink.locator("span > span");
    await expect(labelLines).toHaveCount(2);
    await expect(labelLines.nth(0)).toHaveText(paper);
    await expect(labelLines.nth(1)).toHaveText("印刷版");
    const linePositions = await labelLines.evaluateAll((lines) => lines.map((line) => ({
      display: getComputedStyle(line).display,
      top: line.getBoundingClientRect().top,
    })));
    expect(linePositions[0]?.display).toBe("block");
    expect(linePositions[1]?.top).toBeGreaterThan(linePositions[0]?.top ?? 0);
  }
});

test("QR 非營業時間以置中視窗引導顧客前往線上 Menu", async ({ page }) => {
  await page.route(
    (url) => ["/create-order-session", "/api/public/order-session"].some(
      (suffix) => url.pathname.endsWith(suffix),
    ),
    async (route) => {
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        json: {
          orderSessionToken: `stos_${"h".repeat(43)}`,
          expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
          orderingMode: "DEFAULT",
          orderingOpenNow: false,
          onlineMenuPath: "/store/aming-01?view=pickup",
        },
      });
    },
  );

  const response = await page.goto("/q/demo-aming-chicken-qr-2026-rotate-me");
  expect(response?.status()).toBe(200);
  const dialog = page.getByRole("alertdialog", { name: "目前非營業時間" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("請前往線上 Menu");
  await expect(
    dialog.getByRole("button", { name: "前往線上 Menu 預約", exact: true }),
  ).toBeVisible();
});
