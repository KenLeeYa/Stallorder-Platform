import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";

test.skip(process.env.UI_UX_QA !== "true", "Explicit local redesign QA only; retains labeled examples.");
const org = "11111111-1111-4111-8111-111111111111";
const stall = "22222222-2222-4222-8222-222222222222";
const catalog = `/merchant/catalog?organizationId=${org}`;
const productName = "UIUX 可恢復供應測試商品";
const db = new PrismaClient();
let productId: string;
let activeOrderCount = 105;

async function login(page: Page, role: string, next: string) {
  await page.goto("/login?next=" + encodeURIComponent(next));
  await page.getByTestId("local-qa-login-grid").getByRole("button", { name: role, exact: true }).click();
  await page.waitForURL((url) => url.pathname === next.split("?")[0]);
}

test.beforeAll(async () => {
  const origin = new URL(process.env.PLAYWRIGHT_APP_URL!);
  const database = new URL(process.env.DATABASE_URL!);
  if (origin.origin !== "http://127.0.0.1:3023" || database.hostname !== "127.0.0.1" || database.port !== "55722" || database.pathname !== "/postgres") throw new Error("UI_UX_QA_LOCAL_TARGET_REQUIRED");
  const existing = await db.product.findFirst({ where: { organizationId: org, name: productName } });
  const category = await db.productCategory.findFirstOrThrow({ where: { organizationId: org } });
  productId = (existing ?? await db.product.create({ data: {
    organizationId: org, categoryId: category.id, name: productName, description: "本機 UI/UX 範例，請勿實際製作", defaultPrice: 60,
    stallProducts: { create: { organizationId: org, stallId: stall, isEnabled: true } },
  } })).id;
  const active = await db.order.count({ where: { stallId: stall, status: { in: ["WAITING_CONFIRMATION", "CONFIRMED", "PREPARING", "PACKING", "READY"] } } });
  activeOrderCount = Math.max(active, 105);
  for (let i = active; i < 105; i++) {
    const unique = randomUUID();
    await db.order.create({ data: {
      organizationId: org, stallId: stall, orderNo: `UIUX-${unique.slice(0, 8)}`, idempotencyKey: unique,
      trackingTokenHash: createHash("sha256").update(unique).digest("hex"), deviceHash: createHash("sha256").update(`device-${unique}`).digest("hex"),
      source: "STAFF_POS", origin: "ONLINE_STAFF", isTest: true, customerName: `UIUX 大量訂單範例 ${i + 1}`, fulfillmentType: "TAKEOUT",
      status: i % 3 === 0 ? "WAITING_CONFIRMATION" : i % 3 === 1 ? "CONFIRMED" : "READY", paymentStatus: "UNPAID",
      subtotal: 60, total: 60, confirmationExpiresAt: new Date(Date.now() + 86_400_000),
      items: { create: { organizationId: org, stallId: stall, productId, name: productName, quantity: 1, baseUnitPrice: 60, unitPrice: 60, status: i % 3 === 2 ? "READY" : "PENDING" } },
    } });
  }
});
test.afterAll(async () => db.$disconnect());

