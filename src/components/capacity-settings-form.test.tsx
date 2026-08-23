import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CapacitySettingsForm } from "@/components/capacity-settings-form";
import { LocaleProvider } from "@/components/locale-provider";
import type { CapacityManagerData } from "@/lib/capacity-contract";

const initialData: CapacityManagerData = {
  settings: {
    windowMinutes: 30,
    maxOrdersPerWindow: 30,
    maxItemsPerWindow: 100,
    warningUtilizationPercent: 75,
    pauseUtilizationPercent: 100,
    defaultPrepMinutes: 10,
    minimumQuoteMinutes: 5,
    maximumQuoteMinutes: 60,
    quoteBufferMinutes: 5,
    acknowledgmentThresholdMinutes: 30,
    manualWaitMinutes: null,
    autoPauseEnabled: true,
    autoResumeEnabled: true,
    pauseSource: "NONE",
    isActive: true,
  },
  snapshot: {
    quoteMinMinutes: 10,
    quoteMaxMinutes: 15,
    acknowledgmentThresholdMinutes: 30,
    requiresAcknowledgment: false,
    utilizationPercent: 20,
    orderCount: 2,
    itemCount: 4,
    requestedItemCount: 0,
    weightedLoad: 4,
    requestedWeight: 0,
    effectiveThroughputPerMinute: 1,
    activeStationCount: 1,
    warningUtilizationPercent: 75,
    pauseUtilizationPercent: 100,
    productLimitExceeded: false,
    pauseSource: "NONE",
    autoPauseEnabled: true,
    autoResumeEnabled: true,
    acceptingPublicOrders: true,
    windowStart: null,
    windowEnd: null,
  },
  capabilities: {
    waitTimeQuote: true,
    automaticControl: true,
    productRules: false,
    maxProductRules: null,
  },
  products: [],
  rules: [],
  events: [],
};

describe("CapacitySettingsForm", () => {
  it("shows every settings section without collapsible summaries", () => {
    const html = renderToStaticMarkup(
      <LocaleProvider initialLocale="zh-TW" hasLocaleCookie>
        <CapacitySettingsForm stallId="11111111-1111-4111-8111-111111111111" initialData={initialData} />
      </LocaleProvider>,
    );

    expect(html).not.toContain("<details");
    expect(html).not.toContain("<summary");
    expect(html).toContain("等候時間與容量門檻");
    expect(html).toContain("最近容量事件");
  });
});
