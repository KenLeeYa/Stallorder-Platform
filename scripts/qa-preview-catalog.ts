import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { expect, type Browser } from "@playwright/test";
import { hash } from "bcryptjs";
import { assertIsolatedStorageQa } from "./qa-primary-only-storage";
import { catalogDesktopEditButton, catalogMobileEditButton } from "./lib/catalog-preview-locators.cjs";

export async function verifyPreviewCatalog(db: PrismaClient, browser: Browser, origin: string,
  headers: Record<string, string>, sourceSha: string, ref: string) {
  assert.equal(process.env.GITHUB_REPOSITORY, "KenLeeYa/Stallorder-Platform");
  assert.equal(process.env.APP_PREVIEW, "true");
  assert.equal(process.env.VERCEL_ENV, "preview");
  assertIsolatedStorageQa({ ref, parentRef: process.env.SUPABASE_PARENT_PROJECT_REF!,
    databaseUrl: process.env.DATABASE_URL!, supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL! });
  assert.match(origin, /^https:\/\/stallorder-platform-[a-z0-9]+-ada76145-8663s-projects\.vercel\.app$/);
  const version = await fetch(origin + "/api/version", { headers, redirect: "error" });
  assert.ok(version.ok && (await version.json()).revision === sourceSha);
  const organizationId = "11111111-1111-4111-8111-111111111111";
  const marker = "preview-" + randomUUID().slice(0, 12);
  const email = marker + "@stallorder.invalid";
  const password = randomBytes(32).toString("base64url");
  const passwordHash = await hash(password, 10);
  const products = Array.from({ length: 6 }, (_, i) => ({
    id: randomUUID(), name: marker + "-" + i, description: "Preview catalog fixture", defaultPrice: 60, sortOrder: i,
  }));
  const context = await browser.newContext({ locale: "zh-TW", serviceWorkers: "block" });
  let stage = "seed-fixtures";
  let viewport = 0;
  try {
    await db.$transaction(async tx => {
      await tx.profile.create({ data: { email, displayName: marker, passwordHash,
        organizationMemberships: { create: { organizationId, role: "ORGANIZATION_OWNER" } } } });
      const category = await tx.productCategory.create({ data: { organizationId, name: marker } });
      await tx.product.createMany({ data: products.map(product => ({ ...product, organizationId, categoryId: category.id })) });
    });
    await context.route(origin + "/**", route => route.continue({ headers: { ...route.request().headers(), ...headers } }));
    const page = await context.newPage();
    stage = "login";
    const destination = "/merchant/catalog?organizationId=" + organizationId;
    await page.goto(origin + "/login?next=" + encodeURIComponent(destination));
    await page.getByRole("button", { name: "使用電子郵件與密碼登入", exact: true }).click();
    await page.getByLabel("電子郵件").fill(email);
    await page.getByLabel("密碼", { exact: true }).fill(password);
    const [login] = await Promise.all([
      page.waitForResponse(response => response.url() === origin + "/api/auth/login"
        && response.request().method() === "POST", { timeout: 45_000 }),
      page.getByRole("button", { name: "登入", exact: true }).click(),
    ]);
    assert.equal(login.status(), 200);
    stage = "authenticated-redirect";
    await page.waitForURL(url => url.origin === origin && url.pathname === "/merchant/catalog", { timeout: 45_000 });
    const product = products[5];
    const savedName = product.name + "-saved";
    const commandUrl = origin + "/api/merchant/organizations/" + organizationId + "/catalog";
    const widths = [320, 390, 768, 1440];
    for (const width of widths) {
      viewport = width;
      stage = "catalog-page";
      await page.setViewportSize({ width, height: 900 });
      await page.goto(origin + "/merchant/catalog?organizationId=" + organizationId);
      const search = page.getByRole("searchbox", { name: "搜尋商品", exact: true });
      stage = "search";
      await search.fill(marker);
      await expect(page).toHaveURL(new RegExp("q=" + marker));
      await expect(page.getByText("共 6 項商品", { exact: true })).toBeVisible();
      stage = "pagination";
      await page.getByRole("combobox", { name: "每頁商品數" }).selectOption("5");
      await expect(page.getByText("1 / 2", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "下一頁", exact: true }).click();
      const edit = width >= 1024 ? catalogDesktopEditButton(page, product.name) : catalogMobileEditButton(page, product.name);
      stage = "edit-control";
      await expect(edit).toBeVisible();
      const listUrl = page.url();
      stage = "open-editor";
      await edit.click();
      const dialog = page.getByRole("dialog", { name: "編輯商品", exact: true });
      await expect(dialog).toBeVisible();
      stage = "cancel";
      await dialog.getByRole("button", { name: "關閉", exact: true }).click();
      await expect(dialog).toBeHidden();
      await expect(search).toHaveValue(marker);
      expect(page.url()).toBe(listUrl);
      if (width === 390) {
        await edit.click();
        stage = "failed-save";
        await dialog.getByLabel("商品名稱", { exact: true }).fill(product.name + "-offline");
        await page.route(commandUrl, route => route.request().method() === "POST"
          ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "隔離測試：儲存失敗" }) })
          : route.fallback());
        try {
          await dialog.getByRole("button", { name: "儲存", exact: true }).click();
          await expect(dialog.getByRole("alert")).toContainText("隔離測試：儲存失敗");
          const row = await db.product.findUniqueOrThrow({ where: { id: product.id }, select: { name: true } });
          assert.equal(row.name, product.name);
          await dialog.getByRole("button", { name: "關閉", exact: true }).click();
        } finally { await page.unroute(commandUrl); }
      }
      if (width === 1440) {
        await edit.click();
        stage = "persist-save";
        await dialog.getByLabel("商品名稱", { exact: true }).fill(savedName);
        await dialog.getByRole("button", { name: "儲存", exact: true }).click();
        await expect(dialog).toBeHidden();
        await expect(catalogDesktopEditButton(page, savedName)).toBeVisible();
        const row = await db.product.findUniqueOrThrow({ where: { id: product.id }, select: { name: true } });
        assert.equal(row.name, savedName);
      }
      expect(page.url()).toBe(listUrl);
    }
    return { sourceSha, widths, search: true, pagination: true, cancel: true, save: true, failedSaveRetained: true };
  } catch (error) {
    console.error("PREVIEW_CATALOG_CHECK_FAILED", { stage, viewport });
    throw error;
  } finally {
    await context.close();
  }
}
