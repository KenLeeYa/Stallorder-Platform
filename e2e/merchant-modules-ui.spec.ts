import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { catalogCsvHeaders } from "../src/lib/catalog-csv";
import { QR_LOCALES } from "../src/lib/qr-order-i18n";
import {
  gotoLocalPath,
  loginLocalTestAccount,
  openSharedCatalogProductActions,
  waitForDefaultMerchantDashboard,
} from "./local-navigation";

const organizationId = "11111111-1111-4111-8111-111111111111";
const stallId = "22222222-2222-4222-8222-222222222222";
const password = "StallOrderDemo!2026";
const prisma = new PrismaClient();
let originalBusinessHours: Array<{
  id: string;
  opensAt: string;
  closesAt: string;
  isClosed: boolean;
}> = [];

test.use({ serviceWorkers: "block" });

test.beforeAll(async () => {
  originalBusinessHours = await prisma.stallBusinessHour.findMany({
    where: { stallId },
    select: { id: true, opensAt: true, closesAt: true, isClosed: true },
  });
  await prisma.stallBusinessHour.updateMany({
    where: { stallId },
    data: { opensAt: "00:00", closesAt: "23:59", isClosed: false },
  });
});

test.afterAll(async () => {
  try {
    await prisma.$transaction(
      originalBusinessHours.map((hour) =>
        prisma.stallBusinessHour.update({
          where: { id: hour.id },
          data: {
            opensAt: hour.opensAt,
            closesAt: hour.closesAt,
            isClosed: hour.isClosed,
          },
        }),
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
});

async function waitForReactHandler(
  control: Locator,
  handler: "onClick" | "onChange",
) {
  await expect
    .poll(
      () =>
        control.evaluate((element, eventName) => {
          const propsKey = Object.keys(element).find((key) =>
            key.startsWith("__reactProps$"),
          );
          if (!propsKey) return false;
          const props = (element as unknown as Record<string, unknown>)[
            propsKey
          ];
          return (
            typeof props === "object" &&
            props !== null &&
            typeof (props as Record<string, unknown>)[eventName] === "function"
          );
        }, handler),
      { message: `等待 React 掛載 ${handler}` },
    )
    .toBe(true);
}

async function acknowledgeSettingsFeedback(
  page: Page,
  kind: "success" | "error",
  message?: string,
  focusAfterClose?: Locator,
) {
  const dialog = page.getByRole(kind === "error" ? "alertdialog" : "dialog", {
    name: kind === "error" ? "請確認設定" : "設定已完成",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  if (message) await expect(dialog).toContainText(message);
  const acknowledge = dialog.getByRole("button", { name: "我知道了", exact: true });
  await expect(acknowledge).toBeFocused();
  const box = await dialog.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(Math.abs(box!.x + box!.width / 2 - viewport!.width / 2)).toBeLessThan(2);
  await acknowledge.click();
  await expect(dialog).toBeHidden();
  if (focusAfterClose) await expect(focusAfterClose).toBeFocused();
}

test("商戶可在獨立頁面管理營運模組、桌位與 QR 語系", async ({
  browser,
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  await loginLocalTestAccount(page, "owner@stallorder.test", password);
  await waitForDefaultMerchantDashboard(page, organizationId);

  const settingsBasicPath = `/merchant/stalls/${stallId}/settings/basic`;
  if (process.env.PLAYWRIGHT_PRODUCTION_SERVER !== "true") {
    for (const path of [
      `/api/merchant/stalls/${stallId}`,
      `/api/merchant/stalls/${stallId}/business-hours`,
      `/api/merchant/stalls/${stallId}/memberships`,
      `/api/merchant/stalls/${stallId}/modules`,
      "/api/stalls/aming-chicken/ordering",
      `/api/merchant/organizations/${organizationId}/catalog/import`,
      `/api/merchant/organizations/${organizationId}/catalog`,
    ]) {
      const warmupResponse = await page.context().request.get(path);
      expect(warmupResponse.status()).toBe(405);
      await warmupResponse.dispose();
    }
    const settingsWarmupResponse = await page
      .context()
      .request.get(settingsBasicPath);
    expect(settingsWarmupResponse.status()).toBe(200);
    await settingsWarmupResponse.dispose();
  }

  await gotoLocalPath(page, `/merchant/stalls/${stallId}`);
  for (const title of ["攤位設定", "營運工具", "組織管理"]) {
    await expect(
      page.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
  }
  for (const label of [
    "基本資料",
    "營運狀態",
    "營業時間",
    "特殊營業日與公休公告",
    "內用點餐",
    "內用桌位與專屬 QR",
    "線上點餐與預約",
    "店員外送點餐",
    "訂單列印",
    "廚房 KDS",
    "付款方式",
    "結帳折扣",
    "抽抽樂推薦",
    "QR 點餐語系",
    "安全與訂單限制",
    "攤位成員",
    "CDS 取餐顯示",
    "產能與等候時間",
    "常用地點",
    "出攤行程",
    "LINE 通知",
    "商家資料",
    "翻譯完整度",
    "市集活動",
    "團隊與權限",
    "排程寄送",
  ]) {
    await expect(
      page.getByRole("link", { name: label, exact: true }),
    ).toBeVisible();
  }
  await expect(
    page.getByRole("link", { name: "多攤位範本", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "線上外送", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "外帶預約", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "現金交班報表", exact: true }),
  ).toHaveCount(0);

  await page.getByRole("link", { name: "基本資料", exact: true }).click();
  await expect(page).toHaveURL(
    new RegExp(`/merchant/stalls/${stallId}/settings/basic$`),
  );
  await expect(
    page.getByRole("heading", { name: "基本資料", exact: true }),
  ).toBeVisible();
  const phoneInput = page.locator('input[name="phone"]');
  const originalPhone = await phoneInput.inputValue();
  await phoneInput.fill("abcdef");
  const invalidBasicResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/merchant/stalls/${stallId}`) &&
      response.request().method() === "PATCH" &&
      response.request().postDataJSON()?.operation === "UPDATE_BASIC",
  );
  await page.getByRole("button", { name: "儲存基本資料", exact: true }).click();
  expect((await invalidBasicResponse).status()).toBe(400);
  await expect(
    page.getByText(
      "電話需為 6～30 個字元，僅可包含數字、空格、括號、連字號與開頭的 +，或留空不填。",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(phoneInput).toHaveAttribute("aria-invalid", "true");
  await acknowledgeSettingsFeedback(page, "error", undefined, phoneInput);
  await phoneInput.fill(originalPhone);

  const basicSaveResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/merchant/stalls/${stallId}`) &&
      response.request().method() === "PATCH",
  );
  await page.getByRole("button", { name: "儲存基本資料", exact: true }).click();
  const basicResponse = await basicSaveResponse;
  expect(basicResponse.status()).toBe(200);
  expect(Object.keys(basicResponse.request().postDataJSON()).sort()).toEqual(
    [
      "operation",
      "name",
      "code",
      "description",
      "address",
      "phone",
      "timezone",
      "currency",
    ].sort(),
  );
  expect(basicResponse.request().postDataJSON().operation).toBe("UPDATE_BASIC");
  await acknowledgeSettingsFeedback(page, "success", "基本資料已更新。");

  await gotoLocalPath(page, `/merchant/stalls/${stallId}/settings/operations`);
  await expect(
    page.getByRole("heading", { name: "營運狀態", exact: true }),
  ).toBeVisible();
  const operationsSaveResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/merchant/stalls/${stallId}`) &&
      response.request().method() === "PATCH",
  );
  await page.getByRole("button", { name: "儲存營運狀態", exact: true }).click();
  const operationsResponse = await operationsSaveResponse;
  expect(operationsResponse.status()).toBe(200);
  expect(
    Object.keys(operationsResponse.request().postDataJSON()).sort(),
  ).toEqual(
    ["operation", "businessStatus", "orderingEnabled", "isActive"].sort(),
  );
  expect(operationsResponse.request().postDataJSON().operation).toBe(
    "UPDATE_OPERATIONS",
  );
  await acknowledgeSettingsFeedback(page, "success", "營運狀態已更新。");

  await gotoLocalPath(
    page,
    `/merchant/stalls/${stallId}/settings/business-hours`,
  );
  const editableOpeningTime = page
    .locator('input[data-field-key$=".opensAt"]:not(:disabled)')
    .first();
  const openingTimeKey =
    await editableOpeningTime.getAttribute("data-field-key");
  expect(openingTimeKey).toMatch(/^hours\.[0-6]\.opensAt$/);
  const openingDayIndex = Number(openingTimeKey!.split(".")[1]);
  const openingDayLabel = [
    "星期日",
    "星期一",
    "星期二",
    "星期三",
    "星期四",
    "星期五",
    "星期六",
  ][openingDayIndex];
  const originalOpeningTime = await editableOpeningTime.inputValue();
  await editableOpeningTime.fill("");
  const invalidHoursResponse = page.waitForResponse(
    (response) =>
      response
        .url()
        .endsWith(`/api/merchant/stalls/${stallId}/business-hours`) &&
      response.request().method() === "PATCH",
  );
  await page.getByRole("button", { name: "儲存營業時間", exact: true }).click();
  expect((await invalidHoursResponse).status()).toBe(400);
  await expect(
    page.getByText(`${openingDayLabel}開始時間格式必須為 HH:mm。`, {
      exact: true,
    }),
  ).toBeVisible();
  await acknowledgeSettingsFeedback(page, "error", undefined, editableOpeningTime);
  await editableOpeningTime.fill(originalOpeningTime);

  await gotoLocalPath(page, `/merchant/stalls/${stallId}/settings/members`);
  const memberEmail = page.locator('input[name="email"]');
  await memberEmail.fill("不是有效信箱");
  const invalidMemberResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/merchant/stalls/${stallId}/memberships`) &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "指派", exact: true }).click();
  expect((await invalidMemberResponse).status()).toBe(400);
  await expect(
    page.getByText("請輸入有效的 Email 格式。", { exact: true }),
  ).toBeVisible();
  await acknowledgeSettingsFeedback(page, "error", undefined, memberEmail);
  await memberEmail.fill("");

  await gotoLocalPath(page, `/merchant/stalls/${stallId}/settings/dine-in`);
  await expect(
    page.getByRole("heading", { name: "內用點餐", exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("stall-modules-toggle-all")).toHaveCount(0);
  await expect(page.getByRole("switch", { name: /內用點餐/ })).toHaveAttribute(
    "aria-checked",
    "true",
  );

  await gotoLocalPath(page, `/merchant/stalls/${stallId}/settings/printing`);
  await expect(
    page.getByRole("heading", { name: "訂單列印", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("switch", { name: /訂單列印/ })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(
    page.getByRole("switch", { name: /訂單列印/ }).locator("svg"),
  ).toHaveCount(1);
  await page
    .locator("[data-module-switch-grid]")
    .screenshot({ path: testInfo.outputPath("module-switch-icons.png") });

  await gotoLocalPath(page, `/merchant/stalls/${stallId}/settings/languages`);
  await expect(
    page.getByRole("heading", { name: "QR 點餐語系", exact: true }).first(),
  ).toBeVisible();
  const localeSection = page.locator("#stall-module-section-locales");
  await expect(localeSection).toBeVisible();
  await expect(localeSection.locator("details, summary")).toHaveCount(0);
  const traditionalChineseSwitch = localeSection.getByRole("switch", {
    name: /繁體中文/,
  });
  const japaneseSwitch = localeSection.getByRole("switch", { name: /日文/ });
  for (const [locale, flagPath] of Object.entries({
    "zh-TW": "/flags/tw.svg",
    en: "/flags/us.svg",
    ja: "/flags/jp.svg",
    ko: "/flags/kr.svg",
    vi: "/flags/vn.svg",
    th: "/flags/th.svg",
  })) {
    const flag = localeSection.locator(`[data-locale-flag="${locale}"]`);
    await expect(flag).toBeVisible();
    await expect(flag).toHaveAttribute(
      "src",
      new RegExp(flagPath.replace("/", "\\/")),
    );
  }
  await localeSection
    .locator("[data-locale-switch-grid]")
    .screenshot({ path: testInfo.outputPath("locale-flags.png") });
  await expect(traditionalChineseSwitch).toBeDisabled();
  await expect(traditionalChineseSwitch).toHaveAttribute(
    "aria-checked",
    "true",
  );
  const japaneseInitiallyEnabled =
    (await japaneseSwitch.getAttribute("aria-checked")) === "true";
  const localeSwitchStates = await localeSection
    .getByRole("switch")
    .evaluateAll((switches) =>
      switches.map(
        (control) => control.getAttribute("aria-checked") === "true",
      ),
    );
  expect(localeSwitchStates).toHaveLength(QR_LOCALES.length);
  const enabledLocalesBeforeTest = QR_LOCALES.filter(
    (_, index) => localeSwitchStates[index],
  );

  let japaneseChanged = false;
  let localeRecoveryRequest: APIRequestContext | null = null;
  let localeRecoveryCsrf = "";
  try {
    if (japaneseInitiallyEnabled) {
      const appOrigin = new URL(page.url()).origin;
      const storageState = await page.context().storageState();
      const csrfCookie = storageState.cookies.find(
        (cookie) => cookie.name === "stallorder_csrf",
      );
      expect(csrfCookie).toBeDefined();
      localeRecoveryCsrf = decodeURIComponent(csrfCookie?.value ?? "");
      const localeRecoveryCookie = storageState.cookies
        .map((cookie) => `${cookie.name}=${cookie.value}`)
        .join("; ");
      localeRecoveryRequest = await playwrightRequest.newContext({
        baseURL: appOrigin,
        storageState,
        extraHTTPHeaders: {
          cookie: localeRecoveryCookie,
          origin: appOrigin,
          ...(process.env.PLAYWRIGHT_PRODUCTION_SERVER === "true"
            ? {
                "x-vercel-forwarded-for":
                  process.env.PLAYWRIGHT_TRUSTED_CLIENT_IP ?? "203.0.113.10",
                "cf-connecting-ip":
                  process.env.PLAYWRIGHT_TRUSTED_CLIENT_IP ?? "203.0.113.10",
              }
            : {}),
        },
      });
      await japaneseSwitch.click();
      const disableResponse = page.waitForResponse(
        (response) =>
          response.url().includes(`/api/merchant/stalls/${stallId}/modules`) &&
          response.request().method() === "PATCH",
      );
      await localeSection.getByRole("button", { name: "儲存語系設定" }).click();
      expect((await disableResponse).status()).toBe(200);
      await acknowledgeSettingsFeedback(page, "success", "QR 點餐語系已儲存。");
      japaneseChanged = true;
    }
    await expect(japaneseSwitch).toHaveAttribute("aria-checked", "false");

    const japaneseContext = await browser.newContext({
      locale: "ja-JP",
      timezoneId: "Asia/Taipei",
      serviceWorkers: "block",
    });
    try {
      const japanesePage = await japaneseContext.newPage();
      const qrPath = "/q/demo-aming-chicken-qr-2026-rotate-me";
      const qrResponse = await japanesePage.goto(qrPath, {
        waitUntil: "domcontentloaded",
      });
      expect(qrResponse?.status()).toBe(200);
      expect(new URL(japanesePage.url()).pathname).toBe(qrPath);
      const languageMenu = japanesePage.getByRole("button", {
        name: "點餐語言",
      });
      await expect(languageMenu).toBeVisible();
      await expect(languageMenu).toHaveAttribute(
        "data-current-locale",
        "zh-TW",
      );
      await languageMenu.click();
      await expect(
        japanesePage.getByRole("option", { name: "日本語", exact: true }),
      ).toHaveCount(0);
    } finally {
      await japaneseContext.close();
    }

    const localizationPage = await page.context().newPage();
    try {
      await gotoLocalPath(
        localizationPage,
        `/merchant/catalog?organizationId=${organizationId}`,
      );
      const aiTranslationButton = localizationPage.getByRole("button", {
        name: "一鍵補齊翻譯",
      });
      await expect(aiTranslationButton).toBeDisabled();
      await expect(aiTranslationButton).toHaveAttribute(
        "title",
        "AI 翻譯尚未完成伺服器設定",
      );
      const productActions = await openSharedCatalogProductActions(
        localizationPage,
        "香酥雞排",
      );
      const editProductButton = productActions.getByRole("button", {
        name: "編輯商品",
      });
      await expect(editProductButton).toBeEnabled();
      await editProductButton.click();
      const productEditor = localizationPage.getByRole("dialog", {
        name: "編輯商品",
      });
      await expect(productEditor.getByLabel("英文名稱")).toBeVisible();
      await expect(productEditor.getByLabel("英文名稱")).not.toHaveAttribute(
        "required",
      );
      await expect(productEditor.getByLabel("日文名稱")).toHaveCount(0);
      await productEditor.getByRole("button", { name: "關閉" }).click();

      await localizationPage.getByTestId("open-note-group-navigator").click();
      const noteGroupNavigator = localizationPage.getByTestId(
        "note-group-navigator-dialog",
      );
      await noteGroupNavigator
        .getByPlaceholder("搜尋註記群組或選項")
        .fill("辣度");
      const noteGroupActionsButton = noteGroupNavigator.getByRole("button", {
        name: "管理 辣度",
      });
      await expect(noteGroupActionsButton).toBeVisible();
      await noteGroupActionsButton.click();
      const editNoteGroupButton = localizationPage
        .getByRole("dialog", { name: "管理 辣度" })
        .getByRole("button", { name: "編輯", exact: true });
      await expect(editNoteGroupButton).toBeEnabled();
      await editNoteGroupButton.click();
      const noteEditor = localizationPage.getByRole("dialog", {
        name: "編輯註記群組",
      });
      await noteEditor.getByText("多語名稱", { exact: true }).click();
      await expect(
        noteEditor.getByLabel("英文", { exact: true }),
      ).toBeVisible();
      await expect(noteEditor.getByLabel("日文", { exact: true })).toHaveCount(
        0,
      );
      await noteEditor.getByRole("button", { name: "關閉" }).click();

      await gotoLocalPath(
        localizationPage,
        `/merchant/localization?organizationId=${organizationId}`,
      );
      await expect(
        localizationPage
          .getByRole("complementary", { name: "QR 語系預覽" })
          .getByText("日本語", { exact: true }),
      ).toHaveCount(0);
      const disabledPreviewStatus = await localizationPage.evaluate(
        async (url) => {
          const response = await fetch(url, { credentials: "same-origin" });
          return response.status;
        },
        `/merchant/localization/preview?organizationId=${organizationId}&stallId=${stallId}&locale=ja`,
      );
      expect(disabledPreviewStatus).toBe(404);
    } finally {
      await localizationPage.close();
    }
  } finally {
    try {
      if (japaneseChanged && localeRecoveryRequest) {
        const restoreResponse = await localeRecoveryRequest.patch(
          `/api/merchant/stalls/${stallId}/modules`,
          {
            headers: { "x-csrf-token": localeRecoveryCsrf },
            data: {
              operation: "UPDATE_LOCALES",
              enabledLocales: enabledLocalesBeforeTest,
            },
          },
        );
        expect(restoreResponse.status()).toBe(200);
        await restoreResponse.dispose();
      }
    } finally {
      await localeRecoveryRequest?.dispose();
    }
  }

  await gotoLocalPath(
    page,
    `/merchant/stalls/${stallId}/settings/dining-tables`,
  );
  await expect(
    page
      .getByRole("heading", { name: "內用桌位與專屬 QR", exact: true })
      .first(),
  ).toBeVisible();
  const floorEditor = page.getByRole("region", { name: "桌位平面配置" });
  await expect(floorEditor).toBeVisible();
  const floorTable = floorEditor.getByRole("button", { name: "移動 A1 桌" });
  const originalPosition = await floorTable.evaluate((element) => ({
    left: (element as HTMLElement).style.left,
    top: (element as HTMLElement).style.top,
  }));
  const moveKey =
    Number.parseFloat(originalPosition.left) >= 82 ? "ArrowLeft" : "ArrowRight";
  const restoreKey = moveKey === "ArrowRight" ? "ArrowLeft" : "ArrowRight";
  await floorTable.press(moveKey);
  expect(
    await floorTable.evaluate((element) => (element as HTMLElement).style.left),
  ).not.toBe(originalPosition.left);
  const layoutResponse = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/merchant/stalls/${stallId}/modules`) &&
      response.request().method() === "PATCH",
  );
  await page.getByRole("button", { name: "儲存桌位位置" }).click();
  expect((await layoutResponse).status()).toBe(200);
  await acknowledgeSettingsFeedback(page, "success", "桌位平面配置已儲存。");
  await floorTable.press(restoreKey);
  const restoreLayoutResponse = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/merchant/stalls/${stallId}/modules`) &&
      response.request().method() === "PATCH",
  );
  await page.getByRole("button", { name: "儲存桌位位置" }).click();
  expect((await restoreLayoutResponse).status()).toBe(200);
  await acknowledgeSettingsFeedback(page, "success", "桌位平面配置已儲存。");
  expect(
    await floorTable.evaluate((element) => ({
      left: (element as HTMLElement).style.left,
      top: (element as HTMLElement).style.top,
    })),
  ).toEqual(originalPosition);
  await expect(page.locator('input[value="A1 桌"]')).toBeVisible();

  await gotoLocalPath(page, `/merchant/stalls/${stallId}/settings/payments`);
  await expect(
    page.getByRole("heading", { name: "付款方式", exact: true }).first(),
  ).toBeVisible();
  await expect(page.locator('input[value="LINE Pay"]')).toBeVisible();
  await expect(page.locator('input[value="街口支付"]')).toBeVisible();

  await gotoLocalPath(page, `/merchant/stalls/${stallId}/settings/discounts`);
  await expect(
    page.getByRole("heading", { name: "結帳折扣", exact: true }).first(),
  ).toBeVisible();
  await expect(page.locator('input[value="9 折"]')).toBeVisible();

  await gotoLocalPath(page, `/merchant/stalls/${stallId}/settings/payments`);
  const paymentSection = page.locator("#payment-options");
  const newPaymentCode = paymentSection.locator(
    '[data-field-key="new-payment:code"]',
  );
  const newPaymentName = paymentSection.locator(
    '[data-field-key="new-payment:name"]',
  );
  await newPaymentCode.fill("中文代碼");
  await newPaymentName.fill("測試付款方式");
  const invalidPaymentResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/merchant/stalls/${stallId}/modules`) &&
      response.request().method() === "PATCH" &&
      response.request().postDataJSON()?.operation === "CREATE_PAYMENT_OPTION",
  );
  await paymentSection
    .getByRole("button", { name: "新增", exact: true })
    .click();
  expect((await invalidPaymentResponse).status()).toBe(400);
  await expect(
    paymentSection.getByText(
      "付款方式代碼僅可使用英文字母、數字、底線或連字號，不能輸入中文。",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(newPaymentCode).toHaveAttribute("aria-invalid", "true");
  await acknowledgeSettingsFeedback(page, "error", undefined, newPaymentCode);
  await newPaymentCode.fill("");
  await newPaymentName.fill("");

  await gotoLocalPath(page, `/merchant/team?organizationId=${organizationId}`);
  await expect(page.getByText("最高擁有者", { exact: true })).toBeVisible();
  await expect(page.getByLabel(/變更.*組織角色/).first()).toBeDisabled();

  await gotoLocalPath(
    page,
    `/merchant/reports/overview?organizationId=${organizationId}`,
  );
  await expect(
    page.getByRole("button", { name: "日", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "週", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "月", exact: true }),
  ).toBeVisible();
  const hourlySales = page.getByTestId("hourly-sales-dashboard");
  const hourlySalesCells = hourlySales.getByTestId("hourly-sales-cell");
  await expect(hourlySalesCells).toHaveCount(24);
  await expect(
    hourlySalesCells.first().getByText("00:00", { exact: true }),
  ).toBeVisible();
  await expect(
    hourlySalesCells.last().getByText("23:00", { exact: true }),
  ).toBeVisible();

  await gotoLocalPath(page, "/merchant/aming-chicken");
  const unifiedPublicLink = page.getByRole("link", {
    name: "開啟公開頁",
    exact: true,
  });
  await expect(unifiedPublicLink).toHaveAttribute("href", "/store/aming-01");
  await expect(
    page.getByText("永久路徑：/store/aming-01", { exact: true }),
  ).toBeVisible();
  const stallProductList = page.locator("details[data-stall-product-list]");
  await expect(stallProductList).toHaveAttribute("open", "");
  await stallProductList.locator("summary").first().click();
  await expect(stallProductList).not.toHaveAttribute("open", "");
  await stallProductList.locator("summary").first().click();
  await expect(page.getByRole("button", { name: "批次售完" })).toBeVisible();
  await expect(page.getByLabel("供應開始").first()).toBeVisible();
  await expect(page.getByLabel("供應結束").first()).toBeVisible();
  await expect(page.getByText("安全與訂單限制", { exact: true })).toHaveCount(
    0,
  );

  await gotoLocalPath(
    page,
    `/merchant/stalls/${stallId}/settings/order-limits`,
  );
  await expect(
    page.getByRole("heading", { name: "安全與訂單限制", exact: true }),
  ).toBeVisible();
  const estimatedWaitInput = page.getByLabel("顧客預估等候分鐘");
  await expect(estimatedWaitInput).toHaveValue("15");
  await expect(page.getByLabel("營業日切換時間")).toHaveValue("0");
  await estimatedWaitInput.fill("");
  await page.getByRole("button", { name: "儲存限制", exact: true }).click();
  await expect(estimatedWaitInput).toHaveValue("");
  await expect(
    page.getByText("顧客預估等候分鐘為必填欄位。", { exact: true }),
  ).toBeVisible();
  await acknowledgeSettingsFeedback(page, "error", "請修正標示欄位後再儲存。", estimatedWaitInput);
  await estimatedWaitInput.fill("241");
  await page.getByRole("button", { name: "儲存限制", exact: true }).click();
  await expect(
    page.getByText("顧客預估等候分鐘請輸入 0 到 240 之間。", { exact: true }),
  ).toBeVisible();
  await acknowledgeSettingsFeedback(page, "error", "請修正標示欄位後再儲存。", estimatedWaitInput);
  await estimatedWaitInput.fill("1.5");
  await page.getByRole("button", { name: "儲存限制", exact: true }).click();
  await expect(
    page.getByText("顧客預估等候分鐘請輸入整數。", { exact: true }),
  ).toBeVisible();
  await acknowledgeSettingsFeedback(page, "error", "請修正標示欄位後再儲存。", estimatedWaitInput);
  await estimatedWaitInput.fill("15");
  const limitsResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/stalls/aming-chicken/ordering") &&
      response.request().method() === "PATCH" &&
      response.request().postDataJSON()?.action === "UPDATE_LIMITS",
  );
  await page.getByRole("button", { name: "儲存限制", exact: true }).click();
  expect((await limitsResponse).status()).toBe(200);
  await acknowledgeSettingsFeedback(page, "success", "安全與訂單限制已更新。");

  const catalogPath = `/merchant/catalog?organizationId=${organizationId}`;
  if (process.env.PLAYWRIGHT_PRODUCTION_SERVER !== "true") {
    const warmupResponse = await page.context().request.get(catalogPath);
    expect(warmupResponse.status()).toBe(200);
    await warmupResponse.dispose();
  }
  await gotoLocalPath(page, catalogPath);
  await expect(page).toHaveURL(
    new RegExp(`/merchant/catalog\\?organizationId=${organizationId}$`),
  );
  await expect(page.getByRole("link", { name: "匯出 CSV" })).toBeVisible();
  await expect(
    page.locator('label[title="匯入 CSV"]:visible').first(),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "商品註記設定" }),
  ).toBeVisible();
  await page.getByTestId("open-note-group-navigator").click();
  const noteGroupNavigator = page.getByTestId("note-group-navigator-dialog");
  await noteGroupNavigator.getByPlaceholder("搜尋註記群組或選項").fill("辣度");
  const noteGroupCard = noteGroupNavigator
    .getByRole("button")
    .filter({ hasText: "辣度" })
    .first();
  await expect(noteGroupCard).toBeVisible();
  await expect(
    noteGroupNavigator.getByRole("button", { name: "管理 辣度" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(noteGroupNavigator).toHaveCount(0);
  await expect(page.getByTestId("open-catalog-navigator")).toBeVisible();
  const validCsvRow = [
    "",
    "測試分類",
    "",
    "匯入預覽商品",
    "",
    "88",
    "",
    "1",
    "true",
    "AMING-01",
    "Preview item",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "true",
    "true",
  ];
  const invalidCsvRow = [
    "",
    "測試分類",
    "",
    "錯誤價格商品",
    "",
    "=100",
    "",
    "2",
    "true",
    "AMING-01",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "true",
    "true",
  ];
  const csvInput = page.getByLabel("匯入 CSV", { exact: true });
  await waitForReactHandler(csvInput, "onChange");
  const importPreviewResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname ===
        `/api/merchant/organizations/${organizationId}/catalog/import` &&
      response.request().method() === "POST",
  );
  await csvInput.setInputFiles({
    name: "catalog-preview.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      [
        catalogCsvHeaders.join(","),
        validCsvRow.join(","),
        invalidCsvRow.join(","),
      ].join("\n"),
    ),
  });
  expect((await importPreviewResponse).status()).toBe(200);
  const importDialog = page.getByRole("dialog", { name: "CSV 匯入預覽" });
  await expect(
    importDialog.getByRole("button", { name: "套用 1 筆有效資料" }),
  ).toBeVisible();
  await expect(
    importDialog.getByRole("button", { name: "下載錯誤 CSV" }),
  ).toBeVisible();
  await importDialog.getByRole("button", { name: "關閉" }).click();
  const productActions = await openSharedCatalogProductActions(
    page,
    "香酥雞排",
  );
  const editProductButton = productActions.getByRole("button", {
    name: "編輯商品",
  });
  await expect(editProductButton).toBeEnabled();
  await editProductButton.click();
  const editor = page.getByRole("dialog", { name: "編輯商品" });
  await expect(editor.getByLabel("圖片網址")).toBeVisible();
  await expect(editor.getByText("本機上傳", { exact: true })).toBeVisible();
  await expect(editor.getByLabel("預設售價")).toHaveValue(/^\d+$/);
  await expect(editor.getByLabel("英文名稱")).toHaveValue(
    "Deep-Fried Chicken Cutlet",
  );
  await expect(editor.getByLabel("日文名稱")).toHaveValue("鶏肉の揚げ物");
  await editor.getByRole("button", { name: "關閉" }).click();

  await page
    .getByTestId("shared-catalog-create-actions")
    .getByRole("button", { name: "新增商品", exact: true })
    .click();
  const createEditor = page.getByRole("dialog", { name: "新增商品" });
  const defaultPrice = createEditor.getByLabel("預設售價");
  await expect(defaultPrice).toHaveValue("");
  expect(
    await defaultPrice.evaluate(
      (element: HTMLInputElement) => element.validity.valueMissing,
    ),
  ).toBe(true);
  await defaultPrice.pressSequentially("95");
  await expect(defaultPrice).toHaveValue("95");
  await defaultPrice.clear();
  await defaultPrice.pressSequentially("0");
  await expect(defaultPrice).toHaveValue("0");
  expect(
    await defaultPrice.evaluate(
      (element: HTMLInputElement) => element.validity.valid,
    ),
  ).toBe(true);
  await defaultPrice.clear();
  await createEditor.getByLabel("商品名稱").fill("未送出測試商品");
  const invalidProductResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname ===
        `/api/merchant/organizations/${organizationId}/catalog` &&
      response.request().method() === "POST" &&
      response.request().postDataJSON()?.operation === "CREATE_PRODUCT",
  );
  await createEditor.getByRole("button", { name: "儲存" }).click();
  expect((await invalidProductResponse).status()).toBe(400);
  await expect(
    createEditor
      .getByText("「預設價格」輸入不正確，請依欄位限制重新輸入。", {
        exact: true,
      })
      .first(),
  ).toBeVisible();
  await expect(defaultPrice).toHaveAttribute("aria-invalid", "true");
  await expect(defaultPrice).toBeFocused();
  await expect(createEditor).toBeVisible();
  await expect(defaultPrice).toHaveValue("");

  await defaultPrice.fill("95");
  const productName = createEditor.getByLabel("商品名稱");
  await productName.fill("模擬重名商品");
  await page.route(
    `**/api/merchant/organizations/${organizationId}/catalog`,
    async (route) => {
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          error: "此名稱已存在，請使用其他名稱。",
          fieldErrors: { name: "此名稱已存在，請使用其他名稱。" },
        }),
      });
    },
    { times: 1 },
  );
  const duplicateProductResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname ===
        `/api/merchant/organizations/${organizationId}/catalog` &&
      response.request().method() === "POST" &&
      response.request().postDataJSON()?.operation === "CREATE_PRODUCT",
  );
  await createEditor.getByRole("button", { name: "儲存" }).click();
  expect((await duplicateProductResponse).status()).toBe(409);
  await expect(
    createEditor
      .getByText("此名稱已存在，請使用其他名稱。", { exact: true })
      .first(),
  ).toBeVisible();
  await expect(productName).toHaveAttribute("aria-invalid", "true");
  await expect(productName).toBeFocused();
  await expect(productName).toHaveValue("模擬重名商品");
  await createEditor.getByRole("button", { name: "關閉" }).click();
});
