import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { catalogCsvHeaders } from "../src/lib/catalog-csv-client";
import { chromium, expect, test, type Locator, type Page } from "@playwright/test";
import { readResponsiveBuildProvenance } from "../scripts/responsive-build-provenance.mjs";
import { dismissStaffStartReminder, loginLocalTestAccount, qrProductSelectionControl } from "./local-navigation";
import { acceptanceDirectory, acceptanceWidths, fixedAcceptanceFixture, longProductName, longProductNameEnglish } from "./helpers/responsive-acceptance-fixture";

test.use({ serviceWorkers: "block", trace: "off", video: "off", screenshot: "off", actionTimeout: 15_000 });
let fixture: Awaited<ReturnType<typeof fixedAcceptanceFixture>>;
test.beforeAll(async () => {
  readResponsiveBuildProvenance();
  fixture = await fixedAcceptanceFixture();
});

async function reachable(control: Locator, height = 44) {
  await expect(control).toBeVisible();
  await control.scrollIntoViewIfNeeded();
  const box = await control.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    const style = getComputedStyle(element);
    return { width: rect.width, height: rect.height, left: rect.left, right: rect.right,
      clientWidth: document.documentElement.clientWidth, uncovered: hit === element || element.contains(hit),
      color: style.color, background: style.backgroundColor, outline: style.outline, shadow: style.boxShadow,
      top: rect.top, bottom: rect.bottom, viewportHeight: innerHeight, hitTag: hit?.tagName, hitClass: hit?.getAttribute("class") };
  });
  expect.soft(box.height, `target height ${JSON.stringify(box)}`).toBeGreaterThanOrEqual(height);
  expect.soft(box.width, "target width").toBeGreaterThanOrEqual(44);
  expect.soft(box.left).toBeGreaterThanOrEqual(-1);
  expect.soft(box.right).toBeLessThanOrEqual(box.clientWidth + 1);
  expect.soft(box.uncovered, `target covered: ${JSON.stringify(box)}`).toBe(true);
  return box;
}

