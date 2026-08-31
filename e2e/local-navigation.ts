import { errors, type Page, type Response } from "@playwright/test";

export async function gotoLocalPath(page: Page, path: string, expectedPath = path) {
  if (
    !path.startsWith("/")
    || path.startsWith("//")
    || !expectedPath.startsWith("/")
    || expectedPath.startsWith("//")
  ) {
    throw new Error(`E2E_LOCAL_NAVIGATION_PATH_INVALID: ${path}`);
  }
  const expectedUrl = new URL(
    expectedPath,
    page.url() === "about:blank"
      ? process.env.PLAYWRIGHT_APP_URL ?? "http://localhost:3001"
      : page.url(),
  );

  try {
    const response = await page.goto(path);
    assertSuccessfulResponse(path, response);
    assertExpectedRoute(page, expectedUrl);
    return response;
  } catch (error) {
    if (
      process.env.PLAYWRIGHT_PRODUCTION_SERVER === "true"
      || !(error instanceof Error)
      || !error.message.includes("page.goto: net::ERR_ABORTED")
    ) throw error;

    try {
      await page.waitForURL((url) => matchesExpectedRoute(url, expectedUrl), {
        timeout: 5_000,
        waitUntil: "domcontentloaded",
      });
      assertExpectedRoute(page, expectedUrl);
      return null;
    } catch (waitError) {
      if (!(waitError instanceof errors.TimeoutError)) throw waitError;
    }

    const response = await page.goto(path);
    assertSuccessfulResponse(path, response);
    assertExpectedRoute(page, expectedUrl);
    return response;
  }
}

export async function dismissStaffStartReminder(page: Page) {
  const backdrop = page.getByTestId("staff-start-reminder-backdrop");
  try {
    await backdrop.waitFor({ state: "visible", timeout: 10_000 });
  } catch (error) {
    if (error instanceof errors.TimeoutError) return;
    throw error;
  }
  await backdrop.getByRole("button", { name: "稍後處理", exact: true }).last().click();
  await backdrop.waitFor({ state: "detached", timeout: 5_000 });
}

export async function waitForDefaultMerchantDashboard(page: Page, organizationId: string) {
  await page.waitForURL((url) => (
    url.pathname === "/merchant/dashboard"
    && url.searchParams.get("organizationId") === organizationId
    && url.searchParams.get("dateFrom") === url.searchParams.get("dateTo")
    && url.searchParams.get("dashboardPreset") === "TODAY"
    && url.searchParams.get("dashboardSort") === "sales"
    && url.searchParams.getAll("stallId").length > 0
  ), { timeout: 30_000 });
}

function assertSuccessfulResponse(path: string, response: Response | null) {
  if (response && response.status() >= 400) {
    throw new Error(`E2E_LOCAL_NAVIGATION_HTTP_${response.status()}: ${path}`);
  }
}

function assertExpectedRoute(page: Page, expectedUrl: URL) {
  const actualUrl = new URL(page.url());
  if (!matchesExpectedRoute(actualUrl, expectedUrl)) {
    throw new Error(
      `E2E_LOCAL_NAVIGATION_REDIRECTED: expected ${expectedUrl.pathname}${expectedUrl.search}, received ${actualUrl.pathname}${actualUrl.search}`,
    );
  }
}

function matchesExpectedRoute(actualUrl: URL, expectedUrl: URL) {
  if (actualUrl.origin !== expectedUrl.origin || actualUrl.pathname !== expectedUrl.pathname) return false;
  const remainingValues = new Map<string, string[]>();
  for (const [key, value] of actualUrl.searchParams) {
    const values = remainingValues.get(key) ?? [];
    values.push(value);
    remainingValues.set(key, values);
  }
  for (const [key, value] of expectedUrl.searchParams) {
    const values = remainingValues.get(key);
    const index = values?.indexOf(value) ?? -1;
    if (index < 0 || !values) return false;
    values.splice(index, 1);
  }
  return true;
}
