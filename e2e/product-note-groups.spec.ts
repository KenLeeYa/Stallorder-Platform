import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";
import type { ProductNoteTransfer } from "../src/lib/product-note-transfer";

const organizationId = "11111111-1111-4111-8111-111111111111";
const stallId = "22222222-2222-4222-8222-222222222222";
const password = "StallOrderDemo!2026";
const managerAuthorizationCode = "2468";
const takeoutQrToken = "demo-aming-chicken-qr-2026-rotate-me";
type AuthCookies = Awaited<ReturnType<BrowserContext["cookies"]>>;
const authCookies = new Map<string, AuthCookies>();
const prisma = new PrismaClient();
let originalManagerAuthorizationCodeHash: string | null = null;

test.beforeAll(async () => {
  const settings = await prisma.stallOrderingSettings.findUniqueOrThrow({
    where: { stallId },
    select: { managerAuthorizationCodeHash: true },
  });
  originalManagerAuthorizationCodeHash = settings.managerAuthorizationCodeHash;
  await prisma.stallOrderingSettings.update({
    where: { stallId },
    data: { managerAuthorizationCodeHash: await hash(managerAuthorizationCode, 10) },
  });
});

test.afterAll(async () => {
  try {
    await prisma.stallOrderingSettings.update({
      where: { stallId },
      data: { managerAuthorizationCodeHash: originalManagerAuthorizationCodeHash },
    });
  } finally {
    await prisma.$disconnect();
  }
});

async function login(page: Page, email: string) {
  const cachedCookies = authCookies.get(email);
  if (cachedCookies) {
    await page.context().addCookies(cachedCookies);
    await page.goto(email === "staff@stallorder.test" ? "/staff/aming-chicken" : "/merchant/dashboard");
    await expect(page).toHaveURL(/\/merchant\/dashboard(?:\?organizationId=|$)|\/staff\//);
    return;
  }
  await page.goto("/login");
  await page.getByRole("button", { name: "使用電子郵件與密碼登入", exact: true }).click();
  await page.getByLabel("電子郵件").fill(email);
  await page.getByLabel("密碼").fill(password);
  await page.getByRole("button", { name: "登入", exact: true }).click();
  await expect(page).toHaveURL(/\/merchant\/dashboard(?:\?organizationId=|$)|\/staff\//);
  authCookies.set(email, await page.context().cookies());
}

async function openAttachReusableNotesDialog(page: Page, group: Locator) {
  const trigger = group.getByRole("button", { name: /加入既有共用註記/ });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: /將共用註記加入/ });
  await expect(dialog).toBeVisible();
  return { dialog, trigger };
}

async function fetchJsonInBrowser<T>(page: Page, path: string) {
  return page.evaluate(async (requestPath) => {
    const response = await fetch(requestPath, { credentials: "same-origin" });
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: await response.json(),
    };
  }, path) as Promise<{ status: number; headers: Record<string, string>; body: T }>;
}

