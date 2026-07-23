import { expect, test } from "@playwright/test";

const onboardingRoutes = [
  ["/onboarding", "/auth/google?next=%2Fonboarding"],
  ["/onboarding/edit", "/auth/google?next=%2Fonboarding%2Fedit"],
  ["/onboarding/status", "/auth/google?next=%2Fonboarding%2Fstatus"],
] as const;

test("登入頁的申請開通會啟動 Google 驗證流程", async ({ page }) => {
  let authorizeUrl: URL | undefined;
  await page.route(/^http:\/\/127\.0\.0\.1:55431\/auth\/v1\/authorize/, async (route) => {
    authorizeUrl = new URL(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: "<!doctype html><title>OAuth authorization reached</title>",
    });
  });
  await page.goto("/login");

  const applicationLink = page.getByRole("link", { name: "使用 Google 申請開通" });
  await expect(applicationLink).toHaveAttribute("href", "/auth/google?next=%2Fonboarding");

  await applicationLink.click();
  await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:55431\/auth\/v1\/authorize/);
  expect(authorizeUrl?.searchParams.get("provider")).toBe("google");

  const redirectTo = authorizeUrl?.searchParams.get("redirect_to");
  expect(redirectTo).toBeTruthy();
  const callbackUrl = new URL(redirectTo!);
  expect(callbackUrl.pathname).toBe("/auth/callback");
  expect(callbackUrl.searchParams.get("next")).toBe("/onboarding");
});

test("未登入直接進入申請相關頁面時不會循環導回登入頁", async ({ request }) => {
  for (const [route, expectedLocation] of onboardingRoutes) {
    const response = await request.get(route, { maxRedirects: 0 });
    expect(response.status(), route).toBe(307);

    const location = response.headers().location;
    expect(location, route).toBeTruthy();
    const redirectUrl = new URL(location, "http://localhost:3001");
    expect(`${redirectUrl.pathname}${redirectUrl.search}`, route).toBe(expectedLocation);
  }
});