test("105-order queue: filters, pages, empty search, keyboard and mobile reflow", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await login(page, "店員", "/staff/aming-chicken");
  const list = page.getByTestId("staff-order-list-pane");
  const pager = page.getByTestId("staff-queue-pagination");
  await expect(pager).toContainText(String(activeOrderCount));
  await expect(list.getByRole("button")).toHaveCount(5);
  await expect(page.getByTestId("staff-order-mobile-list").locator("article")).toHaveCount(5);
  const first = await list.locator("strong").allTextContents();
  await pager.getByRole("button", { name: "下一頁訂單" }).click();
  const second = await list.locator("strong").allTextContents();
  expect(second.some((value) => first.includes(value))).toBe(false);
  await list.getByRole("button").nth(1).click();
  await expect(list.getByRole("button").nth(1)).toHaveAttribute("aria-current", "true");
  const filters = page.getByTestId("staff-queue-filters");
  await filters.getByRole("button", { name: /待接單/ }).focus();
  await page.keyboard.press("Enter");
  await expect(filters.getByRole("button", { name: /待接單/ })).toHaveAttribute("aria-pressed", "true");
  await expect(pager).toContainText("第 1");
  await page.getByTestId("staff-search-open").click();
  await page.getByRole("searchbox").fill("NO_SUCH_UIUX_ORDER");
  await page.getByRole("dialog").getByRole("button", { name: "確認", exact: true }).click();
  await expect(page.getByTestId("staff-order-master-detail")).toHaveCount(0);
  await expect(pager).toContainText("共 0 筆");
  await page.getByTestId("staff-search-open").click();
  await page.getByRole("searchbox").clear();
  await page.getByRole("dialog").getByRole("button", { name: "確認", exact: true }).click();
  await page.getByRole("combobox", { name: "訂單來源", exact: true }).selectOption("LINE_DELIVERY");
  await expect(page.getByRole("combobox", { name: "訂單來源", exact: true })).toHaveValue("LINE_DELIVERY");
  await page.getByRole("combobox", { name: "訂單來源", exact: true }).selectOption("ALL");
  await filters.getByRole("button", { name: /^全部/ }).click();
  await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
  await expect(page.getByTestId("staff-order-mobile-list").locator("article")).toHaveCount(activeOrderCount);
  await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
  await expect(page.getByTestId("staff-order-mobile-list").locator("article")).toHaveCount(5);

  for (const width of [360, 768, 1024, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    if (width >= 768) expect(await list.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => { document.documentElement.dataset.interfaceMode = "senior"; document.documentElement.dataset.theme = "dark"; });
  const textSize = await list.locator("strong").first().evaluate((node) => parseFloat(getComputedStyle(node.parentElement!).fontSize));
  expect(textSize).toBeGreaterThanOrEqual(18);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("staff-senior-dark.png"), fullPage: true });
  await page.evaluate(() => { document.documentElement.style.zoom = "2"; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test("catalog: bounded pages, cross-page selection, real save/readback and failed save retains dialog", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await login(page, "商家", catalog);
  await expect(page.getByTestId("merchant-function-navigation-desktop").getByRole("link", { name: "共用商品", exact: true })).toHaveAttribute("aria-current", "page");
  expect(await page.getByTestId("merchant-function-navigation-desktop").getByRole("link", { name: "共用商品", exact: true }).locator("span").evaluate((element) => getComputedStyle(element).clipPath)).toBe("none");
  await expect(page.getByTestId("catalog-management-row")).toHaveCount(5);
  await page.getByRole("checkbox", { name: "全選本頁（5）", exact: true }).check();
  await page.getByTestId("catalog-pagination").getByRole("button", { name: "下一頁商品" }).click();
  await expect(page.getByRole("checkbox", { name: "全選本頁（5）", exact: true })).not.toBeChecked();
  await page.getByRole("searchbox", { name: "搜尋管理商品" }).fill(productName);
  await expect(page.getByTestId("catalog-management-row")).toHaveCount(1);
  const trigger = page.getByTestId("catalog-management-row").getByRole("button", { name: /設定供應狀態/ });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "設定供應狀態", exact: true });
  await dialog.getByRole("button", { name: /暫時停止供應 補料/ }).click();
  await dialog.getByRole("button", { name: "30 分鐘", exact: true }).click();
  const saved = page.waitForResponse((response) => response.request().method() === "PATCH" && response.url().endsWith(`/api/merchant/stalls/${stall}/products`));
  await dialog.getByRole("button", { name: "確認暫時停止供應", exact: true }).click();
  expect((await saved).status()).toBe(200);
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toContainText("暫停供應");
  const assignment = await db.stallProduct.findUniqueOrThrow({ where: { stallId_productId: { stallId: stall, productId } } });
  expect(assignment.isSoldOut).toBe(true);
  expect(assignment.soldOutUntil!.getTime()).toBeGreaterThan(Date.now() + 28 * 60_000);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await dialog.getByRole("button", { name: /指定日期恢復/ }).click();
  await dialog.getByLabel("恢復供應日期").fill("2026-10-02");
  const endpoint = `**/api/merchant/stalls/${stall}/products`;
  await page.route(endpoint, (route) => route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "UIUX 併發衝突，請重新確認" }) }));
  await dialog.getByRole("button", { name: "確認指定日期恢復", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("UIUX 併發衝突");
  await expect(dialog.getByLabel("恢復供應日期")).toHaveValue("2026-10-02");
  await page.unroute(endpoint);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("real authorization boundaries: guest and staff cannot use merchant management", async ({ page, request }) => {
  expect((await request.get(`/api/merchant/stalls/${stall}/products`)).status()).toBe(401);
  await login(page, "店員", "/staff/aming-chicken");
  expect((await page.request.get(`/api/merchant/stalls/${stall}/products`)).status()).toBe(403);
  await page.goto(catalog);
  await expect(page.getByTestId("catalog-management-row")).toHaveCount(0);
});
