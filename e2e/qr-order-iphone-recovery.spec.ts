import { devices, expect, test, type Route } from "@playwright/test";

test.use({ ...devices["iPhone 13"], serviceWorkers: "block" });

const qrToken = "demo-aming-chicken-table-a1-qr-2026";
const trackingToken = `sto_${"r".repeat(48)}`;
const deviceId = "11111111-1111-4111-8111-111111111111";
const recoveryKey = `stallorder_qr_order_recovery:v1:${encodeURIComponent(qrToken)}`;

test("iPhone 重掃同一 QR 載回已完成訂單，明確返回 Menu 才開始新單", async ({ context, page }) => {
  let sessionRequestCount = 0;
  await page.addInitScript(({ key, storedQrToken, storedTrackingToken, storedDeviceId }) => {
    window.localStorage.setItem(key, JSON.stringify({
      qrToken: storedQrToken,
      trackingToken: storedTrackingToken,
      deviceId: storedDeviceId,
      expiresAt: Date.now() + 24 * 60 * 60 * 1_000,
    }));
  }, {
    key: recoveryKey,
    storedQrToken: qrToken,
    storedTrackingToken: trackingToken,
    storedDeviceId: deviceId,
  });

  const orderPayload = {
    order: {
      orderNo: "QR-RECOVERY-001",
      orderStatus: "COMPLETED",
      paymentStatus: "PAID",
      totalAmount: 100,
      currency: "TWD",
      createdAt: "2026-09-02T08:00:00.000Z",
      confirmedAt: "2026-09-02T08:01:00.000Z",
      completedAt: "2026-09-02T08:05:00.000Z",
      stallName: "阿明雞排",
      publicMenuIdentifier: null,
      pickupVerificationCode: null,
      fulfillmentType: "DINE_IN",
      tableLabel: "A1",
      customerPhone: null,
      deliveryAddress: null,
      estimatedWaitMinutes: 0,
      quotedWaitMinutes: null,
      quotedReadyAt: null,
      lastTableOrderAt: null,
      stallTimezone: "Asia/Taipei",
      requestedFulfillmentAt: null,
      committedFulfillmentAt: null,
      pendingFulfillmentAt: null,
      fulfillmentTimeState: "NOT_REQUESTED",
      fulfillmentTimeVersion: 0,
      fulfillmentTimeResponseExpiresAt: null,
      fulfillmentTimeChangeReason: null,
      merchantAmendment: null,
      items: [],
    },
  };
  const fulfillOrder = (route: Route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(orderPayload),
  });
  await context.route("**/get-public-order", fulfillOrder);
  await context.route(`**/api/public/orders/${trackingToken}`, fulfillOrder);
  await context.route("**/create-order-session", async (route) => {
    sessionRequestCount += 1;
    await route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
  });
  await context.route("**/api/public/order-session", async (route) => {
    sessionRequestCount += 1;
    await route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
  });

  await page.goto(`/q/${qrToken}`);

  await expect(page).toHaveURL(new RegExp(
    `/order/${trackingToken.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\?qr=`,
    "u",
  ));
  await expect(page.getByText("已完成", { exact: true }).first()).toBeVisible();
  expect(sessionRequestCount).toBe(0);

  await page.getByRole("button", { name: "返回 Menu", exact: true }).click();
  await expect(page).toHaveURL(`/q/${qrToken}?newOrder=1`);
  await expect.poll(() => page.evaluate((key) => window.localStorage.getItem(key), recoveryKey))
    .toBeNull();
});
