import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { establishLocalTestSession, gotoLocalPath } from "./local-navigation";

const prisma = new PrismaClient();
const organizationId = "11111111-1111-4111-8111-111111111111";
let ownerId = "";
test.use({ serviceWorkers: "block" });
test.beforeAll(async () => {
  const db = new URL(process.env.DATABASE_URL ?? "");
  if (!["localhost", "127.0.0.1"].includes(db.hostname) || db.port !== "55722") throw new Error("DEDICATED_CATALOG_LAB_REQUIRED");
  ownerId = (await prisma.profile.findUniqueOrThrow({ where: { email: "owner@stallorder.test" } })).id;
});
test.afterAll(async () => { await prisma.$disconnect(); });

test("empty ungrouped buckets are absent and category/group filters identify the item list", async ({ page }) => {
  test.setTimeout(120_000);
  await establishLocalTestSession(page, prisma, ownerId);
  await gotoLocalPath(page, "/merchant/catalog");
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    if (width >= 768) {
      const nav = page.getByRole("navigation", { name: "分類與群組", exact: true });
      await expect(nav.getByRole("button", { name: /未分組/ })).toHaveCount(0);
      await nav.getByRole("button", { name: "篩選分類 炸物", exact: true }).click();
      const count = await prisma.product.count({ where: { organizationId, category: { name: "炸物" } } });
      await expect(page.getByTestId("catalog-management-row")).toHaveCount(count);
      await nav.getByRole("button", { name: "篩選群組 人氣炸物", exact: true }).click();
      await expect(page.getByTestId("catalog-list-heading")).toContainText("炸物 / 人氣炸物");
      await expect(page.getByTestId("catalog-management-row")).toHaveCount(3);
    } else {
      await page.getByTestId("open-catalog-navigator").click();
      const dialog = page.getByTestId("catalog-navigator-dialog");
      await dialog.getByRole("button", { name: /炸物.*7/ }).first().click();
      await expect(dialog.getByRole("button", { name: /未分組商品/ })).toHaveCount(0);
      await page.keyboard.press("Escape");
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`catalog-${width}.png`) });
  }
});

test("a real ungrouped product is editable and leaves the system bucket after assignment", async ({ page }) => {
  test.setTimeout(120_000);
  const { category, group, product } = await prisma.$transaction(async (tx) => {
    const category = await tx.productCategory.create({ data: { organizationId, name: "QA 分組分類" } });
    const group = await tx.productGroup.create({ data: { organizationId, categoryId: category.id, name: "QA 歸組目的" } });
    const product = await tx.product.create({ data: { organizationId, categoryId: category.id, name: "QA 未分組品項", description: "local QA fixture", defaultPrice: 50 } });
    return { category, group, product };
  });
  try {
    await establishLocalTestSession(page, prisma, ownerId);
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoLocalPath(page, "/merchant/catalog");
    const nav = page.getByRole("navigation", { name: "分類與群組", exact: true });
    await nav.getByRole("button", { name: "篩選未分組商品 QA 分組分類", exact: true }).click();
    await expect(page.getByText("系統清單：這些商品尚未指定群組。請編輯商品的「群組」欄位完成歸組。", { exact: true })).toBeVisible();
    await page.getByTestId("catalog-management-row").filter({ hasText: product.name }).getByRole("button", { name: "編輯", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "編輯商品", exact: true });
    await editor.getByRole("combobox", { name: "群組", exact: true }).selectOption(group.id);
    const saved = page.waitForResponse(response => response.url().endsWith("/catalog") && response.request().method() === "POST");
    await editor.getByRole("button", { name: "儲存", exact: true }).click();
    expect((await saved).status()).toBe(200);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).groupId).toBe(group.id);
    await page.reload();
    await expect(nav.getByRole("button", { name: "篩選未分組商品 QA 分組分類", exact: true })).toHaveCount(0);
    await nav.getByRole("button", { name: "篩選群組 QA 歸組目的", exact: true }).click();
    await expect(page.getByTestId("catalog-management-row")).toHaveCount(1);
  } finally {
    await prisma.product.delete({ where: { id: product.id } });
    await prisma.productGroup.delete({ where: { id: group.id } });
    await prisma.productCategory.delete({ where: { id: category.id } });
  }
});

