import { describe, expect, it } from "vitest";
import { notificationRetry, renderLineNotification } from "./notification-job-processor";

describe("notification job processing helpers", () => {
  it("uses bounded exponential retry and stops permanent failures", () => {
    const now = new Date("2026-07-20T00:00:00.000Z");
    expect(notificationRetry(1, true, now)?.toISOString()).toBe("2026-07-20T00:01:00.000Z");
    expect(notificationRetry(4, true, now)?.toISOString()).toBe("2026-07-20T00:08:00.000Z");
    expect(notificationRetry(5, true, now)).toBeNull();
    expect(notificationRetry(1, false, now)).toBeNull();
  });

  it("renders ready notification with pickup code, receipt and reorder link", () => {
    const text = renderLineNotification({
      templateCode: "ORDER_READY",
      stallName: "阿明雞排",
      orderNo: "A025",
      fulfillmentType: "TAKEOUT",
      pickupCode: "738",
      quotedWaitMinutes: 15,
      total: 130,
      trackingToken: "sto_tracking-token-that-is-long-enough-for-test",
      appUrl: "https://staging.qidaigo.com",
    });
    expect(text).toContain("取餐碼 738");
    expect(text).toContain("NT$130");
    expect(text).toContain("/reorder");
  });

  it("renders a proposed fulfillment time with the customer confirmation link", () => {
    const text = renderLineNotification({
      templateCode: "FULFILLMENT_TIME_PROPOSED",
      stallName: "阿明雞排",
      orderNo: "A026",
      fulfillmentType: "DELIVERY",
      pickupCode: null,
      quotedWaitMinutes: null,
      total: 200,
      pendingFulfillmentAt: new Date("2026-08-06T10:30:00.000Z"),
      fulfillmentTimeChangeReason: "原時段訂單較多",
      timezone: "Asia/Taipei",
      trackingToken: "sto_tracking-token-that-is-long-enough-for-test",
      appUrl: "https://staging.qidaigo.com",
    });

    expect(text).toContain("送達時間");
    expect(text).toContain("原時段訂單較多");
    expect(text).toContain("/order/");
  });
});
