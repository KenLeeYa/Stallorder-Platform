import { expect, test, type Route } from "@playwright/test";
import { qrProductSelectionControl } from "./local-navigation";

const qrToken = "demo-aming-chicken-qr-2026-rotate-me";

test.use({ serviceWorkers: "block" });

test("本機 QR 外帶可全天候下單並透過同站服務載入修改訂單", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });

  const sessionResponse = page.waitForResponse(
    (response) =>
      ["/create-order-session", "/api/public/order-session"].some((path) =>
        new URL(response.url()).pathname.endsWith(path),
      ) && response.request().method() === "POST",
  );
  await page.goto(`/q/${qrToken}`);
  expect((await sessionResponse).status()).toBe(201);
  await expect(
    page.getByRole("heading", { name: "阿明鹽酥雞", exact: true }),
  ).toBeVisible();

  const product = page.getByRole("article").filter({ hasText: "香酥雞排" });
  await qrProductSelectionControl(product, "香酥雞排").click();
  await product
    .getByRole("button", { name: "加入購物車", exact: true })
    .click();
  await page.getByTestId("qr-mobile-cart-summary").click();
  const cart = page.getByTestId("qr-cart-panel");
  await cart
    .getByRole("button", { name: "繼續填寫訂購資料", exact: true })
    .click();
  await expect(page.getByLabel("顧客稱呼")).toHaveCount(0);
  await expect(page.getByLabel("聯絡電話")).toHaveCount(0);
  await expect(page.getByLabel("訂單備註")).toBeVisible();
  const waitAcknowledgment = page.getByRole("checkbox", {
    name: /我已了解目前預估等候時間/u,
  });
  if (await waitAcknowledgment.isVisible()) await waitAcknowledgment.check();

  const createResponsePromise = page.waitForResponse(
    (response) =>
      ["/create-public-order", "/api/public/orders"].some((path) =>
        new URL(response.url()).pathname.endsWith(path),
      ) && response.request().method() === "POST",
  );
  const trackerResponsePromise = page.waitForResponse((response) => {
    const pathname = new URL(response.url()).pathname;
    return (
      (pathname.includes("/api/public/orders/sto_") && response.request().method() === "GET")
      || (pathname.endsWith("/get-public-order") && response.request().method() === "POST")
    );
  });
  const submit = page.getByRole("button", { name: "送出訂單", exact: true });
  await expect(submit).toBeEnabled({ timeout: 20_000 });
  await submit.click();
  const createResponse = await createResponsePromise;
  expect([200, 201]).toContain(createResponse.status());
  await expect(page).toHaveURL(/\/order\/sto_[A-Za-z0-9_-]+(?:\?.*)?$/u);
  const trackerUrl = new URL(page.url());
  expect(trackerUrl.searchParams.get("qr")).toBe(qrToken);
  const trackingToken = trackerUrl.pathname.split("/").at(-1);
  expect(trackingToken).toMatch(/^sto_[A-Za-z0-9_-]+$/u);
  expect((await trackerResponsePromise).status()).toBe(200);
  await expect(page.getByRole("link", { name: "修改訂單", exact: true })).toBeVisible();

  const reorderPageResponse = await page.request.get(
    `/order/${trackingToken}/reorder`,
  );
  expect(reorderPageResponse.status()).toBe(200);

  let prepareAttempts = 0;
  const interceptFirstPrepareAttempt = async (route: Route) => {
    prepareAttempts += 1;
    if (prepareAttempts === 1) {
      await route.abort("timedout");
      return;
    }
    await route.continue();
  };
  await page.route("**/functions/v1/prepare-reorder", interceptFirstPrepareAttempt);
  await page.route(
    `**/api/public/orders/${trackingToken}/reorder`,
    interceptFirstPrepareAttempt,
  );
  await page.getByRole("link", { name: "修改訂單", exact: true }).click();
  await expect(page.getByText("目前無法準備訂單修改。", { exact: true })).toBeVisible({
    timeout: 10_000,
  });
  const retryPrepare = page.getByRole("button", { name: "再試一次", exact: true });
  await expect(retryPrepare).toBeVisible();

  const prepareResponsePromise = page.waitForResponse(
    (response) =>
      [
        "/functions/v1/prepare-reorder",
        `/api/public/orders/${trackingToken}/reorder`,
      ].some((path) => new URL(response.url()).pathname.endsWith(path)) &&
      response.request().method() === "POST",
  );
  await retryPrepare.click();
  const prepareResponse = await prepareResponsePromise;
  expect(prepareResponse.status()).toBe(200);
  const preparePath = new URL(prepareResponse.url()).pathname;
  if (preparePath.endsWith(`/api/public/orders/${trackingToken}/reorder`)) {
    expect(prepareResponse.headers()["x-order-circuit"]).toBe("B");
  } else {
    expect(preparePath).toBe("/functions/v1/prepare-reorder");
  }
  await expect(
    page.getByRole("heading", { name: "修改訂單", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("香酥雞排", { exact: false })).toBeVisible();
  await expect(page.getByText("Failed to fetch", { exact: true })).toHaveCount(
    0,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);

  await page
    .getByRole("button", { name: "前往目前菜單修改", exact: true })
    .click();
  await expect(page).toHaveURL(/\/store\/aming-01\?/u);
  const editUrl = new URL(page.url());
  expect(editUrl.searchParams.get("view")).toBe("pickup");
  expect(editUrl.searchParams.get("editOrder")).toMatch(
    /^sto_[A-Za-z0-9_-]+$/u,
  );
  await expect(
    page.getByRole("heading", { name: "阿明鹽酥雞", exact: true }),
  ).toBeVisible();

  await page.goto(trackerUrl.toString());
  await expect(page.getByRole("button", { name: "取消訂單", exact: true })).toBeVisible();
  let cancellationStarted = false;
  await page.route(`**/api/public/orders/${trackingToken}`, async (route) => {
    if (route.request().method() === "DELETE") {
      cancellationStarted = true;
      await route.continue();
      return;
    }
    if (route.request().method() === "GET" && cancellationStarted) {
      await new Promise((resolve) => setTimeout(resolve, 4_500));
    }
    await route.continue().catch(() => undefined);
  });
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toBe("確定要取消此訂單嗎？取消後無法復原。");
    await dialog.accept();
  });
  const cancelResponsePromise = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname.endsWith(`/api/public/orders/${trackingToken}`) &&
      response.request().method() === "DELETE",
  );
  await page.getByRole("button", { name: "取消訂單", exact: true }).click();
  expect((await cancelResponsePromise).status()).toBe(200);
  await expect(page.getByText("已取消", { exact: true })).toBeVisible({ timeout: 2_000 });
  await expect(page.getByText(/signal timed out/iu)).toHaveCount(0);
});
