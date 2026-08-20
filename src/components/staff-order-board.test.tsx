import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/components/locale-provider";
import { StaffOrderBoard } from "@/components/staff-order-board";
import type { StaffOrderDto } from "@/lib/orders";

vi.mock("@/components/work-mode-switcher", () => ({ WorkModeSwitcher: () => null }));
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

function render(orders: StaffOrderDto[]) {
  return renderToStaticMarkup(<LocaleProvider initialLocale="zh-TW" hasLocaleCookie>
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
    modules={{ dineIn: true, delivery: true, print: false, payment: false, discount: false, discountApprovalThresholdBps: 8000 }}
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
  </LocaleProvider>);
}

describe("StaffOrderBoard ticket presentation", () => {
  it("groups the icon-only toolbar by status, ordering, and device actions", () => {
    const html = render([]);

    expect(html).toContain('data-testid="staff-function-grid"');
    expect(html).toContain('data-testid="staff-function-status-group"');
    expect(html).toContain('data-testid="staff-function-order-group"');
    expect(html).toContain('data-testid="staff-function-device-group"');
    expect(html).toContain("overflow-x-auto");
    expect(html).toContain("sm:overflow-x-visible");
    expect(html).toContain("relative mt-3 flex");
    expect(html).toContain('<span class="sr-only">店員點餐</span>');
  });

  it("renders eligible tickets compact by default with detail and edit affordances", () => {
    const html = render([order()]);

    expect(html).toContain("查看明細");
    expect(html).toContain("修改訂單內容");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain(`aria-controls="order-details-${orderId}"`);
    expect(html).not.toContain("測試餐點");
  });

  it("keeps completed-food unpaid tickets compact but exposes 待結帳 and 代結帳", () => {
    const html = render([order({
      status: "READY",
      items: [{ ...order().items[0], status: "READY", readyAt: "2026-08-13T04:09:00.000Z" }],
    })]);

    expect(html).toContain("待結帳");
    expect(html).toContain("代結帳");
    expect(html).not.toContain("測試餐點");
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
