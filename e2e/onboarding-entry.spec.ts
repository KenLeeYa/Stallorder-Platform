import { expect, test } from "@playwright/test";

const onboardingRoutes = [
  ["/onboarding", "/login?next=%2Fonboarding"],
  ["/onboarding/edit", "/login?next=%2Fonboarding%2Fedit"],
  ["/onboarding/status", "/login?next=%2Fonboarding%2Fstatus"],
] as const;

test("登入頁的申請開通會使用目前啟用的驗證帳號流程", async ({ page }) => {
  await page.goto("/login");

  const applicationLink = page.getByRole("link", { name: "使用已驗證帳號申請開通" });
  await expect(applicationLink).toHaveAttribute("href", "/auth/google?next=%2Fonboarding");

  const response = await page.request.get("/auth/google?next=%2Fonboarding", {
    maxRedirects: 0,
  });
  expect(response.status()).toBe(307);
  const location = response.headers().location;
  expect(location).toBeTruthy();
  const authorizeUrl = new URL(location!);
  const oauthMockPort = String(Number(process.env.PLAYWRIGHT_OAUTH_MOCK_PORT ?? "55431"));
  expect(authorizeUrl.origin).toBe(`http://127.0.0.1:${oauthMockPort}`);
  expect(authorizeUrl.pathname).toBe("/auth/v1/authorize");
  expect(authorizeUrl.searchParams.get("provider")).toBe("google");
  expect(authorizeUrl.searchParams.get("prompt")).toBe("select_account");

  const redirectTo = authorizeUrl.searchParams.get("redirect_to");
  expect(redirectTo).toBeTruthy();
  const callbackUrl = new URL(redirectTo!);
  expect(callbackUrl.pathname).toBe("/auth/callback");
  expect(callbackUrl.searchParams.get("next")).toBe("/onboarding");
});

test("未登入直接進入申請相關頁面時會回到統一登入入口", async ({ request }) => {
  for (const [route, expectedLocation] of onboardingRoutes) {
    const response = await request.get(route, { maxRedirects: 0 });
    expect(response.status(), route).toBe(307);

    const location = response.headers().location;
    expect(location, route).toBeTruthy();
    const redirectUrl = new URL(location, "http://localhost:3001");
    expect(`${redirectUrl.pathname}${redirectUrl.search}`, route).toBe(expectedLocation);
  }
});
