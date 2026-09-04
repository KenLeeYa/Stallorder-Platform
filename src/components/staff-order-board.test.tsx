import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MessageTestProvider } from "@/test/message-test-provider";
import { StaffOrderBoard } from "@/components/staff-order-board";
import type { StaffOrderDto } from "@/lib/orders";

vi.mock("@/components/work-mode-switcher", () => ({ WorkModeSwitcher: () => null }));
vi.mock("@/components/workspace-switcher", () => ({ WorkspaceSwitcher: () => null }));
vi.mock("@/components/pwa-controls", () => ({ PwaControls: () => null }));
vi.mock("@/components/offline-bootstrap-control", () => ({ OfflineBootstrapControl: () => null }));
vi.mock("@/components/offline-queue-status", () => ({ OfflineQueueStatus: () => null }));
vi.mock("@/components/logout-button", () => ({ LogoutButton: () => null }));

const orderId = "11111111-1111-4111-8111-111111111111";
const itemId = "22222222-2222-4222-8222-222222222222";
const productId = "33333333-3333-4333-8333-333333333333";

function order(override: Partial<StaffOrderDto> = {}): StaffOrderDto {
  return {
    id: orderId,
    orderNo: "260813-001",
    source: "STAFF_POS",
    isTest: false,
    customerName: "現場顧客",
    customerPhone: null,
    deliveryAddress: null,
    tableLabel: null,
    diningTableId: null,
    fulfillmentType: "TAKEOUT",
    note: null,
    status: "CONFIRMED",
    paymentStatus: "UNPAID",
    subtotal: 100,
    discountAmount: 0,
    discountLabel: null,
    total: 100,
    pickupCodeLength: 3,
    pickupVerifiedAt: null,
    pickupVerificationMethod: null,
    confirmationExpiresAt: "2026-08-13T04:30:00.000Z",
    quotedWaitMinutes: null,
    quotedReadyAt: null,
    scheduledPickupAt: null,
    requestedFulfillmentAt: null,
    committedFulfillmentAt: null,
    pendingFulfillmentAt: null,
    fulfillmentTimeState: "NOT_REQUESTED",
    fulfillmentTimeVersion: 0,
    fulfillmentTimeResponseExpiresAt: null,
    fulfillmentTimeChangeReason: null,
    createdAt: "2026-08-13T04:00:00.000Z",
    primaryPrintStatus: null,
    items: [{
      id: itemId,
      name: "測試餐點",
      unitPrice: 100,
      quantity: 1,
      isOrderDiscountEligible: true,
      note: null,
      status: "PENDING",
      preparingAt: null,
      readyAt: null,
      servedAt: null,
      noteOptions: [],
    }],
    ...override,
  };
}

function render(orders: StaffOrderDto[], moduleOverride: Partial<{ dineIn: boolean; delivery: boolean; print: boolean; kds: boolean; payment: boolean; discount: boolean; discountApprovalThresholdBps: number }> = {}) {
  return renderToStaticMarkup(<MessageTestProvider initialLocale="zh-TW">
    <StaffOrderBoard
    stall={{
      id: "44444444-4444-4444-8444-444444444444",
      organizationId: "55555555-5555-4555-8555-555555555555",
      slug: "demo",
      name: "測試攤位",
      currency: "TWD",
      timezone: "Asia/Taipei",
      businessDayCutoffHour: 0,
    }}
    initialOrders={orders}
    initialNow={new Date("2026-08-13T04:10:00.000Z").getTime()}
    account={{ displayName: "店員", role: "STAFF" }}
    modules={{ dineIn: true, delivery: true, print: false, kds: true, payment: false, discount: false, discountApprovalThresholdBps: 8000, ...moduleOverride }}
    paymentOptions={[]}
    discountOptions={[]}
    orderCatalog={{
      products: [{
        id: productId,
        name: "可新增商品",
        description: "",
        category: "主餐",
        price: 120,
        imageUrl: null,
        isOrderDiscountEligible: true,
        noteGroups: [],
      }],
      tables: [],
      fulfillmentSlots: [],
      limits: { maxItemQuantity: 100, maxUniqueProducts: 100, maxTotalQuantity: 100, maxNoteLength: 1000 },
    }}
    capacity={null}
    workModeDestinations={[]}
    appVersion="test"
    />
  </MessageTestProvider>);
}

