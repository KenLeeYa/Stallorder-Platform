import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { establishLocalTestSession, gotoLocalPath } from "./local-navigation";
import { prepareCatalogNavigationFixture } from "./catalog-navigation-fixture";

const prisma = new PrismaClient();
let restoreNavigation: (() => Promise<void>) | undefined;
const catalogPath = "/merchant/catalog?organizationId=11111111-1111-4111-8111-111111111111";

test.beforeAll(async () => {
  const db = new URL(process.env.DATABASE_URL ?? "");
  if (!["127.0.0.1", "localhost"].includes(db.hostname) || db.port !== (process.env.CI ? "54322" : "55722")) throw new Error("DEDICATED_LOCAL_LAB_REQUIRED");
  restoreNavigation = await prepareCatalogNavigationFixture(prisma);
});
test.afterAll(async () => { try { await restoreNavigation?.(); } finally { await prisma.$disconnect(); } });

for (const width of [1440, 768, 390, 320]) {
  test(`單一註記保留清單、搜尋及子視窗返回位置 ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const owner = await prisma.profile.findUniqueOrThrow({ where: { email: "owner@stallorder.test" } });
    await establishLocalTestSession(page, prisma, owner.id);
    await gotoLocalPath(page, catalogPath);
    await page.waitForLoadState("networkidle");
    await page.getByTestId("open-reusable-note-navigator").filter({ visible: true }).click();
    const navigator = page.getByTestId("reusable-note-navigator-dialog");
    const search = navigator.getByPlaceholder("搜尋單一註記");
    await search.fill("不加胡椒");
    const trigger = navigator.getByRole("button", { name: "管理 不加胡椒", exact: true });
    await trigger.click();
    const actions = page.getByRole("dialog", { name: "管理 不加胡椒", exact: true });
    await expect(actions).toBeVisible();
    await expect(navigator).toBeVisible();
    await expect(search).toHaveValue("不加胡椒");
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await page.screenshot({ path: test.info().outputPath(`single-notes-actions-${width}.png`) });
    await page.keyboard.press("Escape");
    await expect(actions).toHaveCount(0);
    await expect(navigator).toBeVisible();
    await expect(trigger).toBeFocused();

    await trigger.click();
    await actions.getByRole("button", { name: "編輯", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "編輯共用單一註記", exact: true });
    await expect(editor).toBeVisible();
    await expect(navigator).toBeVisible();
    await page.keyboard.press("Tab");
    expect(await editor.evaluate(element => element.contains(document.activeElement))).toBe(true);
    await editor.getByRole("button", { name: "關閉", exact: true }).click();
    await expect(navigator).toBeVisible();
    await expect(search).toHaveValue("不加胡椒");
    await expect(trigger).toBeFocused();

    await navigator.getByRole("button", { name: "新增單一註記", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "新增共用單一註記", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(navigator).toBeVisible();
    await expect(search).toHaveValue("不加胡椒");
    await search.fill("");
    const scroller = navigator.locator(":scope > div").last();
    await scroller.evaluate(element => { element.scrollTop = element.scrollHeight; });
    const last = navigator.getByTestId("reusable-note-action-trigger").last();
    await last.scrollIntoViewIfNeeded();
    const scrollTop = await scroller.evaluate(element => element.scrollTop);
    await last.click();
    await page.getByRole("dialog").getByRole("button", { name: "關閉", exact: true }).click();
    await expect(navigator).toBeVisible();
    expect(Math.abs(await scroller.evaluate(element => element.scrollTop) - scrollTop)).toBeLessThanOrEqual(2);
    await expect(last).toBeFocused();
    await page.screenshot({ path: test.info().outputPath(`single-notes-return-${width}.png`) });
    await navigator.getByRole("button", { name: "關閉", exact: true }).click();
    await expect(navigator).toHaveCount(0);
    await expect(page.getByTestId("open-reusable-note-navigator").filter({ visible: true })).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });
}
