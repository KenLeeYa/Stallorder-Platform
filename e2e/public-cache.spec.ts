import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

test("QR search waits for hydration before accepting input", async ({ page }) => {
  let releaseScripts!: () => void;
  const scriptsReady = new Promise<void>((resolve) => { releaseScripts = resolve; });
  await page.route(/\/_next\/static\/.*\.js(?:\?|$)/, async (route) => {
    await scriptsReady;
    await route.continue();
  });

  try {
    await page.goto("/q/demo-aming-chicken-qr-2026-rotate-me", { waitUntil: "commit" });
    const search = page.getByRole("searchbox", { name: "搜尋餐點或分類", exact: true });
    await expect(search).toBeVisible();
    await expect(search).toBeDisabled();
    releaseScripts();
    await expect(search).toBeEnabled();
    await search.fill("no-product-xyz");
    await expect(search).toHaveValue("no-product-xyz");
    await expect(page.getByTestId("qr-category-navigation").getByRole("link")).toHaveCount(0);
  } finally {
    releaseScripts();
  }
});

test("anonymous public menu uses short shared-cache headers", async ({ request }) => {
  const response = await request.get("/api/public/stalls/aming-chicken/menu");

  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("public, max-age=0, must-revalidate");
  expect(response.headers()["vercel-cdn-cache-control"]).toBe(
    "public, s-maxage=15, stale-while-revalidate=15",
  );
  expect(response.headers()["cdn-cache-control"]).toBe(
    "public, s-maxage=10, stale-while-revalidate=10",
  );
  expect(response.headers()["set-cookie"]).toBeUndefined();
});

for (const { header, value } of [
  { header: "cookie", value: "session=present" },
  { header: "authorization", value: "Bearer present" },
]) {
  test(`public menu bypasses shared cache when ${header} is present`, async ({ request }) => {
    const response = await request.get("/api/public/stalls/aming-chicken/menu", {
      headers: { [header]: value },
    });

    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("private, no-store, max-age=0");
    expect(response.headers()["vercel-cdn-cache-control"]).toBeUndefined();
    expect(response.headers()["cdn-cache-control"]).toBeUndefined();
  });
}

test("QR menu renders cached content before the short-lived session is ready", async ({ page }) => {
  const target = new URL(process.env.DATABASE_URL ?? "");
  if (!["postgres:", "postgresql:"].includes(target.protocol)
    || !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname)
    || target.pathname !== "/postgres") throw new Error("PUBLIC_CACHE_LOCAL_DATABASE_REQUIRED");
  const db = new PrismaClient();
  const organizationId = "11111111-1111-4111-8111-111111111111";
  const stallId = "22222222-2222-4222-8222-222222222222";
  const appliedAt = new Date();
  let releaseSession: (() => void) | undefined;
  const sessionGate = new Promise<void>((resolve) => { releaseSession = resolve; });
  let hours: Awaited<ReturnType<typeof db.stallBusinessHour.findMany>> = [];
  let prepared = false;
  try {
    const stall = await db.stall.findUniqueOrThrow({ where: { id: stallId } });
    expect(stall).toMatchObject({ organizationId, slug: "aming-chicken" });
    hours = await db.stallBusinessHour.findMany({ where: { organizationId, stallId } });
    expect(hours).toHaveLength(7);
    await db.$transaction(async transaction => {
      for (const hour of hours) {
        const changed = await transaction.stallBusinessHour.updateMany({
          where: { id: hour.id, organizationId, stallId, updatedAt: hour.updatedAt },
          data: { opensAt: "00:00", closesAt: "00:00", lastOrderAt: null, isClosed: false, updatedAt: appliedAt },
        });
        expect(changed.count).toBe(1);
      }
    });
    prepared = true;
    await page.route("**/api/public-order/create-order-session", async (route) => {
      await sessionGate;
      await route.continue();
    });
    await page.goto("/q/demo-aming-chicken-qr-2026-rotate-me", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "阿明鹽酥雞", exact: true })).toBeVisible();
    await expect(page.getByRole("article").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "送出訂單", exact: true })).toBeDisabled();
    const session = page.waitForResponse(response => response.url().endsWith("/api/public-order/create-order-session")
      && response.request().method() === "POST");
    releaseSession?.();
    expect((await session).status()).toBe(201);
    await expect(page.getByText(/點餐時間剩餘/)).toBeVisible({ timeout: 15_000 });
  } finally {
    releaseSession?.();
    try {
      if (prepared) {
        const drift: string[] = [];
        for (const hour of hours) {
          try {
            const restored = await db.stallBusinessHour.updateMany({
              where: { id: hour.id, organizationId, stallId, updatedAt: appliedAt,
                opensAt: "00:00", closesAt: "00:00", lastOrderAt: null, isClosed: false },
              data: { opensAt: hour.opensAt, closesAt: hour.closesAt, lastOrderAt: hour.lastOrderAt,
                isClosed: hour.isClosed, updatedAt: hour.updatedAt },
            });
            if (restored.count !== 1) drift.push(hour.id);
          } catch { drift.push(hour.id); }
        }
        if (drift.length) throw new Error("PUBLIC_CACHE_HOURS_RESTORE_DRIFT");
      }
    } finally { await db.$disconnect(); }
  }
});
