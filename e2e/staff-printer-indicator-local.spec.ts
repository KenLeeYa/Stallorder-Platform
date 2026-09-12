import { test, expect, type Page } from "@playwright/test";

// UI/transport mocks must not be bypassed by a running worker's own network requests.
// The unchanged real worker is verified separately through its native capability handshake.
test.use({ browserName: process.env.LOCAL_QA_BROWSER === "webkit" ? "webkit" : "chromium", userAgent: "StarWebPRNTBrowser/3.0 iPad", serviceWorkers: "block" });
test.skip(process.env.LOCAL_PRINTER_INDICATOR_QA !== "true", "Explicit local QA only; printer transport is simulated.");
const slug = "aming-chicken";
const origin = process.env.PLAYWRIGHT_APP_URL ?? "http://127.0.0.1:3018";

test.beforeEach(async ({ page }) => {
  if (!["http://127.0.0.1:3018", "http://127.0.0.1:3028"].includes(origin)) throw new Error("LOCAL_TARGET_MISMATCH");
  page.on("pageerror", error => console.log("QA_PAGE_ERROR:", error.message));
  await page.addInitScript(() => {
    const device = window as typeof window & { qaPrinter: string };
    device.qaPrinter = "READY";
    class Trader {
      onReceive?: (response: object) => void;
      onTimeout?: () => void;
      sendMessage({ request }: { request: string }) {
        if (request !== '<text encoding="utf-8"></text>') throw new Error("QA_MUST_NOT_PRINT");
        if (device.qaPrinter === "TIMEOUT") this.onTimeout?.();
        else this.onReceive?.({ traderSuccess: "true", traderStatus: "0000000000000000" });
      }
      isPaperEnd() { return device.qaPrinter === "PAPER_END"; }
      isCoverOpen() { return device.qaPrinter === "COVER_OPEN"; }
      isOffLine() { return device.qaPrinter === "OFFLINE"; }
      isAutoCutterError() { return false; }
      isRollPositionError() { return false; }
      isHighTemperatureStop() { return false; }
      isNonRecoverableError() { return false; }
    }
    const installTransport = () => Object.defineProperty(window, "StarWebPrintTrader", { configurable: true, writable: true, value: Trader });
    installTransport();
    // The real vendor script still passes its integrity check; replace only its transport before onReady.
    document.addEventListener("load", event => {
      if (event.target instanceof HTMLScriptElement && event.target.src.includes("StarWebPrintTrader-1.2.0.js")) installTransport();
    }, true);
  });
});

async function login(page: Page) {
  await page.goto(origin + "/login");
  await page.waitForFunction(() => {
    const button = document.querySelector('[data-testid="local-qa-login-grid"] button');
    return button && Object.keys(button).some(key => key.startsWith("__reactProps$")
      && typeof (button as unknown as Record<string, { onClick?: unknown }>)[key]?.onClick === "function");
  });
  await page.getByTestId("local-qa-login-grid").getByRole("button", { name: "店員", exact: true }).click();
  await expect(page).toHaveURL(origin + "/staff/" + slug);
  await page.waitForFunction(() => {
    const button = document.querySelector('button[aria-label="鎖屏通知"]');
    return button && Object.keys(button).some(key => key.startsWith("__reactProps$")
      && typeof (button as unknown as Record<string, { onClick?: unknown }>)[key]?.onClick === "function");
  });
}

