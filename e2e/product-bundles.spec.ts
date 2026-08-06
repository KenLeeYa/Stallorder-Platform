import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

const organizationId = "11111111-1111-4111-8111-111111111111";
const password = "StallOrderDemo!2026";
const prisma = new PrismaClient();

test.afterEach(async () => {
  await prisma.product.deleteMany({
    where: { organizationId, name: { startsWith: "套餐 QA " } },
  });
  await prisma.product.deleteMany({
    where: { organizationId, name: { startsWith: "未分派套餐元件 QA " } },
  });
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

async function login(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "使用電子郵件與密碼登入", exact: true }).click();
  await page.getByLabel("電子郵件").fill("owner@stallorder.test");
  await page.getByLabel("密碼").fill(password);
  await page.getByRole("button", { name: "登入", exact: true }).click();
  await expect(page).toHaveURL(/\/merchant\/dashboard\?organizationId=/);
}

test("商家可建立套餐、選擇群組與一般商品選項", async ({ page }) => {
  test.setTimeout(120_000);
  const bundleName = `套餐 QA ${Date.now()}`;
  const choiceGroupName = "主餐任選";
  const unavailableComponentName = `未分派套餐元件 QA ${Date.now()}`;

  await login(page);
  await page.goto(`/merchant/catalog?organizationId=${organizationId}`);

  const catalogDisclosure = page.locator("details[data-shared-product-catalog]");
  await expect(catalogDisclosure).toHaveAttribute("open", "");
  await catalogDisclosure.locator(":scope > summary").click();
  await expect(catalogDisclosure).not.toHaveAttribute("open", "");
  await catalogDisclosure.locator(":scope > summary").click();
  await expect(catalogDisclosure).toHaveAttribute("open", "");
  const toggleAllProducts = page.getByTestId("shared-products-toggle-all");
  await expect(toggleAllProducts).toHaveAttribute("aria-expanded", "true");
  await toggleAllProducts.click();
  await expect(catalogDisclosure).not.toHaveAttribute("open", "");
  await expect(toggleAllProducts).toHaveText("展開全部品項");
  await toggleAllProducts.click();
  await expect(catalogDisclosure).toHaveAttribute("open", "");
  const firstCategoryDisclosure = catalogDisclosure.locator("details").first();
  await expect(firstCategoryDisclosure).toHaveAttribute("open", "");
  await firstCategoryDisclosure.locator(":scope > summary").click();
  await expect(firstCategoryDisclosure).not.toHaveAttribute("open", "");
  await firstCategoryDisclosure.locator(":scope > summary").click();
  await expect(firstCategoryDisclosure).toHaveAttribute("open", "");

  await page.getByRole("button", { name: "商品", exact: true }).click();
  const componentEditor = page.getByRole("dialog", { name: "新增商品" });
  await componentEditor.getByLabel("商品名稱").fill(unavailableComponentName);
  await componentEditor.getByLabel("預設售價").fill("30");
  await componentEditor.getByRole("checkbox", { name: "阿明鹽酥雞", exact: true }).uncheck();
  await componentEditor.getByRole("button", { name: "儲存", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("商品已新增。");

  await page.getByRole("button", { name: "新增套餐", exact: true }).click();
  const productEditor = page.getByRole("dialog", { name: "新增套餐" });
  await productEditor.getByLabel("商品名稱").fill(bundleName);
  await expect(productEditor.getByLabel("商品類型")).toHaveValue("BUNDLE");
  await expect(productEditor.getByRole("checkbox", { name: "阿明鹽酥雞", exact: true })).toBeChecked();
  await productEditor.getByLabel("套餐組合價").fill("180");
  await productEditor.getByRole("button", { name: "儲存", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("商品已新增。");

  await page.getByRole("button", { name: `設定 ${bundleName} 套餐內容` }).click();
  const bundleEditor = page.getByRole("dialog", { name: `設定「${bundleName}」套餐內容` });
  await expect(bundleEditor.getByText("套餐組合價：$180", { exact: true })).toBeVisible();
  const visibilitySummary = bundleEditor.getByTestId("bundle-visibility-summary");
  await expect(visibilitySummary).toContainText("阿明鹽酥雞：套餐不會顯示");
  await expect(visibilitySummary).toContainText("尚未設定套餐群組");

  await bundleEditor.getByRole("button", { name: "新增群組", exact: true }).click();
  const choiceGroupNameInput = bundleEditor.getByLabel("群組名稱");
  const invalidChoiceGroupResponse = page.waitForResponse((response) => (
    new URL(response.url()).pathname === `/api/merchant/organizations/${organizationId}/catalog`
    && response.request().method() === "POST"
    && response.request().postDataJSON()?.operation === "CREATE_BUNDLE_CHOICE_GROUP"
  ));
  await bundleEditor.getByRole("button", { name: "儲存", exact: true }).click();
  expect((await invalidChoiceGroupResponse).status()).toBe(400);
  await expect(bundleEditor.getByText("「名稱」輸入不正確，請依欄位限制重新輸入。", { exact: true }).first()).toBeVisible();
  await expect(choiceGroupNameInput).toHaveAttribute("aria-invalid", "true");
  await expect(choiceGroupNameInput).toBeFocused();
  await expect(choiceGroupNameInput).toHaveValue("");

  await choiceGroupNameInput.fill(choiceGroupName);
  await bundleEditor.getByLabel("最少選擇").fill("2");
  await bundleEditor.getByLabel("最多選擇").fill("1");
  await bundleEditor.getByRole("button", { name: "儲存", exact: true }).click();
  await expect(bundleEditor.getByText("套餐群組最少選擇數不可大於最多選擇數。", { exact: true }).first()).toBeVisible();
  await expect(bundleEditor.getByLabel("最多選擇")).toHaveAttribute("aria-invalid", "true");
  await expect(bundleEditor.getByLabel("最多選擇")).toBeFocused();
  await bundleEditor.getByLabel("最少選擇").fill("1");
  await bundleEditor.getByRole("button", { name: "儲存", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("套餐選擇群組已新增。");

  const choiceGroup = bundleEditor.locator("section").filter({ hasText: choiceGroupName });
  await expect(choiceGroup.getByText("套餐群組", { exact: true })).toBeVisible();
  await expect(visibilitySummary).toContainText("主餐任選」至少需 1 個可用商品，目前 0 個");
  await choiceGroup.getByRole("button", { name: "加入一般商品", exact: true }).click();
  const componentSelect = choiceGroup.getByLabel("一般商品");
  const unavailableOptionLabel = `${unavailableComponentName}（阿明鹽酥雞：未分派）`;
  await expect(componentSelect.locator("option").filter({ hasText: unavailableComponentName })).toHaveText(unavailableOptionLabel);
  await componentSelect.selectOption({ label: unavailableOptionLabel });
  await expect(choiceGroup.getByTestId("bundle-component-draft-status")).toContainText("阿明鹽酥雞－未分派");
  await expect(choiceGroup.getByTestId("bundle-component-draft-status")).toContainText("套餐不會顯示");
  await choiceGroup.getByLabel("一般商品").selectOption({ label: "香酥雞排" });
  await expect(choiceGroup.getByTestId("bundle-component-draft-status")).toHaveText("此元件可用於所有套餐分派攤位。");
  await choiceGroup.getByLabel("數量").fill("2");
  await choiceGroup.getByLabel("價差").fill("20");
  await choiceGroup.getByRole("button", { name: "儲存", exact: true }).click();
  await expect(page.getByText("套餐選項已新增。", { exact: true })).toBeVisible();
  await expect(choiceGroup).toContainText("香酥雞排 × 2");
  await expect(choiceGroup).toContainText("+$20");

  await bundleEditor.getByRole("button", { name: "關閉", exact: true }).click();

  await page.goto("/staff/aming-chicken");
  await page.getByRole("button", { name: "店員點餐", exact: true }).click();
  const staffComposer = page.getByRole("dialog", { name: "店員點餐與結帳" });
  await expect(staffComposer.getByTestId("staff-product-card").filter({ hasText: bundleName })).toBeVisible();

  await page.goto("/q/demo-aming-chicken-qr-2026-rotate-me");
  await expect(page.getByRole("heading", { name: bundleName, exact: true })).toBeVisible();

  await page.goto(`/merchant/catalog?organizationId=${organizationId}`);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: `刪除 ${bundleName}` }).click();
  await expect(page.getByRole("status")).toHaveText("商品已刪除，歷史訂單快照已保留。");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: `刪除 ${unavailableComponentName}` }).click();
  await expect(page.getByRole("status")).toHaveText("商品已刪除，歷史訂單快照已保留。");
});

test("手機版套餐操作列與商品編輯器不超出畫面", async ({ page }) => {
  const bundleName = `套餐 QA 手機版 ${Date.now()}`;
  const category = await prisma.productCategory.findFirstOrThrow({
    where: { organizationId, isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true },
  });
  await prisma.product.create({
    data: {
      organizationId,
      categoryId: category.id,
      name: bundleName,
      description: "",
      defaultPrice: 180,
      kind: "BUNDLE",
    },
  });

  await page.setViewportSize({ width: 375, height: 812 });
  await login(page);
  await page.goto(`/merchant/catalog?organizationId=${organizationId}`);

  const bundleButton = page.getByRole("button", {
    name: `設定 ${bundleName} 套餐內容`,
    exact: true,
  });
  await expect(bundleButton).toBeVisible();
  const productActions = bundleButton.locator("..");
  const actionBounds = await productActions.locator("button").evaluateAll((buttons) => buttons.map((button) => {
    const bounds = button.getBoundingClientRect();
    return { left: bounds.left, right: bounds.right, height: bounds.height };
  }));
  expect(actionBounds.length).toBeGreaterThan(1);
  for (const bounds of actionBounds) {
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(375);
    expect(bounds.height).toBeGreaterThanOrEqual(44);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

  const productTrigger = page.getByRole("button", { name: "商品", exact: true });
  const overflowBefore = await page.evaluate(() => ({
    body: document.body.style.overflow,
    document: document.documentElement.style.overflow,
  }));
  await productTrigger.click();
  const productEditor = page.getByRole("dialog", { name: "新增商品" });
  const closeButton = productEditor.getByRole("button", { name: "關閉", exact: true });
  await expect(closeButton).toBeFocused();
  await expect.poll(() => page.evaluate(() => ({
    body: document.body.style.overflow,
    document: document.documentElement.style.overflow,
  }))).toEqual({ body: "hidden", document: "hidden" });

  const editorBounds = await productEditor.boundingBox();
  expect(editorBounds).not.toBeNull();
  expect(editorBounds!.y).toBeGreaterThanOrEqual(15);
  expect(editorBounds!.y + editorBounds!.height).toBeLessThanOrEqual(797);
  const scrollMetrics = await productEditor.getByTestId("catalog-editor-scroll-region").evaluate((region) => ({
    clientHeight: region.clientHeight,
    scrollHeight: region.scrollHeight,
    overflowY: getComputedStyle(region).overflowY,
  }));
  expect(scrollMetrics.overflowY).toBe("auto");
  expect(scrollMetrics.scrollHeight).toBeGreaterThan(scrollMetrics.clientHeight);
  await expect(productEditor.getByTestId("catalog-editor-header")).toHaveCSS("position", "sticky");

  await page.keyboard.press("Shift+Tab");
  await expect(productEditor.getByRole("button", { name: "儲存", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(closeButton).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(productEditor).toBeHidden();
  await expect(productTrigger).toBeFocused();
  await expect.poll(() => page.evaluate(() => ({
    body: document.body.style.overflow,
    document: document.documentElement.style.overflow,
  }))).toEqual(overflowBefore);
});
