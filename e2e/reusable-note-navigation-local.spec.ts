import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { loginLocalTestAccount, openSharedCatalogManagement } from "./local-navigation";
import { prepareCatalogNavigationFixture } from "./catalog-navigation-fixture";

const prisma = new PrismaClient();
let actorId = "", actorEmail = "";
let restoreNavigation: (() => Promise<void>) | undefined;
const catalogPath = "/merchant/catalog?organizationId=11111111-1111-4111-8111-111111111111";

test.beforeAll(async () => {
  const db = new URL(process.env.DATABASE_URL ?? "");
  if (!["127.0.0.1", "localhost"].includes(db.hostname) || db.port !== (process.env.CI ? "54322" : "55722")) throw new Error("DEDICATED_LOCAL_LAB_REQUIRED");
  restoreNavigation = await prepareCatalogNavigationFixture(prisma);
});
test.afterAll(async () => { try { await restoreNavigation?.(); } finally { await prisma.$disconnect(); } });

test.beforeEach(async () => {
  const owner = await prisma.profile.findUniqueOrThrow({ where: { email: "owner@stallorder.test" } });
  const membership = await prisma.organizationMembership.findFirstOrThrow({
    where: { organizationId: "11111111-1111-4111-8111-111111111111", profileId: owner.id, role: "ORGANIZATION_OWNER", isActive: true },
  });
  if (!owner.isActive || !owner.passwordHash || !membership.allStalls) throw new Error("NAVIGATION_SEED_OWNER_REQUIRED");
  actorEmail = `note-navigation-${randomUUID()}@stallorder.test`;
  actorId = (await prisma.profile.create({ data: {
    email: actorEmail, displayName: "註記導覽隔離測試", passwordHash: owner.passwordHash,
    emailVerified: owner.emailVerified, authMigrationRequired: owner.authMigrationRequired,
    organizationMemberships: { create: { organizationId: membership.organizationId, role: "ORGANIZATION_OWNER", allStalls: true, isPrimaryOwner: false } },
  } })).id;
});

test.afterEach(async () => {
  if (!actorId) return;
  try {
    await prisma.authSession.updateMany({ where: { profileId: actorId, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: "E2E_FIXTURE_CLEANUP" } });
    expect((await prisma.organizationMembership.updateMany({ where: { profileId: actorId, isPrimaryOwner: false, role: "ORGANIZATION_OWNER", organizationId: "11111111-1111-4111-8111-111111111111" }, data: { isActive: false } })).count).toBe(1);
    expect((await prisma.profile.updateMany({ where: { id: actorId, email: actorEmail }, data: { isActive: false, sessionVersion: { increment: 1 } } })).count).toBe(1);
  } finally { actorId = ""; actorEmail = ""; }
});

for (const width of [1440, 768, 390, 320]) {
  test(`單一註記保留清單、搜尋及子視窗返回位置 ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await loginLocalTestAccount(page, actorEmail, "StallOrderDemo!2026", catalogPath);
    await openSharedCatalogManagement(page);
    const navigatorEntry = page.getByTestId("open-reusable-note-navigator").filter({ visible: true });
    await expect(navigatorEntry).toBeEnabled();
    await navigatorEntry.click();
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
