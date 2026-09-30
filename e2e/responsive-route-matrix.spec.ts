import { readFileSync, writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";
import { dismissStaffStartReminder, gotoLocalPath } from "./local-navigation";
import { acceptanceDirectory, acceptanceQrWhere, acceptanceWidths, fixedAcceptanceFixture, fixedDataset } from "./helpers/responsive-acceptance-fixture";
import { readResponsiveBuildProvenance } from "../scripts/responsive-build-provenance.mjs";

test.use({ actionTimeout: 15_000, serviceWorkers: "block", trace: "off", video: "off" });
let fixture: Awaited<ReturnType<typeof fixedAcceptanceFixture>>;
test.beforeAll(async () => { readResponsiveBuildProvenance(); fixture = await fixedAcceptanceFixture(); });

const routes = [
  "/merchant/dashboard",
  "/merchant/stalls?organizationId=11111111-1111-4111-8111-111111111111",
  "/merchant/stalls/22222222-2222-4222-8222-222222222222",
  "/merchant/stalls/22222222-2222-4222-8222-222222222222/settings/special-hours",
  "/merchant/stalls/22222222-2222-4222-8222-222222222222/settings/dining-tables",
  "/merchant/stalls/22222222-2222-4222-8222-222222222222/settings/printing",
  "/merchant/stalls/22222222-2222-4222-8222-222222222222/settings/kds",
  "/merchant/stalls/22222222-2222-4222-8222-222222222222/settings/payments",
  "/merchant/stalls/22222222-2222-4222-8222-222222222222/settings/languages",
  "/merchant/stalls/22222222-2222-4222-8222-222222222222/products",
  "/merchant/catalog?organizationId=11111111-1111-4111-8111-111111111111",
  "/merchant/operations",
  "/merchant/reports/overview?organizationId=11111111-1111-4111-8111-111111111111",
  "/merchant/reports/orders?organizationId=11111111-1111-4111-8111-111111111111",
  "/merchant/reports/products?organizationId=11111111-1111-4111-8111-111111111111",
  "/merchant/reports/payments?organizationId=11111111-1111-4111-8111-111111111111",
  "/merchant/reports/stalls?organizationId=11111111-1111-4111-8111-111111111111",
  "/merchant/reports/cash-shifts?organizationId=11111111-1111-4111-8111-111111111111",
  "/staff/aming-chicken",
  "/staff/aming-chicken/cash",
  "/staff/aming-chicken/floor",
  "/kitchen?stall=aming-chicken",
];

const publicRoutes = [
  "/store/aming-01?view=menu",
  "/store/aming-01?view=pickup",
  "/store/aming-01?view=delivery",
];

const canonicalRoutePaths: Record<string, string> = {
  "/merchant/stalls/22222222-2222-4222-8222-222222222222/products": "/merchant/aming-chicken",
};

async function login(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "使用電子郵件與密碼登入", exact: true }).click();
  await page.getByLabel("電子郵件").fill("owner@stallorder.test");
  await page.getByLabel("密碼").fill("StallOrderDemo!2026");
  await page.getByRole("button", { name: "登入", exact: true }).click();
  await expect(page).toHaveURL(/\/merchant\/dashboard\?organizationId=/, { timeout: 30_000 });
}

