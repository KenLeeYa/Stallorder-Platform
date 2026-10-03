import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { openSharedCatalogManagement } from "./local-navigation";

const organizationId = "11111111-1111-4111-8111-111111111111";
const stallId = "22222222-2222-4222-8222-222222222222";

test("供應設定失敗保留日期、解除忙碌並拒絕重複提交", async ({ page }, testInfo) => {
  const app = new URL(testInfo.project.use.baseURL ?? "");
  const database = new URL(process.env.DATABASE_URL ?? "");
  for (const target of [app, database]) {
    if (!["localhost", "127.0.0.1"].includes(target.hostname)
      || !/^\d+$/.test(target.port) || Number(target.port) < 1024 || Number(target.port) > 65535) {
      throw new Error("LOCAL_QA_ONLY");
    }
  }
  if (app.protocol !== "http:" || !["postgres:", "postgresql:"].includes(database.protocol)
    || database.pathname !== "/postgres") throw new Error("LOCAL_QA_ONLY");
  const prisma = new PrismaClient();
  const email = `availability-recovery-${randomUUID()}@stallorder.test`;
  let profileId = "";
  try {
    const owner = await prisma.profile.findUniqueOrThrow({ where: { email: "owner@stallorder.test" } });
    const membership = await prisma.organizationMembership.findFirstOrThrow({
      where: { organizationId, profileId: owner.id, role: "ORGANIZATION_OWNER", isActive: true },
    });
    if (!owner.isActive || !owner.passwordHash || !membership.allStalls) throw new Error("SEED_OWNER_REQUIRED");
    const profile = await prisma.profile.create({ data: {
      email, displayName: "供應錯誤恢復測試", passwordHash: owner.passwordHash,
      authMigrationRequired: owner.authMigrationRequired, emailVerified: owner.emailVerified,
      organizationMemberships: { create: { organizationId, role: "ORGANIZATION_OWNER", allStalls: true, isPrimaryOwner: false } },
    } });
    profileId = profile.id;
    const product = await prisma.product.findFirstOrThrow({
      where: { organizationId, name: "香酥雞排", isActive: true, stallProducts: { some: { stallId } } },
      select: { id: true, name: true },
    });
    const before = await prisma.stallProduct.findUniqueOrThrow({ where: { stallId_productId: { stallId, productId: product.id } } });
    const destination = `/merchant/catalog?organizationId=${organizationId}`;
    await page.goto(`/login?next=${encodeURIComponent(destination)}`);
    await page.getByRole("button", { name: "使用電子郵件與密碼登入", exact: true }).click();
    await page.getByLabel("電子郵件").fill(email);
    await page.getByLabel("密碼").fill("StallOrderDemo!2026");
    await page.getByRole("button", { name: "登入", exact: true }).click();
    await expect(page).toHaveURL(new URL(destination, app.origin).href);
    await openSharedCatalogManagement(page);
    const board = page.getByRole("region", { name: "商品批次管理", exact: true });
    await board.getByRole("combobox", { name: "管理攤位" }).selectOption(stallId);
    await board.getByRole("searchbox", { name: "搜尋管理商品" }).fill(product.name);
    await board.getByRole("checkbox", { name: `選取 ${product.name}`, exact: true }).check();
    await board.getByRole("button", { name: "批次供應設定", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "設定供應狀態", exact: true });
    await dialog.getByRole("button", { name: /^指定日期恢復/ }).click();
    const resumeDate = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    await dialog.getByLabel("恢復供應日期").fill(resumeDate);
    const endpoint = `${app.origin}/api/merchant/stalls/${stallId}/products`;
    for (const status of [429, 500, 0]) {
      let count = 0;
      let release!: () => void;
      const held = new Promise<void>((resolve) => { release = resolve; });
      await page.route(endpoint, async (route) => {
        expect(route.request().method()).toBe("PATCH");
        expect(route.request().postDataJSON()).toEqual({ operation: "BULK_AVAILABILITY", productIds: [product.id], mode: "UNTIL_DATE", resumeDate });
        count++;
        await held;
        if (status === 0) await route.abort("connectionfailed");
        else await route.fulfill({ status, contentType: "application/json", body: JSON.stringify({ error: `供應測試 ${status}` }) });
      });
      try {
        const submit = dialog.getByRole("button", { name: "確認指定日期恢復", exact: true });
        await submit.evaluate((element) => { (element as HTMLButtonElement).click(); (element as HTMLButtonElement).click(); });
        await expect.poll(() => count).toBe(1);
        await expect(dialog.getByRole("button", { name: "儲存中...", exact: true })).toBeDisabled();
        await expect(dialog.getByLabel("恢復供應日期")).toBeDisabled();
        await page.keyboard.press("Escape");
        await expect(dialog).toBeVisible();
        release();
        await expect(dialog.getByRole("alert")).toBeVisible();
        if (status !== 0) await expect(dialog.getByRole("alert")).toHaveText(`供應測試 ${status}`);
        await expect(submit).toBeEnabled();
        await expect(dialog.getByLabel("恢復供應日期")).toBeEnabled();
        await expect(dialog.getByLabel("恢復供應日期")).toHaveValue(resumeDate);
        expect(count).toBe(1);
      } finally { release(); await page.unroute(endpoint); }
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    expect(await prisma.stallProduct.findUniqueOrThrow({ where: { stallId_productId: { stallId, productId: product.id } } })).toEqual(before);
  } finally {
    try {
      if (profileId) {
        await prisma.authSession.updateMany({ where: { profileId, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: "E2E_FIXTURE_CLEANUP" } });
        expect((await prisma.organizationMembership.updateMany({ where: { profileId, organizationId, isPrimaryOwner: false, role: "ORGANIZATION_OWNER" }, data: { isActive: false } })).count).toBe(1);
        expect((await prisma.profile.updateMany({ where: { id: profileId, email }, data: { isActive: false, sessionVersion: { increment: 1 } } })).count).toBe(1);
      }
    } finally { await prisma.$disconnect(); }
  }
});
