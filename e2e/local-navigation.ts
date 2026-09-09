import {
  errors,
  expect,
  type Locator,
  type Page,
  type Response,
} from "@playwright/test";
import type { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { AUTH_SESSION_MAX_AGE_SECONDS } from "../src/lib/session-lifetime";
import {
  createOpaqueToken,
  hashToken,
  SESSION_DEVICE_COOKIE,
} from "../src/lib/security";

const TEST_SESSION_COOKIE = "stallorder_session";
const TEST_CSRF_COOKIE = "stallorder_csrf";

export async function continueQrCheckout(page: Page) {
  const upsell = page.getByRole("dialog", { name: "結帳前，再看看", exact: true });
  await expect.poll(async () => (
    await upsell.isVisible() || await page.getByLabel("訂單備註").filter({ visible: true }).isVisible()
  )).toBe(true);
  if (await upsell.isVisible()) {
    await upsell.getByRole("button", { name: "不用，直接結帳", exact: true }).click();
    await expect(upsell).not.toBeVisible();
  }
}

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

export async function addFirstStaffCatalogProduct(
  page: Page,
  composer: Locator,
) {
  const product = composer.getByTestId("staff-product-card").first();
  await product.waitFor({ state: "visible" });
  const openConfigurator = product.getByTestId(
    "staff-open-product-configurator",
  );

  if ((await openConfigurator.count()) > 0) {
    await openConfigurator.click();
    const configurator = page.getByTestId("staff-product-configurator");
    await configurator.waitFor({ state: "visible" });
    const productName = (await configurator.locator("h3").innerText()).trim();
    const groups = configurator.locator("section");
    for (let index = 0; index < (await groups.count()); index += 1) {
      const group = groups.nth(index);
      const heading = group.locator("h4").first();
      if (
        (await heading.count()) === 0 ||
        !(await heading.innerText()).includes("*")
      )
        continue;
      const options = group.getByTestId("staff-configurator-option");
      if (
        await options.evaluateAll((elements) =>
          elements.some((element) => element.getAttribute("aria-checked") === "true"),
        )
      )
        continue;
      for (let optionIndex = 0; optionIndex < (await options.count()); optionIndex += 1) {
        const option = options.nth(optionIndex);
        if (await option.isEnabled()) {
          await option.click();
          break;
        }
      }
    }
    await configurator
      .getByRole("button", { name: "加入購物車", exact: true })
      .click();
    await configurator.waitFor({ state: "hidden" });
    return productName;
  }

  const increase = product.getByTitle(/^增加 /).first();
  const productName = (await increase.getAttribute("title"))?.replace(/^增加 /, "");
  if (!productName) throw new Error("店員點餐測試找不到第一個商品名稱。");
  await increase.click();
  await product
    .getByRole("button", { name: "加入購物車", exact: true })
    .click();
  return productName;
}

export async function openSharedCatalogProductActions(
  page: Page,
  productName: string,
) {
  const desktopSearch = page.getByRole("searchbox", { name: "搜尋管理商品", exact: true });
  const navigator = page.getByTestId("catalog-navigator-dialog");
  const openNavigator = page
    .getByTestId("open-catalog-navigator")
    .filter({ visible: true });
  await desktopSearch
    .or(navigator)
    .or(openNavigator)
    .filter({ visible: true })
    .first()
    .waitFor({ state: "visible" });
  if (await desktopSearch.isVisible() && !(await navigator.isVisible())) {
    await desktopSearch.fill(productName);
    const row = page.getByTestId("catalog-management-row").filter({
      has: page.getByRole("heading", { name: productName, exact: true }),
    });
    await row.getByRole("button", { name: `更多操作 ${productName}`, exact: true }).click();
    const actions = page.getByRole("dialog", { name: `商品：${productName}`, exact: true });
    await actions.waitFor({ state: "visible" });
    return actions;
  }
  if (!(await navigator.isVisible())) {
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

export async function establishLocalTestSession(
  page: Page,
  database: PrismaClient,
  profileId: string,
) {
  const token = createOpaqueToken();
  const csrfToken = createOpaqueToken();
  const deviceId = randomUUID();
  // A fresh fixture should not trigger immediate background session rotation.
  const expiresAt = new Date(Date.now() + AUTH_SESSION_MAX_AGE_SECONDS * 1_000);
  const profile = await database.profile.findUniqueOrThrow({
    where: { id: profileId },
    select: { sessionVersion: true },
  });
  await database.authSession.create({
    data: {
      profileId,
      tokenHash: hashToken(token),
      csrfTokenHash: hashToken(csrfToken),
      deviceId,
      expiresAt,
      profileSessionVersion: profile.sessionVersion,
    },
  });
  const origin = new URL(
    page.url() === "about:blank"
      ? (process.env.PLAYWRIGHT_APP_URL ?? "http://localhost:3001")
      : page.url(),
  ).origin;
  await page.context().addCookies([
    {
      name: TEST_SESSION_COOKIE,
      value: token,
      url: origin,
      httpOnly: true,
      sameSite: "Lax",
      expires: expiresAt.getTime() / 1_000,
    },
    {
      name: TEST_CSRF_COOKIE,
      value: csrfToken,
      url: origin,
      sameSite: "Lax",
      expires: expiresAt.getTime() / 1_000,
    },
    {
      name: SESSION_DEVICE_COOKIE,
      value: deviceId,
      url: origin,
      httpOnly: true,
      sameSite: "Lax",
      expires: expiresAt.getTime() / 1_000,
    },
  ]);
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
  if (new URL(page.url()).pathname === "/select-organization") {
    await page.locator(`a[href="/merchant/dashboard?organizationId=${organizationId}"]`).click();
  }
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