for (const channel of ["chrome", "msedge"] as const) {
  for (const mode of ["zoom200", "zoom400", "text200"] as const) {
    test(`${channel} native ${mode} uses owned browser profile`, async () => {
      test.setTimeout(180_000);
      const source = readResponsiveBuildProvenance();
      const profile = mkdtempSync(join(tmpdir(), "stallorder-b3-browser-"));
      mkdirSync(join(profile, "Default"));
      writeFileSync(join(profile, "Default", "Preferences"), JSON.stringify({ webkit: { webprefs: { default_font_size: mode === "text200" ? 32 : 16 } } }));
      const browser = await chromium.launchPersistentContext(profile, {
        channel, headless: false, viewport: null, deviceScaleFactor: undefined, isMobile: undefined, baseURL: "http://127.0.0.1:3026", locale: "zh-TW", timezoneId: "Asia/Taipei",
        args: ["--window-size=1280,900"], serviceWorkers: "block",
        extraHTTPHeaders: { "x-vercel-forwarded-for": process.env.PLAYWRIGHT_TRUSTED_CLIENT_IP!, "cf-connecting-ip": process.env.PLAYWRIGHT_TRUSTED_CLIENT_IP! },
      });
      try {
        const page = await browser.newPage();
        page.setDefaultTimeout(15_000);
        const cdp = await browser.newCDPSession(page);
        const { windowId } = await cdp.send("Browser.getWindowForTarget");
        for (let adjustment = 0; adjustment < 6; adjustment += 1) {
          const size = await page.evaluate(() => ({ inner: innerWidth }));
          if (size.inner === 1280) break;
          const { bounds } = await cdp.send("Browser.getWindowBounds", { windowId });
          if (!bounds.width) throw new Error("NATIVE_BROWSER_WINDOW_WIDTH_UNAVAILABLE");
          await cdp.send("Browser.setWindowBounds", { windowId, bounds: { width: bounds.width + 1280 - size.inner, height: 900, windowState: "normal" } });
          await page.waitForTimeout(100);
        }
        const baseline = await page.evaluate(() => ({ innerWidth, outerWidth, dpr: devicePixelRatio }));
        // Windows Chrome rounds native window bounds to 1282 on this display.
        // Retain exact measured ratios; Edge supplies the exact 1280 -> 320 case.
        if (channel === "msedge") expect(Math.abs(baseline.innerWidth - 1280)).toBeLessThanOrEqual(1);
        const settings = await browser.newPage();
        await settings.goto(`${channel === "chrome" ? "chrome" : "edge"}://settings/appearance`);
        const zoom = mode === "zoom200" ? 2 : mode === "zoom400" ? 4 : 1;
        let settingReadback: string;
        if (channel === "chrome") {
          await settings.locator("#zoomLevel").selectOption(String(zoom));
          settingReadback = await settings.locator("#zoomLevel").inputValue();
          expect(settingReadback).toBe(String(zoom));
        } else {
          await settings.locator('fluent-menu-button[aria-label^="頁面縮放"]').click();
          await settings.getByRole("menuitemradio", { name: `${zoom * 100}%`, exact: true }).click();
          await expect(settings.locator('fluent-menu-button[aria-label^="頁面縮放"]')).toHaveAttribute("aria-label", `頁面縮放 ${zoom * 100}%`);
          settingReadback = await settings.locator('fluent-menu-button[aria-label^="頁面縮放"]').getAttribute("aria-label") ?? "";
          expect(settingReadback).toContain(`${zoom * 100}%`);
        }
        await settings.screenshot({ path: `${acceptanceDirectory}/${channel}-${mode}-browser-setting.png` });
        await settings.close();
        await page.bringToFront();
        const capture = async (surface: string) => {
          const mask = surface === "merchant" ? await page.addStyleTag({ content: '[data-testid="merchant-ordering-qr"] { visibility: hidden !important; }' }) : null;
          try {
            const shot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
            writeFileSync(`${acceptanceDirectory}/${channel}-${mode}-${surface}.png`, Buffer.from(shot.data, "base64"));
          } finally { await mask?.evaluate(element => element.parentNode?.removeChild(element)); }
        };
        const receipts: unknown[] = [];
        const saveReceipt = (status: string) => writeFileSync(`${acceptanceDirectory}/${channel}-${mode}.json`, JSON.stringify({ source, status, channel, version: browser.browser()?.version(), mode, method: "Native browser settings UI; no viewport, deviceScaleFactor or page-scale override. Text size uses owned profile default_font_size. Full-frame CDP capture; Merchant QR block masked.", baseline, settingReadback, receipts }, null, 2));
        saveReceipt("STARTED");
        for (const surface of ["customer", "staff", "pos", "kds", "merchant", "admin"] as const) {
          if (surface !== "customer") await loginLocalTestAccount(page,
            surface === "admin" ? "platform.admin@stallorder.test" : surface === "merchant" ? "owner@stallorder.test" : surface === "kds" ? "kitchen@stallorder.test" : "staff@stallorder.test", "StallOrderDemo!2026");
          await page.goto(surface === "customer" ? `/q/${fixture.qrToken}` : surface === "admin" ? "/admin/plan-versions" : surface === "merchant" ? "/merchant/aming-chicken" : surface === "kds" ? "/kitchen?stall=aming-chicken" : "/staff/aming-chicken");
          receipts.push({ surface, phase: "before-interaction", nativeGeometry: await page.evaluate(() => ({ innerWidth, outerWidth, innerHeight, dpr: devicePixelRatio, pinchScale: visualViewport?.scale, rootFont: getComputedStyle(document.documentElement).fontSize })) });
          saveReceipt("STARTED");
          let target: Locator;
          if (surface === "customer") {
            await qrProductSelectionControl(page.getByRole("article").filter({ has: page.getByRole("heading", { name: longProductName, exact: true }) }), longProductName).click();
            await page.getByTestId("qr-product-configuration").getByRole("radio").first().check();
            target = page.getByTestId("qr-product-configuration").getByRole("button", { name: "加入購物車", exact: true });
          } else if (surface === "staff" || surface === "pos") {
            await dismissStaffStartReminder(page);
            if (surface === "pos") {
              await page.getByRole("button", { name: "店員點餐", exact: true }).click();
              target = page.getByTestId("staff-product-card").filter({ hasText: longProductName }).getByTestId("staff-open-product-configurator");
              await target.scrollIntoViewIfNeeded();
              await capture("pos-catalog");
              await target.click();
              await page.getByTestId("staff-product-configurator").getByRole("radio").first().check();
              target = page.getByTestId("staff-product-configurator").getByRole("button", { name: "加入購物車", exact: true });
            } else {
              target = page.getByTestId("staff-search-open");
              await target.click();
              await page.keyboard.press("Escape");
            }
          } else if (surface === "kds") {
            await page.getByTestId("kitchen-order-queue-button").filter({ hasText: "B3-001" }).click();
            target = page.getByTestId("kitchen-order-actions-pane").getByRole("button").first();
          } else if (surface === "merchant") {
            const opener = page.getByRole("button", { name: "攤位商品設定", exact: true });
            if (await opener.isVisible()) await opener.click();
            const choice = page.locator("[data-stall-product-list]").getByRole("checkbox").first();
            await choice.check(); await choice.uncheck(); target = choice.locator("..");
          } else {
            target = page.getByTestId("admin-plan-version-record").first().locator("summary");
            await target.click();
          }
          const targetBounds = await reachable(target, surface === "kds" ? 48 : 44);
          const readback = await page.evaluate(() => ({ innerWidth, outerWidth, dpr: devicePixelRatio, pinchScale: visualViewport?.scale, rootFont: getComputedStyle(document.documentElement).fontSize, scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
          expect.soft(Math.abs(readback.innerWidth - baseline.innerWidth / zoom)).toBeLessThanOrEqual(1);
          expect.soft(readback.dpr / baseline.dpr).toBeCloseTo(zoom, 1);
          expect.soft(readback.pinchScale).toBe(1);
          expect.soft(readback.rootFont).toBe(mode === "text200" ? "32px" : "16px");
          expect.soft(readback.scrollWidth).toBeLessThanOrEqual(readback.clientWidth + 1);
          receipts.push({ surface, readback, targetBounds });
          await capture(surface);
        }
        saveReceipt(test.info().errors.length ? "FAIL" : "PASS");
      } finally { await browser.close(); }
    });
  }
}

async function keyboardDialog(page: Page, dialog: Locator) {
  await expect(dialog).toBeVisible();
  const controls = dialog.locator('button:visible:not(:disabled), input:visible:not(:disabled), select:visible:not(:disabled), textarea:visible:not(:disabled), a[href]:visible');
  await controls.last().focus();
  await page.keyboard.press("Tab");
  expect.soft(await dialog.evaluate(element => element.contains(document.activeElement)), "Tab remains inside dialog").toBe(true);
  await page.keyboard.press("Shift+Tab");
  expect.soft(await dialog.evaluate(element => element.contains(document.activeElement)), "Shift+Tab remains inside dialog").toBe(true);
  const focus = await page.locator(":focus").evaluate(element => ({ outline: getComputedStyle(element).outline, shadow: getComputedStyle(element).boxShadow }));
  expect.soft((focus.outline.includes("none") || focus.outline.includes("0px")) && focus.shadow === "none", "keyboard focus visibly styled").toBe(false);
  return focus;
}

for (const surface of ["customer", "staff", "pos", "kds", "merchant", "admin", "mini"] as const) {
  for (const appearance of [{ locale: "zh-TW", theme: "light" }, { locale: "en", theme: "dark" }] as const) {
    test(`${surface} eight widths ${appearance.locale} ${appearance.theme}`, async ({ page, context }, testInfo) => {
      test.setTimeout(360_000);
      const errors: string[] = [];
      await page.emulateMedia({ reducedMotion: "reduce" });
      page.on("pageerror", error => errors.push(error.message));
      if (!["customer", "mini"].includes(surface)) {
        const email = surface === "admin" ? "platform.admin@stallorder.test" : surface === "kds" ? "kitchen@stallorder.test" : surface === "merchant" ? "owner@stallorder.test" : "staff@stallorder.test";
        await loginLocalTestAccount(page, email, "StallOrderDemo!2026");
      }
      await context.addCookies([{ name: "stallorder_locale", value: appearance.locale, url: "http://127.0.0.1:3026" }]);
      await page.addInitScript(theme => localStorage.setItem("stallorder.theme.preference", theme), appearance.theme);
      const route = surface === "customer" ? `/q/${appearance.locale === "en" ? fixture.localeQrToken : fixture.qrToken}` : surface === "mini" ? "/mini" : surface === "kds" ? "/kitchen?stall=aming-chicken" : surface === "merchant" ? "/merchant/aming-chicken" : surface === "admin" ? "/admin/plan-versions" : "/staff/aming-chicken";
      await page.setViewportSize({ width: 320, height: 900 });
      await page.goto(route);
      if (surface === "customer" && appearance.locale === "en") {
        const selector = page.locator("[data-current-locale]");
        await expect(selector).toHaveCount(1);
        await expect(selector).toHaveAttribute("data-current-locale", "en");
      }
      if (surface === "customer") {
        const search = page.getByRole("searchbox");
        await search.fill("b3-no-matching-product-000");
        await expect(page.getByRole("article")).toHaveCount(0);
        await expect(page.getByRole("status").filter({ hasText: /找不到|No products|No food|No matching/i }).first()).toBeVisible();
        await search.clear();
      }
      if (["staff", "pos"].includes(surface)) await dismissStaffStartReminder(page);
      if (surface === "staff") {
        await page.getByTestId("staff-search-open").click();
        const search = page.getByRole("dialog");
        await search.getByRole("searchbox").fill("B3-001");
        await search.getByRole("button", { name: /^(確認|Confirm)$/i }).click();
        await expect(search).toBeHidden();
      }
      const receipt: unknown[] = [];
      for (const width of acceptanceWidths) {
        await page.setViewportSize({ width, height: 900 });
        const iconTargets = await page.locator("button, a[href]").evaluateAll(elements => elements.flatMap(element => {
          if (!(element instanceof HTMLElement) || !element.checkVisibility() || !element.querySelector("svg") || element.innerText.trim()) return [];
          const rect = element.getBoundingClientRect();
          const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
          if (!(hit === element || element.contains(hit))) return [];
          return [{ name: element.getAttribute("aria-label") ?? element.getAttribute("title") ?? element.textContent?.trim(), width: rect.width, height: rect.height }];
        }));
        expect.soft(iconTargets.filter(target => target.width < 44 || target.height < 44), "uncovered icon targets").toEqual([]);
        let target: Locator | undefined;
        let dialog: Locator | undefined;
        let opener: Locator | undefined;
        if (surface === "customer") {
          const name = appearance.locale === "en" ? longProductNameEnglish : longProductName;
          const product = page.getByRole("article").filter({ has: page.getByRole("heading", { name, exact: true }) });
          opener = qrProductSelectionControl(product, name);
          await opener.click();
          dialog = page.getByTestId("qr-product-configuration");
          await dialog.getByRole("radio").first().check();
          target = dialog.getByRole("button", { name: /加入購物車|Add to cart/i, exact: true });
        } else if (surface === "staff") {
          if (width < 768) {
            opener = page.getByTestId("staff-order-mobile-list").getByRole("article").filter({ hasText: "B3-001" }).getByRole("button", { name: /查看明細|View details/i });
            await opener.click();
            dialog = page.getByRole("dialog").filter({ has: page.getByTestId("staff-order-mobile-detail") });
          } else {
            await page.getByTestId("staff-order-list-pane").getByRole("button").filter({ hasText: "B3-001" }).click();
          }
          target = page.getByTestId("staff-order-primary-actions").getByRole("button").filter({ visible: true }).first();
          // Exercise browser actionability/scrolling without completing a frozen order.
          await target.click({ trial: true });
        } else if (surface === "pos") {
          opener = page.getByRole("button", { name: /店員點餐|Take order/i, exact: true });
          await opener.click();
          dialog = page.getByRole("dialog").filter({ has: page.getByTestId("staff-product-card") });
          target = dialog.getByTestId("staff-open-product-configurator").first();
        } else if (surface === "kds") {
          target = page.getByTestId("kitchen-order-queue-button").filter({ hasText: "B3-001" });
          await target.click();
          target = page.getByTestId("kitchen-order-actions-pane").getByRole("button").first();
        } else if (surface === "merchant") {
          if (width < 768) {
            opener = page.getByRole("button", { name: /攤位商品設定|Booth product settings/i, exact: true });
            await opener.click();
            dialog = page.getByRole("dialog").filter({ has: page.locator("[data-stall-product-list]") });
          }
          const choice = page.locator("[data-stall-product-list]").getByRole("checkbox").first();
          await choice.check();
          await expect(choice).toBeChecked();
          await choice.uncheck();
          target = choice.locator("..");
        } else if (surface === "admin") {
          const record = page.getByTestId("admin-plan-version-record").first();
          target = record.locator("summary");
          await target.click();
          await expect(record.locator("details")).toHaveAttribute("open", "");
        } else {
          await expect(page.getByRole("status")).toBeVisible();
          await expect(page.getByRole("button", { name: /LINE.*登入|LINE.*login/i })).toHaveCount(0);
        }
        const targetBounds = target ? await reachable(target, ["customer", "staff", "kds"].includes(surface) ? 48 : 44) : null;
        const focus = dialog ? await keyboardDialog(page, dialog) : null;
        const layout = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth, theme: document.documentElement.dataset.theme, locale: document.documentElement.lang, reduced: matchMedia("(prefers-reduced-motion: reduce)").matches, transition: getComputedStyle(document.body).transitionDuration, animation: getComputedStyle(document.body).animationDuration }));
        expect.soft(layout.scrollWidth).toBeLessThanOrEqual(layout.width + 1);
        expect.soft(layout.theme).toBe(appearance.theme);
        expect.soft(layout.locale).toBe(appearance.locale);
        expect.soft(layout.reduced).toBe(true);
        expect.soft(parseFloat(layout.transition)).toBeLessThanOrEqual(0.00001);
        expect.soft(parseFloat(layout.animation)).toBeLessThanOrEqual(0.00001);
        const scan = (width === 320 || width === 1440) ? await new AxeBuilder({ page }).analyze() : null;
        const violations = scan?.violations.filter(violation => ["critical", "serious"].includes(violation.impact ?? "")) ?? [];
        expect.soft(violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.map(n => n.target) })), "axe critical/serious").toEqual([]);
        const contrast = scan?.passes.find(rule => rule.id === "color-contrast")?.nodes.map(node => ({ target: node.target, checks: node.any.map(check => check.data) }));
        receipt.push({ width, layout, targetBounds, focus, iconTargets, violations, contrast });
        if ([390, 768, 1024, 1440].includes(width)) await page.screenshot({ path: `${acceptanceDirectory}/${surface}-${appearance.locale}-${width}.png`, mask: surface === "merchant" ? [page.getByTestId("merchant-ordering-qr")] : [] });
        if (dialog) {
          await page.keyboard.press("Escape");
          await expect(dialog).toBeHidden();
          if (opener) await expect(opener).toBeFocused();
        }
        if (surface === "admin") await target!.click();
      }
      writeFileSync(`${acceptanceDirectory}/${surface}-${appearance.locale}.json`, JSON.stringify({ source: readResponsiveBuildProvenance(), title: testInfo.title, receipt, errors }, null, 2));
      expect(errors).toEqual([]);
    });
  }
}