test("核心營運頁面在手機、平板與桌面不產生全頁水平溢位", async ({ page }) => {
  test.setTimeout(600_000);
  const viewports = acceptanceWidths.map(width => ({ name: `${width}px`, width, height: 900 }));

  await page.setViewportSize(viewports[0]);
  await login(page);

  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });

    for (const route of routes) {
      await gotoLocalPath(page, route, canonicalRoutePaths[route] ?? route);
      await expect(page.locator("body")).toBeVisible();
      await expect(page.locator("[data-nextjs-dialog]")).toHaveCount(0);
      const horizontalLayout = await page.evaluate(() => {
        const clientWidth = document.documentElement.clientWidth;
        return {
          clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
          offenders: Array.from(document.querySelectorAll<HTMLElement>("body *"))
            .map((element) => {
              const box = element.getBoundingClientRect();
              return {
                tag: element.tagName.toLowerCase(),
                testId: element.dataset.testid ?? "",
                className: typeof element.className === "string" ? element.className.slice(0, 160) : "",
                left: Math.round(box.left),
                right: Math.round(box.right),
                width: Math.round(box.width),
              };
            })
            .filter((element) => element.right > clientWidth + 1 || element.left < -1)
            .slice(0, 12),
        };
      });
      expect(
        horizontalLayout.scrollWidth,
        `Unexpected page-level horizontal overflow at ${route} (${viewport.name}): ${JSON.stringify(horizontalLayout)}`,
      ).toBeLessThanOrEqual(horizontalLayout.clientWidth + 1);
    }
  }
});

test("舊公開連結在 HTTP 層導向攤位代碼入口", async ({ request }) => {
  for (const [legacyPath, view] of [
    ["/menu/aming-chicken", "menu"],
    ["/s/aming-chicken", "pickup"],
    ["/delivery/aming-chicken", "delivery"],
  ] as const) {
    const response = await request.get(legacyPath, { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    const location = response.headers().location;
    expect(location).toBe(`/store/aming-01?view=${view}`);
  }
});

for (const viewport of [
  { name: "compact-mobile", width: 320, height: 568 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test(`${viewport.name} 公開菜單與點餐入口不產生全頁水平溢位`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });

    for (const route of [...publicRoutes, `/q/${fixture.qrToken}`]) {
      await gotoLocalPath(page, route, canonicalRoutePaths[route] ?? route);
      await expect(page.locator("body")).toBeVisible();
      await expect(page.locator("[data-nextjs-dialog]")).toHaveCount(0);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
        ),
        `Unexpected page-level horizontal overflow at ${route} (${viewport.name})`,
      ).toBe(true);
      await expect(page.getByRole("main")).toBeVisible();
    }
  });
}

test("missing selected order cannot close the next detail after a delayed animation frame", async ({ page }) => {
  await page.addInitScript(() => {
    const NativeEventSource = window.EventSource;
    const sources: EventSource[] = [];
    window.EventSource = class extends NativeEventSource { constructor(url: string | URL, options?: EventSourceInit) { super(url, options); sources.push(this); } };
    (window as Window & { b3Sources?: EventSource[] }).b3Sources = sources;
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.goto("/staff/aming-chicken");
  await dismissStaffStartReminder(page);
  const first = page.getByTestId("staff-order-mobile-list").getByRole("article").first();
  const heading = await first.innerText();
  await first.getByRole("button", { name: "查看明細", exact: true }).click();
  await page.evaluate(() => {
    const originalRequest = window.requestAnimationFrame.bind(window);
    const originalCancel = window.cancelAnimationFrame.bind(window);
    const held = new Map<number, FrameRequestCallback>();
    let next = 1_000_000;
    const state = window as Window & { b3Frames?: { count: () => number; release: () => void } };
    // Fault injection: postpone the missing-record focus effect, preserving all other frames.
    window.requestAnimationFrame = callback => {
      if (String(callback).includes("staff-order-mobile-list")) { const id = next++; held.set(id, callback); return id; }
      return originalRequest(callback);
    };
    window.cancelAnimationFrame = id => { held.delete(id); originalCancel(id); };
    state.b3Frames = { count: () => held.size, release: () => { const callbacks = [...held.values()]; held.clear(); callbacks.forEach(callback => callback(performance.now())); } };
  });
  await page.route("**/api/stalls/aming-chicken/orders", async route => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({ response, json: { ...body, orders: body.orders.filter((order: { orderNo: string }) => !heading.includes(order.orderNo)) } });
  });
  // Genuine stream invalidation triggers the normal authorized snapshot request.
  await page.evaluate(() => (window as Window & { b3Sources?: EventSource[] }).b3Sources?.forEach(source => source.dispatchEvent(new MessageEvent("orders", { data: "{}" }))));
  await expect(page.getByTestId("staff-order-mobile-detail")).toBeHidden({ timeout: 20_000 });
  expect(await page.evaluate(() => (window as Window & { b3Frames?: { count: () => number } }).b3Frames?.count())).toBeGreaterThan(0);
  const next = page.getByTestId("staff-order-mobile-list").getByRole("button", { name: "查看明細", exact: true }).first();
  await next.click();
  await expect(page.getByTestId("staff-order-mobile-detail")).toBeVisible();
  await page.evaluate(() => (window as Window & { b3Frames?: { release: () => void } }).b3Frames?.release());
  await expect(page.getByTestId("staff-order-mobile-detail")).toBeVisible();
});

test("stations redirect after kitchen layout retains usable validation without React fallback", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await login(page);
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/kitchen?stall=aming-chicken");
    await page.getByTestId("kitchen-order-queue-button").filter({ hasText: "B3-001" }).click();
  }
  await page.goto("/kitchen/stations?stall=aming-chicken");
  await expect(page).toHaveURL(new RegExp(`/merchant/stalls/${fixture.stallId}/kitchen/stations\\?source=kitchen$`));
  await page.getByLabel("名稱", { exact: true }).first().fill("B3 無效代碼，不建立資料");
  const code = page.getByLabel("代碼", { exact: true }).first();
  await code.fill("中文代碼");
  await page.getByRole("button", { name: "新增工作站", exact: true }).click();
  await expect(code).toHaveAttribute("aria-invalid", "true");
  await expect(code).toBeFocused();
  expect(errors).toEqual([]);
});

