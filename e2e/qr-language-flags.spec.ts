import { expect, test } from "@playwright/test";

const expectedLocales = [
  { locale: "zh-TW", label: "繁體中文", flagPath: "/flags/tw.svg" },
  { locale: "en", label: "English", flagPath: "/flags/us.svg" },
  { locale: "ja", label: "日本語", flagPath: "/flags/jp.svg" },
  { locale: "ko", label: "한국어", flagPath: "/flags/kr.svg" },
  { locale: "vi", label: "Tiếng Việt", flagPath: "/flags/vn.svg" },
  { locale: "th", label: "ไทย", flagPath: "/flags/th.svg" },
] as const;

test("QR 點餐語言選單的所有語系都有對應國旗", async ({ page }, testInfo) => {
  await page.goto("/q/demo-aming-chicken-qr-2026-rotate-me");
  const trigger = page.getByRole("button", { name: "點餐語言" }).filter({ visible: true });
  await expect(trigger).toHaveAttribute("data-current-locale", "zh-TW");
  await expect(trigger.locator('[data-locale-flag="zh-TW"]')).toBeVisible();
  await trigger.click();

  const options = page.getByRole("option").filter({ visible: true });
  await expect(options).toHaveCount(expectedLocales.length);
  for (const expected of expectedLocales) {
    const option = page.getByRole("option", { name: expected.label, exact: true }).filter({ visible: true });
    const flag = option.locator(`[data-locale-flag="${expected.locale}"]`);
    await expect(option).toBeVisible();
    await expect(flag).toHaveAttribute("src", new RegExp(expected.flagPath.replace("/", "\\/")));
  }
  await page.locator('[role="listbox"]').screenshot({ path: testInfo.outputPath("qr-language-flags.png") });

  await page.getByRole("option", { name: "English", exact: true }).filter({ visible: true }).click();
  await expect(page.getByRole("button", { name: "Menu language" }).filter({ visible: true })).toHaveAttribute("data-current-locale", "en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});
