import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { formatAppCurrency } from "@/lib/locale-format";

const mocks = vi.hoisted(() => ({
  getBillingData: vi.fn(),
  requireBillingWorkspace: vi.fn(),
  notFound: vi.fn(() => { throw new Error("NOT_FOUND"); }),
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/components/additional-stall-request-form", () => ({
  AdditionalStallRequestForm: () => <div data-testid="additional-stall-form" />,
}));
vi.mock("@/components/billing-navigation", () => ({
  BillingPageHeader: () => <div data-testid="billing-page-header" />,
}));
vi.mock("@/components/billing-status-banner", () => ({
  BillingStatusBanner: () => <div data-testid="billing-status-banner" />,
}));
vi.mock("@/lib/billing-portal-data", () => ({
  getMerchantBillingPortalData: mocks.getBillingData,
}));
vi.mock("@/lib/billing-page", () => ({
  requireBillingWorkspace: mocks.requireBillingWorkspace,
}));
vi.mock("@/lib/messages/merchant-server", () => ({
  getRequestMerchantMessages: () => Promise.resolve({
    locale: "zh-TW",
    m: (message: string) => message,
    label: (message: string) => message,
  }),
}));

import MerchantBillingPage from "./page";
import MerchantUsagePage from "../usage/page";

const workspace = {
  id: "11111111-1111-4111-8111-111111111111",
  businessName: "測試組織",
};

const paygCharge = 987;

describe("merchant PAYG financial visibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getBillingData.mockResolvedValue(billingData());
  });

  it("hides PAYG monetary values from an organization administrator while retaining usage counts", async () => {
    const { billingHtml, usageHtml } = await renderPages(false);
    const formattedCharge = formatAppCurrency("zh-TW", paygCharge, "TWD");

    expect(billingHtml).toContain("淨計費訂單");
    expect(billingHtml).toContain("阿宏河粉");
    expect(usageHtml).toContain("本期計費訂單");
    expect(usageHtml).toContain("37");
    for (const amount of [paygCharge, 1_137, 1_499, 150]) {
      expect(billingHtml).not.toContain(formatAppCurrency("zh-TW", amount, "TWD"));
    }
    expect(billingHtml).not.toContain("<progress");
    expect(usageHtml).not.toContain(formattedCharge);
  });

  it("keeps PAYG monetary values visible to an authorized financial role", async () => {
    const { billingHtml, usageHtml } = await renderPages(true);
    const formattedCharge = formatAppCurrency("zh-TW", paygCharge, "TWD");

    expect(billingHtml).toContain(formattedCharge);
    expect(billingHtml).toContain("<progress");
    expect(usageHtml).toContain(formattedCharge);
  });
});

async function renderPages(canViewFinancials: boolean) {
  mocks.requireBillingWorkspace.mockResolvedValue({
    workspace,
    canManage: false,
    canViewFinancials,
  });
  const searchParams = Promise.resolve({ organizationId: workspace.id });
  const billing = await MerchantBillingPage({ searchParams });
  const usage = await MerchantUsagePage({
    searchParams: Promise.resolve({ organizationId: workspace.id }),
  });
  return {
    billingHtml: renderToStaticMarkup(billing),
    usageHtml: renderToStaticMarkup(usage),
  };
}

function billingData() {
  return {
    subscription: {
      status: "ACTIVE",
      billingInterval: "MONTHLY",
      billingPeriodStart: new Date("2026-08-01T00:00:00.000Z"),
      billingPeriodEnd: new Date("2026-09-01T00:00:00.000Z"),
      trialEndsAt: null,
      paymentDueAt: null,
      planVersion: {
        displayName: "PAYG",
        version: 1,
        pricingMode: "USAGE_PER_STALL_CAPPED",
        includedOrders: null,
        maxStalls: null,
        maxStaff: null,
        maxProducts: null,
        maxQrCodes: null,
        overagePolicy: "SOFT_LIMIT",
      },
      invoices: [],
    },
    usage: {
      billableOrders: 37,
      orderPackageQuantity: 0,
      activeStalls: 1,
      activeStaff: 4,
      activeProducts: 18,
      activeQrCodes: 2,
      csvExports: 0,
    },
    warnings: [],
    effectiveEntitlements: [],
    notifications: [],
    orderPackages: [],
    paygStallUsage: [{
      id: "usage-summary-id",
      stallId: "22222222-2222-4222-8222-222222222222",
      netBillableOrderCount: 37,
      fullRefundCreditCount: 0,
      finalCharge: paygCharge,
      uncappedAmount: 1_137,
      capAmount: 1_499,
      capSavings: 150,
      stall: { name: "阿宏河粉" },
    }],
  };
}
