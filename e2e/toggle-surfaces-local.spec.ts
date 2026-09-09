import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { continueQrCheckout, dismissStaffStartReminder, establishLocalTestSession, gotoLocalPath } from "./local-navigation";

const prisma = new PrismaClient();
const organizationId = "11111111-1111-4111-8111-111111111111";
const stallId = "22222222-2222-4222-8222-222222222222";
let ownerId: string;
test.use({ serviceWorkers: "block" });
test.skip(process.env.PLAYWRIGHT_REUSE_EXISTING_SERVER !== "true", "Requires the retained all-features 3018/55722 local QA fixture.");
test.beforeAll(async () => {
  const db = new URL(process.env.DATABASE_URL ?? "");
  if (!["localhost", "127.0.0.1"].includes(db.hostname) || db.port !== "55722") throw new Error("LOCAL_TOGGLE_QA_DATABASE_REQUIRED");
  ownerId = (await prisma.profile.findUniqueOrThrow({ where: { email: "owner@stallorder.test" } })).id;
});
test.afterAll(async () => { await prisma.$disconnect(); });

for (const [surface, route] of [
  ["catalog", `/merchant/catalog?organizationId=${organizationId}`],
  ["business-hours", `/merchant/stalls/${stallId}/settings/business-hours`],
  ["capacity", `/merchant/stalls/${stallId}/capacity`],
  ["schedule", `/merchant/stalls/${stallId}/schedule`],
  ["growth", `/merchant/growth?organizationId=${organizationId}`],
  ["developer", `/merchant/developer?organizationId=${organizationId}`],
  ["attendance", `/merchant/stalls/${stallId}/attendance`],
  ["line", `/merchant/stalls/${stallId}/line`],
  ["printing", "/staff/aming-chicken/print"],
]) {
  test(`${surface}: native toggles fit the real page in standard and senior modes`, async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await establishLocalTestSession(page, prisma, ownerId);
    await gotoLocalPath(page, route);
    if (surface === "printing") await page.getByText("新增印表機", { exact: true }).click();
    if (surface === "line") await page.getByRole("button", { name: "3 通知設定", exact: true }).click();
    const controls = page.locator('input[type="checkbox"]:visible');
    await expect(controls.first()).toBeVisible();
    if (surface === "catalog") {
      const all = page.getByRole("checkbox", { name: /全選本清單/ });
      await all.check();
      await expect(page.getByRole("button", { name: "批次售完", exact: true })).toBeEnabled();
      await all.uncheck();
      await expect(page.getByRole("button", { name: "批次售完", exact: true })).toBeDisabled();
    }
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      if (surface === "catalog" && width < 768) await page.getByRole("button", { name: "全部商品庫存", exact: true }).click();
      for (const mode of ["standard", "senior"]) {
        await page.locator("html").evaluate((html, value) => { html.dataset.interfaceMode = value; }, mode);
        const sizes = await controls.evaluateAll((inputs) => inputs.map((input) => {
          const rect = input.getBoundingClientRect();
          return { width: rect.width, height: rect.height, appearance: getComputedStyle(input).appearance };
        }));
        expect(sizes.length).toBeGreaterThan(0);
        for (const size of sizes) {
          expect(size.width).toBeGreaterThanOrEqual(44);
          expect(size.height).toBeGreaterThanOrEqual(44);
          expect(size.appearance).toBe("none");
        }
        const overflow = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: window.innerWidth }));
        if (overflow.page > overflow.viewport) {
          const nodes = await page.locator("main *").evaluateAll((nodes) => nodes.filter((node) => node.getBoundingClientRect().right > window.innerWidth + 1).slice(0, 12).map((node) => ({ tag: node.tagName, text: node.textContent?.slice(0, 35), class: node.className, width: node.getBoundingClientRect().width })));
          console.log(JSON.stringify({ surface, width, mode, nodes }));
        }
        expect(overflow.page, `${surface}/${width}/${mode}`).toBeLessThanOrEqual(overflow.viewport);
        if ([390, 768].includes(width) && mode === "standard") await page.screenshot({ path: testInfo.outputPath(`${surface}-${width}.png`), fullPage: true });
      }
      if (surface === "catalog" && width < 768) await page.getByRole("dialog").getByRole("button", { name: /關閉/ }).click();
    }
    expect(errors).toEqual([]);
  });
}

test("Staff modifier switches change the actual cart draft without submitting an order", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await establishLocalTestSession(page, prisma, ownerId);
  await gotoLocalPath(page, "/staff/aming-chicken");
  await dismissStaffStartReminder(page);
  await page.getByRole("button", { name: "店員點餐", exact: true }).click();
  const product = page.getByTestId("staff-product-card").filter({ hasText: "香酥雞排" }).first();
  await product.getByTestId("staff-open-product-configurator").click();
  const configurator = page.getByTestId("staff-product-configurator");
  const choice = configurator.getByRole("checkbox").filter({ has: page.locator(".selection-toggle") }).first();
  await expect(choice).toBeVisible();
  const selected = await choice.getAttribute("aria-checked");
  await choice.click();
  await expect(choice).toHaveAttribute("aria-checked", selected === "true" ? "false" : "true");
  await expect(choice.locator(".selection-toggle")).toHaveAttribute("data-checked", selected === "true" ? "false" : "true");
  await choice.focus();
  await page.keyboard.press("Space");
  await expect(choice).toHaveAttribute("aria-checked", selected!);
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const mode of ["standard", "senior"]) {
      await page.locator("html").evaluate((html, value) => { html.dataset.interfaceMode = value; }, mode);
      const bounds = await choice.boundingBox();
      expect(bounds?.height).toBeGreaterThanOrEqual(44);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
    await page.screenshot({ path: testInfo.outputPath(`staff-modifiers-${width}.png`) });
  }
});

