import { expect, test } from "@playwright/test";

const password = "StallOrderDemo!2026";

test("商家可用月亮與太陽切換明暗模式並保留偏好", async ({ page }) => {
  await page.goto("/login");
  const loginToggle = page.getByRole("button", { name: "切換為暗黑模式" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(loginToggle).toHaveAttribute("aria-pressed", "false");
  await expect(loginToggle.locator("svg.theme-switch-to-dark")).toBeVisible();
  await loginToggle.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("button", { name: "切換為白光模式" })).toHaveAttribute("aria-pressed", "true");
  const contrastRatios = await page.evaluate(() => {
    const pairs = [
      ["bg-teal-50", "text-teal-950"],
      ["bg-emerald-50", "text-emerald-950"],
      ["bg-amber-50", "text-amber-950"],
      ["bg-red-50", "text-red-950"],
      ["bg-sky-50", "text-sky-950"],
      ["bg-violet-50", "text-violet-950"],
    ];
    function luminance(rgb: string) {
      const channels = rgb.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? [0, 0, 0];
      const linear = channels.map((channel) => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
    }
    return pairs.map(([background, foreground]) => {
      const sample = document.createElement("span");
      sample.className = `${background} ${foreground}`;
      sample.textContent = "狀態訊息";
      document.body.append(sample);
      const style = getComputedStyle(sample);
      const light = Math.max(luminance(style.color), luminance(style.backgroundColor));
      const dark = Math.min(luminance(style.color), luminance(style.backgroundColor));
      sample.remove();
      return { pair: `${background}/${foreground}`, ratio: (light + 0.05) / (dark + 0.05) };
    });
  });
  for (const result of contrastRatios) expect(result.ratio, result.pair).toBeGreaterThanOrEqual(4.5);

  const controlContrastRatios = await page.evaluate(() => {
    function luminance(rgb: string) {
      const channels = rgb.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? [0, 0, 0];
      const linear = channels.map((channel) => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
    }
    function ratio(first: string, second: string) {
      const light = Math.max(luminance(first), luminance(second));
      const dark = Math.min(luminance(first), luminance(second));
      return (light + 0.05) / (dark + 0.05);
    }
    const utilityControl = document.createElement("button");
    utilityControl.className = "border border-stone-300 bg-white text-stone-700";
    document.body.append(utilityControl);
    const utilityStyle = getComputedStyle(utilityControl);
    const field = document.createElement("input");
    field.className = "form-input";
    document.body.append(field);
    const fieldStyle = getComputedStyle(field);
    const result = [
      { pair: "border-stone-300/bg-white", ratio: ratio(utilityStyle.borderTopColor, utilityStyle.backgroundColor) },
      { pair: "form-input border/background", ratio: ratio(fieldStyle.borderTopColor, fieldStyle.backgroundColor) },
    ];
    utilityControl.remove();
    field.remove();
    return result;
  });
  for (const result of controlContrastRatios) expect(result.ratio, result.pair).toBeGreaterThanOrEqual(3);

  await page.evaluate(() => {
    const hoverSample = document.createElement("button");
    hoverSample.dataset.testid = "dark-hover-white";
    hoverSample.className = "hover:bg-white text-stone-950";
    hoverSample.textContent = "Hover";
    document.body.append(hoverSample);
  });
  const hoverSample = page.getByTestId("dark-hover-white");
  await hoverSample.hover();
  await expect.poll(() => hoverSample.evaluate((element) => getComputedStyle(element).backgroundColor))
    .toBe("rgb(28, 25, 23)");
  await hoverSample.evaluate((element) => element.remove());

  const darkOverlay = await page.evaluate(() => {
    const sample = document.createElement("div");
    sample.style.backgroundImage = "linear-gradient(var(--cds-surface-overlay), var(--cds-surface-overlay))";
    document.body.append(sample);
    const value = getComputedStyle(sample).backgroundImage;
    sample.remove();
    return value;
  });
  expect(darkOverlay).toContain("rgba(12, 10, 9, 0.94)");

  await page.emulateMedia({ media: "print" });
  const printColors = await page.evaluate(() => {
    const ticket = document.createElement("article");
    ticket.className = "print:block bg-stone-900 text-white border border-stone-300";
    ticket.textContent = "列印票券";
    document.body.append(ticket);
    const bodyStyle = getComputedStyle(document.body);
    const ticketStyle = getComputedStyle(ticket);
    const result = {
      bodyBackground: bodyStyle.backgroundColor,
      bodyColor: bodyStyle.color,
      ticketBackground: ticketStyle.backgroundColor,
      ticketColor: ticketStyle.color,
    };
    ticket.remove();
    return result;
  });
  expect(printColors).toEqual({
    bodyBackground: "rgb(255, 255, 255)",
    bodyColor: "rgb(28, 25, 23)",
    ticketBackground: "rgba(0, 0, 0, 0)",
    ticketColor: "rgb(28, 25, 23)",
  });
  await page.emulateMedia({ media: "screen" });

  await page.getByRole("button", { name: "使用電子郵件與密碼登入", exact: true }).click();
  await page.getByLabel("電子郵件").fill("owner@stallorder.test");
  await page.getByLabel("密碼").fill(password);
  await page.getByRole("button", { name: "登入", exact: true }).click();
  await expect(page).toHaveURL(/\/merchant\//);

  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const merchantToggle = page.getByRole("button", { name: "切換為白光模式" });
  await expect(merchantToggle.locator("svg.theme-switch-to-light")).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("stallorder.theme.preference")))
    .toBe("dark");
  await expect.poll(() => page.locator("body").evaluate((body) => getComputedStyle(body).backgroundColor))
    .toBe("rgb(12, 10, 9)");

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "切換為白光模式" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  await page.goto("/q/demo-aming-chicken-qr-2026-rotate-me");
  const qrToggle = page.getByRole("button", { name: "切換為暗黑模式" });
  await expect(qrToggle).toBeVisible({ timeout: 30_000 });
  await qrToggle.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});
