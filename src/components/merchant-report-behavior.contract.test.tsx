import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LocaleProvider } from "@/components/locale-provider";
import { ReportFilters } from "@/components/report-navigation";

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const reportNavigation = source("./report-navigation.tsx");
const reportMessages = source("../lib/messages/reports.ts");
const merchantMessages = source("../lib/messages/merchant.ts");
const merchantHeader = source("./merchant-workspace-header.tsx");
const operatingProfitPage = source("../app/merchant/operating-profit/page.tsx");
const operatingProfitDashboard = source("./operating-profit-dashboard.tsx");
const reportPages = [
  "overview",
  "orders",
  "stalls",
  "products",
  "payments",
  "cash-shifts",
].map((page) => source(`../app/merchant/reports/${page}/page.tsx`));

describe("merchant report behavior contract", () => {
  it("renames the merchant entry and report eyebrow to stall reports", () => {
    expect(merchantHeader).toContain('m("攤位報表")');
    expect(merchantHeader).not.toContain('m("跨攤位報表")');
    expect(merchantMessages).toContain('"攤位報表":');
    expect(reportMessages).toContain('"reports.eyebrow": ["攤位報表"');
  });

  it("shows stall scope only for multi-stall organizations on every report page", () => {
    expect(reportNavigation).toContain("multiStallMode: boolean");
    expect(reportNavigation).toContain("{multiStallMode ? <fieldset");
    for (const page of reportPages) {
      expect(page).toContain('multiStallMode={scope.workspace.operatingMode === "MULTI_STALL"}');
    }

    const props = {
      organizationId: "organization-1",
      stalls: [{ id: "stall-1", name: "測試攤位" }],
      selectedStallIds: ["stall-1"],
      dateFrom: "2026-08-30",
      dateTo: "2026-08-30",
    };
    const render = (multiStallMode: boolean) => renderToStaticMarkup(
      <LocaleProvider initialLocale="zh-TW" hasLocaleCookie>
        <ReportFilters {...props} multiStallMode={multiStallMode} />
      </LocaleProvider>,
    );
    expect(render(false)).not.toContain("<fieldset");
    expect(render(true)).toContain("<fieldset");
  });

  it("reuses the stall report day, week, and month query controls for operating profit", () => {
    expect(reportNavigation).toContain('applyPreset(preset: "day" | "week" | "month")');
    expect(operatingProfitPage).toContain('multiStallMode={workspace.operatingMode === "MULTI_STALL"}');
    expect(operatingProfitDashboard).toContain("<ReportFilters");
    expect(operatingProfitDashboard).toContain("showExport={false}");
  });

  it("keeps long operating-profit data panels collapsible", () => {
    for (const testId of [
      "operating-profit-pnl",
      "operating-profit-cash-flow",
      "operating-profit-expense-categories",
      "operating-profit-daily-sales",
      "operating-profit-product-margins",
    ]) {
      expect(operatingProfitDashboard).toContain(`testId="${testId}"`);
    }
    expect(operatingProfitDashboard).toContain("<CollapsiblePanel");
  });
});