test("phone partial CSV success preserves row errors and reachable apply", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 620 });
  await loginLocalTestAccount(page, "owner@stallorder.test", "StallOrderDemo!2026");
  await page.goto(`/merchant/catalog?organizationId=${fixture.organizationId}`);
  const row = (id: string, price: string) => [id, "responsive-b3-fixed-120-v1", "", "B3 partial import fixture", "", price, "", "0", "false", "", ...Array(10).fill(""), "true", "true"].join(",");
  const csv = `${catalogCsvHeaders.join(",")}\n${row(fixture.importProductId, "50")}\n${row("", "=100")}`;
  // Accessible role excludes Next's transient hidden streaming copy of the input.
  await page.getByRole("button", { name: "匯入 CSV", exact: true }).setInputFiles({ name: "b3-partial.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  const dialog = page.getByRole("dialog", { name: "CSV 匯入預覽" });
  await expect(dialog.getByRole("list", { name: "錯誤資料" })).toContainText("CSV 第 3 列");
  const target = dialog.getByRole("button", { name: "套用 1 筆有效資料" });
  await reachable(target);
  await keyboardDialog(page, dialog);
  await target.click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("status").filter({ hasText: "已套用 1 筆商品，略過 1 筆錯誤資料。" })).toBeVisible();
  await page.screenshot({ path: `${acceptanceDirectory}/merchant-partial-success.png` });
});