test("Customer modifier and utensils switches remain usable through cart review", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const qr = await prisma.qrCode.findFirstOrThrow({
    where: { stallId, state: "ACTIVE", diningTableId: null, expiresAt: null },
    orderBy: { createdAt: "desc" },
    select: { token: true },
  });
  await page.setViewportSize({ width: 390, height: 1000 });
  await gotoLocalPath(page, `/q/${qr.token}`);
  const product = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "香酥雞排", exact: true }) });
  await product.getByTestId("qr-open-product-configurator").click();
  const configurator = page.getByTestId("qr-product-configuration");
  const choice = configurator.getByRole("checkbox").first();
  await choice.click();
  await expect(choice).toBeChecked();
  await expect(choice.locator(".selection-toggle")).toHaveAttribute("data-checked", "true");
  await choice.focus();
  await page.keyboard.press("Space");
  await expect(choice).not.toBeChecked();
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const mode of ["standard", "senior"]) {
      await page.locator("html").evaluate((html, value) => { html.dataset.interfaceMode = value; }, mode);
      const overflow = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, nodes: Array.from(document.querySelectorAll("main *")).filter(node => node.getBoundingClientRect().right > innerWidth + 1).slice(0, 12).map(node => ({ tag: node.tagName, text: node.textContent?.slice(0, 30), class: node.className, width: node.getBoundingClientRect().width })) }));
      expect(overflow.scroll, JSON.stringify({ mode, ...overflow })).toBeLessThanOrEqual(width);
      expect((await choice.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    }
  }
  await page.setViewportSize({ width: 390, height: 1000 });
  for (const group of await configurator.locator('[role="radiogroup"]').all()) {
    if ((await group.getByRole("radio").count()) && (await group.getByRole("radio", { checked: true }).count()) === 0) {
      await group.getByRole("radio").first().click();
    }
  }
  await configurator.getByRole("button", { name: "加入購物車", exact: true }).click();
  await expect(configurator).not.toBeVisible();
  await page.getByTestId("qr-mobile-cart-summary").click();
  const cart = page.getByTestId("qr-cart-panel");
  await cart.getByRole("button", { name: "繼續填寫訂購資料", exact: true }).click();
  await continueQrCheckout(page);
  const utensils = cart.getByRole("checkbox", { name: /需要免洗餐具/ });
  await expect(utensils).toBeVisible();
  await utensils.check();
  await expect(utensils).toBeChecked();
  await utensils.focus();
  await page.keyboard.press("Space");
  await expect(utensils).not.toBeChecked();
  await page.screenshot({ path: testInfo.outputPath("customer-utensils-390.png") });
});

test("Employee leave fields stay inside their form at every width and display mode", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await establishLocalTestSession(page, prisma, ownerId);
  await gotoLocalPath(page, "/attendance/aming-chicken");
  const form = page.locator("form").filter({ has: page.getByRole("heading", { name: "申請排休／休假", exact: true }) });
  await expect(form).toBeVisible();
  await form.getByLabel("開始日", { exact: true }).fill("2026-09-20");
  await form.getByLabel("結束日", { exact: true }).fill("2026-09-21");
  await form.getByLabel("說明（選填）", { exact: true }).fill("表單寬度測試：日期、假別與長說明都應留在欄位範圍內");
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const mode of ["standard", "senior"]) {
      for (const theme of ["light", "dark"]) {
        await page.locator("html").evaluate((html, settings) => {
          html.dataset.interfaceMode = settings.mode;
          html.dataset.theme = settings.theme;
        }, { mode, theme });
        const bounds = await form.evaluate((element: HTMLFormElement) => {
          const parent = element.getBoundingClientRect();
          return { valid: element.checkValidity(), scheme: getComputedStyle(element).colorScheme, scroll: element.scrollWidth, width: element.clientWidth,
            fields: Array.from(element.querySelectorAll("input, select, button")).map(field => {
              const box = field.getBoundingClientRect();
              return { name: field.getAttribute("name") ?? "submit", left: box.left - parent.left, right: box.right - parent.right, height: box.height };
            }),
          };
        });
        expect(bounds.valid).toBe(true);
        expect(bounds.scheme).toBe(theme);
        expect(bounds.scroll, JSON.stringify({ width, mode, theme, bounds })).toBeLessThanOrEqual(bounds.width);
        for (const field of bounds.fields) {
          expect(field.left).toBeGreaterThanOrEqual(0);
          expect(field.right, `${width}/${mode}/${theme}/${field.name}`).toBeLessThanOrEqual(0);
          expect(field.height).toBeGreaterThanOrEqual(44);
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      }
    }
    await page.screenshot({ path: testInfo.outputPath(`employee-leave-${width}.png`), fullPage: true });
  }
});
