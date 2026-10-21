import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import { STAGING_TARGET, conversionQuery } from "./dr-staging-conversion-plan.mjs";
import { readStagingAccess } from "./staging-access-entry.mjs";

const ORGANIZATION = "11111111-1111-4111-8111-111111111111";
const STALL = "22222222-2222-4222-8222-222222222222";
const ORIGIN = `https://${STAGING_TARGET.host}`;
const literal = (value) => `'${value.replaceAll("'", "''")}'`;

export async function acceptStaging(plan, verifyPrimary) {
  const access = await readStagingAccess(plan);
  const runtime = JSON.parse(await readFile("staging-conversion-private/runtime.json", "utf8"));
  const headers = { "CF-Access-Client-Id": access.clientId, "CF-Access-Client-Secret": access.clientSecret };
  const request = (path, options = {}) => fetch(new URL(path, ORIGIN), {
    ...options, headers: { ...headers, ...options.headers }, redirect: "manual", signal: AbortSignal.timeout(20_000),
  });
  let reachable = false;
  for (let attempt = 0; attempt < 36; attempt += 1) {
    const response = await request("/api/version").catch(() => null);
    if (response?.status === 200 && (await response.json()).revision === plan.sourceSha) { reachable = true; break; }
    if (attempt % 6 === 0) await verifyPrimary();
    await new Promise((done) => setTimeout(done, 5_000));
  }
  assert.ok(reachable, "STAGING_PUBLIC_RUNTIME_NOT_READY");
  const anonymous = await fetch(`${ORIGIN}/login`, { redirect: "manual", signal: AbortSignal.timeout(20_000) });
  assert.ok([302, 403].includes(anonymous.status), "STAGING_ANONYMOUS_ACCESS_ALLOWED");
  if (anonymous.status === 302) assert.ok(anonymous.headers.get("location")?.startsWith(`${access.teamDomain}/`), "STAGING_ACCESS_REDIRECT_INVALID");
  const deployment = JSON.parse(await readFile("artifacts/staging-deployment.json", "utf8"));
  const generated = await fetch(`https://${deployment.deploymentUrl}/login`, { redirect: "manual", signal: AbortSignal.timeout(20_000) });
  assert.ok([302, 401, 403].includes(generated.status), "STAGING_GENERATED_ORIGIN_PUBLIC");
  await verifyPrimary();

  // Only the freshly seeded fixture is made continuously available for test use.
  const [fixture] = await conversionQuery(`select count(*)::int as hours from public.stall_business_hours
    where organization_id='${ORGANIZATION}' and stall_id='${STALL}'`);
  assert.equal(fixture.hours, 7, "STAGING_QA_FIXTURE_MISSING");
  await conversionQuery(`update public.stall_business_hours set opens_at='00:00',closes_at='00:00',is_closed=false
    where organization_id='${ORGANIZATION}' and stall_id='${STALL}'`, false);
  const browser = await chromium.launch();
  let orderId = "";
  const errors = [];
  const checks = [];
  async function page() {
    const context = await browser.newContext({ locale: "zh-TW", timezoneId: "Asia/Taipei",
      viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
    // Never send Access credentials to Turnstile, Supabase or any third party.
    await context.route(`${ORIGIN}/**`, (route) => route.continue({ headers: { ...route.request().headers(), ...headers } }));
    const current = await context.newPage();
    current.on("pageerror", () => errors.push("pageerror"));
    current.setDefaultTimeout(30_000);
    return current;
  }
  async function login(current, role) {
    await current.goto(`${ORIGIN}/${role === "owner" ? "login" : "staff/login"}`);
    await current.getByRole("button", { name: "使用電子郵件與密碼登入", exact: true }).click();
    await current.getByLabel("電子郵件").fill(`${role}@stallorder.test`);
    await current.getByLabel("密碼").fill("StallOrderDemo!2026");
    const result = current.waitForResponse((response) => new URL(response.url()).pathname === "/api/auth/login" && response.request().method() === "POST");
    await current.getByRole("button", { name: "登入", exact: true }).click();
    assert.equal((await result).status(), 200, "STAGING_LOGIN_FAILED");
    await expect(current).toHaveURL(new RegExp(`${role === "owner" ? "/merchant/dashboard" : role === "staff" ? "/staff/aming-chicken" : "/kitchen"}`));
  }
  try {
    const owner = await page();
    await login(owner, "owner");
    await expect(owner.locator("#main-content").getByText("營運總覽", { exact: true })).toBeVisible();
    await owner.reload();
    await expect(owner).toHaveURL(/\/merchant\/dashboard/);
    checks.push("real-password-login-workspace-refresh");
    const denied = await owner.context().request.get(`${ORIGIN}/api/merchant/organizations/11111111-1111-4111-8111-111111111112/catalog`, { headers });
    assert.ok([403, 404].includes(denied.status()), "STAGING_TENANT_DENIAL_FAILED");
    checks.push("cross-tenant-denial");
    await owner.goto(`${ORIGIN}/merchant/catalog?organizationId=${ORGANIZATION}`);
    await owner.getByRole("button", { name: "新增商品", exact: true }).click();
    const editor = owner.getByRole("dialog", { name: "新增商品", exact: true });
    await editor.locator('input[type="file"][accept*="image/png"]').setInputFiles("public/icons/stallorder-512.png");
    const uploaded = owner.waitForResponse((response) => new URL(response.url()).pathname.endsWith("/catalog/image") && response.request().method() === "POST");
    await owner.getByRole("dialog", { name: "調整商品圖片", exact: true }).getByRole("button", { name: "裁切並上傳", exact: true }).click();
    const upload = await uploaded;
    assert.equal(upload.status(), 201, "STAGING_IMAGE_UPLOAD_FAILED");
    const { imageUrl } = await upload.json();
    const image = new URL(imageUrl);
    assert.equal(image.origin, ORIGIN, "STAGING_IMAGE_ORIGIN_INVALID");
    const objectPath = image.pathname.replace(/^\/api\/assets\/product-images\//, "");
    assert.match(objectPath, new RegExp(`^${ORGANIZATION}/[a-f0-9-]{36}\\.webp$`));
    await expect(editor.getByLabel("圖片網址")).toHaveValue(imageUrl);
    const downloaded = await request(image.pathname);
    assert.ok(downloaded.ok && downloaded.headers.get("content-type")?.startsWith("image/webp"), "STAGING_IMAGE_READ_FAILED");
    assert.ok((await downloaded.arrayBuffer()).byteLength > 0, "STAGING_IMAGE_EMPTY");
    await owner.screenshot({ path: "artifacts/staging-image-upload.png" });
    await conversionQuery(`update public.catalog_image_uploads set expires_at=now()-interval '1 minute'
      where organization_id='${ORGANIZATION}' and object_path=${literal(objectPath)} and attached_at is null`, false);
    const cleanup = await request("/api/cron/storage-replication", { headers: { authorization: `Bearer ${runtime.CRON_SECRET}` } });
    assert.equal(cleanup.status, 200, "STAGING_IMAGE_CLEANUP_FAILED");
    const [remaining] = await conversionQuery(`select count(*)::int as files from storage.objects where bucket_id='product-images' and name=${literal(objectPath)}`);
    assert.equal(remaining.files, 0, "STAGING_IMAGE_DELETE_NOT_VERIFIED");
    checks.push("browser-image-upload-byte-readback-real-storage-deletion");
    await verifyPrimary();

    const customer = await page();
    await customer.setViewportSize({ width: 390, height: 844 });
    await customer.goto(`${ORIGIN}/q/demo-aming-chicken-table-a1-qr-2026`);
    const product = customer.getByRole("article").filter({ hasText: "香酥雞排" }).first();
    await product.getByTestId("qr-open-product-configurator").or(product.getByRole("button", { name: "增加 香酥雞排", exact: true })).first().click();
    const mild = product.getByRole("radio", { name: "不辣", exact: true });
    if (await mild.isVisible()) await mild.click();
    await product.getByRole("button", { name: "加入購物車", exact: true }).click();
    await customer.getByTestId("qr-mobile-cart-summary").click();
    await customer.getByTestId("qr-cart-panel").getByRole("button", { name: "繼續填寫訂購資料", exact: true }).click();
    const upsell = customer.getByRole("dialog", { name: "結帳前，再看看", exact: true });
    if (await upsell.isVisible()) await upsell.getByRole("button", { name: "不用，直接結帳", exact: true }).click();
    await customer.getByLabel("訂單備註", { exact: true }).fill(`Staging acceptance ${process.env.GITHUB_RUN_ID}`);
    const acknowledgment = customer.getByRole("checkbox", { name: /我已了解目前預估等候時間/ });
    if (await acknowledgment.isVisible()) await acknowledgment.check();
    const submitted = customer.waitForResponse((response) => ["/create-public-order", "/api/public/orders"].some((path) => new URL(response.url()).pathname.endsWith(path)) && response.request().method() === "POST");
    await customer.getByRole("button", { name: "送出訂單", exact: true }).click();
    const created = await submitted;
    assert.ok([200, 201].includes(created.status()), "STAGING_QR_ORDER_FAILED");
    orderId = created.request().postDataJSON().clientOrderId;
    assert.match(orderId, /^[a-f0-9-]{36}$/);
    const [order] = await conversionQuery(`select id,order_no,organization_id,status from public.orders where id=${literal(orderId)}`);
    assert.equal(order.organization_id, ORGANIZATION, "STAGING_QA_ORDER_SCOPE_INVALID");
    await conversionQuery(`update public.orders set is_test=true where id=${literal(orderId)} and organization_id='${ORGANIZATION}'`, false);
    await expect(customer).toHaveURL(/\/order\/sto_/);
    await customer.screenshot({ path: "artifacts/staging-qr-order.png" });
    checks.push("real-qr-order-tracker");

    const staff = await page();
    await login(staff, "staff");
    const reminder = staff.getByTestId("staff-start-reminder-backdrop");
    if (await reminder.isVisible()) await reminder.getByRole("button", { name: "稍後處理", exact: true }).last().click();
    await expect(staff.getByText(new RegExp(order.order_no)).first()).toBeVisible();
    if (order.status === "WAITING_CONFIRMATION") await staff.getByRole("button", { name: "確認接單", exact: true }).click();
    await staff.screenshot({ path: "artifacts/staging-staff-order.png" });
    const kitchen = await page();
    await login(kitchen, "kitchen");
    await expect(kitchen.getByText(new RegExp(order.order_no)).first()).toBeVisible();
    await kitchen.screenshot({ path: "artifacts/staging-kitchen-order.png" });
    checks.push("independent-staff-kitchen-login-and-order-visibility");
    const [safety] = await conversionQuery(`select
      (select count(*)::int from public.printers where is_enabled) as printers,
      (select count(*)::int from public.payment_options where is_enabled and kind<>'CASH') as live_payments,
      (select count(*)::int from vault.secrets) as vault,
      (select count(*)::int from cron.job where active) as crons,
      (select count(*)::int from pg_subscription) as subscriptions`);
    assert.ok(Object.values(safety).every((value) => value === 0), "STAGING_QA_SAFETY_FAILED");
    assert.equal(errors.length, 0, "STAGING_BROWSER_PAGE_ERROR");
    await verifyPrimary();
    await writeFile("artifacts/staging-acceptance.json", JSON.stringify({ sourceSha: plan.sourceSha,
      deploymentId: deployment.deploymentId, backend: STAGING_TARGET.ref, origin: ORIGIN, checks,
      anonymousAccessDenied: true, generatedOriginProtected: true, applicationRoleLogins: ["owner", "staff", "kitchen"],
      cloudflareHumanIdpLogin: "not_run", browserServiceWorkers: "blocked-for-service-token-test", physicalPrinting: "disabled",
      realPayment: "disabled", syntheticOrderId: orderId, safety, primaryWrites: false }, null, 2));
  } finally {
    await browser.close();
  }
}
