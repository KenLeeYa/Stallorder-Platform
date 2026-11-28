import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { expect, type Browser } from "@playwright/test";
import { hash } from "bcryptjs";
import { assertIsolatedStorageQa } from "./qa-primary-only-storage";

export async function verifyPreviewWebPrntClaim(db: PrismaClient, browser: Browser, origin: string,
  headers: Record<string, string>, sourceSha: string, ref: string, orderId: string) {
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
  const stallId = "22222222-2222-4222-8222-222222222222";
  const profileId = randomUUID(), printerId = randomUUID(), ruleId = randomUUID();
  const stall = await db.stall.findUniqueOrThrow({ where: { id: stallId, organizationId }, select: { slug: true } });
  assert.equal(await db.order.count({ where: { id: orderId, organizationId, stallId, isTest: true } }), 1);
  const settings = await db.stallOrderingSettings.findUniqueOrThrow({ where: { stallId }, select: { printModuleEnabled: true } });
  const context = await browser.newContext({ locale: "zh-TW", serviceWorkers: "block" });
  const times: Record<string, number[]> = { snapshot: [], direct: [] };
  let stage = "setup";
  try {
    await db.$transaction(async tx => {
      await tx.profile.create({ data: { id: profileId, displayName: marker, email, passwordHash,
        organizationMemberships: { create: { organizationId, role: "ORGANIZATION_OWNER" } },
        stallMemberships: { create: { organizationId, stallId, role: "MERCHANT_OWNER" } } } });
      await tx.printer.create({ data: { id: printerId, organizationId, stallId, name: marker, connectionType: "WEBPRNT_BLUETOOTH" } });
      await tx.printRule.create({ data: { id: ruleId, organizationId, stallId, printerId, name: marker, autoPrint: true } });
      if (!settings.printModuleEnabled) await tx.stallOrderingSettings.update({ where: { stallId }, data: { printModuleEnabled: true } });
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
    const endpoint = "/api/stalls/" + encodeURIComponent(stall.slug) + "/print-jobs";
    // Alternate the two supported request paths against the same isolated database and login.
    for (const mode of ["snapshot", "direct", "direct", "snapshot", "snapshot", "direct"]) {
      stage = mode;
      const jobId = randomUUID();
      const payload = { kind: "KITCHEN_58MM_STARPRNT", version: "kitchen-58mm-starprnt-v1",
        mediaType: "application/vnd.star.starprnt", content: "PREVIEW", dataBase64: "G0BA" };
      await db.printJob.create({ data: { id: jobId, organizationId, stallId, orderId, printerId, printRuleId: ruleId, payload } });
      const elapsed = await page.evaluate(async ({ mode, endpoint, jobId, printerId }) => {
        const csrf = document.cookie.split("; ").find(v => v.startsWith("stallorder_csrf="))?.split("=")[1];
        if (!csrf) throw new Error("PREVIEW_WEBPRNT_CSRF_MISSING");
        const command = async (body: Record<string, string>, responseMode: string) => {
          const response = await fetch(endpoint, { method: "POST", redirect: "error",
            headers: { "Content-Type": "application/json", "x-csrf-token": decodeURIComponent(csrf), "x-print-response": responseMode },
            body: JSON.stringify(body) });
          if (!response.ok) throw new Error("PREVIEW_WEBPRNT_" + body.operation + "_" + response.status);
          return response.json();
        };
        const start = performance.now();
        if (mode === "snapshot") {
          const snapshot = await command({ operation: "REFRESH" }, "");
          if (!snapshot.state.jobs.some((job: { id: string }) => job.id === jobId)) throw new Error("PREVIEW_TICKET_NOT_LISTED");
        }
        const ticket = await command(mode === "direct" ? { operation: "CLAIM_NEXT", printerId } : { operation: "CLAIM", printerId, jobId }, "ticket");
        const duration = Math.round(performance.now() - start);
        if (ticket.entityId !== jobId || ticket.printPayload?.dataBase64 !== "G0BA") throw new Error("PREVIEW_TICKET_MISMATCH");
        await command({ operation: "SUCCESS", jobId }, "ack");
        return duration;
      }, { mode, endpoint, jobId, printerId });
      const job = await db.printJob.findUniqueOrThrow({ where: { id: jobId }, select: { status: true, attemptCount: true, copies: true } });
      assert.deepEqual(job, { status: "SUCCEEDED", attemptCount: 1, copies: 1 });
      times[mode].push(elapsed);
      await db.printJob.delete({ where: { id: jobId } });
    }
    const median = (values: number[]) => [...values].sort((a, b) => a - b)[1];
    const report = { snapshotMs: times.snapshot, directMs: times.direct,
      snapshotMedianMs: median(times.snapshot), directMedianMs: median(times.direct), nativePaperMeasured: false };
    console.log("PREVIEW_WEBPRNT_TIMING", JSON.stringify(report));
    assert.ok(report.directMedianMs < report.snapshotMedianMs, "PREVIEW_WEBPRNT_NO_MEASURED_GAIN");
    return report;
  } catch (error) {
    console.error("PREVIEW_WEBPRNT_CHECK_FAILED", { stage });
    throw error;
  } finally {
    await context.close();
    await db.$transaction(async tx => {
      await tx.printJob.deleteMany({ where: { printerId, printRuleId: ruleId, orderId, stallId, organizationId } });
      await tx.printRule.deleteMany({ where: { id: ruleId, printerId, stallId, organizationId } });
      await tx.printer.deleteMany({ where: { id: printerId, stallId, organizationId } });
      if (!settings.printModuleEnabled) await tx.stallOrderingSettings.update({ where: { stallId }, data: { printModuleEnabled: false } });
    });
  }
}
