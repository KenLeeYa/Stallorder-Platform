import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { expect, type Browser } from "@playwright/test";
import { hash } from "bcryptjs";
import { applicationReadResultSchema, applicationDetailResultSchema } from "@stallorder/contracts/operations/v1";
import { assertIsolatedStorageQa } from "./qa-primary-only-storage";

export async function verifyPreviewMerchantApplications(db: PrismaClient, browser: Browser, origin: string,
  headers: Record<string, string>, sourceSha: string, ref: string) {
  assert.equal(process.env.VERCEL_ENV, "preview");
  assert.equal(process.env.GITHUB_REPOSITORY, "KenLeeYa/Stallorder-Platform");
  assert.equal(process.env.APP_PREVIEW, "true");
  assertIsolatedStorageQa({ ref, parentRef: process.env.SUPABASE_PARENT_PROJECT_REF!,
    databaseUrl: process.env.DATABASE_URL!, supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL! });
  assert.match(origin, /^https:\/\/stallorder-platform-[a-z0-9]+-ada76145-8663s-projects\.vercel\.app$/);
  const version = await fetch(origin + "/api/version", { headers, redirect: "error" });
  assert.equal((await version.json()).revision, sourceSha);
  const marker = randomUUID();
  const email = "admin-" + marker + "@stallorder.invalid";
  const applicant = "applicant-" + marker + "@stallorder.invalid";
  const password = randomBytes(30).toString("base64url");
  const passwordHash = await hash(password, 10);
  const applicationId = randomUUID();
  const adminId = randomUUID();
  const applicantId = randomUUID();
  const context = await browser.newContext({ locale: "zh-TW", serviceWorkers: "block" });
  let stage = "fixtures";
  try {
    await db.$transaction(async tx => {
      await tx.profile.create({ data: { id: adminId, email, displayName: "Preview administrator", passwordHash, platformRole: "PLATFORM_ADMIN" } });
      await tx.profile.create({ data: { id: applicantId, email: applicant, displayName: "Preview applicant" } });
      await tx.merchantApplication.create({ data: { id: applicationId, applicantProfileId: applicantId,
        applicantEmail: applicant, applicantDisplayName: "Preview applicant", merchantName: marker, status: "PENDING_REVIEW" } });
    });
    // Apply protection headers only to requests targeting the deployment verified above.
    await context.route(origin + "/**", route => route.continue({ headers: { ...route.request().headers(), ...headers } }));
    const page = await context.newPage();
    const endpoint = origin + "/api/admin/merchant-applications";
    stage = "anonymous-session";
    const denied = await page.request.get(endpoint, { headers, maxRedirects: 0 });
    assert.equal(denied.status(), 401);
    stage = "admin-login";
    await page.goto(origin + "/login");
    await page.getByRole("button", { name: "使用電子郵件與密碼登入", exact: true }).click();
    await page.getByLabel("電子郵件").fill(email);
    await page.getByLabel("密碼", { exact: true }).fill(password);
    await page.getByRole("button", { name: "登入", exact: true }).click();
    await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
    stage = "list";
    await page.goto(origin + "/admin/merchant-applications?status=PENDING_REVIEW");
    await expect(page.getByText(marker, { exact: true }).filter({ visible: true }).first()).toBeVisible();
    stage = "filters";
    const status = page.locator("select").filter({ has: page.locator('option[value="PENDING_REVIEW"]') });
    await status.selectOption("APPROVED");
    await expect(page.getByText(marker, { exact: true })).toHaveCount(0);
    await status.selectOption("PENDING_REVIEW");
    await expect(page.getByText(marker, { exact: true }).filter({ visible: true }).first()).toBeVisible();
    stage = "pagination";
    const list = await page.request.get(endpoint + "?status=PENDING_REVIEW&pageSize=5", { headers, maxRedirects: 0 });
    assert.equal(list.status(), 200);
    assert.match(list.headers()["cache-control"], /no-store/);
    const result = applicationReadResultSchema.parse(await list.json());
    assert.ok(result.rows.some(row => row.id === applicationId));
    const next = await page.request.get(endpoint + "?status=PENDING_REVIEW&page=2&pageSize=5", { headers, maxRedirects: 0 });
    assert.equal(next.status(), 200);
    applicationReadResultSchema.parse(await next.json());
    stage = "detail";
    const detail = await page.request.get(endpoint + "/" + applicationId, { headers, maxRedirects: 0 });
    assert.equal(detail.status(), 200);
    applicationDetailResultSchema.parse(await detail.json());
    await page.goto(origin + "/admin/merchant-applications/" + applicationId);
    await expect(page.getByRole("heading", { name: marker })).toBeVisible();
    stage = "session-revocation";
    await db.authSession.updateMany({ where: { profileId: adminId, revokedAt: null }, data: { revokedAt: new Date() } });
    assert.equal((await page.request.get(endpoint, { headers, maxRedirects: 0 })).status(), 401);
    return { sourceSha, list: true, filters: true, pagination: true, detail: true, anonymousDenied: true, revokedDenied: true };
  } catch (error) {
    console.error("Merchant application Preview check failed at", stage);
    throw error;
  } finally {
    await context.close();
    // Both profiles and the application live solely on the owned ephemeral child.
    // The protected workflow destroys that child and checks for its absence after this step.
  }
}
