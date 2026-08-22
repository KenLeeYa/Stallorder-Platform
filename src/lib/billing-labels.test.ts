import { describe, expect, it } from "vitest";
import {
  addOnLabel,
  billingFeatureLabels,
  featureLabel,
  planLabel,
} from "@/lib/billing-labels";

const catalogFeatureCodes = [
  "QR_ORDERING",
  "MANUAL_CHECKOUT",
  "PRODUCT_MANAGEMENT",
  "SOLD_OUT_CONTROL",
  "BUSINESS_HOURS",
  "BASIC_REPORTS",
  "ADVANCED_REPORTS",
  "CSV_EXPORT",
  "MODIFIERS",
  "KITCHEN_VIEW",
  "KDS",
  "CDS",
  "WAIT_TIME_QUOTE",
  "CAPACITY_CONTROL",
  "CASH_SHIFT",
  "CASH_RECONCILIATION",
  "STALL_LOCATION",
  "STALL_SCHEDULE",
  "LINE_NOTIFICATIONS",
  "LINE_ORDER_LINKING",
  "LINE_REPEAT_ORDER",
  "STAFF_ROLES",
  "MULTIPLE_QR_CODES",
  "MULTI_STALL_BASIC",
  "MULTI_STALL_DASHBOARD",
  "SCHEDULED_REPORTS",
  "CUSTOM_BRANDING",
  "CUSTOM_DOMAIN",
  "WHITE_LABEL",
  "SSO",
  "AUDIT_VIEWER",
  "OPERATIONAL_ALERTS",
  "BULK_PRODUCT_ASSIGNMENT",
  "BULK_STALL_CONTROL",
  "PRINTER_INTEGRATION",
  "API_ACCESS",
  "WEBHOOK_ACCESS",
  "PRIORITY_SUPPORT",
  "PRODUCT_SALES_REPORT",
  "PAYMENT_REPORT",
  "DELIVERY_PLATFORM_INTEGRATIONS",
  "UBER_EATS_INTEGRATION",
  "FOODPANDA_INTEGRATION",
  "DELIVERY_MENU_SYNC",
  "DELIVERY_ORDER_IMPORT",
  "DELIVERY_ORDER_RECONCILIATION",
] as const;

describe("billing feature labels", () => {
  it.each(catalogFeatureCodes)("provides a readable Chinese label for %s", (code) => {
    const label = featureLabel(code);

    expect(label).toBe(billingFeatureLabels[code]);
    expect(label).not.toBe(code);
    expect(label).not.toContain("_");
    expect(label).toMatch(/[\u3400-\u9fff]/u);
  });

  it("keeps an unknown technical code visible behind a Chinese warning", () => {
    expect(featureLabel("NEW_PRIVATE_FEATURE")).toBe("未命名功能（NEW_PRIVATE_FEATURE）");
  });
});

describe("billing catalog labels", () => {
  it("uses Chinese names for current and legacy plans", () => {
    expect(planLabel("ENTERPRISE")).toBe("企業方案");
    expect(planLabel("STANDARD")).toBe("標準方案");
  });

  it("uses Chinese names for add-ons that were stored in English", () => {
    expect(addOnLabel("WHITE_LABEL")).toBe("白標品牌服務");
    expect(addOnLabel("API_ACCESS")).toBe("API 存取");
  });

  it("preserves a supplied display name for an unknown future catalog code", () => {
    expect(planLabel("FUTURE_PLAN", "未命名測試方案")).toBe("未命名測試方案");
    expect(addOnLabel("FUTURE_ADD_ON", "未命名測試加購")).toBe("未命名測試加購");
  });
});