test("note groups have a tablet sidebar, distinct option rows and a usable phone hierarchy", async ({ page }) => {
  test.setTimeout(120_000);
  await establishLocalTestSession(page, prisma, ownerId);
  await gotoLocalPath(page, "/merchant/catalog");
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByTestId("open-note-group-navigator").click();
    const dialog = page.getByTestId("note-group-navigator-dialog");
    await dialog.getByPlaceholder("搜尋註記群組或選項").fill("QA-no-match-unique");
    await expect(dialog.getByText("找不到符合的註記群組。", { exact: true }).filter({ visible: true })).toBeVisible();
    await dialog.getByPlaceholder("搜尋註記群組或選項").fill("去冰");
    if (width >= 768) {
      const nav = dialog.getByRole("navigation", { name: "註記群組", exact: true });
      await expect(nav.getByRole("button", { name: "冰量", exact: true })).toBeVisible();
      await expect(nav.getByRole("button", { name: "辣度", exact: true })).toHaveCount(0);
      await nav.getByRole("button", { name: "冰量", exact: true }).click();
    } else {
      await dialog.getByRole("button", { name: /冰量.*個註記選項/ }).click();
    }
    const option = dialog.getByTestId("note-option-action-trigger").filter({ hasText: "去冰", visible: true });
    await expect(option).toBeVisible();
    expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`notes-${width}.png`) });
    await option.click();
    await expect(page.getByTestId("product-note-action-dialog")).toBeVisible();
    await page.keyboard.press("Escape");
  }
});

test("a group-only note edits through the board and retains its price and group after reload", async ({ page }) => {
  test.setTimeout(120_000);
  const group = await prisma.productNoteGroup.create({ data: { organizationId, name: "QA 群組專用註記的較長名稱呈現測試", options: { create: { organizationId, name: "QA 原始註記", priceDelta: 0 } } }, include: { options: true } });
  try {
    await establishLocalTestSession(page, prisma, ownerId);
    await page.setViewportSize({ width: 768, height: 900 });
    await gotoLocalPath(page, "/merchant/catalog");
    const dialog = page.getByTestId("product-note-inline-board");
    await dialog.getByRole("navigation", { name: "註記群組", exact: true }).getByRole("button", { name: group.name, exact: true }).click();
    await dialog.getByTestId("note-option-action-trigger").filter({ hasText: "QA 原始註記", visible: true }).click();
    await page.getByTestId("product-note-action-dialog").getByRole("button", { name: "編輯", exact: true }).click();
    await page.getByRole("textbox", { name: "註記名稱", exact: true }).fill("QA 修改後註記");
    await page.getByRole("spinbutton", { name: "價格調整", exact: true }).fill("7");
    const saved = page.waitForResponse(response => response.url().endsWith("/product-notes") && response.request().method() === "POST");
    await page.getByRole("button", { name: "儲存", exact: true }).click();
    expect((await saved).status()).toBe(200);
    const option = await prisma.productNoteOption.findUniqueOrThrow({ where: { id: group.options[0].id } });
    expect({ name: option.name, price: option.priceDelta, group: option.noteGroupId }).toEqual({ name: "QA 修改後註記", price: 7, group: group.id });
    await page.reload();
    await expect.poll(() => dialog.getByPlaceholder("搜尋註記群組或選項").evaluate((element) =>
      Object.keys(element).some(key => key.startsWith("__reactProps$")),
    )).toBe(true);
    await dialog.getByPlaceholder("搜尋註記群組或選項").fill("QA 修改後註記");
    await expect(dialog.getByTestId("note-option-action-trigger").filter({ visible: true })).toContainText("$7");
  } finally { await prisma.productNoteGroup.delete({ where: { id: group.id } }); }
});
