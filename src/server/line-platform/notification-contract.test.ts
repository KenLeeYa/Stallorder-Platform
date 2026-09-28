import { describe,expect,it } from "vitest";
import { buildPlatformMessages,type PlatformTemplateInput } from "./messaging-template";
import { platformNotificationSuppression } from "./notification-worker";
const input: PlatformTemplateInput = { event: "ORDER_RECEIPT_AVAILABLE",orderId: "11111111-1111-4111-8111-111111111111",orderNo: "A081",stallName: "測試門市 🍜",address: "合成門市地址",phone: "+886 2 2345-6789",total: 120,paymentStatus: "UNPAID",pickupCode: "481",createdAt: new Date("2026-09-27T00:00:00Z"),fulfilledAt: null,expectedAt: null,endpointUrl: "https://mini.local.test/mini",liffId: "1234568-fixture",imageUrl: "https://mini.local.test/api/line-platform/media/synthetic" };
describe("platform OA templates and stale event rules", () => {
  it.each(["ORDER_PICKED_UP", "ORDER_CANCELLED"] as const)("removes the QR and pickup action from closed %s cards", event => {
    const card = buildPlatformMessages({ ...input, event })[0].contents;
    expect(JSON.stringify(card)).not.toContain(input.imageUrl);
    expect(card.footer.contents[0]).toMatchObject({ action: { label: "查看訂單" } });
    expect(JSON.stringify(card)).not.toContain("預約／預估時間");
  });
  it("makes the pickup number prominent without claiming an unpaid READY order is paid", () => {
    const card = buildPlatformMessages({ ...input, event: "ORDER_READY" })[0].contents;
    expect(JSON.stringify(card)).toContain('"size":"3xl"');
    expect(JSON.stringify(card)).toContain("尚未付款");
    expect(JSON.stringify(card)).toContain(input.imageUrl);
  });
  it("keeps an unpaid receipt honest and uses only owned order/deep links and the matching store", () => {
    const message = JSON.stringify(buildPlatformMessages(input));
    expect(message).toContain("尚未付款"); expect(message).not.toContain("LINE Pay 已付款");
    expect(message).toContain("測試門市 🍜"); expect(message).toContain("NT$120");
    expect(message).toContain("https://miniapp.line.me/1234568-fixture/orders/11111111-1111-4111-8111-111111111111");
    expect(message).toContain("tel:+886223456789"); expect(message).toContain("通知當時快照");
  });
  it("rejects attacker-controlled QR origins and never turns arbitrary contact strings into links", () => {
    expect(() => buildPlatformMessages({ ...input,imageUrl: "https://evil.test/qr" })).toThrow();
    expect(JSON.stringify(buildPlatformMessages({ ...input,phone: "javascript:alert(1)" }))).not.toContain("javascript:");
  });
  it.each(["COMPLETED","CANCELLED","EXPIRED","PREPARING"])("suppresses READY when order became %s", status => {
    expect(platformNotificationSuppression("ORDER_READY",{ status,payment_status: "PAID",eligible: true,friendship: "FRIEND",picked_up: false })).toBe("ORDER_NO_LONGER_READY");
  });
  it("requires friendship and physical handoff evidence separately from payment/completion", () => {
    const order = { status: "COMPLETED",payment_status: "PAID",eligible: true,friendship: "FRIEND",picked_up: false };
    expect(platformNotificationSuppression("ORDER_PICKED_UP",order)).toBe("PICKUP_EVENT_MISSING");
    expect(platformNotificationSuppression("ORDER_PICKED_UP",{ ...order,picked_up: true })).toBeNull();
    expect(platformNotificationSuppression("ORDER_PICKED_UP",{ ...order,picked_up: true,friendship: "UNKNOWN" })).toBe("FRIEND_NOT_CONFIRMED");
  });
});
