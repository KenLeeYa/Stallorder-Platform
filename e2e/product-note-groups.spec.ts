import { randomUUID } from "node:crypto";
import {
  expect,
  test,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { PrismaClient, type Prisma } from "@prisma/client";
import { hash } from "bcryptjs";
import type { ProductNoteTransfer } from "../src/lib/product-note-transfer";
import {
  dismissStaffStartReminder,
  continueQrCheckout,
  loginLocalTestAccount,
  qrProductSelectionControl,
} from "./local-navigation";

const organizationId = "11111111-1111-4111-8111-111111111111";
const stallId = "22222222-2222-4222-8222-222222222222";
const password = "StallOrderDemo!2026";
const managerAuthorizationCode = "246810";
const takeoutQrToken = `product-notes-e2e-${randomUUID()}`;
type AuthCookies = Awaited<ReturnType<BrowserContext["cookies"]>>;
const authCookies = new Map<string, AuthCookies>();
const prisma = new PrismaClient();
let originalManagerAuthorizationCodeHash: string | null = null;
let originalLotteryEnabled = false;
let originalEnabledLocales: string[] = [];
let fixtureQrId = "";
let reusableNoteSortFixtureId = "";
const localeFixtureTranslationIds = {
  noteGroups: [] as string[],
  noteOptions: [] as string[],
};
let originalBusinessHours: Array<{
  id: string;
  opensAt: string;
  closesAt: string;
  isClosed: boolean;
}> = [];

test.use({ serviceWorkers: "block" });

test.beforeAll(async () => {
  const [settings, businessHours, qrVersion] = await Promise.all([
    prisma.stallOrderingSettings.findUniqueOrThrow({
      where: { stallId },
      select: { managerAuthorizationCodeHash: true, enabledLocales: true, lotteryEnabled: true },
    }),
    prisma.stallBusinessHour.findMany({
      where: { organizationId, stallId },
      orderBy: { dayOfWeek: "asc" },
      select: { id: true, opensAt: true, closesAt: true, isClosed: true },
    }),
    prisma.qrCode.aggregate({
      where: { stallId },
      _max: { tokenVersion: true },
    }),
  ]);
  expect(businessHours).toHaveLength(7);
  originalManagerAuthorizationCodeHash = settings.managerAuthorizationCodeHash;
  originalLotteryEnabled = settings.lotteryEnabled;
  originalEnabledLocales = settings.enabledLocales;
  originalBusinessHours = businessHours;
  await prisma.$transaction([
    prisma.stallOrderingSettings.update({
      where: { stallId },
      data: {
        managerAuthorizationCodeHash: await hash(managerAuthorizationCode, 10),
        lotteryEnabled: false,
        enabledLocales: Array.from(new Set([
          ...settings.enabledLocales,
          "en",
          "ja",
        ])),
      },
    }),
    prisma.stallBusinessHour.updateMany({
      where: { organizationId, stallId },
      data: { opensAt: "00:00", closesAt: "23:59", isClosed: false },
    }),
  ]);
  fixtureQrId = (
    await prisma.qrCode.create({
      data: {
        organizationId,
        stallId,
        token: takeoutQrToken,
        label: "Product notes E2E",
        state: "ACTIVE",
        tokenVersion: (qrVersion._max.tokenVersion ?? 0) + 1,
      },
      select: { id: true },
    })
  ).id;
});

test.afterAll(async () => {
  try {
    await prisma.$transaction([
      ...(reusableNoteSortFixtureId
        ? [prisma.reusableProductNote.deleteMany({ where: { id: reusableNoteSortFixtureId } })]
        : []),
      ...(localeFixtureTranslationIds.noteOptions.length > 0
        ? [prisma.productNoteOptionTranslation.deleteMany({
            where: { id: { in: localeFixtureTranslationIds.noteOptions } },
          })]
        : []),
      ...(localeFixtureTranslationIds.noteGroups.length > 0
        ? [prisma.productNoteGroupTranslation.deleteMany({
            where: { id: { in: localeFixtureTranslationIds.noteGroups } },
          })]
        : []),
      ...(fixtureQrId
        ? [
            prisma.publicOrderAttempt.deleteMany({ where: { qrCodeId: fixtureQrId } }),
            prisma.qrCode.deleteMany({ where: { id: fixtureQrId } }),
          ]
        : []),
      prisma.stallOrderingSettings.update({
        where: { stallId },
        data: {
          managerAuthorizationCodeHash: originalManagerAuthorizationCodeHash,
          lotteryEnabled: originalLotteryEnabled,
          enabledLocales: originalEnabledLocales,
        },
      }),
      ...originalBusinessHours.map((hour) =>
        prisma.stallBusinessHour.update({
          where: { id: hour.id },
          data: {
            opensAt: hour.opensAt,
            closesAt: hour.closesAt,
            isClosed: hour.isClosed,
          },
        }),
      ),
    ]);
  } finally {
    await prisma.$disconnect();
  }
});

async function ensurePublicCatalogNoteLocaleFixtures(locales: string[]) {
  const stallProducts = await prisma.stallProduct.findMany({
    where: {
      stallId,
      product: {
        category: { isActive: true },
        OR: [{ groupId: null }, { group: { isActive: true } }],
      },
    },
    select: {
      isEnabled: true,
      product: {
        select: {
          isActive: true,
          noteGroupAssignments: {
            where: { isActive: true, noteGroup: { isActive: true } },
            select: {
              noteGroup: {
                select: {
                  id: true,
                  name: true,
                  translations: { select: { locale: true } },
                  options: {
                    where: { isActive: true },
                    select: {
                      id: true,
                      name: true,
                      translations: { select: { locale: true } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  const seen = new Set<string>();
  const noteGroupTranslations: Prisma.ProductNoteGroupTranslationCreateManyInput[] = [];
  const noteOptionTranslations: Prisma.ProductNoteOptionTranslationCreateManyInput[] = [];

  for (const locale of locales) {
    for (const stallProduct of stallProducts) {
      if (!stallProduct.isEnabled || !stallProduct.product.isActive) continue;
      for (const assignment of stallProduct.product.noteGroupAssignments) {
        const noteGroup = assignment.noteGroup;
        const noteGroupKey = `note-group:${noteGroup.id}:${locale}`;
        if (!seen.has(noteGroupKey)) {
          seen.add(noteGroupKey);
          if (!noteGroup.translations.some((translation) => translation.locale === locale)) {
            const id = randomUUID();
            localeFixtureTranslationIds.noteGroups.push(id);
            noteGroupTranslations.push({
              id,
              organizationId,
              noteGroupId: noteGroup.id,
              locale,
              name: noteGroup.name,
            });
          }
        }

        for (const option of noteGroup.options) {
          const optionKey = `note-option:${option.id}:${locale}`;
          if (seen.has(optionKey)) continue;
          seen.add(optionKey);
          if (!option.translations.some((translation) => translation.locale === locale)) {
            const id = randomUUID();
            localeFixtureTranslationIds.noteOptions.push(id);
            noteOptionTranslations.push({
              id,
              organizationId,
              noteOptionId: option.id,
              locale,
              name: option.name,
            });
          }
        }
      }
    }
  }

  await prisma.$transaction([
    ...(noteGroupTranslations.length > 0
      ? [prisma.productNoteGroupTranslation.createMany({ data: noteGroupTranslations })]
      : []),
    ...(noteOptionTranslations.length > 0
      ? [prisma.productNoteOptionTranslation.createMany({ data: noteOptionTranslations })]
      : []),
  ]);
}

async function login(page: Page, email: string) {
  const destination = email === "staff@stallorder.test"
    ? "/staff/aming-chicken"
    : `/merchant/dashboard?organizationId=${organizationId}`;
  const cachedCookies = authCookies.get(email);
  if (cachedCookies) {
    await page.context().addCookies(cachedCookies);
    await page.goto(destination);
    await expect(page).toHaveURL(
      /\/merchant\/dashboard(?:\?organizationId=|$)|\/staff\//,
    );
    if (email === "staff@stallorder.test")
      await dismissStaffStartReminder(page);
    return;
  }
  await loginLocalTestAccount(page, email, password);
  await page.goto(destination);
  await expect(page).toHaveURL(
    /\/merchant\/dashboard(?:\?organizationId=|$)|\/staff\//,
  );
  if (email === "staff@stallorder.test") await dismissStaffStartReminder(page);
  authCookies.set(email, await page.context().cookies());
}

async function acknowledgeSettingsFeedback(
  page: Page,
  kind: "success" | "error",
  message: string,
) {
  const dialog = kind === "error"
    ? page.getByRole("alertdialog", { name: "請確認", exact: true })
    : page.getByRole("dialog", { name: "操作已完成", exact: true });
  await expect(dialog).toContainText(message);
  await dialog.getByRole("button", { name: "我知道了", exact: true }).click();
  await expect(dialog).toBeHidden();
}

async function openNoteGroupNavigator(page: Page) {
  const singleNotes = page.getByTestId("reusable-note-navigator-dialog");
  if (await singleNotes.isVisible()) {
    await singleNotes.getByRole("button", { name: "關閉", exact: true }).click();
  }
  const navigator = page.getByTestId("note-group-navigator-dialog");
  if (!(await navigator.isVisible())) {
    await page.getByTestId("open-note-group-navigator").filter({ visible: true }).click();
    await expect(navigator).toBeVisible();
  }
  const backButton = navigator.getByRole("button", {
    name: "返回註記群組",
    exact: true,
  });
  if (await backButton.isVisible()) await backButton.click();
  return navigator;
}

async function openNoteGroup(page: Page, groupName: string) {
  const navigator = await openNoteGroupNavigator(page);
  await navigator.getByPlaceholder("搜尋註記群組或選項").fill(groupName);
  const groupButton = navigator
    .getByRole("button")
    .filter({ hasText: groupName })
    .first();
  await expect(groupButton).toBeVisible();
  await groupButton.click();
  await expect(
    navigator.getByRole("button", {
      name: "返回註記群組",
      exact: true,
    }),
  ).toBeVisible();
  return navigator;
}

async function openAttachReusableNotesDialog(page: Page, groupName: string) {
  const group = await openNoteGroup(page, groupName);
  await group.getByRole("button", { name: /加入既有共用註記/ }).click();
  const dialog = page.getByRole("dialog", { name: /將共用註記加入/ });
  await expect(dialog).toBeVisible();
  return { dialog, trigger: page.getByTestId("open-note-group-navigator").filter({ visible: true }) };
}

async function openProductNoteGroupActions(page: Page, groupName: string) {
  const navigator = await openNoteGroupNavigator(page);
  await navigator.getByPlaceholder("搜尋註記群組或選項").fill(groupName);
  await navigator
    .getByRole("button", { name: `管理 ${groupName}`, exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: `管理 ${groupName}`,
    exact: true,
  });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function selectProductNoteGroupAction(
  page: Page,
  groupName: string,
  action: string,
) {
  const dialog = await openProductNoteGroupActions(page, groupName);
  await dialog.getByRole("button", { name: action, exact: true }).click();
}

async function openProductNoteGroupOptionActions(
  page: Page,
  groupName: string,
  optionName: string,
) {
  const group = await openNoteGroup(page, groupName);
  const option = group
    .locator('[data-testid="note-option-action-trigger"]:visible')
    .filter({ hasText: optionName });
  await expect(option).toBeVisible();
  await option.click();
  const dialog = page.getByRole("dialog", {
    name: `管理 ${optionName}`,
    exact: true,
  });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function selectProductNoteGroupOptionAction(
  page: Page,
  groupName: string,
  optionName: string,
  action: string,
) {
  const dialog = await openProductNoteGroupOptionActions(
    page,
    groupName,
    optionName,
  );
  await dialog.getByRole("button", { name: action, exact: true }).click();
}

async function expectProductNoteGroupOptionAction(
  page: Page,
  groupName: string,
  optionName: string,
  action: string,
) {
  const dialog = await openProductNoteGroupOptionActions(
    page,
    groupName,
    optionName,
  );
  await expect(
    dialog.getByRole("button", { name: action, exact: true }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "關閉", exact: true }).click();
  await expect(dialog).toBeHidden();
}

async function openProductNoteActions(
  page: Page,
  itemName: string,
) {
  const navigator = page.getByTestId("reusable-note-navigator-dialog");
  if (!(await navigator.isVisible())) {
    await page.getByTestId("open-reusable-note-navigator").filter({ visible: true }).click();
    await expect(navigator).toBeVisible();
  }
  await navigator.getByPlaceholder("搜尋單一註記").fill(itemName);
  await navigator
    .getByRole("button", { name: `管理 ${itemName}`, exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: `管理 ${itemName}`,
    exact: true,
  });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function openNewReusableNoteEditor(page: Page) {
  const navigator = page.getByTestId("reusable-note-navigator-dialog");
  if (!(await navigator.isVisible())) {
    await page.getByTestId("open-reusable-note-navigator").filter({ visible: true }).click();
    await expect(navigator).toBeVisible();
  }
  await navigator.getByRole("button", { name: "新增單一註記", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "新增共用單一註記" });
  await expect(editor).toBeVisible();
  return editor;
}

async function openNewProductNoteGroupEditor(page: Page) {
  const navigator = await openNoteGroupNavigator(page);
  await navigator.getByRole("button", { name: "新增群組", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "新增註記群組" });
  await expect(editor).toBeVisible();
  return editor;
}

async function selectProductNoteAction(
  page: Page,
  itemName: string,
  action: string,
) {
  const dialog = await openProductNoteActions(page, itemName);
  await dialog.getByRole("button", { name: action, exact: true }).click();
}

async function fetchJsonInBrowser<T>(page: Page, path: string) {
  return page.evaluate(async (requestPath) => {
    const response = await fetch(requestPath, { credentials: "same-origin" });
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: await response.json(),
    };
  }, path) as Promise<{
    status: number;
    headers: Record<string, string>;
    body: T;
  }>;
}

test("商家可新增、修改、指派與刪除商品註記群組", async ({ page }) => {
  test.setTimeout(120_000);
  const groupName = `甜度 QA ${Date.now()}`;

  await login(page, "owner@stallorder.test");
  await page.goto(`/merchant/catalog?organizationId=${organizationId}`);
  await expect(
    page.getByRole("heading", { name: "商品註記設定" }),
  ).toBeVisible();
  const settingsToggle = page
    .getByTestId("product-note-settings-toggle")
    .filter({ visible: true });
  const settingsContent = page
    .locator("#product-note-settings-content")
    .filter({ visible: true });
  await expect(settingsToggle).toHaveCount(1);
  await expect(settingsToggle).toHaveAttribute("aria-expanded", "true");
  await settingsToggle.click();
  await expect(settingsToggle).toHaveText("展開商品註記設定");
  await expect(settingsContent).toBeHidden();
  await expect(
    page.getByRole("heading", { name: "商品註記設定" }),
  ).toBeVisible();
  await settingsToggle.click();
  await expect(settingsToggle).toHaveAttribute("aria-expanded", "true");
  await expect(settingsContent).toBeVisible();
  const initialNavigator = await openNoteGroupNavigator(page);
  await expect(
    initialNavigator.getByRole("button").filter({ hasText: "辣度" }).first(),
  ).toBeVisible();
  await expect(
    initialNavigator.getByRole("button").filter({ hasText: "加料" }).first(),
  ).toBeVisible();
  await initialNavigator
    .getByRole("button", { name: "關閉", exact: true })
    .click();
  await expect(page.getByTestId("product-note-groups-toggle-all")).toHaveCount(
    0,
  );

  const groupEditor = await openNewProductNoteGroupEditor(page);
  const groupNameInput = groupEditor.getByLabel("群組名稱");
  const invalidGroupResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname ===
        `/api/merchant/organizations/${organizationId}/product-notes` &&
      response.request().method() === "POST" &&
      response.request().postDataJSON()?.operation === "CREATE_NOTE_GROUP",
  );
  await groupEditor.getByRole("button", { name: "儲存" }).click();
  expect((await invalidGroupResponse).status()).toBe(400);
  await expect(
    groupEditor
      .getByText("「名稱」輸入不正確，請依欄位限制重新輸入。", { exact: true })
      .first(),
  ).toBeVisible();
  await expect(groupNameInput).toHaveAttribute("aria-invalid", "true");
  await expect(groupNameInput).toBeFocused();
  await expect(groupNameInput).toHaveValue("");

  await groupNameInput.fill(groupName);
  await groupEditor.getByLabel("選取方式").selectOption("SINGLE");
  await groupEditor
    .getByRole("switch", { name: "顧客必須選擇", exact: true })
    .click();
  await expect(groupEditor.getByLabel("最少選取數")).toHaveValue("1");
  const assignedProduct = groupEditor.getByRole("switch", {
    name: "冬瓜茶",
    exact: true,
  });
  await assignedProduct.click();
  await groupEditor.getByText("註記翻譯", { exact: true }).click();
  await groupEditor.getByLabel("英文", { exact: true }).fill("Sweetness");

  const productAssignments = groupEditor.getByRole("group", {
    name: "指派商品",
  });
  await expect(productAssignments).toHaveAttribute(
    "data-field-key",
    "productIds",
  );
  await expect(productAssignments).toHaveAttribute("tabindex", "-1");
  await page.route(
    `**/api/merchant/organizations/${organizationId}/product-notes`,
    async (route) => {
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          error: "「指派商品」輸入不正確，請依欄位限制重新輸入。",
          fieldErrors: {
            productIds: "「指派商品」輸入不正確，請依欄位限制重新輸入。",
          },
        }),
      });
    },
    { times: 1 },
  );
  const invalidAssignmentsResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname ===
        `/api/merchant/organizations/${organizationId}/product-notes` &&
      response.request().method() === "POST",
  );
  await groupEditor.getByRole("button", { name: "儲存" }).click();
  expect((await invalidAssignmentsResponse).status()).toBe(400);
  await expect(productAssignments).toHaveAttribute("aria-invalid", "true");
  await expect(productAssignments).toBeFocused();
  await expect(groupNameInput).toHaveValue(groupName);
  await assignedProduct.click();
  await expect(productAssignments).toHaveAttribute("aria-invalid", "false");
  await assignedProduct.click();

  await groupEditor.getByRole("button", { name: "儲存" }).click();
  await acknowledgeSettingsFeedback(page, "success", "註記群組已新增。");

  const groupActions = await openProductNoteGroupActions(page, groupName);
  await groupActions.getByRole("button", { name: "編輯", exact: true }).click();
  const savedGroupEditor = page.getByRole("dialog", {
    name: "編輯註記群組",
  });
  await expect(
    savedGroupEditor.getByLabel("冬瓜茶", { exact: true }),
  ).toBeChecked();
  await expect(savedGroupEditor.getByLabel("最少選取數")).toHaveValue("1");
  await savedGroupEditor
    .getByRole("button", { name: "關閉", exact: true })
    .click();

  let group = await openNoteGroup(page, groupName);
  await group.getByRole("button", { name: "新增群組專用註記" }).click();

  const optionEditor = page.getByRole("dialog", { name: "新增群組專用註記" });
  await optionEditor.getByLabel("註記名稱").fill("正常甜");
  await optionEditor.getByLabel("價格調整").fill("5");
  await optionEditor.getByRole("button", { name: "儲存" }).click();
  await acknowledgeSettingsFeedback(page, "success", "註記選項已新增。");
  group = await openNoteGroup(page, groupName);
  await expect(group).toContainText("正常甜");

  await selectProductNoteGroupOptionAction(page, groupName, "正常甜", "編輯");
  const editOption = page.getByRole("dialog", { name: "編輯群組專用註記" });
  await editOption.getByLabel("註記名稱").fill("固定甜度");
  await editOption.getByRole("button", { name: "儲存" }).click();
  await acknowledgeSettingsFeedback(page, "success", "註記選項已更新。");
  group = await openNoteGroup(page, groupName);
  await expect(group).toContainText("固定甜度");

  page.once("dialog", (dialog) => dialog.accept());
  await selectProductNoteGroupOptionAction(page, groupName, "固定甜度", "刪除");
  await acknowledgeSettingsFeedback(page, "success", "註記選項已刪除。");

  page.once("dialog", (dialog) => dialog.accept());
  await selectProductNoteGroupAction(page, groupName, "刪除");
  await acknowledgeSettingsFeedback(page, "success", "註記群組已刪除。");
  await expect(page.getByText(groupName, { exact: true })).toHaveCount(0);
});

test("群組內共用與專用註記排序可儲存並於重載後保留", async ({ page }) => {
  test.setTimeout(120_000);
  const suffix = Date.now();
  const groupName = `排序群組 QA ${suffix}`;
  const reusableName = `共用排序 QA ${suffix}`;
  const dedicatedName = `專用排序 QA ${suffix}`;

  await login(page, "owner@stallorder.test");
  await page.goto(`/merchant/catalog?organizationId=${organizationId}`);

  const reusableEditor = await openNewReusableNoteEditor(page);
  await reusableEditor.getByLabel("註記名稱").fill(reusableName);
  await reusableEditor.getByRole("button", { name: "儲存" }).click();
  await acknowledgeSettingsFeedback(page, "success", "共用單一註記已新增。");

  const groupEditor = await openNewProductNoteGroupEditor(page);
  await groupEditor.getByLabel("群組名稱").fill(groupName);
  await groupEditor.getByRole("button", { name: "儲存" }).click();
  await acknowledgeSettingsFeedback(page, "success", "註記群組已新增。");

  let group = await openNoteGroup(page, groupName);
  await group.getByRole("button", { name: "新增群組專用註記" }).click();
  const dedicatedEditor = page.getByRole("dialog", {
    name: "新增群組專用註記",
  });
  await dedicatedEditor.getByLabel("註記名稱").fill(dedicatedName);
  await dedicatedEditor.getByRole("button", { name: "儲存" }).click();
  await acknowledgeSettingsFeedback(page, "success", "註記選項已新增。");

  const { dialog: attachDialog } = await openAttachReusableNotesDialog(
    page,
    groupName,
  );
  await attachDialog.getByLabel(reusableName, { exact: true }).check();
  await attachDialog
    .getByRole("button", { name: "加入群組", exact: true })
    .click();
  await acknowledgeSettingsFeedback(page, "success",
    "已將 1 個共用單一註記加入群組。",
  );

  await selectProductNoteGroupOptionAction(
    page,
    groupName,
    reusableName,
    "調整排序",
  );
  const reusableSortEditor = page.getByRole("dialog", {
    name: "調整群組內排序",
  });
  await reusableSortEditor.getByLabel("排序").fill("0");
  const reusableSortResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname ===
        `/api/merchant/organizations/${organizationId}/product-notes` &&
      response.request().method() === "POST" &&
      response.request().postDataJSON()?.operation === "UPDATE_NOTE_OPTION",
  );
  await reusableSortEditor.getByRole("button", { name: "儲存" }).click();
  expect((await reusableSortResponse).status()).toBe(200);
  await acknowledgeSettingsFeedback(page, "success", "註記選項已更新。");

  await selectProductNoteGroupOptionAction(
    page,
    groupName,
    dedicatedName,
    "編輯",
  );
  const dedicatedSortEditor = page.getByRole("dialog", {
    name: "編輯群組專用註記",
  });
  await dedicatedSortEditor.getByLabel("排序").fill("5");
  const dedicatedSortResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname ===
        `/api/merchant/organizations/${organizationId}/product-notes` &&
      response.request().method() === "POST" &&
      response.request().postDataJSON()?.operation === "UPDATE_NOTE_OPTION",
  );
  await dedicatedSortEditor.getByRole("button", { name: "儲存" }).click();
  expect((await dedicatedSortResponse).status()).toBe(200);
  await acknowledgeSettingsFeedback(page, "success", "註記選項已更新。");

  await page.reload();
  group = await openNoteGroup(page, groupName);
  const optionNames = group
    .locator('[data-testid="note-option-action-trigger"]:visible')
    .locator("strong");
  await expect(optionNames).toHaveText([reusableName, dedicatedName]);

  await group.getByRole("button", { name: "關閉", exact: true }).click();

  page.once("dialog", (dialog) => dialog.accept());
  await selectProductNoteGroupAction(page, groupName, "刪除");
  await acknowledgeSettingsFeedback(page, "success", "註記群組已刪除。");
  page.once("dialog", (dialog) => dialog.accept());
  await selectProductNoteAction(
    page,
    reusableName,
    "刪除",
  );
  await acknowledgeSettingsFeedback(page, "success", "共用單一註記已刪除。");
});

test("商家可原子批次加入多個既有共用註記", async ({ page }) => {
  test.setTimeout(120_000);
  const suffix = Date.now();
  const groupName = `批次註記群組 QA ${suffix}`;
  const noteNames = [`批次加料 A QA ${suffix}`, `批次加料 B QA ${suffix}`];
  const scrollFixtureNames = Array.from(
    { length: 8 },
    (_, index) => `捲動測試 ${index + 1} QA ${suffix}`,
  );
  const productNotesPath = `/api/merchant/organizations/${organizationId}/product-notes`;

  await login(page, "owner@stallorder.test");
  await page.goto(`/merchant/catalog?organizationId=${organizationId}`);

  for (const noteName of noteNames) {
    const noteEditor = await openNewReusableNoteEditor(page);
    await noteEditor.getByLabel("註記名稱").fill(noteName);
    await noteEditor.getByRole("button", { name: "儲存" }).click();
    await acknowledgeSettingsFeedback(page, "success", "共用單一註記已新增。");
  }

  const scrollFixtureStatuses = await page.evaluate(
    async ({ names, path }) => {
      const csrfToken =
        document.cookie
          .split(";")
          .map((value) => value.trim())
          .find((value) => value.startsWith("stallorder_csrf="))
          ?.slice("stallorder_csrf=".length) ?? "";
      const statuses: number[] = [];
      for (const [index, name] of names.entries()) {
        const response = await fetch(path, {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
            "x-csrf-token": decodeURIComponent(csrfToken),
          },
          body: JSON.stringify({
            operation: "CREATE_REUSABLE_NOTE",
            name,
            priceDelta: 0,
            sortOrder: 1000 + index,
            isActive: true,
            translations: [],
          }),
        });
        statuses.push(response.status);
      }
      return statuses;
    },
    { names: scrollFixtureNames, path: productNotesPath },
  );
  expect(scrollFixtureStatuses).toEqual(scrollFixtureNames.map(() => 200));
  await page.reload();

  const groupEditor = await openNewProductNoteGroupEditor(page);
  await groupEditor.getByLabel("群組名稱").fill(groupName);
  await groupEditor.getByRole("button", { name: "儲存" }).click();
  await acknowledgeSettingsFeedback(page, "success", "註記群組已新增。");

  await page.setViewportSize({ width: 375, height: 667 });
  let { dialog: choices, trigger: attachTrigger } =
    await openAttachReusableNotesDialog(page, groupName);
  const search = choices.getByLabel("搜尋共用註記");
  await expect(search).toBeFocused();
  const closeButton = choices.getByRole("button", {
    name: "關閉",
    exact: true,
  });
  const cancelButton = choices.getByRole("button", {
    name: "取消",
    exact: true,
  });
  const joinButton = choices.getByRole("button", {
    name: "加入群組",
    exact: true,
  });
  await expect(cancelButton).toBeVisible();
  await expect(joinButton).toBeVisible();
  await closeButton.focus();
  await page.keyboard.press("Shift+Tab");
  await expect(joinButton).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(closeButton).toBeFocused();
  await page.getByTestId("open-note-group-navigator").filter({ visible: true }).focus();
  await page.keyboard.press("Tab");
  await expect(closeButton).toBeFocused();
  await search.focus();
  await search.fill(noteNames[1]);
  await expect(choices.getByLabel(noteNames[1], { exact: true })).toBeVisible();
  await expect(choices.getByLabel(noteNames[0], { exact: true })).toHaveCount(
    0,
  );
  await choices.getByLabel(noteNames[1], { exact: true }).check();
  await search.fill("");
  await choices.getByLabel(noteNames[0], { exact: true }).check();
  await expect(
    choices.getByText("已選擇 2 個註記", { exact: false }),
  ).toBeVisible();

  const selectionList = choices.getByTestId("product-note-attach-list");
  const actionBar = choices.getByTestId("product-note-attach-actions");
  const listLayout = await selectionList.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    overflowY: getComputedStyle(element).overflowY,
    touchAction: getComputedStyle(element).touchAction,
  }));
  expect(listLayout.scrollHeight).toBeGreaterThan(listLayout.clientHeight);
  expect(listLayout.overflowY).toBe("auto");
  expect(listLayout.touchAction).toBe("pan-y");
  const actionBarBeforeScroll = await actionBar.boundingBox();
  expect(actionBarBeforeScroll).not.toBeNull();
  expect(
    actionBarBeforeScroll!.y + actionBarBeforeScroll!.height,
  ).toBeLessThanOrEqual(667);
  await selectionList.evaluate((element) => {
    element.scrollTop = 0;
  });
  await selectionList.hover();
  await page.mouse.wheel(0, 480);
  await expect
    .poll(() => selectionList.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  const actionBarAfterScroll = await actionBar.boundingBox();
  expect(actionBarAfterScroll).not.toBeNull();
  expect(
    Math.abs(actionBarAfterScroll!.y - actionBarBeforeScroll!.y),
  ).toBeLessThanOrEqual(1);
  await expect(cancelButton).toBeVisible();
  await expect(joinButton).toBeVisible();

  const mobileLayout = await choices.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const selectionList = element.querySelector("fieldset");
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      documentWidth: document.documentElement.scrollWidth,
      selectionOverflowY: selectionList
        ? getComputedStyle(selectionList).overflowY
        : "",
    };
  });
  expect(mobileLayout.left).toBeGreaterThanOrEqual(0);
  expect(mobileLayout.right).toBeLessThanOrEqual(
    mobileLayout.viewportWidth + 1,
  );
  expect(mobileLayout.top).toBeGreaterThanOrEqual(0);
  expect(mobileLayout.bottom).toBeLessThanOrEqual(
    mobileLayout.viewportHeight + 1,
  );
  expect(mobileLayout.documentWidth).toBeLessThanOrEqual(
    mobileLayout.viewportWidth + 1,
  );
  expect(mobileLayout.selectionOverflowY).toBe("auto");
  await expect
    .poll(() =>
      page.evaluate(() => ({
        body: document.body.style.overflow,
        document: document.documentElement.style.overflow,
      })),
    )
    .toEqual({ body: "hidden", document: "hidden" });

  await page.keyboard.press("Escape");
  await expect(choices).toHaveCount(0);
  await expect(attachTrigger).toBeFocused();
  await expect
    .poll(() =>
      page.evaluate(() => ({
        body: document.body.style.overflow,
        document: document.documentElement.style.overflow,
      })),
    )
    .toEqual({ body: "", document: "" });
  ({ dialog: choices, trigger: attachTrigger } =
    await openAttachReusableNotesDialog(page, groupName));
  await expect(
    choices.getByText("已選擇 0 個註記", { exact: false }),
  ).toBeVisible();
  for (const noteName of noteNames)
    await choices.getByLabel(noteName, { exact: true }).check();

  await page.route(`**${productNotesPath}`, async (route) => {
    const payload = route.request().postDataJSON() as {
      operation?: string;
      reusableNoteIds?: string[];
    };
    if (
      payload.operation !== "ATTACH_REUSABLE_NOTES" ||
      !payload.reusableNoteIds
    ) {
      await route.continue();
      return;
    }
    await route.continue({
      postData: JSON.stringify({
        ...payload,
        reusableNoteIds: [
          payload.reusableNoteIds[0],
          "ffffffff-ffff-4fff-8fff-fffffffffff1",
        ],
      }),
    });
  });
  const failedBatchResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === productNotesPath &&
      response.request().method() === "POST",
  );
  await choices.getByRole("button", { name: "加入群組", exact: true }).click();
  expect((await failedBatchResponse).status()).toBe(404);
  await expect(choices.getByRole("alert").first()).toHaveText(
    "找不到指定的商品或註記資料。",
  );
  for (const noteName of noteNames)
    await expect(choices.getByLabel(noteName, { exact: true })).toBeChecked();
  await page.unroute(`**${productNotesPath}`);

  await page.keyboard.press("Escape");
  await page.reload();
  const group = await openNoteGroup(page, groupName);
  for (const noteName of noteNames) {
    await expect(
      group
        .locator('[data-testid="note-option-action-trigger"]:visible')
        .filter({ hasText: noteName }),
    ).toHaveCount(0);
  }
  await group.getByRole("button", { name: "關閉", exact: true }).click();

  ({ dialog: choices, trigger: attachTrigger } =
    await openAttachReusableNotesDialog(page, groupName));
  for (const noteName of noteNames)
    await choices.getByLabel(noteName, { exact: true }).check();
  let releaseAttachRequest: () => void = () => {};
  const attachRequestGate = new Promise<void>((resolve) => {
    releaseAttachRequest = resolve;
  });
  await page.route(
    `**${productNotesPath}`,
    async (route) => {
      const payload = route.request().postDataJSON() as { operation?: string };
      if (payload.operation === "ATTACH_REUSABLE_NOTES")
        await attachRequestGate;
      await route.continue();
    },
    { times: 1 },
  );
  const successfulBatchResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === productNotesPath &&
      response.request().method() === "POST" &&
      response.request().postDataJSON()?.operation === "ATTACH_REUSABLE_NOTES",
  );
  await choices.getByRole("button", { name: "加入群組", exact: true }).click();
  await expect(
    choices.getByRole("button", { name: "關閉", exact: true }),
  ).toBeDisabled();
  await expect(
    choices.getByRole("button", { name: "取消", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(choices).toBeVisible();
  releaseAttachRequest();
  const batchResponse = await successfulBatchResponse;
  expect(batchResponse.status()).toBe(200);
  expect(batchResponse.request().postDataJSON()?.reusableNoteIds).toHaveLength(
    2,
  );
  await acknowledgeSettingsFeedback(page, "success",
    "已將 2 個共用單一註記加入群組。",
  );
  await expect(attachTrigger).toBeFocused();

  await page.reload();
  for (const noteName of noteNames) {
    await expectProductNoteGroupOptionAction(
      page,
      groupName,
      noteName,
      "從群組移除",
    );
  }

  page.once("dialog", (dialog) => dialog.accept());
  await selectProductNoteGroupAction(page, groupName, "刪除");
  await acknowledgeSettingsFeedback(page, "success", "註記群組已刪除。");
  for (const noteName of [...noteNames, ...scrollFixtureNames]) {
    page.once("dialog", (dialog) => dialog.accept());
    await selectProductNoteAction(page, noteName, "刪除");
    await acknowledgeSettingsFeedback(page, "success", "共用單一註記已刪除。");
  }
});

test("共用單一註記可加入多個群組、同步更新並阻擋使用中刪除", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const suffix = Date.now();
  const noteName = `香菜另外放 QA ${suffix}`;
  const updatedName = `香菜另放 QA ${suffix}`;
  const precedingNoteName = `排序前置註記 QA ${suffix}`;
  const lastNote = await prisma.reusableProductNote.aggregate({
    where: { organizationId }, _max: { sortOrder: true },
  });
  reusableNoteSortFixtureId = (await prisma.reusableProductNote.create({ data: {
    organizationId, name: precedingNoteName, sortOrder: (lastNote._max.sortOrder ?? 0) + 1,
  } })).id;

  await login(page, "owner@stallorder.test");
  await page.goto(`/merchant/catalog?organizationId=${organizationId}`);
  // Require a unique visible entry while Next.js retains hidden streaming markup.
  await expect(page.getByTestId("open-reusable-note-navigator").filter({ visible: true })).toHaveCount(1);
  await expect(page.getByTestId("open-reusable-note-navigator").filter({ visible: true })).toBeVisible();
  await expect(page.getByTestId("open-note-group-navigator").filter({ visible: true })).toHaveCount(1);
  await expect(page.getByTestId("open-note-group-navigator").filter({ visible: true })).toBeVisible();

  const createEditor = await openNewReusableNoteEditor(page);
  await createEditor.getByLabel("註記名稱").fill(noteName);
  await createEditor.getByLabel("價格調整").fill("7");
  await createEditor.getByRole("button", { name: "儲存" }).click();
  await acknowledgeSettingsFeedback(page, "success", "共用單一註記已新增。");

  const singleNotes = page.getByTestId("reusable-note-navigator-dialog");
  await expect(singleNotes).toBeVisible();
  for (const [action, message] of [
    ["上移", "共用註記排序已更新。"],
    ["下移", "共用註記排序已更新。"],
    ["停用", "共用單一註記已停用，所有群組已同步。"],
    ["啟用", "共用單一註記已啟用，所有群組已同步。"],
  ]) {
    await selectProductNoteAction(page, noteName, action);
    await expect(singleNotes).toBeVisible();
    await acknowledgeSettingsFeedback(page, "success", message);
    if (action === "上移" || action === "下移") {
      await expect.poll(async () => (await prisma.reusableProductNote.findMany({
        where: { organizationId, name: { in: [noteName, precedingNoteName] } },
        orderBy: { sortOrder: "asc" }, select: { name: true },
      })).map(note => note.name)).toEqual(action === "上移"
        ? [noteName, precedingNoteName]
        : [precedingNoteName, noteName]);
    }
    await expect(singleNotes.getByPlaceholder("搜尋單一註記")).toHaveValue(noteName);
    await expect(singleNotes.getByPlaceholder("搜尋單一註記")).toBeFocused();
  }
  page.once("dialog", dialog => dialog.dismiss());
  await selectProductNoteAction(page, noteName, "刪除");
  await expect(singleNotes).toBeVisible();
  await expect(singleNotes.getByRole("button", { name: `管理 ${noteName}`, exact: true })).toBeVisible();

  const notesApi = `/api/merchant/organizations/${organizationId}/product-notes`;
  await page.route(`**${notesApi}`, route => route.fulfill({
    status: 503, contentType: "application/json", json: { error: "目前無法更新註記群組。" },
  }), { times: 1 });
  await selectProductNoteAction(page, noteName, "停用");
  await acknowledgeSettingsFeedback(page, "error", "目前無法更新註記群組。");
  await expect(singleNotes).toBeVisible();
  await expect(singleNotes.getByPlaceholder("搜尋單一註記")).toHaveValue(noteName);

  const duplicateEditor = await openNewReusableNoteEditor(page);
  const duplicateName = duplicateEditor.getByLabel("註記名稱");
  await duplicateName.fill(noteName);
  await duplicateEditor.getByRole("button", { name: "儲存" }).click();
  await expect(duplicateEditor.getByRole("alert")).toHaveText(
    "已有相同名稱的共用單一註記，請使用其他名稱。",
  );
  await expect(duplicateName).toHaveAttribute("aria-invalid", "true");
  await expect(duplicateName).toBeFocused();
  await duplicateEditor.getByRole("button", { name: "關閉" }).click();

  const { dialog: spiceAttachDialog } = await openAttachReusableNotesDialog(
    page,
    "辣度",
  );
  const emptyAttachChoices = spiceAttachDialog.getByRole("group", {
    name: "選擇共用註記",
  });
  const emptyAttachButton = spiceAttachDialog.getByRole("button", {
    name: "加入群組",
    exact: true,
  });
  await emptyAttachButton.click();
  await expect(spiceAttachDialog.getByRole("alert")).toHaveCount(1);
  await expect(spiceAttachDialog.getByRole("alert")).toHaveText(
    "請至少選擇一個要加入群組的共用單一註記。",
  );
  await expect(emptyAttachChoices).toHaveAttribute("aria-invalid", "true");
  await expect(emptyAttachChoices).toBeFocused();
  await emptyAttachChoices.getByLabel(noteName, { exact: true }).check();
  await expect(emptyAttachChoices).toHaveAttribute("aria-invalid", "false");
  await emptyAttachButton.click();
  await acknowledgeSettingsFeedback(
    page,
    "success",
    "已將 1 個共用單一註記加入群組。",
  );
  await expectProductNoteGroupOptionAction(
    page,
    "辣度",
    noteName,
    "從群組移除",
  );

  const { dialog: toppingAttachDialog } = await openAttachReusableNotesDialog(
    page,
    "加料",
  );
  await toppingAttachDialog.getByLabel(noteName, { exact: true }).check();
  await toppingAttachDialog
    .getByRole("button", { name: "加入群組", exact: true })
    .click();
  await acknowledgeSettingsFeedback(
    page,
    "success",
    "已將 1 個共用單一註記加入群組。",
  );
  await expectProductNoteGroupOptionAction(
    page,
    "加料",
    noteName,
    "從群組移除",
  );

  await selectProductNoteAction(page, noteName, "編輯");
  const editEditor = page.getByRole("dialog", { name: "編輯共用單一註記" });
  await editEditor.getByLabel("註記名稱").fill(updatedName);
  await editEditor.getByLabel("價格調整").fill("9");
  await editEditor.getByRole("button", { name: "儲存" }).click();
  await acknowledgeSettingsFeedback(page, "success",
    "共用單一註記已更新，所有群組已同步。",
  );
  const updatedNoteNavigator = page.getByTestId("reusable-note-navigator-dialog");
  await expect(updatedNoteNavigator).toBeVisible();
  await updatedNoteNavigator.getByPlaceholder("搜尋單一註記").fill(updatedName);
  await expect(
    updatedNoteNavigator.getByRole("button", { name: `管理 ${updatedName}`, exact: true }),
  ).toContainText("已加入 2 個群組");
  await updatedNoteNavigator.getByRole("button", { name: "關閉", exact: true }).click();

  page.once("dialog", (dialog) => dialog.accept());
  await selectProductNoteAction(
    page,
    updatedName,
    "刪除",
  );
  await acknowledgeSettingsFeedback(page, "error",
    "此共用註記仍在註記群組中使用，請先從所有群組移除。",
  );

  for (const groupName of ["辣度", "加料"]) {
    const group = await openNoteGroup(page, groupName);
    await expect(group.getByText(updatedName, { exact: true }).filter({ visible: true })).toBeVisible();
    await group.getByRole("button", { name: "關閉", exact: true }).click();
    page.once("dialog", (dialog) => dialog.accept());
    await selectProductNoteGroupOptionAction(
      page,
      groupName,
      updatedName,
      "從群組移除",
    );
    await acknowledgeSettingsFeedback(
      page,
      "success",
      "共用註記已從群組移除。",
    );
    const reopenedGroup = await openNoteGroup(page, groupName);
    await expect(
      reopenedGroup
        .locator('[data-testid="note-option-action-trigger"]:visible')
        .filter({ hasText: updatedName }),
    ).toHaveCount(0);
    await reopenedGroup
      .getByRole("button", { name: "關閉", exact: true })
      .click();
  }

  page.once("dialog", (dialog) => dialog.accept());
  await selectProductNoteAction(
    page,
    updatedName,
    "刪除",
  );
  await acknowledgeSettingsFeedback(page, "success", "共用單一註記已刪除。");
  const deletedNoteNavigator = page.getByTestId("reusable-note-navigator-dialog");
  await expect(deletedNoteNavigator).toBeVisible();
  await deletedNoteNavigator.getByPlaceholder("搜尋單一註記").fill(updatedName);
  await expect(
    deletedNoteNavigator.getByRole("button", { name: `管理 ${updatedName}`, exact: true }),
  ).toHaveCount(0);
});

test("商品註記可匯出、預覽並以單一交易匯入", async ({ page }) => {
  test.setTimeout(120_000);
  const suffix = Date.now();
  const noteName = `匯入共用註記 QA ${suffix}`;
  const groupName = `匯入註記群組 QA ${suffix}`;

  await login(page, "owner@stallorder.test");
  await page.goto(`/merchant/catalog?organizationId=${organizationId}`);
  await page.getByTestId("open-reusable-note-navigator").filter({ visible: true }).click();
  const transferNavigator = page.getByTestId("reusable-note-navigator-dialog");
  await expect(transferNavigator).toBeVisible();

  const exportPath = `/api/merchant/organizations/${organizationId}/product-notes/export`;
  const importPath = `/api/merchant/organizations/${organizationId}/product-notes/import`;
  await page.route(`**${exportPath}`, (route) =>
    route.fulfill({
      status: 422,
      contentType: "application/json",
      body: JSON.stringify({
        error: "註記資料超過 1MB 匯出上限，請精簡註記後再匯出。",
      }),
    }),
  );
  await transferNavigator.getByRole("button", { name: "匯出 JSON" }).click();
  await acknowledgeSettingsFeedback(page, "error",
    "註記資料超過 1MB 匯出上限，請精簡註記後再匯出。",
  );
  await expect(page).toHaveURL(
    new RegExp(`/merchant/catalog\\?organizationId=${organizationId}`),
  );
  await page.unroute(`**${exportPath}`);

  const exportResponse = await fetchJsonInBrowser<ProductNoteTransfer>(
    page,
    exportPath,
  );
  expect(exportResponse.status).toBe(200);
  expect(exportResponse.headers["content-disposition"]).toContain(
    "stallorder-product-notes-",
  );
  const exported = exportResponse.body;
  expect(exported.sourceCurrency).toBe("TWD");
  const productReference = exported.groups.flatMap(
    (group: {
      products?: Array<{ id: string | null; name: string; sortOrder: number }>;
    }) => group.products ?? [],
  )[0];
  if (!productReference) throw new Error("測試資料缺少可供註記指派的商品。");
  const importedProductReference = { ...productReference, sortOrder: 47 };
  const transfer = {
    schemaVersion: exported.schemaVersion,
    exportedAt: exported.exportedAt,
    sourceCurrency: exported.sourceCurrency,
    reusableNotes: [
      {
        name: noteName,
        priceDelta: 5,
        sortOrder: 999,
        isActive: true,
        translations: [{ locale: "en", name: "Imported note" }],
      },
    ],
    groups: [
      {
        name: groupName,
        selectionMode: "MULTIPLE",
        isRequired: false,
        minSelections: 0,
        maxSelections: 2,
        sortOrder: 999,
        isActive: true,
        translations: [{ locale: "en", name: "Imported group" }],
        products: [importedProductReference],
        options: [
          {
            name: noteName,
            reusableNoteName: noteName,
            priceDelta: 5,
            sortOrder: 1,
            isActive: true,
            translations: [],
          },
        ],
      },
    ],
  };

  const importInput = transferNavigator.locator('input[type="file"][accept*="json"]');
  await importInput.focus();
  await expect(importInput.locator("..")).toHaveClass(/focus-within:ring-2/);
  await importInput.setInputFiles({
    name: "stallorder-product-notes.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(transfer)),
  });
  const preview = page.getByRole("dialog", { name: "確認匯入商品註記" });
  await expect(preview).toBeVisible();
  await expect(preview.getByRole("button", { name: "關閉" })).toBeFocused();
  await expect(preview).toContainText("共用註記1");
  await expect(preview).toContainText("註記群組1");
  await expect(preview).toContainText(groupName);
  await expect(preview.getByText("新增", { exact: true })).toHaveCount(2);

  const applyResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname ===
        `/api/merchant/organizations/${organizationId}/product-notes/import` &&
      response.request().method() === "POST" &&
      response.status() === 200,
  );
  await preview.getByRole("button", { name: "套用匯入" }).click();
  await applyResponse;
  await acknowledgeSettingsFeedback(page, "success",
    "已匯入 1 個共用註記、1 個群組與 1 個群組註記",
  );
  await expect(page.getByRole("button", { name: `管理 ${noteName}`, exact: true })).toBeVisible();

  const mergeTransfer = structuredClone(transfer);
  mergeTransfer.reusableNotes[0].priceDelta = 9;
  mergeTransfer.reusableNotes[0].translations = [];
  mergeTransfer.groups[0].sortOrder = 998;
  mergeTransfer.groups[0].translations = [];
  mergeTransfer.groups[0].products = [];
  mergeTransfer.groups[0].options = [];
  await importInput.setInputFiles({
    name: "stallorder-product-notes-merge.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(mergeTransfer)),
  });
  const mergePreview = page.getByRole("dialog", { name: "確認匯入商品註記" });
  await expect(mergePreview).toContainText("安全合併");
  await expect(mergePreview.getByText("更新", { exact: true })).toHaveCount(2);
  await expect(mergePreview).toContainText("價格調整");
  await expect(mergePreview).toContainText("5 TWD → 9 TWD");
  await expect(mergePreview).toContainText("排序");
  await page.route(
    `**${importPath}`,
    (route) =>
      route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ error: "測試用匯入衝突，請重新確認資料。" }),
      }),
    { times: 1 },
  );
  await mergePreview.getByRole("button", { name: "套用匯入" }).click();
  await expect(mergePreview.getByRole("alert")).toHaveText(
    "測試用匯入衝突，請重新確認資料。",
  );
  await expect(mergePreview).toBeVisible();
  const mergeApplyResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === importPath &&
      response.request().method() === "POST" &&
      response.status() === 200,
  );
  await mergePreview.getByRole("button", { name: "套用匯入" }).click();
  await mergeApplyResponse;
  await acknowledgeSettingsFeedback(page, "success", "已匯入");

  const mergedExportResponse = await fetchJsonInBrowser<ProductNoteTransfer>(
    page,
    `/api/merchant/organizations/${organizationId}/product-notes/export`,
  );
  expect(mergedExportResponse.status).toBe(200);
  const mergedExport = mergedExportResponse.body;
  const mergedGroup = mergedExport.groups.find(
    (group: { name: string }) => group.name === groupName,
  );
  const mergedNote = mergedExport.reusableNotes.find(
    (note: { name: string }) => note.name === noteName,
  );
  expect(mergedGroup?.products).toContainEqual(importedProductReference);
  expect(mergedGroup?.options).toContainEqual(
    expect.objectContaining({ name: noteName, sortOrder: 1 }),
  );
  expect(mergedGroup?.sortOrder).toBe(998);
  expect(mergedGroup?.translations).toContainEqual({
    locale: "en",
    name: "Imported group",
  });
  expect(mergedNote?.priceDelta).toBe(9);
  expect(mergedNote?.translations).toContainEqual({
    locale: "en",
    name: "Imported note",
  });

  await transferNavigator.getByRole("button", { name: "關閉", exact: true }).click();
  const importedGroup = await openNoteGroup(page, groupName);
  await expect(importedGroup).toContainText(noteName);
  await importedGroup
    .getByRole("button", { name: "關閉", exact: true })
    .click();
  page.once("dialog", (dialog) => dialog.accept());
  await selectProductNoteGroupAction(page, groupName, "刪除");
  await acknowledgeSettingsFeedback(page, "success", "註記群組已刪除。");

  page.once("dialog", (dialog) => dialog.accept());
  await selectProductNoteAction(page, noteName, "刪除");
  await acknowledgeSettingsFeedback(page, "success", "共用單一註記已刪除。");
});

