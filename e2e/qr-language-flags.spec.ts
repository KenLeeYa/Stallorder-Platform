import { expect, test } from "@playwright/test";
import { createOpenQrFixture } from "./open-qr-fixture";

const organizationId = "11111111-1111-4111-8111-111111111111";
const stallId = "22222222-2222-4222-8222-222222222222";
let qrFixture: Awaited<ReturnType<typeof createOpenQrFixture>>;

const expectedLocales = [
  { locale: "zh-TW", label: "繁體中文", flagPath: "/flags/tw.svg" },
  { locale: "en", label: "English", flagPath: "/flags/us.svg" },
  { locale: "ja", label: "日本語", flagPath: "/flags/jp.svg" },
  { locale: "ko", label: "한국어", flagPath: "/flags/kr.svg" },
  { locale: "vi", label: "Tiếng Việt", flagPath: "/flags/vn.svg" },
  { locale: "th", label: "ไทย", flagPath: "/flags/th.svg" },
] as const;

test.beforeAll(async () => {
  qrFixture = await createOpenQrFixture({
    organizationId,
    stallId,
    tokenPrefix: "qr-language-e2e",
    label: "QR language E2E",
  });
});

test.afterAll(async () => {
  await qrFixture.restore();
});

test("QR 點餐語言選單的所有語系都有對應國旗", async ({ page }, testInfo) => {
  await page.goto(`/q/${qrFixture.qrToken}`);
  const trigger = page.getByRole("button", { name: "點餐語言" });
  await expect(trigger).toHaveAttribute("data-current-locale", "zh-TW");
  await expect(trigger.locator('[data-locale-flag="zh-TW"]')).toBeVisible();
  await trigger.click();

  const options = page.getByRole("option");
  await expect(options).toHaveCount(expectedLocales.length);
  for (const expected of expectedLocales) {
    const option = page.getByRole("option", { name: expected.label, exact: true });
    const flag = option.locator(`[data-locale-flag="${expected.locale}"]`);
    await expect(option).toBeVisible();
    await expect(flag).toHaveAttribute("src", new RegExp(expected.flagPath.replace("/", "\\/")));
  }
  await page.locator('[role="listbox"]').screenshot({ path: testInfo.outputPath("qr-language-flags.png") });

  await page.getByRole("option", { name: "English", exact: true }).click();
  await expect(page.getByRole("button", { name: "Menu language" })).toHaveAttribute("data-current-locale", "en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});
