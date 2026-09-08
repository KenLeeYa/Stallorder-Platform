import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { establishLocalTestSession, gotoLocalPath } from "./local-navigation";

const prisma = new PrismaClient();
const stallId = "22222222-2222-4222-8222-222222222222";
const apiPath = `/api/merchant/stalls/${stallId}/line`;
const path = `/merchant/stalls/${stallId}/line`;
const dummySecret = "local-test-placeholder-only";
const appOrigin = new URL(process.env.PLAYWRIGHT_APP_URL ?? "http://localhost:3001").origin;

test.beforeAll(() => {
  const database = new URL(process.env.DATABASE_URL ?? "");
  const app = new URL(appOrigin);
  if (!['localhost', '127.0.0.1'].includes(database.hostname) || !['localhost', '127.0.0.1'].includes(app.hostname) || app.protocol !== "http:") throw new Error("LOCAL_TEST_RUNTIME_REQUIRED");
});
test.afterAll(async () => { await prisma.$disconnect(); });
test.beforeEach(async ({ page }) => {
  const owner = await prisma.profile.findUniqueOrThrow({ where: { email: "owner@stallorder.test" } });
  await establishLocalTestSession(page, prisma, owner.id);
  await gotoLocalPath(page, path);
});

for (const width of [1440, 768, 390, 320]) {
  test(`LINE 首次設定引導、取得位置及草稿保留 ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole("heading", { name: "第一次串接 LINE" })).toBeVisible();
    await expect(page.getByRole("link", { name: "開啟 LINE 官方帳號後台" })).toHaveAttribute("href", "https://manager.line.biz/");
    await expect(page.getByText(/Provider 選定後無法更換/)).toBeVisible();
    await expect(page.getByText(/不需另外申請 Vault 帳號/)).toBeVisible();
    await expect(page.getByLabel("Messaging API Channel Access Token", { exact: true })).toHaveAttribute("type", "password");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`line-account-${width}.png`) });
    await page.getByLabel("Messaging API Channel Access Token", { exact: true }).fill(dummySecret);
    await page.getByLabel("Messaging API Channel Secret", { exact: true }).fill(dummySecret);
    await page.getByRole("button", { name: "下一步", exact: true }).click();
    await expect(page.getByLabel("LINE Login Callback URL", { exact: true })).toHaveValue(`${appOrigin}/api/public/line/callback`);
    await expect(page.getByText(/目前為本機或非公開 HTTPS 網址/)).toBeVisible();
    await page.getByLabel("LINE Login Channel ID", { exact: true }).fill("1234567890");
    await page.getByLabel("LINE Login Channel Secret", { exact: true }).fill(dummySecret);
    await page.screenshot({ path: test.info().outputPath(`line-login-${width}.png`) });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.getByRole("button", { name: "上一步", exact: true }).click();
    await expect(page.getByLabel("Messaging API Channel Access Token", { exact: true })).toHaveValue(dummySecret);
    await page.getByRole("button", { name: "下一步", exact: true }).click();
    await expect(page.getByLabel("LINE Login Channel ID", { exact: true })).toHaveValue("1234567890");
    await page.getByRole("button", { name: "下一步", exact: true }).click();
    await expect(page.getByLabel("餐點可取餐", { exact: true })).toBeChecked();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`line-notifications-${width}.png`) });
    await page.getByRole("button", { name: "4 Webhook 與實測", exact: true }).click();
    await expect(page.getByText("先完成前三步並儲存，系統才會產生此攤位的 Webhook URL。", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "複製 Webhook URL", exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`line-final-${width}.png`) });
  });
}

test("儲存欄位錯誤返回對應步驟，確認後聚焦並保留草稿", async ({ page }) => {
  await fillDraft(page);
  for (const [field, step, label] of [
    ["channelAccessToken", "1 官方帳號", "Messaging API Channel Access Token"],
    ["loginChannelSecret", "2 LINE Login", "LINE Login Channel Secret"],
    ["displayName", "3 通知設定", "顯示名稱"],
  ]) {
    await page.route(`**${apiPath}`, route => route.fulfill({ status: 400, json: { error: "請檢查輸入內容。", fieldErrors: { [field]: "測試欄位錯誤" } } }));
    await page.getByRole("button", { name: "3 通知設定", exact: true }).click();
    await page.getByRole("button", { name: "儲存串接設定", exact: true }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "我知道了", exact: true }).click();
    await expect(page.getByRole("button", { name: step, exact: true })).toHaveAttribute("aria-current", "step");
    await expect(page.getByLabel(label, { exact: true })).toBeFocused();
    await expect(page.getByLabel(label, { exact: true })).not.toHaveValue("");
    await page.unroute(`**${apiPath}`);
  }
});

test("失敗重試、儲存後引導驗證及停用回饋，保持未實測狀態", async ({ page }) => {
  await fillDraft(page);
  let attempts = 0;
  await page.route(`**${apiPath}`, async route => {
    const draft = route.request().postDataJSON();
    if (draft.operation === "DISABLE") {
      if (draft.reason.length < 2) return route.fulfill({ status: 400, json: { error: "請檢查輸入內容。", fieldErrors: { reason: "停用原因太短" } } });
      return route.fulfill({ status: 200, json: { configured: false, integrationId: null, status: "DISABLED", channelId: "", settings: { displayName: "測試 LINE 通知", officialAccountUrl: "", notifyConfirmed: true, notifyReady: true, notifyCancelled: true }, updatedAt: null } });
    }
    attempts += 1;
    if (attempts === 1) return route.abort("failed");
    expect(draft.operation).toBe("UPSERT");
    expect(draft.channelAccessToken).toBe(dummySecret);
    await route.fulfill({ status: 200, json: {
      configured: true, integrationId: "33333333-3333-4333-8333-333333333333", status: "ACTIVE", channelId: draft.channelId,
      settings: { displayName: draft.displayName, officialAccountUrl: "", notifyConfirmed: true, notifyReady: true, notifyCancelled: true },
      updatedAt: new Date().toISOString(),
    } });
  });
  await page.getByRole("button", { name: "儲存串接設定", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toContainText("無法儲存 LINE 整合設定。");
  await page.getByRole("alertdialog").getByRole("button", { name: "我知道了", exact: true }).click();
  await page.getByRole("button", { name: "儲存串接設定", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "我知道了", exact: true }).click();
  await expect(page.getByLabel("Webhook URL", { exact: true })).toHaveValue(`${appOrigin}/api/webhooks/line/33333333-3333-4333-8333-333333333333`);
  await expect(page.getByText(/設定已儲存，尚未驗證實際收訊。/)).toBeVisible();
  await expect(page.getByText(/Verify 成功後開啟 Use webhook/)).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => { (window as unknown as { copiedText: string }).copiedText = text; } } });
  });
  await page.getByRole("button", { name: "複製 Webhook URL", exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as { copiedText: string }).copiedText)).toBe(`${appOrigin}/api/webhooks/line/33333333-3333-4333-8333-333333333333`);
  await page.getByRole("button", { name: "修改串接設定", exact: true }).click();
  await expect(page.getByLabel("Messaging API Channel Access Token", { exact: true })).toHaveValue("");
  await expect(page.getByText(/更新設定時需重新輸入三項憑證/)).toBeVisible();
  expect(attempts).toBe(2);
  await page.getByRole("button", { name: "停用整合", exact: true }).click();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.getByLabel("停用原因", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "停用整合", exact: true }).click();
  page.once("dialog", dialog => dialog.dismiss());
  await page.getByRole("button", { name: "確認停用", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "確認停用", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "我知道了", exact: true }).click();
  await expect(page.getByLabel("停用原因", { exact: true })).toBeFocused();
  await page.getByLabel("停用原因", { exact: true }).fill("測試停用");
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "確認停用", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "我知道了", exact: true }).click();
  await expect(page.getByRole("heading", { name: "第一次串接 LINE", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "4 Webhook 與實測", exact: true }).click();
  await expect(page.getByLabel("Webhook URL", { exact: true })).toHaveCount(0);
});

test("Callback 複製成功與拒絕權限皆有回饋且可手動複製", async ({ page }) => {
  await page.getByRole("button", { name: "2 LINE Login", exact: true }).click();
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => { (window as unknown as { copiedText: string }).copiedText = text; } } });
  });
  await page.getByRole("button", { name: "複製 Callback URL", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "網址已複製。" })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { copiedText: string }).copiedText)).toBe(`${appOrigin}/api/public/line/callback`);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new Error("clipboard denied"); } } });
  });
  await page.getByRole("button", { name: "複製 Callback URL", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "無法自動複製，請選取網址後手動複製。" })).toBeVisible();
  await expect(page.getByLabel("LINE Login Callback URL", { exact: true })).toBeFocused();
});

async function fillDraft(page: Page) {
  await page.getByRole("button", { name: "1 官方帳號", exact: true }).click();
  await page.getByLabel("Messaging API Channel Access Token", { exact: true }).fill(dummySecret);
  await page.getByLabel("Messaging API Channel Secret", { exact: true }).fill(dummySecret);
  await page.getByRole("button", { name: "下一步", exact: true }).click();
  await page.getByLabel("LINE Login Channel ID", { exact: true }).fill("1234567890");
  await page.getByLabel("LINE Login Channel Secret", { exact: true }).fill(dummySecret);
  await page.getByRole("button", { name: "下一步", exact: true }).click();
  await page.getByLabel("顯示名稱", { exact: true }).fill("測試 LINE 通知");
}
