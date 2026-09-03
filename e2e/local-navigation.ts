import {
  errors,
  type Locator,
  type Page,
  type Response,
} from "@playwright/test";

export function qrProductSelectionControl(
  product: Locator,
  productName: string,
  increaseLabel = `增加 ${productName}`,
) {
  return product
    .getByTestId("qr-open-product-configurator")
    .or(product.getByRole("button", { name: increaseLabel, exact: true }))
    .first();
}

export async function openSharedCatalogProductActions(
  page: Page,
  productName: string,
) {
  const navigator = page.getByTestId("catalog-navigator-dialog");
  if (!(await navigator.isVisible())) {
    const openNavigator = page.getByTestId("open-catalog-navigator");
    await openNavigator.waitFor({ state: "visible" });
    await openNavigator.click();
    await navigator.waitFor({ state: "visible" });
  }
  const search = navigator.getByPlaceholder("搜尋所有商品");
  await search.fill(productName);
  const product = navigator.getByRole("button", {
    name: `操作：${productName}`,
    exact: true,
  });
  await product.waitFor({ state: "visible" });
  await product.click();
  const actions = page.getByRole("dialog", {
    name: `商品：${productName}`,
    exact: true,
  });
  await actions.waitFor({ state: "visible" });
  return actions;
}

export async function gotoLocalPath(
  page: Page,
  path: string,
  expectedPath = path,
) {
  if (
    !path.startsWith("/") ||
    path.startsWith("//") ||
    !expectedPath.startsWith("/") ||
    expectedPath.startsWith("//")
  ) {
    throw new Error(`E2E_LOCAL_NAVIGATION_PATH_INVALID: ${path}`);
  }
  const expectedUrl = new URL(
    expectedPath,
    page.url() === "about:blank"
      ? (process.env.PLAYWRIGHT_APP_URL ?? "http://localhost:3001")
      : page.url(),
  );

  try {
    const response = await page.goto(path);
    assertSuccessfulResponse(path, response);
    assertExpectedRoute(page, expectedUrl);
    return response;
  } catch (error) {
    if (
      process.env.PLAYWRIGHT_PRODUCTION_SERVER === "true" ||
      !(error instanceof Error) ||
      !error.message.includes("page.goto: net::ERR_ABORTED")
    )
      throw error;

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

export async function loginLocalTestAccount(
  page: Page,
  email: string,
  password: string,
) {
  await gotoLocalPath(page, "/login");
  const origin = new URL(page.url()).origin;
  const response = await page.context().request.post("/api/auth/login", {
    data: { email, password },
    headers: {
      origin,
      referer: page.url(),
      "sec-fetch-site": "same-origin",
    },
  });
  if (response.status() !== 200) {
    throw new Error(`E2E_LOCAL_LOGIN_HTTP_${response.status()}`);
  }
  const body = await response.json() as { next?: unknown };
  if (
    typeof body.next !== "string" ||
    !body.next.startsWith("/") ||
    body.next.startsWith("//")
  ) {
    throw new Error("E2E_LOCAL_LOGIN_DESTINATION_INVALID");
  }
  await gotoLocalPath(page, body.next);
  return body.next;
}

export async function dismissStaffStartReminder(page: Page) {
  const backdrop = page.getByTestId("staff-start-reminder-backdrop");
  try {
    await backdrop.waitFor({ state: "visible", timeout: 10_000 });
  } catch (error) {
    if (error instanceof errors.TimeoutError) return;
    throw error;
  }
  await backdrop
    .getByRole("button", { name: "稍後處理", exact: true })
    .last()
    .click();
  await backdrop.waitFor({ state: "detached", timeout: 5_000 });
}

export async function waitForDefaultMerchantDashboard(
  page: Page,
  organizationId: string,
) {
  await page.waitForURL(
    (url) =>
      url.pathname === "/merchant/dashboard" &&
      url.searchParams.get("organizationId") === organizationId &&
      url.searchParams.get("dateFrom") === url.searchParams.get("dateTo") &&
      url.searchParams.get("dashboardPreset") === "TODAY" &&
      url.searchParams.get("dashboardSort") === "sales" &&
      url.searchParams.getAll("stallId").length > 0,
    { timeout: 30_000 },
  );
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
  if (
    actualUrl.origin !== expectedUrl.origin ||
    actualUrl.pathname !== expectedUrl.pathname
  )
    return false;
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
