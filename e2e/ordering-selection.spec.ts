import { expect, test } from "@playwright/test";
import { continueQrCheckout } from "./local-navigation";

test.use({ serviceWorkers: "block" });

// Real customer components with deterministic session responses; no orders are submitted.
for (const orderingMode of ["DEFAULT", "PREORDER", "DELIVERY"] as const) {
  test(`Ordering selections: ${orderingMode} preserves options, limits, cart and acknowledgments`, async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width: 390, height: 1000 });
    await page.clock.install({ time: new Date("2099-08-03T01:00:00.000Z") });
    await page.route("**/api/availability/config", (route) => route.fulfill({ json: {
      mode: "NORMAL_PRIMARY", activeBackend: "PRIMARY", promotionEpoch: 1,
      orderIntake: "EDGE_PRIMARY", qrOrdering: "AVAILABLE", staffOnline: "AVAILABLE",
      offlinePos: "AVAILABLE", linePay: "AVAILABLE", jkoPay: "AVAILABLE",
      updatedAt: "2099-08-03T00:00:00.000Z",
    } }));
    await page.route(/\/(?:create-order-session|api\/public\/order-session)$/u, (route) => route.fulfill({
      status: 201,
      headers: { "access-control-allow-origin": "*" },
      json: {
        orderingMode, orderSessionToken: `stos_${"c".repeat(43)}`,
        expiresAt: "2099-08-03T02:00:00.000Z",
        preorderSlots: ["2099-08-03T04:00:00.000Z"], lotteryEnabled: false,
        stall: { name: "勾選介面測試攤位", slug: "selection-e2e", location: "本機介面測試",
          currency: "TWD", timezone: "Asia/Taipei", fulfillmentType: orderingMode === "DELIVERY" ? "DELIVERY" : "TAKEOUT", table: null },
        products: [{
          id: "44444444-4444-4444-8444-444444444441", name: "牛肉河粉", description: "點按整個選項即可勾選",
          price: 170, kind: "SINGLE", category: "河粉", rank: null, isBestSeller: false,
          isSoldOut: false, imageUrl: null, translations: [], bundleChoiceGroups: [],
          noteGroups: [
            { id: "spice", name: "辣度", selectionMode: "SINGLE", isRequired: true, minSelections: 1, maxSelections: 1, sortOrder: 0, translations: [],
              options: [{ id: "mild", name: "小辣", priceDelta: 0, sortOrder: 0, translations: [] }, { id: "hot", name: "大辣", priceDelta: 0, sortOrder: 1, translations: [] }] },
            { id: "extras", name: "加購選項", selectionMode: "MULTIPLE", isRequired: false, minSelections: 0, maxSelections: 2, sortOrder: 1, translations: [],
              options: [{ id: "meat", name: "肉量加倍", priceDelta: 50, sortOrder: 0, translations: [] }, { id: "noodles", name: "加麵", priceDelta: 20, sortOrder: 1, translations: [] }, { id: "egg", name: "加蛋", priceDelta: 15, sortOrder: 2, translations: [] }] },
          ],
        }],
        supportedLocales: ["zh-TW"], estimatedWaitMinutes: 30, estimatedWaitMinMinutes: 25,
        estimatedWaitMaxMinutes: 30, waitAcknowledgmentThresholdMinutes: 15,
        requiresWaitAcknowledgment: true, lastTableOrderAt: null,
        limits: { maxItemQuantity: 20, maxUniqueProducts: 20, maxTotalQuantity: 50, maxNoteLength: 300 },
      },
    }));
    await page.goto(orderingMode === "DEFAULT"
      ? "/q/selection-e2e-DEFAULT"
      : orderingMode === "PREORDER" ? "/s/aming-chicken" : "/delivery/aming-chicken");
    await expect(page.getByRole("heading", { name: "勾選介面測試攤位" })).toBeVisible();
    if (orderingMode === "PREORDER") await page.getByRole("button", { name: "套用這個時間", exact: true }).click();
    await page.getByTestId("qr-open-product-configurator").click();
    const configurator = page.getByTestId("qr-product-configuration");
    const meat = configurator.getByRole("checkbox", { name: /肉量加倍/ });
    const noodles = configurator.getByRole("checkbox", { name: /加麵/ });
    const egg = configurator.getByRole("checkbox", { name: /加蛋/ });
    await expect(configurator.getByText("請完成「牛肉河粉」的必選註記。")).toBeVisible();
    await configurator.getByRole("radio", { name: "小辣", exact: true }).click();
    await configurator.getByRole("radio", { name: "大辣", exact: true }).click();
    await expect(configurator.getByRole("radio", { name: "小辣", exact: true })).not.toBeChecked();
    await expect(configurator.getByRole("radio", { name: "大辣", exact: true })).toBeChecked();
    await meat.click();
    await noodles.click();
    await expect(egg).toBeDisabled();
    await noodles.focus();
    await page.keyboard.press("Space");
    await expect(noodles).not.toBeChecked();
    await expect(egg).toBeEnabled();
    await expect(meat.locator(".ordering-selection-mark")).toHaveAttribute("data-checked", "true");
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const mode of ["standard", "senior"]) {
        for (const theme of ["light", "dark"]) {
          await page.locator("html").evaluate((html, settings) => {
            html.dataset.interfaceMode = settings.mode;
            html.dataset.theme = settings.theme;
          }, { mode, theme });
          for (const choice of [meat, noodles]) {
            const marker = await choice.locator(".ordering-selection-mark").boundingBox();
            expect(marker?.width).toBeLessThanOrEqual(28);
            expect(marker?.width).toBe(marker?.height);
            expect((await choice.boundingBox())?.height).toBeGreaterThanOrEqual(44);
          }
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
          if (orderingMode === "DEFAULT" && [390, 768].includes(width)) {
            await page.screenshot({ path: testInfo.outputPath(`ordering-${width}-${mode}-${theme}.png`) });
          }
        }
      }
    }
    await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
    const selectedStyle = await meat.locator(".ordering-selection-mark").evaluate((element) => ({ color: getComputedStyle(element).color, background: getComputedStyle(element).backgroundColor }));
    expect(selectedStyle.color).not.toBe(selectedStyle.background);
    await expect(noodles.locator(".ordering-selection-mark")).toHaveCSS("color", "rgba(0, 0, 0, 0)");
    await page.emulateMedia({ forcedColors: "none", reducedMotion: "no-preference" });
    await page.setViewportSize({ width: 390, height: 1000 });
    await configurator.getByRole("button", { name: "加入購物車", exact: true }).click();
    await expect(configurator).not.toBeVisible();
    await page.getByTestId("qr-mobile-cart-summary").click();
    const cart = page.getByTestId("qr-cart-panel");
    await expect(cart.getByTestId("qr-cart-lines")).toContainText("肉量加倍");
    await cart.getByRole("button", { name: "繼續填寫訂購資料", exact: true }).click();
    await continueQrCheckout(page);
    const utensils = cart.getByRole("checkbox", { name: /需要免洗餐具/ });
    await utensils.check();
    await expect(utensils).toBeChecked();
    await utensils.focus();
    await page.keyboard.press("Space");
    await expect(utensils).not.toBeChecked();
    await expect(cart.locator("input.ordering-checkbox")).toHaveCount(2);
    const wait = cart.locator("input.ordering-checkbox").last();
    await wait.check();
    await expect(wait).toBeChecked();
    expect((await utensils.boundingBox())?.width).toBeLessThanOrEqual(28);
    await page.screenshot({ path: testInfo.outputPath(`checkout-${orderingMode}-390.png`) });
    expect(errors).toEqual([]);
  });
}