test.describe("QR 瀏覽器語系", () => {
  test.use({ locale: "ja-JP", timezoneId: "Asia/Taipei" });

  test("QR 依瀏覽器語系自動切換並保留手動選擇", async ({ browser, page }) => {
    const visibility = await prisma.stallProduct.findMany({ where: { stallId }, select: { id: true, isEnabled: true } });
    try {
      // Locale selection requires a completely translated menu; the retained
      // local catalog deliberately contains additional untranslated products.
      await prisma.stallProduct.updateMany({ where: { stallId, productId: { notIn: [
        "44444444-4444-4444-8444-444444444441", "44444444-4444-4444-8444-444444444442", "44444444-4444-4444-8444-444444444443",
      ] } }, data: { isEnabled: false } });
      await ensurePublicCatalogNoteLocaleFixtures(["en", "ja"]);
      const ownerContext = await browser.newContext({ locale: "zh-TW" });
      try {
        const ownerPage = await ownerContext.newPage();
        await login(ownerPage, "owner@stallorder.test");
        await ownerPage.goto(`/merchant/stalls/${stallId}/settings/printing`);
        const cacheInvalidationResponse = ownerPage.waitForResponse(
          (response) =>
            response.request().method() === "PATCH"
            && new URL(response.url()).pathname.endsWith(
              `/api/merchant/stalls/${stallId}/modules`,
            ),
        );
        await ownerPage
          .getByRole("button", { name: "儲存設定", exact: true })
          .click();
        expect((await cacheInvalidationResponse).status()).toBe(200);
      } finally {
        await ownerContext.close();
      }
      const sessionResponse = page.waitForResponse(
        (response) =>
          ["/create-order-session", "/api/public/order-session"].some((path) =>
            new URL(response.url()).pathname.endsWith(path),
          ) && response.request().method() === "POST",
      );
      await page.goto(`/q/${takeoutQrToken}`);
      expect((await sessionResponse).status()).toBe(201);
      await expect(page.locator("html")).toHaveAttribute("lang", "ja");
      await expect(
        page.getByRole("button", { name: "メニュー言語" }),
      ).toHaveAttribute("data-current-locale", "ja");
      await expect(
        page.getByRole("heading", { name: "揚げ物", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "台湾風鶏の唐揚げ" }),
      ).toBeVisible();

      const japaneseProduct = page
        .getByRole("article")
        .filter({ hasText: "台湾風鶏の唐揚げ" });
      await qrProductSelectionControl(
        japaneseProduct,
        "台湾風鶏の唐揚げ",
        "台湾風鶏の唐揚げを増やす",
      ).click();
      const japaneseProductDialog = page.getByRole("dialog", {
        name: "台湾風鶏の唐揚げ",
      });
      await expect(japaneseProductDialog).toBeVisible();
      await expect(
        japaneseProductDialog.getByRole("radiogroup", { name: /辛さ/ }),
      ).toBeVisible();
      await expect(
        japaneseProductDialog.getByRole("radio", {
          name: "小辛",
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        japaneseProductDialog.getByRole("group", { name: /追加トッピング/ }),
      ).toBeVisible();
      await japaneseProductDialog
        .getByRole("button", { name: "閉じる", exact: true })
        .click();
      await expect(japaneseProductDialog).toBeHidden();

      await page.getByRole("button", { name: "メニュー言語" }).click();
      await page.getByRole("option", { name: "English", exact: true }).click();
      await expect(page.locator("html")).toHaveAttribute("lang", "en");
      await expect(
        page.getByRole("heading", { name: "Pepper Popcorn Chicken" }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Your order" }),
      ).toBeVisible();

      await page.reload();
      await expect(
        page.getByRole("button", { name: "Menu language" }),
      ).toHaveAttribute("data-current-locale", "en");
      await expect(
        page.getByRole("heading", { name: "Pepper Popcorn Chicken" }),
      ).toBeVisible();
    } finally {
      for (const row of visibility) await prisma.stallProduct.update({ where: { id: row.id }, data: { isEnabled: row.isEnabled } });
      const cookies = authCookies.get("owner@stallorder.test");
      if (cookies) {
        const settings = await prisma.stallOrderingSettings.findUniqueOrThrow({ where: { stallId } });
        const response = await page.request.patch(`/api/merchant/stalls/${stallId}/modules`, {
          headers: { origin: new URL(page.url()).origin, cookie: cookies.map(row => `${row.name}=${row.value}`).join("; "),
            "x-csrf-token": cookies.find(row => row.name === "stallorder_csrf")!.value },
          data: { operation: "UPDATE_LOCALES", enabledLocales: settings.enabledLocales },
        });
        expect(response.status()).toBe(200);
      }
    }
  });
});

test("QR 註記選擇會由後端驗價並顯示於店員訂單", async ({ browser, page }) => {
  test.setTimeout(120_000);

  await page.goto(`/q/${takeoutQrToken}`);
  const qrProduct = page.getByRole("article").filter({ hasText: "台式鹽酥雞" });
  await qrProductSelectionControl(qrProduct, "台式鹽酥雞").click();
  await expect(page.getByRole("radiogroup", { name: /辣度/ })).toBeVisible();
  await page.getByRole("radio", { name: "中辣", exact: true }).click();
  await page.getByRole("checkbox", { name: /加蛋/ }).click();
  await qrProduct.getByRole("button", { name: "加入購物車" }).click();
  const continueButton = page.getByRole("button", { name: "繼續填寫訂購資料", exact: true });
  if (await continueButton.isVisible()) await continueButton.click();
  await continueQrCheckout(page);
  await expect(page.getByLabel("顧客稱呼")).toHaveCount(0);
  await expect(page.getByLabel("聯絡電話")).toHaveCount(0);
  await page.getByLabel("訂單備註").fill("胡椒少一點");
  await expect(
    page.getByTestId("qr-cart-panel").getByText("$90", { exact: true }).last(),
  ).toBeVisible();
  const waitAcknowledgment = page.getByRole("checkbox", {
    name: /我已了解目前預估等候時間/u,
  });
  if (await waitAcknowledgment.isVisible()) await waitAcknowledgment.check();
  const submitOrder = page.getByRole("button", {
    name: "送出訂單",
    exact: true,
  });
  await expect(submitOrder).toBeEnabled({ timeout: 20_000 });

  let createResponsePromise = page.waitForResponse(
    (response) =>
      ["/create-public-order", "/api/public/orders"].some((path) =>
        new URL(response.url()).pathname.endsWith(path),
      ) && response.request().method() === "POST",
  );
  await submitOrder.click();
  if (await page.getByRole("dialog", { name: "結帳前，再看看", exact: true }).isVisible()) {
    await continueQrCheckout(page);
  }
  let createResponse = await createResponsePromise;
  if (createResponse.status() === 422) {
    await expect(createResponse.json()).resolves.toMatchObject({
      code: "WAIT_ACKNOWLEDGMENT_REQUIRED",
    });
    await expect(waitAcknowledgment).toBeVisible();
    await waitAcknowledgment.check();
    await expect(submitOrder).toBeEnabled({ timeout: 20_000 });
    createResponsePromise = page.waitForResponse(
      (response) =>
        ["/create-public-order", "/api/public/orders"].some((path) =>
          new URL(response.url()).pathname.endsWith(path),
        ) && response.request().method() === "POST",
    );
    await submitOrder.click();
    createResponse = await createResponsePromise;
  }
  expect(createResponse.status()).toBe(201);
  await expect(page).toHaveURL(/\/order\//);
  await expect(page.getByText(/辣度：中辣.*加料：加蛋/)).toBeVisible();
  const orderNo =
    (await page.getByText(/^訂單 /u).textContent())?.replace(/^訂單\s*/u, "") ??
    "";
  expect(orderNo).not.toBe("");

  const staffContext = await browser.newContext({
    locale: "zh-TW",
    timezoneId: "Asia/Taipei",
    serviceWorkers: "block",
  });
  const staffPage = await staffContext.newPage();
  await login(staffPage, "staff@stallorder.test");
  await staffPage.goto("/staff/aming-chicken");
  await dismissStaffStartReminder(staffPage);
  const staffOrder = staffPage
    .getByTestId("staff-order-list-pane")
    .getByRole("button")
    .filter({ hasText: `訂單 ${orderNo}` });
  await staffOrder.click();
  await expect(staffOrder).toHaveAttribute("aria-current", "true");
  const staffOrderItems = staffPage.getByTestId("staff-order-items-pane");
  const staffOrderActions = staffPage.getByTestId("staff-order-actions-pane");
  await expect(staffOrderItems).toContainText("辣度：中辣");
  await expect(staffOrderItems).toContainText("加料：加蛋");
  await expect(staffOrderActions).toContainText("胡椒少一點");
  await expect(staffOrderActions).toContainText("$90");

  await staffOrderActions.getByRole("button", { name: "確認取消訂單" }).click();
  const cancellation = staffPage.getByRole("alertdialog", {
    name: "確認取消訂單？",
  });
  await expect(cancellation).toContainText(orderNo);
  await cancellation.getByLabel("管理授權碼").fill(managerAuthorizationCode);
  const cancellationResponse = staffPage.waitForResponse(
    (response) =>
      new URL(response.url()).pathname.includes(
        "/api/stalls/aming-chicken/orders/",
      ) && response.request().method() === "PATCH",
    { timeout: 30_000 },
  );
  await cancellation.getByRole("button", { name: "確認取消訂單" }).click();
  expect((await cancellationResponse).status()).toBe(200);
  await expect(staffOrder).toHaveCount(0);
  await staffContext.close();
});
