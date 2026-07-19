import { expect, test } from "@playwright/test";

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
  let releaseSession: (() => void) | undefined;
  const sessionGate = new Promise<void>((resolve) => {
    releaseSession = resolve;
  });
  await page.route("**/api/public-order/create-order-session", async (route) => {
    await sessionGate;
    await route.continue();
  });

  await page.goto("/q/demo-aming-chicken-qr-2026-rotate-me", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "阿明鹽酥雞", exact: true })).toBeVisible();
  await expect(page.getByRole("article").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "送出訂單", exact: true })).toBeDisabled();

  releaseSession?.();
  await expect(page.getByText(/點餐時間剩餘/)).toBeVisible({ timeout: 15_000 });
});
