import { expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";

test.skip(process.env.UI_UX_CAPTURE !== "true", "Explicit local redesign capture only.");

test("capture real local roles and responsive screens", async ({ browser }) => {
  test.setTimeout(240_000);
  const origin = process.env.PLAYWRIGHT_APP_URL ?? "";
  expect(new URL(origin).hostname).toBe("127.0.0.1");
  const directory = path.resolve(process.env.UI_UX_ARTIFACT_DIR ?? "test-results/ui-ux");
  await mkdir(directory, { recursive: true });
  const db = new PrismaClient();
  const orders = await db.order.findMany({ where: { stallId: "22222222-2222-4222-8222-222222222222", status: { in: ["WAITING_CONFIRMATION", "CONFIRMED", "PREPARING", "PACKING", "READY"] } }, select: { id: true, status: true }, orderBy: { id: "asc" } });
  const products = await db.product.count({ where: { organizationId: "11111111-1111-4111-8111-111111111111" } });
  const data = { activeOrders: orders.length, orderStateHash: createHash("sha256").update(JSON.stringify(orders)).digest("hex"), products };
  await db.$disconnect();
  const metrics: unknown[] = [];
  const errors: string[] = [];
  const screens = [
    { name: "staff", role: "店員", url: "/staff/aming-chicken", ready: "staff-order-mobile-list" },
    { name: "catalog", role: "商家", url: "/merchant/catalog?organizationId=11111111-1111-4111-8111-111111111111" },
    { name: "dashboard", role: "商家", url: "/merchant/dashboard?organizationId=11111111-1111-4111-8111-111111111111" },
    { name: "admin", role: "平台管理者", url: "/admin/billing" },
    { name: "menu", url: "/store/aming-01?view=menu" },
  ];
  for (const screen of screens) {
    const context = await browser.newContext({ baseURL: origin, locale: "zh-TW", timezoneId: "Asia/Taipei" });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    if (screen.role) {
      await page.goto("/login?next=" + encodeURIComponent(screen.url));
      await page.getByTestId("local-qa-login-grid").getByRole("button", { name: screen.role, exact: true }).click();
      await page.waitForURL((url) => url.pathname === screen.url.split("?")[0]);
    } else {
      expect((await page.goto(screen.url))?.status()).toBe(200);
    }
    await expect(page.getByRole("heading", { name: "發生錯誤", exact: true })).toHaveCount(0);
    for (const width of [320, 360, 390, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      if (screen.ready) await expect(page.getByTestId(screen.ready)).toBeAttached();
      if (screen.name === "dashboard") {
        await expect(page.getByRole("button", { name: "重新整理", exact: true })).toBeEnabled();
      }
      await page.evaluate(() => document.fonts.ready);
      const measurement = await page.evaluate(() => ({
        width: innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        nodes: document.querySelectorAll("*").length,
        catalogRows: document.querySelectorAll('[data-testid="catalog-management-row"]').length,
        cards: document.querySelectorAll('[data-testid="staff-order-card"]').length,
        buttons: document.querySelectorAll("button").length,
        listButtons: document.querySelectorAll('[data-testid="staff-order-list-pane"] button').length,
      }));
      metrics.push({ screen: screen.name, ...measurement });
      await page.screenshot({ path: path.join(directory, `${screen.name}-${width}.png`), fullPage: true });
    }
    await context.close();
  }
  await writeFile(path.join(directory, "metrics.json"), JSON.stringify({ data, metrics, errors }, null, 2));
  expect(errors).toEqual([]);
});