test("連線、缺紙、斷線與恢復會更新圖示；成功狀態不占用看板高度", async ({ page }) => {
  test.setTimeout(120_000);
  let configured = "READY";
  const operations: string[] = [], errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/stalls/" + slug + "/print-jobs", async route => {
    const operation = route.request().postDataJSON()?.operation;
    operations.push(operation);
    if (!["REFRESH", "HEARTBEAT"].includes(operation)) throw new Error("QA_UNEXPECTED_PRINT_COMMAND:" + operation);
    await route.fulfill({ json: { state: {
      printers: configured === "NO_PRINTER" ? [] : [{ id: "qa-printer", name: "QA 連線印表機", isEnabled: true,
        autoDetectEnabled: true, connectionType: "WEBPRNT_BLUETOOTH", openCashDrawerOnCashPayment: false }],
      rules: configured === "NO_RULE" ? [] : [{ printerId: "qa-printer", isEnabled: true, autoPrint: true }], jobs: [],
    } } });
  });
  await login(page);
  const icon = page.locator('a[href="/staff/' + slug + '/print"]');
  await expect.poll(() => operations.includes("HEARTBEAT")).toBe(true);
  if (process.env.LOCAL_QA_EVIDENCE) await page.screenshot({ path: process.env.LOCAL_QA_EVIDENCE + "/printer-initial-" + (process.env.LOCAL_QA_BROWSER ?? "chromium") + ".png" });
  await expect(icon).toHaveClass(/bg-teal-50/);
  const status = page.getByTestId("staff-printer-status");
  await expect(status).toHaveClass(/sr-only/);
  await expect(icon).toHaveAttribute("title", /QA 連線印表機/);
  for (const state of ["PAPER_END", "COVER_OPEN", "OFFLINE", "TIMEOUT"]) {
    await page.evaluate(value => { (window as typeof window & { qaPrinter: string }).qaPrinter = value; }, state);
    await expect(icon).toHaveAttribute("data-printer-status", "ERROR");
    await expect(icon).not.toHaveClass(/bg-teal-50/);
    await expect(status).not.toHaveClass(/sr-only/);
    await expect(status).toBeVisible();
    await page.evaluate(() => { (window as typeof window & { qaPrinter: string }).qaPrinter = "READY"; });
    await expect(icon).toHaveAttribute("data-printer-status", "READY");
  }
  configured = "NO_RULE";
  await expect(icon).toHaveAttribute("data-printer-status", "CONNECTED_NO_RULE");
  await expect(icon).toHaveClass(/bg-teal-50/);
  await expect(status).toContainText("尚未建立並啟用自動出單規則");
  await expect(status).not.toHaveClass(/sr-only/);
  configured = "NO_PRINTER";
  await expect(icon).toHaveAttribute("data-printer-status", "NOT_CONFIGURED");
  await expect(icon).not.toHaveClass(/bg-teal-50/);
  configured = "READY";
  await expect(icon).toHaveAttribute("data-printer-status", "READY");
  for (const theme of ["light", "dark"]) {
    await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
    for (const width of [320, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      const size = await icon.boundingBox();
      expect(size?.width).toBeGreaterThanOrEqual(44);
      expect(size?.height).toBeGreaterThanOrEqual(44);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
      expect((await status.boundingBox())?.height).toBeLessThanOrEqual(1);
    }
  }
  expect(operations.every(operation => ["REFRESH", "HEARTBEAT"].includes(operation))).toBe(true);
  expect(errors).toEqual([]);
});

test("不支援 Star 的瀏覽器保留設定提示且不會顯示綠色", async ({ browser }) => {
  const context = await browser.newContext({ userAgent: "Mozilla/5.0 Chrome/145 Safari/537.36" });
  const page = await context.newPage();
  await login(page);
  const icon = page.locator('a[href="/staff/' + slug + '/print"]');
  await expect(icon).toHaveAttribute("data-printer-status", "UNSUPPORTED");
  await expect(icon).not.toHaveClass(/bg-teal-50/);
  await expect(page.getByTestId("staff-printer-status")).toContainText("Star webPRNT Browser");
  await context.close();
});

test("長者模式的列印入口在手機功能選單與桌面工具列保留連線狀態", async ({ page }) => {
  await page.route("**/api/stalls/" + slug + "/print-jobs", route => route.fulfill({ json: { state: {
    printers: [{ id: "qa-printer", name: "QA 連線印表機", isEnabled: true, autoDetectEnabled: true, connectionType: "WEBPRNT_BLUETOOTH" }],
    rules: [{ printerId: "qa-printer", isEnabled: true, autoPrint: true }], jobs: [],
  } } }));
  await login(page);
  await page.evaluate(() => {
    document.documentElement.dataset.interfaceMode = "senior";
    window.dispatchEvent(new Event("stallorder:accessibility-mode-change"));
  });
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    if (width < 1024) await page.getByTestId("senior-action-menu-launcher").click();
    const icon = page.locator('a[href="/staff/' + slug + '/print"]');
    await expect(icon).toHaveAttribute("data-printer-status", "READY");
    await expect(icon).toHaveClass(/bg-teal-50/);
    await icon.scrollIntoViewIfNeeded();
    const size = await icon.boundingBox();
    expect(size?.width).toBeGreaterThanOrEqual(44);
    expect(size?.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
    await expect(page.getByTestId("staff-printer-status")).toHaveClass(/sr-only/);
    if (process.env.LOCAL_QA_EVIDENCE && width === 1440) await page.screenshot({ path: process.env.LOCAL_QA_EVIDENCE + "/printer-senior-" + (process.env.LOCAL_QA_BROWSER ?? "chromium") + ".png" });
    if (width < 1024) await page.getByRole("button", { name: "關閉功能選單", exact: true }).click();
  }
});

