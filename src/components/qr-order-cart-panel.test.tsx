import { createRef, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { deliveryOrderMessages } from "@/lib/delivery-order-i18n";
import { qrOrderMessages } from "@/lib/qr-order-i18n";
import {
  QrOrderCartPanel,
  resolveQrCheckoutBlocker,
} from "./qr-order-cart-panel";

type CartPanelProps = ComponentProps<typeof QrOrderCartPanel>;

const product = {
  id: "product-1",
  name: "測試餐點",
  description: "",
  price: 100,
  kind: "SINGLE" as const,
  category: "主餐",
  rank: null,
  isBestSeller: false,
  isOrderDiscountEligible: true,
  imageUrl: null,
  translations: [],
  noteGroups: [],
  bundleChoiceGroups: [],
};

const baseProps: CartPanelProps = {
  session: {
    orderingMode: "DEFAULT",
    preorderSlots: [],
    lotteryEnabled: false,
    stall: {
      name: "測試攤位",
      slug: "test-stall",
      location: "台北",
      currency: "TWD",
      timezone: "Asia/Taipei",
      fulfillmentType: "TAKEOUT",
      table: null,
    },
    products: [product],
    supportedLocales: ["zh-TW"],
    estimatedWaitMinutes: 10,
    estimatedWaitMinMinutes: 5,
    estimatedWaitMaxMinutes: 10,
    waitAcknowledgmentThresholdMinutes: null,
    requiresWaitAcknowledgment: false,
    lastTableOrderAt: null,
    limits: {
      maxItemQuantity: 5,
      maxUniqueProducts: 5,
      maxTotalQuantity: 10,
      maxNoteLength: 300,
    },
    orderSessionToken: "stos_test",
    expiresAt: "2099-08-03T01:10:00.000Z",
  },
  cartLines: [{
    id: "line-1",
    productId: product.id,
    quantity: 1,
    note: "",
    noteOptionIds: [],
    bundleChoiceIds: [],
  }],
  activeCartStep: "CHECKOUT",
  activeOrderingMode: "DEFAULT",
  locale: "zh-TW",
  copy: qrOrderMessages["zh-TW"],
  deliveryCopy: deliveryOrderMessages["zh-TW"],
  orderingEnabled: true,
  totalQuantity: 1,
  total: 100,
  customerName: "",
  customerPhone: "",
  deliveryAddress: "",
  customerNote: "",
  waitAcknowledged: false,
  fulfillmentTimePicker: null,
  turnstileRequested: false,
  turnstileResetKey: 0,
  checkoutBlocker: "",
  message: "",
  isSubmitting: false,
  closeButtonRef: createRef<HTMLButtonElement>(),
  continueButtonRef: createRef<HTMLButtonElement>(),
  checkoutHeadingRef: createRef<HTMLHeadingElement>(),
  localizedProduct: (item) => ({ name: item.name }),
  localizedOptionName: (option) => option.name,
  bundleChoiceLabel: (option) => option.componentProductName,
  onClose: vi.fn(),
  onChangeLineQuantity: vi.fn(),
  onEditLine: vi.fn(),
  onContinueToCheckout: vi.fn(),
  onBackToCart: vi.fn(),
  onCustomerNameChange: vi.fn(),
  onCustomerPhoneChange: vi.fn(),
  onDeliveryAddressChange: vi.fn(),
  onCustomerNoteChange: vi.fn(),
  onWaitAcknowledgedChange: vi.fn(),
  onTurnstileToken: vi.fn(),
  onSubmit: vi.fn(),
};

function renderPanel(overrides: Partial<CartPanelProps> = {}) {
  return renderToStaticMarkup(<QrOrderCartPanel {...baseProps} {...overrides} />);
}

function submitOpeningTag(html: string) {
  const labelOffset = html.indexOf("送出訂單");
  const buttonOffset = html.lastIndexOf("<button", labelOffset);
  return html.slice(buttonOffset, html.indexOf(">", buttonOffset) + 1);
}

const blockerMessages = {
  orderingUnavailable: qrOrderMessages["zh-TW"].degradedMessage,
  emptyCart: qrOrderMessages["zh-TW"].selectAtLeastOne,
  unappliedFulfillmentTime: "取餐時間尚未套用，請先按下「套用這個時間」。",
  sessionLoading: qrOrderMessages["zh-TW"].sessionLoading,
  sessionExpired: qrOrderMessages["zh-TW"].sessionExpired,
  deliveryDetailsMissing: deliveryOrderMessages["zh-TW"].detailsRequired,
  waitAcknowledgmentRequired: qrOrderMessages["zh-TW"].waitAcknowledgmentRequired,
  securityRequired: qrOrderMessages["zh-TW"].securityRequired,
};

const readyCheckout = {
  orderingAvailability: "AVAILABLE" as const,
  totalQuantity: 1,
  hasUnappliedFulfillmentTime: false,
  sessionReady: true,
  sessionExpired: false,
  deliveryDetailsMissing: false,
  requiredOptionMessage: null,
  waitAcknowledgmentRequired: false,
  hasTurnstileToken: true,
  messages: blockerMessages,
};

describe("resolveQrCheckoutBlocker priority matrix", () => {
  it.each(["DEGRADED", "UNAVAILABLE", "MAINTENANCE", "UNKNOWN"] as const)(
    "maps %s availability to the ordering-unavailable blocker",
    (orderingAvailability) => {
      expect(resolveQrCheckoutBlocker({
        ...readyCheckout,
        orderingAvailability,
      })).toBe(blockerMessages.orderingUnavailable);
    },
  );

  it.each([
    {
      name: "ordering unavailable before every checkout-state blocker",
      overrides: {
        orderingAvailability: "DEGRADED" as const,
        totalQuantity: 0,
        hasUnappliedFulfillmentTime: true,
        sessionReady: false,
        sessionExpired: true,
        deliveryDetailsMissing: true,
        requiredOptionMessage: "請完成必選註記。",
        waitAcknowledgmentRequired: true,
        hasTurnstileToken: false,
      },
      expected: blockerMessages.orderingUnavailable,
    },
    {
      name: "empty cart before preorder, session, delivery, option, wait, and Turnstile",
      overrides: {
        totalQuantity: 0,
        hasUnappliedFulfillmentTime: true,
        sessionReady: false,
        sessionExpired: true,
        deliveryDetailsMissing: true,
        requiredOptionMessage: "請完成必選註記。",
        waitAcknowledgmentRequired: true,
        hasTurnstileToken: false,
      },
      expected: blockerMessages.emptyCart,
    },
    {
      name: "unapplied PREORDER slot before session and checkout fields",
      overrides: {
        hasUnappliedFulfillmentTime: true,
        sessionReady: false,
        sessionExpired: true,
        deliveryDetailsMissing: true,
        requiredOptionMessage: "請完成必選註記。",
        waitAcknowledgmentRequired: true,
        hasTurnstileToken: false,
      },
      expected: blockerMessages.unappliedFulfillmentTime,
    },
    {
      name: "session not ready before expiry and checkout fields",
      overrides: {
        sessionReady: false,
        sessionExpired: true,
        deliveryDetailsMissing: true,
        requiredOptionMessage: "請完成必選註記。",
        waitAcknowledgmentRequired: true,
        hasTurnstileToken: false,
      },
      expected: blockerMessages.sessionLoading,
    },
    {
      name: "session expiry before delivery, option, wait, and Turnstile",
      overrides: {
        sessionExpired: true,
        deliveryDetailsMissing: true,
        requiredOptionMessage: "請完成必選註記。",
        waitAcknowledgmentRequired: true,
        hasTurnstileToken: false,
      },
      expected: blockerMessages.sessionExpired,
    },
    {
      name: "DELIVERY phone/address before option, wait, and Turnstile",
      overrides: {
        deliveryDetailsMissing: true,
        requiredOptionMessage: "請完成必選註記。",
        waitAcknowledgmentRequired: true,
        hasTurnstileToken: false,
      },
      expected: blockerMessages.deliveryDetailsMissing,
    },
    {
      name: "required option before wait acknowledgement and Turnstile",
      overrides: {
        requiredOptionMessage: "請完成「測試餐點」的必選註記。",
        waitAcknowledgmentRequired: true,
        hasTurnstileToken: false,
      },
      expected: "請完成「測試餐點」的必選註記。",
    },
    {
      name: "wait acknowledgement before Turnstile",
      overrides: {
        waitAcknowledgmentRequired: true,
        hasTurnstileToken: false,
      },
      expected: blockerMessages.waitAcknowledgmentRequired,
    },
    {
      name: "Turnstile after every business blocker is clear",
      overrides: { hasTurnstileToken: false },
      expected: blockerMessages.securityRequired,
    },
  ])("selects $name", ({ overrides, expected }) => {
    expect(resolveQrCheckoutBlocker({ ...readyCheckout, ...overrides })).toBe(expected);
  });

  it("treats availability CHECKING as session loading, not ordering unavailable", () => {
    expect(resolveQrCheckoutBlocker({
      ...readyCheckout,
      orderingAvailability: "CHECKING",
      sessionReady: false,
    })).toBe(blockerMessages.sessionLoading);
  });

  it("returns no blocker only when every gate is satisfied", () => {
    expect(resolveQrCheckoutBlocker(readyCheckout)).toBe("");
  });
});

describe("QrOrderCartPanel checkout blocker presentation", () => {
  it.each([
    "您仍可查看菜單，請至攤位櫃台點餐。",
    "請至少選擇一項商品。",
    "正在建立安全點餐工作階段...",
    "取餐時間尚未套用，請先按下「套用這個時間」。",
    "點餐工作階段已逾時，請重新掃描 QR Code。",
    "請填寫有效的聯絡電話與外送地址。",
    "請完成「測試餐點」的必選註記。",
    "請先確認目前預估等候時間。",
    "請先完成安全驗證。",
  ])("announces %s next to a disabled submit CTA", (checkoutBlocker) => {
    const html = renderPanel({ checkoutBlocker });

    expect(html).toContain('data-testid="qr-checkout-blocker"');
    expect(html).toContain('role="status"');
    expect(html).toContain(checkoutBlocker);
    expect(html.indexOf(checkoutBlocker)).toBeLessThan(html.indexOf("送出訂單"));
    expect(submitOpeningTag(html)).toMatch(/\sdisabled=""/);
  });

  it("renders required delivery fields beside the delivery blocker", () => {
    const html = renderPanel({
      session: {
        ...baseProps.session,
        orderingMode: "DELIVERY",
        stall: { ...baseProps.session.stall, fulfillmentType: "DELIVERY" },
      },
      activeOrderingMode: "DELIVERY",
      checkoutBlocker: "請填寫有效的聯絡電話與外送地址。",
    });

    expect(html).toContain('aria-label="聯絡電話"');
    expect(html).toContain('aria-label="外送地址"');
    expect(html).toContain("請填寫有效的聯絡電話與外送地址。");
  });

  it("enables submit only when no blocker remains", () => {
    const html = renderPanel();

    expect(html).not.toContain('data-testid="qr-checkout-blocker"');
    expect(submitOpeningTag(html)).not.toMatch(/\sdisabled=""/);
  });
});
