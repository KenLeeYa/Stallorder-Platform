import { expect, test } from "@playwright/test";
import { qrProductSelectionControl } from "./local-navigation";

const demoQrToken = "demo-aming-chicken-qr-2026-rotate-me";

test("手機 QR 點餐使用固定訂單摘要且不產生水平溢位", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const sessionResponse = page.waitForResponse(
    (response) =>
      ["/create-order-session", "/api/public/order-session"].some((path) =>
        new URL(response.url()).pathname.endsWith(path),
      ) && response.request().method() === "POST",
  );

  await page.goto(`/q/${demoQrToken}`);
  expect((await sessionResponse).status()).toBe(201);

  const memberEntry = page.getByTestId("qr-member-entry");
  if (process.env.PLAYWRIGHT_PRODUCTION_SERVER === "true") {
    await expect(memberEntry).toHaveCount(0);
  } else {
    await memberEntry.click();
    const memberDialog = page.getByRole("dialog", {
      name: "會員快速入口（本機預覽）",
    });
    await expect(memberDialog).toContainText("訪客仍可直接點餐");
    await memberDialog
      .getByRole("button", { name: "繼續訪客點餐", exact: true })
      .click();
    await expect(memberDialog).toHaveCount(0);
  }

  const firstProduct = page.getByRole("article").first();
  const firstProductName = await firstProduct.getByRole("heading").innerText();
  await qrProductSelectionControl(firstProduct, firstProductName).click();
  await firstProduct
    .getByRole("button", { name: "加入購物車", exact: true })
    .click();

  const summary = page.getByTestId("qr-mobile-cart-summary");
  await expect(summary).toBeVisible();
  expect((await summary.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);

  await summary.click();
  const cart = page.getByTestId("qr-cart-panel");
  await expect(cart).toHaveAttribute("role", "dialog");
  await cart
    .getByRole("button", { name: "繼續填寫訂購資料", exact: true })
    .click();
  await expect(cart.locator('input[type="text"]')).toHaveCount(0);
  await expect(cart.getByLabel("訂單備註")).toHaveAttribute(
    "maxlength",
    /^\d+$/,
  );
});

test("本機 QA 可透過示範 QR 建立點餐 session", async ({ page }) => {
  const sessionResponse = page.waitForResponse(
    (response) =>
      ["/create-order-session", "/api/public/order-session"].some((path) =>
        new URL(response.url()).pathname.endsWith(path),
      ) && response.request().method() === "POST",
  );

  await page.goto(`/q/${demoQrToken}`);

  const response = await sessionResponse;
  expect(response.status()).toBe(201);
  const session = await response.json();
  expect(session.estimatedWaitMinMinutes).toBeGreaterThanOrEqual(0);
  expect(session.estimatedWaitMaxMinutes).toBeGreaterThanOrEqual(
    session.estimatedWaitMinMinutes,
  );
  await expect(
    page.getByRole("heading", { name: "阿明鹽酥雞", exact: true }),
  ).toBeVisible();
  const waitText =
    session.estimatedWaitMinMinutes === session.estimatedWaitMaxMinutes
      ? `目前預估等候約 ${session.estimatedWaitMaxMinutes} 分鐘`
      : `目前預估等候時間：${session.estimatedWaitMinMinutes}～${session.estimatedWaitMaxMinutes} 分鐘`;
  await expect(page.getByText(waitText, { exact: true })).toBeVisible();
  const product = page.getByRole("article").filter({ hasText: "香酥雞排" });
  await expect(product).toContainText("95");
  await qrProductSelectionControl(product, "香酥雞排").click();
  await product
    .getByRole("button", { name: "加入購物車", exact: true })
    .click();
  await expect(page.getByLabel("顧客稱呼")).toHaveCount(0);
  await expect(page.getByLabel("聯絡電話")).toHaveCount(0);
  await expect(page.getByLabel("訂單備註")).toBeVisible();
  const waitAcknowledgment = page.getByRole("checkbox", {
    name: /我已了解目前預估等候時間/,
  });
  if (await waitAcknowledgment.isVisible()) await waitAcknowledgment.check();
  await expect(
    page.getByRole("button", { name: "送出訂單", exact: true }),
  ).toBeEnabled({ timeout: 15_000 });

  const restoredSession = page.waitForResponse(
    (response) =>
      ["/create-order-session", "/api/public/order-session"].some((path) =>
        new URL(response.url()).pathname.endsWith(path),
      ) && response.request().method() === "POST",
  );
  await page.reload();
  expect((await restoredSession).status()).toBe(201);
  await expect(page.getByText("已恢復上次尚未送出的點餐內容。")).toBeVisible();
  await expect(
    page.getByTestId("qr-cart-panel").getByText("共 1 份"),
  ).toBeVisible();
});

test("輕量 session 更新不載入菜單查詢", async ({ request }) => {
  const functionsUrl = (
    process.env.SUPABASE_FUNCTIONS_URL ??
    process.env.NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL
  )?.replace(/\/$/, "");
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  expect(functionsUrl).toBeTruthy();
  expect(publishableKey).toBeTruthy();

  const lightweightSession = await request.post(
    `${functionsUrl}/create-order-session`,
    {
      headers: {
        origin: "http://localhost:3001",
        apikey: publishableKey!,
        authorization: `Bearer ${publishableKey}`,
        "x-stallorder-protocol-version": "1",
        "cf-connecting-ip": "203.0.113.45",
      },
      data: {
        qrToken: demoQrToken,
        deviceId: crypto.randomUUID(),
        sessionRequestId: crypto.randomUUID(),
        orderingMode: "DEFAULT",
        includeMenu: false,
      },
    },
  );

  expect([200, 201]).toContain(lightweightSession.status());
  expect(lightweightSession.headers()["server-timing"]).toMatch(
    /db-query-count;dur=4(?:,|$)/,
  );
  await expect(lightweightSession.json()).resolves.not.toHaveProperty(
    "products",
  );
});