describe("StaffOrderBoard ticket presentation", () => {
  it("places ordering actions before status controls in the icon-only toolbar", () => {
    const html = render([]);

    expect(html).toContain('data-testid="staff-function-grid"');
    expect(html).toContain('data-persist-horizontal-scroll="staff-function-grid"');
    expect(html).toContain('data-testid="staff-function-identity-group"');
    expect(html).toContain('data-testid="staff-function-status-group"');
    expect(html).toContain('data-testid="staff-function-order-group"');
    expect(html).toContain('data-testid="staff-function-device-group"');
    expect(html.indexOf('data-testid="staff-function-identity-group"')).toBeLessThan(html.indexOf('data-testid="staff-function-order-group"'));
    expect(html.indexOf('data-testid="staff-function-order-group"')).toBeLessThan(html.indexOf('data-testid="staff-function-status-group"'));
    expect(html.indexOf('data-testid="staff-function-status-group"')).toBeLessThan(html.indexOf('data-testid="staff-function-device-group"'));
    expect(html).toContain("overflow-x-auto");
    expect(html).toContain("sm:overflow-x-visible");
    expect(html).toContain("sticky top-0");
    expect(html).toMatch(/<header[^>]*data-testid="staff-sticky-header"[^>]*overflow-x-clip[^>]*overflow-y-visible/);
    expect(html).toContain("overscroll-x-contain");
    expect(html).toContain("min-[360px]:flex-nowrap");
    expect(html).not.toContain("backdrop-blur");
    expect(html).toContain("[&amp;_button]:box-border");
    expect(html).toContain("h-11 w-11");
    expect(html).toContain('<span class="sr-only">店員點餐</span>');
    expect(html).toMatch(/<header[^>]*data-testid="staff-sticky-header"[^>]*sticky top-0[\s\S]*data-testid="staff-function-grid"[\s\S]*<\/header>/);
  });

  it("keeps the item summary and primary actions visible while detailed controls stay compact", () => {
    const html = render([order()]);

    expect(html).toContain("查看明細");
    expect(html).toContain("修改訂單內容");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain(`aria-controls="order-details-${orderId}"`);
    expect(html).toContain("1 × 測試餐點");
  });

  it("keeps completed-food unpaid tickets compact but exposes 待結帳 and 代結帳", () => {
    const html = render([order({
      status: "READY",
      items: [{ ...order().items[0], status: "READY", readyAt: "2026-08-13T04:09:00.000Z" }],
    })]);

    expect(html).toContain("待結帳");
    expect(html).toContain("代結帳");
    expect(html).toContain("1 × 測試餐點");
  });

  it("replaces the extra completion button with automatic-print status", () => {
    const html = render([order({
      status: "READY",
      paymentStatus: "PAID",
      primaryPrintStatus: "PENDING",
      items: [{ ...order().items[0], status: "READY", readyAt: "2026-08-13T04:09:00.000Z" }],
    })], { print: true, kds: false });

    expect(html).toContain("已收款，列印完成後自動結單");
    expect(html).not.toContain("列印並完成");
    expect(html).not.toContain("代結帳");
  });

  it("labels a paid non-KDS takeout action as completing the order", () => {
    const html = render([order({ paymentStatus: "PAID" })], { print: false, kds: false });

    expect(html).toContain("完成訂單");
    expect(html).not.toContain("完成此桌");
  });

  it("gives a confirmed public pickup order an explicit ready action when KDS is off", () => {
    const html = render([order({ source: "QR_MENU" })], { print: true, kds: false });

    expect(html).toContain("餐點完成・通知可取餐");
    expect(html).toContain("結帳收款");
    expect(html).not.toContain("列印並完成");
  });

  it("keeps payment available when a non-KDS public pickup order is ready", () => {
    const html = render([order({
      source: "QR_MENU",
      status: "READY",
      items: [{ ...order().items[0], status: "READY", readyAt: "2026-08-13T04:09:00.000Z" }],
    })], { print: true, kds: false });

    expect(html).toContain("結帳收款");
    expect(html).not.toContain("餐點完成・通知可取餐");
  });

  it("keeps a paid QR pickup order visible for explicit completion without print coupling", () => {
    const html = render([order({
      source: "QR_MENU",
      status: "READY",
      paymentStatus: "PAID",
      primaryPrintStatus: "PENDING",
      items: [{ ...order().items[0], status: "READY", readyAt: "2026-08-13T04:09:00.000Z" }],
    })], { print: true, kds: false });

    expect(html).toContain("待取餐");
    expect(html).toContain("完成訂單");
    expect(html).not.toContain("已收款，列印完成後自動結單");
  });

  it("labels the pending-order transition as an acceptance action", () => {
    const html = render([order({ status: "WAITING_CONFIRMATION" })]);

    expect(html).toContain("確認接單");
  });

  it("separates cross-business-date reservations into a collapsed future section", () => {
    const html = render([order({
      committedFulfillmentAt: "2026-08-14T04:30:00.000Z",
      fulfillmentTimeState: "CONFIRMED",
    })]);

    expect(html).toContain("未來預約訂單（1）");
    expect(html).toContain("未收款登記額");
    expect(html).not.toContain("測試餐點");
    expect(html).not.toContain("全部開始製作");
  });

  it("anchors scheduled-order waiting time at fulfillment time instead of createdAt", () => {
    const html = render([order({
      createdAt: "2026-08-12T04:00:00.000Z",
      requestedFulfillmentAt: "2026-08-13T04:30:00.000Z",
      fulfillmentTimeState: "REQUESTED",
    })]);

    expect(html).toContain("預約取餐");
    expect(html).toContain("距預約 20 分");
    expect(html).not.toContain("已等待 1450 分");
    expect(html).not.toMatch(/[\u00a0\u2007\u2009\u202f]/u);
  });

  it("labels a passed fulfillment time as overdue instead of generic waiting", () => {
    const html = render([order({
      committedFulfillmentAt: "2026-08-13T04:05:00.000Z",
      fulfillmentTimeState: "CONFIRMED",
    })]);

    expect(html).toContain("已逾預約 5 分");
  });

  it.each([
    ["waiting confirmation", { status: "WAITING_CONFIRMATION", fulfillmentTimeState: "CONFIRMED", committedFulfillmentAt: "2026-08-14T04:30:00.000Z" }],
    ["requested response", { status: "CONFIRMED", fulfillmentTimeState: "REQUESTED", requestedFulfillmentAt: "2026-08-14T04:30:00.000Z" }],
    ["customer action", { status: "CONFIRMED", fulfillmentTimeState: "CUSTOMER_ACTION_REQUIRED", pendingFulfillmentAt: "2026-08-14T04:30:00.000Z", committedFulfillmentAt: "2026-08-14T04:15:00.000Z" }],
    ["anomalous preparing", { status: "PREPARING", fulfillmentTimeState: "CONFIRMED", committedFulfillmentAt: "2026-08-14T04:30:00.000Z" }],
  ])("keeps future %s orders in the main list for immediate handling", (_label, override) => {
    const html = render([order(override as Partial<StaffOrderDto>)]);

    expect(html).toContain("今日製作／逾期");
    expect(html).toContain("查看明細");
    expect(html).not.toContain("未來預約訂單（1）");
  });
});