test("Android 音效指引與測試：舊版通知程式會擋下測試，更新後才排定", async ({ page }) => {
  await page.route("**/api/stalls/" + slug + "/print-jobs", route => route.fulfill({ json: { state: { printers: [], rules: [], jobs: [] } } }));
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "userAgent", { configurable: true, value: "Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/145.0 Mobile Safari/537.36" });
    const device = window as typeof window & { qaPushSound: boolean };
    device.qaPushSound = false;
    Object.defineProperty(window, "Notification", { configurable: true, value: class { static permission = "granted"; } });
    if (!("PushManager" in window)) Object.defineProperty(window, "PushManager", { configurable: true, value: class {} });
    Object.defineProperty(navigator.serviceWorker, "getRegistration", { configurable: true, value: async () => ({
      update: async () => undefined,
      pushManager: { getSubscription: async () => ({ endpoint: "https://fcm.googleapis.com/fcm/send/qa-not-dispatched" }) },
      active: { postMessage: (_message: object, ports: MessagePort[]) => {
        ports[0].postMessage(device.qaPushSound ? { supported: true, silent: false } : { supported: true });
      } },
    }) });
  });
  const commands: object[] = [];
  await page.route("**/api/stalls/" + slug + "/push", async route => {
    if (route.request().method() === "POST") {
      commands.push(route.request().postDataJSON());
      await route.fulfill({ status: 202, json: {} });
    } else await route.fulfill({ json: { configured: true, publicKey: null, subscriptions: [{ id: "qa-subscription", deliveries: [] }] } });
  });
  await login(page);
  await page.getByRole("button", { name: "鎖屏通知", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "新訂單鎖屏通知" });
  await expect(dialog).toBeVisible();
  const testButton = dialog.getByRole("button", { name: "30 秒後測試通知" });
  await expect(testButton).toBeEnabled();
  await testButton.click();
  await expect(dialog).toContainText("通知服務尚未更新");
  expect(commands).toEqual([]);
  await page.evaluate(() => { (window as typeof window & { qaPushSound: boolean }).qaPushSound = true; });
  await testButton.click();
  await expect(dialog).toContainText("本次已要求非靜音通知");
  expect(commands).toEqual([{ operation: "TEST", subscriptionId: "qa-subscription" }]);
  await dialog.getByText("收到通知但沒有聲音", { exact: true }).click();
  await expect(dialog.getByText(/只調高媒體音量/)).toBeVisible();
  await expect(dialog.getByRole("link", { name: "查看 Android 官方通知設定說明" })).toHaveAttribute("href", /support.google.com\/android/);
  await page.keyboard.press("Escape");
  for (const mode of ["standard", "senior"]) {
    await page.evaluate(value => {
      document.documentElement.dataset.interfaceMode = value;
      window.dispatchEvent(new Event("stallorder:accessibility-mode-change"));
    }, mode);
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 800 });
      const launcher = page.getByTestId("senior-action-menu-launcher");
      if (mode === "senior" && width < 1024) await launcher.click();
      await page.getByRole("button", { name: "鎖屏通知", exact: true }).click();
      await dialog.getByText("收到通知但沒有聲音", { exact: true }).click();
      expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      await testButton.scrollIntoViewIfNeeded();
      await expect(testButton).toBeVisible();
      if (process.env.LOCAL_QA_EVIDENCE && width === 1440) await page.screenshot({ path: process.env.LOCAL_QA_EVIDENCE + "/push-sound-guide-" + mode + "-" + (process.env.LOCAL_QA_BROWSER ?? "chromium") + ".png" });
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      if (mode === "standard" && width === 768) {
        const capacity = page.getByTestId("staff-capacity-compact");
        await capacity.locator("summary").click();
        await expect(capacity.getByRole("heading")).toBeVisible();
        await capacity.getByRole("button", { name: "關閉", exact: true }).click();
        await expect(capacity).not.toHaveAttribute("open", "");
      }
    }
  }
  // Both the worker and server delivery are mocked; this test sends no physical notification.
});
