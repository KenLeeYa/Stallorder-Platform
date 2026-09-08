import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { establishLocalTestSession, gotoLocalPath } from "./local-navigation";
import { prepareCatalogNavigationFixture } from "./catalog-navigation-fixture";

const prisma = new PrismaClient();
let restoreNavigation: (() => Promise<void>) | undefined;
test.use({ serviceWorkers: "block" });
test.afterAll(async () => { try { await restoreNavigation?.(); } finally { await prisma.$disconnect(); } });
test("product panes share the bottom edge and notes are directly usable on tablet and desktop", async ({ page }) => {
  test.setTimeout(120_000);
  const db = new URL(process.env.DATABASE_URL ?? "");
  if (!["127.0.0.1", "localhost"].includes(db.hostname) || db.port !== (process.env.CI ? "54322" : "55722")) throw new Error("DEDICATED_LOCAL_LAB_REQUIRED");
  const owner = await prisma.profile.findUniqueOrThrow({ where: { email: "owner@stallorder.test" } });
  restoreNavigation = await prepareCatalogNavigationFixture(prisma);
  await establishLocalTestSession(page, prisma, owner.id);
  await gotoLocalPath(page, "/merchant/catalog?organizationId=11111111-1111-4111-8111-111111111111");
  for (const width of [768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const nav = page.getByRole("navigation", { name: "分類與群組", exact: true });
    const grid = nav.locator("..");
    const left = (await nav.boundingBox())!, whole = (await grid.boundingBox())!;
    expect(Math.abs(left.y + left.height - whole.y - whole.height)).toBeLessThanOrEqual(2);
    const inline = page.getByTestId("product-note-inline-board");
    await expect(inline).toBeVisible();
    await inline.getByRole("button", { name: "冰量", exact: true }).click();
    await expect(inline.getByTestId("note-option-action-trigger").filter({ hasText: "去冰" })).toBeVisible();
    await expect(page.getByTestId("note-group-navigator-dialog")).toHaveCount(0);
    const noteNav = inline.getByRole("navigation", { name: "註記群組", exact: true });
    await noteNav.evaluate(el => { el.scrollTop = el.scrollHeight; });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`inline-notes-${width}.png`) });
  }
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByTestId("product-note-inline-board")).not.toBeVisible();
    await page.getByTestId("open-note-group-navigator").click();
    await expect(page.getByTestId("note-group-navigator-dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
});