test("商家可新增、修改、指派與刪除商品註記群組", async ({ page }) => {
  test.setTimeout(120_000);
  const groupName = `甜度 QA ${Date.now()}`;

  await login(page, "owner@stallorder.test");
  await page.goto(`/merchant/catalog?organizationId=${organizationId}`);
  await expect(page.getByRole("heading", { name: "商品註記設定" })).toBeVisible();
  const settingsToggle = page.getByTestId("product-note-settings-toggle");
  const settingsContent = page.locator("#product-note-settings-content");
  await expect(settingsToggle).toHaveAttribute("aria-expanded", "true");
  await settingsToggle.click();
  await expect(settingsToggle).toHaveText("展開商品註記設定");
  await expect(settingsContent).toBeHidden();
  await expect(page.getByRole("heading", { name: "商品註記設定" })).toBeVisible();
  await settingsToggle.click();
  await expect(settingsToggle).toHaveAttribute("aria-expanded", "true");
  await expect(settingsContent).toBeVisible();
  await page.getByRole("tab", { name: "註記群組" }).click();
  await expect(page.getByText("辣度", { exact: true })).toBeVisible();
  await expect(page.getByText("加料", { exact: true })).toBeVisible();

  const toggleAllGroups = page.getByTestId("product-note-groups-toggle-all");
  const groupDisclosures = page.locator("#product-note-groups-list > details");
  await expect(toggleAllGroups).toHaveAttribute("aria-expanded", "true");
  await toggleAllGroups.click();
  await expect(toggleAllGroups).toHaveText("展開全部註記群組");
  expect(await groupDisclosures.evaluateAll((items) => items.every((item) => !item.hasAttribute("open")))).toBe(true);
  await toggleAllGroups.click();
  expect(await groupDisclosures.evaluateAll((items) => items.every((item) => item.hasAttribute("open")))).toBe(true);
  await groupDisclosures.first().locator(":scope > summary").click();
  await expect(toggleAllGroups).toHaveAttribute("aria-expanded", "false");
  await toggleAllGroups.click();
  await expect(toggleAllGroups).toHaveAttribute("aria-expanded", "true");

  await page.getByRole("button", { name: "新增群組", exact: true }).click();
  const groupEditor = page.getByRole("dialog", { name: "新增註記群組" });
  const groupNameInput = groupEditor.getByLabel("群組名稱");
  const invalidGroupResponse = page.waitForResponse((response) => (
    new URL(response.url()).pathname === `/api/merchant/organizations/${organizationId}/product-notes`
    && response.request().method() === "POST"
    && response.request().postDataJSON()?.operation === "CREATE_NOTE_GROUP"
  ));
  await groupEditor.getByRole("button", { name: "儲存" }).click();
  expect((await invalidGroupResponse).status()).toBe(400);
  await expect(groupEditor.getByText("「名稱」輸入不正確，請依欄位限制重新輸入。", { exact: true }).first()).toBeVisible();
  await expect(groupNameInput).toHaveAttribute("aria-invalid", "true");
  await expect(groupNameInput).toBeFocused();
  await expect(groupNameInput).toHaveValue("");

  await groupNameInput.fill(groupName);
  await groupEditor.getByLabel("選取方式").selectOption("SINGLE");
  await groupEditor.getByLabel("顧客必須選擇").check();
  await expect(groupEditor.getByLabel("最少選取數")).toHaveValue("1");
  const assignedProduct = groupEditor.getByLabel("冬瓜茶", { exact: true });
  await assignedProduct.check();
  await groupEditor.getByText("多語名稱", { exact: true }).click();
  await groupEditor.getByLabel("英文", { exact: true }).fill("Sweetness");

  const productAssignments = groupEditor.getByRole("group", { name: "指派商品" });
  await expect(productAssignments).toHaveAttribute("data-field-key", "productIds");
  await expect(productAssignments).toHaveAttribute("tabindex", "-1");
  await page.route(`**/api/merchant/organizations/${organizationId}/product-notes`, async (route) => {
    await route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({
        error: "「指派商品」輸入不正確，請依欄位限制重新輸入。",
        fieldErrors: { productIds: "「指派商品」輸入不正確，請依欄位限制重新輸入。" },
      }),
    });
  }, { times: 1 });
  const invalidAssignmentsResponse = page.waitForResponse((response) => (
    new URL(response.url()).pathname === `/api/merchant/organizations/${organizationId}/product-notes`
    && response.request().method() === "POST"
  ));
  await groupEditor.getByRole("button", { name: "儲存" }).click();
  expect((await invalidAssignmentsResponse).status()).toBe(400);
  await expect(productAssignments).toHaveAttribute("aria-invalid", "true");
  await expect(productAssignments).toBeFocused();
  await expect(groupNameInput).toHaveValue(groupName);
  await assignedProduct.uncheck();
  await expect(productAssignments).toHaveAttribute("aria-invalid", "false");
  await assignedProduct.check();

  await groupEditor.getByRole("button", { name: "儲存" }).click();
  await expect(page.getByRole("status")).toHaveText("註記群組已新增。");

  const group = page.locator("details").filter({ has: page.getByText(groupName, { exact: true }) }).first();
  await expect(group).toContainText("冬瓜茶");
  await expect(group).toContainText("最少 1 項");
  await group.getByRole("button", { name: "新增群組專用註記" }).click();

  const optionEditor = page.getByRole("dialog", { name: "新增群組專用註記" });
  await optionEditor.getByLabel("註記名稱").fill("正常甜");
  await optionEditor.getByLabel("價格調整").fill("5");
  await optionEditor.getByRole("button", { name: "儲存" }).click();
  await expect(page.getByRole("status")).toHaveText("註記選項已新增。");
  await expect(group).toContainText("正常甜");

  await group.getByLabel("編輯 正常甜").click();
  const editOption = page.getByRole("dialog", { name: "編輯群組專用註記" });
  await editOption.getByLabel("註記名稱").fill("固定甜度");
  await editOption.getByRole("button", { name: "儲存" }).click();
  await expect(page.getByRole("status")).toHaveText("註記選項已更新。");
  await expect(group).toContainText("固定甜度");

  page.once("dialog", (dialog) => dialog.accept());
  await group.getByLabel("刪除 固定甜度").click();
  await expect(page.getByRole("status")).toHaveText("註記選項已刪除。");

  page.once("dialog", (dialog) => dialog.accept());
  await group.getByLabel(`刪除 ${groupName}`).click();
  await expect(page.getByRole("status")).toHaveText("註記群組已刪除。");
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

  await page.getByRole("button", { name: "新增單一註記" }).click();
  const reusableEditor = page.getByRole("dialog", { name: "新增共用單一註記" });
  await reusableEditor.getByLabel("註記名稱").fill(reusableName);
  await reusableEditor.getByRole("button", { name: "儲存" }).click();
  await expect(page.getByRole("status")).toHaveText("共用單一註記已新增。");

  await page.getByRole("tab", { name: "註記群組" }).click();
  await page.getByRole("button", { name: "新增群組", exact: true }).click();
  const groupEditor = page.getByRole("dialog", { name: "新增註記群組" });
  await groupEditor.getByLabel("群組名稱").fill(groupName);
  await groupEditor.getByRole("button", { name: "儲存" }).click();
  await expect(page.getByRole("status")).toHaveText("註記群組已新增。");

  let group = page.locator("details").filter({ has: page.getByText(groupName, { exact: true }) }).first();
  await group.getByRole("button", { name: "新增群組專用註記" }).click();
  const dedicatedEditor = page.getByRole("dialog", { name: "新增群組專用註記" });
  await dedicatedEditor.getByLabel("註記名稱").fill(dedicatedName);
  await dedicatedEditor.getByRole("button", { name: "儲存" }).click();
  await expect(page.getByRole("status")).toHaveText("註記選項已新增。");

  const { dialog: attachDialog } = await openAttachReusableNotesDialog(page, group);
  await attachDialog.getByLabel(reusableName, { exact: true }).check();
  await attachDialog.getByRole("button", { name: "加入群組", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("已將 1 個共用單一註記加入群組。");

  await group.getByLabel(`調整排序 ${reusableName}`).click();
  const reusableSortEditor = page.getByRole("dialog", { name: "調整群組內排序" });
  await reusableSortEditor.getByLabel("排序").fill("0");
  const reusableSortResponse = page.waitForResponse((response) => (
    new URL(response.url()).pathname === `/api/merchant/organizations/${organizationId}/product-notes`
    && response.request().method() === "POST"
    && response.request().postDataJSON()?.operation === "UPDATE_NOTE_OPTION"
  ));
  await reusableSortEditor.getByRole("button", { name: "儲存" }).click();
  expect((await reusableSortResponse).status()).toBe(200);

  await group.getByLabel(`編輯 ${dedicatedName}`).click();
  const dedicatedSortEditor = page.getByRole("dialog", { name: "編輯群組專用註記" });
  await dedicatedSortEditor.getByLabel("排序").fill("5");
  const dedicatedSortResponse = page.waitForResponse((response) => (
    new URL(response.url()).pathname === `/api/merchant/organizations/${organizationId}/product-notes`
    && response.request().method() === "POST"
    && response.request().postDataJSON()?.operation === "UPDATE_NOTE_OPTION"
  ));
  await dedicatedSortEditor.getByRole("button", { name: "儲存" }).click();
  expect((await dedicatedSortResponse).status()).toBe(200);

  await page.reload();
  await page.getByRole("tab", { name: "註記群組" }).click();
  group = page.locator("details").filter({ has: page.getByText(groupName, { exact: true }) }).first();
  const optionNames = group.locator(".divide-y.divide-stone-100 > div > div:first-child > span.text-sm.font-medium");
  await expect(optionNames).toHaveText([reusableName, dedicatedName]);

  page.once("dialog", (dialog) => dialog.accept());
  await group.getByLabel(`刪除 ${groupName}`).click();
  await expect(page.getByRole("status")).toHaveText("註記群組已刪除。");
  await page.getByRole("tab", { name: "所有單一註記" }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByLabel(`刪除 ${reusableName}`).click();
  await expect(page.getByRole("status")).toHaveText("共用單一註記已刪除。");
});

test("商家可原子批次加入多個既有共用註記", async ({ page }) => {
  test.setTimeout(120_000);
  const suffix = Date.now();
  const groupName = `批次註記群組 QA ${suffix}`;
  const noteNames = [`批次加料 A QA ${suffix}`, `批次加料 B QA ${suffix}`];
  const scrollFixtureNames = Array.from({ length: 8 }, (_, index) => `捲動測試 ${index + 1} QA ${suffix}`);
  const productNotesPath = `/api/merchant/organizations/${organizationId}/product-notes`;

  await login(page, "owner@stallorder.test");
  await page.goto(`/merchant/catalog?organizationId=${organizationId}`);

  for (const noteName of noteNames) {
    await page.getByRole("button", { name: "新增單一註記" }).click();
    const noteEditor = page.getByRole("dialog", { name: "新增共用單一註記" });
    await noteEditor.getByLabel("註記名稱").fill(noteName);
    await noteEditor.getByRole("button", { name: "儲存" }).click();
    await expect(page.getByRole("status")).toHaveText("共用單一註記已新增。");
  }

  const scrollFixtureStatuses = await page.evaluate(async ({ names, path }) => {
    const csrfToken = document.cookie
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
  }, { names: scrollFixtureNames, path: productNotesPath });
  expect(scrollFixtureStatuses).toEqual(scrollFixtureNames.map(() => 200));
  await page.reload();

  await page.getByRole("tab", { name: "註記群組" }).click();
  await page.getByRole("button", { name: "新增群組", exact: true }).click();
  const groupEditor = page.getByRole("dialog", { name: "新增註記群組" });
  await groupEditor.getByLabel("群組名稱").fill(groupName);
  await groupEditor.getByRole("button", { name: "儲存" }).click();
  await expect(page.getByRole("status")).toHaveText("註記群組已新增。");

  let group = page.locator("details").filter({ has: page.getByText(groupName, { exact: true }) }).first();
  await page.setViewportSize({ width: 375, height: 667 });
  let { dialog: choices, trigger: attachTrigger } = await openAttachReusableNotesDialog(page, group);
  const search = choices.getByLabel("搜尋共用註記");
  await expect(search).toBeFocused();
  const closeButton = choices.getByRole("button", { name: "關閉", exact: true });
  const cancelButton = choices.getByRole("button", { name: "取消", exact: true });
  const joinButton = choices.getByRole("button", { name: "加入群組", exact: true });
  await expect(cancelButton).toBeVisible();
  await expect(joinButton).toBeVisible();
  await closeButton.focus();
  await page.keyboard.press("Shift+Tab");
  await expect(joinButton).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(closeButton).toBeFocused();
  await page.getByTestId("product-note-groups-toggle-all").focus();
  await page.keyboard.press("Tab");
  await expect(closeButton).toBeFocused();
  await search.focus();
  await search.fill(noteNames[1]);
  await expect(choices.getByLabel(noteNames[1], { exact: true })).toBeVisible();
  await expect(choices.getByLabel(noteNames[0], { exact: true })).toHaveCount(0);
  await choices.getByLabel(noteNames[1], { exact: true }).check();
  await search.fill("");
  await choices.getByLabel(noteNames[0], { exact: true }).check();
  await expect(choices.getByText("已選擇 2 個註記", { exact: false })).toBeVisible();

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
  expect(actionBarBeforeScroll!.y + actionBarBeforeScroll!.height).toBeLessThanOrEqual(667);
  await selectionList.evaluate((element) => { element.scrollTop = 0; });
  await selectionList.hover();
  await page.mouse.wheel(0, 480);
  await expect.poll(() => selectionList.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  const actionBarAfterScroll = await actionBar.boundingBox();
  expect(actionBarAfterScroll).not.toBeNull();
  expect(Math.abs(actionBarAfterScroll!.y - actionBarBeforeScroll!.y)).toBeLessThanOrEqual(1);
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
      selectionOverflowY: selectionList ? getComputedStyle(selectionList).overflowY : "",
    };
  });
  expect(mobileLayout.left).toBeGreaterThanOrEqual(0);
  expect(mobileLayout.right).toBeLessThanOrEqual(mobileLayout.viewportWidth + 1);
  expect(mobileLayout.top).toBeGreaterThanOrEqual(0);
  expect(mobileLayout.bottom).toBeLessThanOrEqual(mobileLayout.viewportHeight + 1);
  expect(mobileLayout.documentWidth).toBeLessThanOrEqual(mobileLayout.viewportWidth + 1);
  expect(mobileLayout.selectionOverflowY).toBe("auto");
  await expect.poll(() => page.evaluate(() => ({
    body: document.body.style.overflow,
    document: document.documentElement.style.overflow,
  }))).toEqual({ body: "hidden", document: "hidden" });

  await page.keyboard.press("Escape");
  await expect(choices).toHaveCount(0);
  await expect(attachTrigger).toBeFocused();
  await expect.poll(() => page.evaluate(() => ({
    body: document.body.style.overflow,
    document: document.documentElement.style.overflow,
  }))).toEqual({ body: "", document: "" });
  ({ dialog: choices, trigger: attachTrigger } = await openAttachReusableNotesDialog(page, group));
  await expect(choices.getByText("已選擇 0 個註記", { exact: false })).toBeVisible();
  for (const noteName of noteNames) await choices.getByLabel(noteName, { exact: true }).check();

  await page.route(`**${productNotesPath}`, async (route) => {
    const payload = route.request().postDataJSON() as { operation?: string; reusableNoteIds?: string[] };
    if (payload.operation !== "ATTACH_REUSABLE_NOTES" || !payload.reusableNoteIds) {
      await route.continue();
      return;
    }
    await route.continue({
      postData: JSON.stringify({
        ...payload,
        reusableNoteIds: [payload.reusableNoteIds[0], "ffffffff-ffff-4fff-8fff-fffffffffff1"],
      }),
    });
  });
  const failedBatchResponse = page.waitForResponse((response) => (
    new URL(response.url()).pathname === productNotesPath
    && response.request().method() === "POST"
  ));
  await choices.getByRole("button", { name: "加入群組", exact: true }).click();
  expect((await failedBatchResponse).status()).toBe(404);
  await expect(choices.getByRole("alert").first()).toHaveText("找不到指定的商品或註記資料。");
  for (const noteName of noteNames) await expect(choices.getByLabel(noteName, { exact: true })).toBeChecked();
  await page.unroute(`**${productNotesPath}`);

  await page.keyboard.press("Escape");
  await page.reload();
  await page.getByRole("tab", { name: "註記群組" }).click();
  group = page.locator("details").filter({ has: page.getByText(groupName, { exact: true }) }).first();
  for (const noteName of noteNames) {
    await expect(group.getByLabel(`從群組移除 ${noteName}`)).toHaveCount(0);
  }

  ({ dialog: choices, trigger: attachTrigger } = await openAttachReusableNotesDialog(page, group));
  for (const noteName of noteNames) await choices.getByLabel(noteName, { exact: true }).check();
  let releaseAttachRequest: () => void = () => {};
  const attachRequestGate = new Promise<void>((resolve) => {
    releaseAttachRequest = resolve;
  });
  await page.route(`**${productNotesPath}`, async (route) => {
    const payload = route.request().postDataJSON() as { operation?: string };
    if (payload.operation === "ATTACH_REUSABLE_NOTES") await attachRequestGate;
    await route.continue();
  }, { times: 1 });
  const successfulBatchResponse = page.waitForResponse((response) => (
    new URL(response.url()).pathname === productNotesPath
    && response.request().method() === "POST"
    && response.request().postDataJSON()?.operation === "ATTACH_REUSABLE_NOTES"
  ));
  await choices.getByRole("button", { name: "加入群組", exact: true }).click();
  await expect(choices.getByRole("button", { name: "關閉", exact: true })).toBeDisabled();
  await expect(choices.getByRole("button", { name: "取消", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(choices).toBeVisible();
  releaseAttachRequest();
  const batchResponse = await successfulBatchResponse;
  expect(batchResponse.status()).toBe(200);
  expect(batchResponse.request().postDataJSON()?.reusableNoteIds).toHaveLength(2);
  await expect(page.getByRole("status")).toHaveText("已將 2 個共用單一註記加入群組。");
  await expect(attachTrigger).toBeFocused();

  await page.reload();
  await page.getByRole("tab", { name: "註記群組" }).click();
  group = page.locator("details").filter({ has: page.getByText(groupName, { exact: true }) }).first();
  for (const noteName of noteNames) {
    await expect(group.getByLabel(`從群組移除 ${noteName}`)).toBeVisible();
  }

  page.once("dialog", (dialog) => dialog.accept());
  await group.getByLabel(`刪除 ${groupName}`).click();
  await expect(page.getByRole("status")).toHaveText("註記群組已刪除。");
  await page.getByRole("tab", { name: "所有單一註記" }).click();
  for (const noteName of [...noteNames, ...scrollFixtureNames]) {
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByLabel(`刪除 ${noteName}`).click();
    await expect(page.getByRole("status")).toHaveText("共用單一註記已刪除。");
  }
});

test("共用單一註記可加入多個群組、同步更新並阻擋使用中刪除", async ({ page }) => {
  test.setTimeout(120_000);
  const suffix = Date.now();
  const noteName = `香菜另外放 QA ${suffix}`;
  const updatedName = `香菜另放 QA ${suffix}`;

  await login(page, "owner@stallorder.test");
  await page.goto(`/merchant/catalog?organizationId=${organizationId}`);
  await expect(page.getByRole("tab", { name: "所有單一註記" })).toHaveAttribute("aria-selected", "true");

  await page.getByRole("button", { name: "新增單一註記" }).click();
  const createEditor = page.getByRole("dialog", { name: "新增共用單一註記" });
  await createEditor.getByLabel("註記名稱").fill(noteName);
  await createEditor.getByLabel("價格調整").fill("7");
  await createEditor.getByRole("button", { name: "儲存" }).click();
  await expect(page.getByRole("status")).toHaveText("共用單一註記已新增。");

  await page.getByRole("button", { name: "新增單一註記" }).click();
  const duplicateEditor = page.getByRole("dialog", { name: "新增共用單一註記" });
  const duplicateName = duplicateEditor.getByLabel("註記名稱");
  await duplicateName.fill(noteName);
  await duplicateEditor.getByRole("button", { name: "儲存" }).click();
  await expect(duplicateEditor.getByRole("alert")).toHaveText("已有相同名稱的共用單一註記，請使用其他名稱。");
  await expect(duplicateName).toHaveAttribute("aria-invalid", "true");
  await expect(duplicateName).toBeFocused();
  await duplicateEditor.getByRole("button", { name: "關閉" }).click();

  await page.getByRole("tab", { name: "註記群組" }).click();
  const spiceGroup = page.locator("details").filter({ has: page.getByText("辣度", { exact: true }) }).first();
  const toppingGroup = page.locator("details").filter({ has: page.getByText("加料", { exact: true }) }).first();
  const { dialog: spiceAttachDialog } = await openAttachReusableNotesDialog(page, spiceGroup);
  const emptyAttachChoices = spiceAttachDialog.getByRole("group", { name: "選擇共用註記" });
  const emptyAttachButton = spiceAttachDialog.getByRole("button", { name: "加入群組", exact: true });
  await emptyAttachButton.click();
  await expect(spiceAttachDialog.getByRole("alert")).toHaveCount(1);
  await expect(spiceAttachDialog.getByRole("alert")).toHaveText("請至少選擇一個要加入群組的共用單一註記。");
  await expect(emptyAttachChoices).toHaveAttribute("aria-invalid", "true");
  await expect(emptyAttachChoices).toBeFocused();
  await emptyAttachChoices.getByLabel(noteName, { exact: true }).check();
  await expect(emptyAttachChoices).toHaveAttribute("aria-invalid", "false");
  await emptyAttachButton.click();
  await expect(spiceGroup.getByLabel(`從群組移除 ${noteName}`)).toBeVisible();

  const { dialog: toppingAttachDialog } = await openAttachReusableNotesDialog(page, toppingGroup);
  await toppingAttachDialog.getByLabel(noteName, { exact: true }).check();
  await toppingAttachDialog.getByRole("button", { name: "加入群組", exact: true }).click();
  await expect(toppingGroup.getByLabel(`從群組移除 ${noteName}`)).toBeVisible();

  await page.getByRole("tab", { name: "所有單一註記" }).click();
  await page.getByLabel(`編輯 ${noteName}`).click();
  const editEditor = page.getByRole("dialog", { name: "編輯共用單一註記" });
  await editEditor.getByLabel("註記名稱").fill(updatedName);
  await editEditor.getByLabel("價格調整").fill("9");
  await editEditor.getByRole("button", { name: "儲存" }).click();
  await expect(page.getByRole("status")).toHaveText("共用單一註記已更新，所有群組已同步。");
  await expect(page.getByText("已加入 2 個群組", { exact: false })).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByLabel(`刪除 ${updatedName}`).click();
  await expect(page.getByRole("status")).toHaveText("此共用註記仍在註記群組中使用，請先從所有群組移除。");

  await page.getByRole("tab", { name: "註記群組" }).click();
  for (const group of [spiceGroup, toppingGroup]) {
    await expect(group.getByText(updatedName, { exact: true })).toBeVisible();
    page.once("dialog", (dialog) => dialog.accept());
    await group.getByLabel(`從群組移除 ${updatedName}`).click();
    await expect(group.getByLabel(`從群組移除 ${updatedName}`)).toHaveCount(0);
  }

  await page.getByRole("tab", { name: "所有單一註記" }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByLabel(`刪除 ${updatedName}`).click();
  await expect(page.getByRole("status")).toHaveText("共用單一註記已刪除。");
  await expect(page.getByText(updatedName, { exact: true })).toHaveCount(0);
});

test("商品註記可匯出、預覽並以單一交易匯入", async ({ page }) => {
  test.setTimeout(120_000);
  const suffix = Date.now();
  const noteName = `匯入共用註記 QA ${suffix}`;
  const groupName = `匯入註記群組 QA ${suffix}`;

  await login(page, "owner@stallorder.test");
  await page.goto(`/merchant/catalog?organizationId=${organizationId}`);

  const exportPath = `/api/merchant/organizations/${organizationId}/product-notes/export`;
  const importPath = `/api/merchant/organizations/${organizationId}/product-notes/import`;
  await page.route(`**${exportPath}`, (route) => route.fulfill({
    status: 422,
    contentType: "application/json",
    body: JSON.stringify({ error: "註記資料超過 1MB 匯出上限，請精簡註記後再匯出。" }),
  }));
  await page.getByRole("button", { name: "匯出 JSON" }).click();
  await expect(page.getByRole("status")).toHaveText("註記資料超過 1MB 匯出上限，請精簡註記後再匯出。");
  await expect(page).toHaveURL(new RegExp(`/merchant/catalog\\?organizationId=${organizationId}`));
  await page.unroute(`**${exportPath}`);

  const exportResponse = await fetchJsonInBrowser<ProductNoteTransfer>(page, exportPath);
  expect(exportResponse.status).toBe(200);
  expect(exportResponse.headers["content-disposition"]).toContain("stallorder-product-notes-");
  const exported = exportResponse.body;
  expect(exported.sourceCurrency).toBe("TWD");
  const productReference = exported.groups
    .flatMap((group: { products?: Array<{ id: string | null; name: string; sortOrder: number }> }) => group.products ?? [])[0];
  if (!productReference) throw new Error("測試資料缺少可供註記指派的商品。");
  const importedProductReference = { ...productReference, sortOrder: 47 };
  const transfer = {
    schemaVersion: exported.schemaVersion,
    exportedAt: exported.exportedAt,
    sourceCurrency: exported.sourceCurrency,
    reusableNotes: [{
      name: noteName,
      priceDelta: 5,
      sortOrder: 999,
      isActive: true,
      translations: [{ locale: "en", name: "Imported note" }],
    }],
    groups: [{
      name: groupName,
      selectionMode: "MULTIPLE",
      isRequired: false,
      minSelections: 0,
      maxSelections: 2,
      sortOrder: 999,
      isActive: true,
      translations: [{ locale: "en", name: "Imported group" }],
      products: [importedProductReference],
      options: [{
        name: noteName,
        reusableNoteName: noteName,
        priceDelta: 5,
        sortOrder: 1,
        isActive: true,
        translations: [],
      }],
    }],
  };

  const importInput = page.locator('input[type="file"][accept*="json"]');
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

  const applyResponse = page.waitForResponse((response) => (
    new URL(response.url()).pathname === `/api/merchant/organizations/${organizationId}/product-notes/import`
    && response.request().method() === "POST"
    && response.status() === 200
  ));
  await preview.getByRole("button", { name: "套用匯入" }).click();
  await applyResponse;
  await expect(page.getByRole("status")).toContainText("已匯入 1 個共用註記、1 個群組與 1 個群組註記");
  await expect(page.getByText(noteName, { exact: true })).toBeVisible();

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
  await page.route(`**${importPath}`, (route) => route.fulfill({
    status: 409,
    contentType: "application/json",
    body: JSON.stringify({ error: "測試用匯入衝突，請重新確認資料。" }),
  }), { times: 1 });
  await mergePreview.getByRole("button", { name: "套用匯入" }).click();
  await expect(mergePreview.getByRole("alert")).toHaveText("測試用匯入衝突，請重新確認資料。");
  await expect(mergePreview).toBeVisible();
  const mergeApplyResponse = page.waitForResponse((response) => (
    new URL(response.url()).pathname === importPath
    && response.request().method() === "POST"
    && response.status() === 200
  ));
  await mergePreview.getByRole("button", { name: "套用匯入" }).click();
  await mergeApplyResponse;

  const mergedExportResponse = await fetchJsonInBrowser<ProductNoteTransfer>(
    page,
    `/api/merchant/organizations/${organizationId}/product-notes/export`,
  );
  expect(mergedExportResponse.status).toBe(200);
  const mergedExport = mergedExportResponse.body;
  const mergedGroup = mergedExport.groups.find((group: { name: string }) => group.name === groupName);
  const mergedNote = mergedExport.reusableNotes.find((note: { name: string }) => note.name === noteName);
  expect(mergedGroup?.products).toContainEqual(importedProductReference);
  expect(mergedGroup?.options).toContainEqual(expect.objectContaining({ name: noteName, sortOrder: 1 }));
  expect(mergedGroup?.sortOrder).toBe(998);
  expect(mergedGroup?.translations).toContainEqual({ locale: "en", name: "Imported group" });
  expect(mergedNote?.priceDelta).toBe(9);
  expect(mergedNote?.translations).toContainEqual({ locale: "en", name: "Imported note" });

  await page.getByRole("tab", { name: "註記群組" }).click();
  const importedGroup = page.locator("details").filter({ has: page.getByText(groupName, { exact: true }) }).first();
  await expect(importedGroup).toContainText(noteName);
  page.once("dialog", (dialog) => dialog.accept());
  await importedGroup.getByLabel(`刪除 ${groupName}`).click();
  await expect(page.getByRole("status")).toHaveText("註記群組已刪除。");

  await page.getByRole("tab", { name: "所有單一註記" }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByLabel(`刪除 ${noteName}`).click();
  await expect(page.getByRole("status")).toHaveText("共用單一註記已刪除。");
});

test("QR 依瀏覽器語系自動切換並保留手動選擇", async ({ browser }) => {
  const baseURL = String(test.info().project.use.baseURL ?? "http://localhost:3001");
  const context = await browser.newContext({ baseURL, locale: "ja-JP", timezoneId: "Asia/Taipei" });
  const page = await context.newPage();

  try {
    const sessionResponse = page.waitForResponse((response) => (
      new URL(response.url()).pathname.endsWith("/create-order-session")
      && response.request().method() === "POST"
    ));
    await page.goto(`/q/${takeoutQrToken}`);
    expect((await sessionResponse).status()).toBe(201);
    await expect(page.locator("html")).toHaveAttribute("lang", "ja");
    await expect(page.getByRole("button", { name: "メニュー言語" })).toHaveAttribute("data-current-locale", "ja");
    await expect(page.getByRole("heading", { name: "揚げ物", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "台湾風鶏の唐揚げ" })).toBeVisible();

    await page.getByRole("button", { name: "台湾風鶏の唐揚げを増やす" }).click();
    const japaneseProductDialog = page.getByRole("dialog", { name: "台湾風鶏の唐揚げ" });
    await expect(japaneseProductDialog).toBeVisible();
    await expect(japaneseProductDialog.getByRole("group", { name: /辛さ/ })).toBeVisible();
    await expect(japaneseProductDialog.getByLabel("小辛", { exact: true })).toBeVisible();
    await expect(japaneseProductDialog.getByRole("group", { name: /追加トッピング/ })).toBeVisible();
    await japaneseProductDialog.getByRole("button", { name: "閉じる", exact: true }).click();
    await expect(japaneseProductDialog).toBeHidden();

    await page.getByRole("button", { name: "メニュー言語" }).click();
    await page.getByRole("option", { name: "English", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("heading", { name: "Pepper Popcorn Chicken" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Your order" })).toBeVisible();

    await page.reload();
    await expect(page.getByRole("button", { name: "Menu language" })).toHaveAttribute("data-current-locale", "en");
    await expect(page.getByRole("heading", { name: "Pepper Popcorn Chicken" })).toBeVisible();
  } finally {
    await context.close();
  }
});

test("QR 註記選擇會由後端驗價並顯示於店員訂單", async ({ browser, page }) => {
  test.setTimeout(120_000);
  const customerName = `註記 QA ${Date.now()}`;

  await page.goto(`/q/${takeoutQrToken}`);
  await page.getByRole("button", { name: "增加 台式鹽酥雞" }).click();
  await expect(page.getByRole("group", { name: /辣度/ })).toBeVisible();
  await page.getByLabel("中辣", { exact: true }).check();
  await page.getByLabel(/加蛋/).check();
  await page.getByRole("article").filter({ hasText: "台式鹽酥雞" })
    .getByRole("button", { name: "加入購物車" }).click();
  await page.getByLabel("顧客稱呼").fill(customerName);
  await page.getByLabel("訂單備註").fill("胡椒少一點");
  await expect(page.getByTestId("qr-cart-panel").getByText("$90", { exact: true }).last()).toBeVisible();
  const waitAcknowledgment = page.getByRole("checkbox", { name: /我已了解目前預估等候時間/u });
  if (await waitAcknowledgment.isVisible()) await waitAcknowledgment.check();
  const submitOrder = page.getByRole("button", { name: "送出訂單", exact: true });
  await expect(submitOrder).toBeEnabled({ timeout: 20_000 });

  let createResponsePromise = page.waitForResponse((response) => (
    new URL(response.url()).pathname.endsWith("/create-public-order")
    && response.request().method() === "POST"
  ));
  await submitOrder.click();
  let createResponse = await createResponsePromise;
  if (createResponse.status() === 422) {
    await expect(createResponse.json()).resolves.toMatchObject({ code: "WAIT_ACKNOWLEDGMENT_REQUIRED" });
    await expect(waitAcknowledgment).toBeVisible();
    await waitAcknowledgment.check();
    await expect(submitOrder).toBeEnabled({ timeout: 20_000 });
    createResponsePromise = page.waitForResponse((response) => (
      new URL(response.url()).pathname.endsWith("/create-public-order")
      && response.request().method() === "POST"
    ));
    await submitOrder.click();
    createResponse = await createResponsePromise;
  }
  expect(createResponse.status()).toBe(201);
  await expect(page).toHaveURL(/\/order\//);
  await expect(page.getByText(/辣度：中辣.*加料：加蛋/)).toBeVisible();

  const staffContext = await browser.newContext({ locale: "zh-TW", timezoneId: "Asia/Taipei" });
  const staffPage = await staffContext.newPage();
  await login(staffPage, "staff@stallorder.test");
  await staffPage.goto("/staff/aming-chicken");
  const staffOrder = staffPage.getByRole("article").filter({ hasText: customerName });
  await staffOrder.getByRole("button", { name: "查看明細", exact: true }).click();
  await expect(staffOrder).toContainText("辣度：中辣");
  await expect(staffOrder).toContainText("加料：加蛋");
  await expect(staffOrder).toContainText("胡椒少一點");
  await expect(staffOrder).toContainText("$90");

  await staffOrder.getByRole("button", { name: "取消訂單" }).click();
  const cancellation = staffPage.getByRole("alertdialog", { name: "確認取消訂單？" });
  await expect(cancellation).toContainText(customerName);
  await cancellation.getByLabel("管理授權碼").fill(managerAuthorizationCode);
  const cancellationResponse = staffPage.waitForResponse((response) => (
    new URL(response.url()).pathname.includes("/api/stalls/aming-chicken/orders/")
    && response.request().method() === "PATCH"
  ), { timeout: 30_000 });
  await cancellation.getByRole("button", { name: "確認取消訂單" }).click();
  expect((await cancellationResponse).status()).toBe(200);
  await expect(staffOrder).toHaveCount(0);
  await staffContext.close();
});