test("fixed fixture reuses exact main QR with both same-label QRs present", async () => {
  const prisma = new PrismaClient();
  try {
    const before = JSON.parse(readFileSync(acceptanceDirectory + "/fixed-dataset.json", "utf8"));
    const main = await prisma.stall.findUniqueOrThrow({ where: { slug: "aming-chicken" } });
    const candidates = await prisma.qrCode.findMany({ where: { label: fixedDataset, state: "ACTIVE" }, select: { id: true, organizationId: true, stallId: true } });
    expect(candidates).toHaveLength(2);
    expect(new Set(candidates.map(qr => qr.stallId)).size).toBe(2);
    const selected = await prisma.qrCode.findMany({ where: acceptanceQrWhere(main.organizationId, main.id), select: { id: true, organizationId: true, stallId: true } });
    expect(selected).toEqual([{ id: before.qrId, organizationId: main.organizationId, stallId: main.id }]);
    const first = await fixedAcceptanceFixture();
    const second = await fixedAcceptanceFixture();
    expect(first.stallId).toBe(main.id);
    expect(second.stallId).toBe(main.id);
    expect(second.qrToken).toBe(first.qrToken);
    expect(second.localeQrToken).toBe(first.localeQrToken);
    expect(second.qrToken).not.toBe(second.localeQrToken);
    expect(JSON.stringify(second.orders)).toBe(JSON.stringify(first.orders));
    const after = JSON.parse(readFileSync(acceptanceDirectory + "/fixed-dataset.json", "utf8"));
    expect(after.orderDigest).toBe(before.orderDigest);
    expect(after.qrId).toBe(before.qrId);
    expect(after.localeQrId).toBe(before.localeQrId);
    const mismatched = await prisma.order.count({ where: { id: { in: second.orders.map(order => order.id) }, OR: [{ stallId: { not: main.id } }, { organizationId: { not: main.organizationId } }] } });
    expect(mismatched).toBe(0);
    writeFileSync(acceptanceDirectory + "/fixture-reuse.json", JSON.stringify({ source: readResponsiveBuildProvenance(), candidates, selected, count: second.orders.length, orderDigest: after.orderDigest, sameIdsOnRetry: true }, null, 2));
  } finally { await prisma.$disconnect(); }
});
