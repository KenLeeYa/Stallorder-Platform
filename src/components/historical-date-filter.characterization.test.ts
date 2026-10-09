import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveReportReadScope } from "@/lib/report-scope";
import type { WorkspaceOrganization, WorkspaceStall } from "@/lib/workspace";

vi.mock("@/lib/workspace", () => ({ requireWorkspaceOrganization: vi.fn(), requireWorkspacePage: vi.fn() }));

function workspace() {
  const stall: WorkspaceStall = { id: "allowed", organizationId: "org", name: "Allowed", slug: "allowed", code: "A", businessStatus: "OPEN", orderingEnabled: true, isActive: true, kdsEnabled: true, roles: ["ORGANIZATION_OWNER"] };
  return { id: "org", name: "Org", businessName: "Org", slug: "org", status: "ACTIVE", defaultCurrency: "TWD", operatingMode: "MULTI_STALL", merchantSetupState: "COMPLETED", merchantSetupStallId: null, roles: ["ORGANIZATION_OWNER"], canUseAllStalls: true,
    stalls: [stall, { ...stall, id: "inactive", isActive: false }, { ...stall, id: "revoked", roles: ["STAFF"] }] } satisfies WorkspaceOrganization;
}

afterEach(() => vi.useRealTimers());

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("bounded historical data filters", () => {
  it("defaults cross-stall reports and operational records to today", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-30T16:01:00Z"));
    const scope = resolveReportReadScope(workspace(), []);
    expect([scope.dateFrom, scope.dateTo]).toEqual(["2026-10-01", "2026-10-01"]);
    expect(scope.stalls.map((stall) => stall.id)).toEqual(["allowed"]);
    const operationsPage = source("src/app/merchant/operations/page.tsx");
    expect(operationsPage).toContain("const dateFrom = single(params.dateFrom) ?? today;");
    expect(operationsPage).toContain("const dateTo = single(params.dateTo) ?? today;");
    expect(operationsPage).toContain("dashboardDateRange(dateFrom, dateTo)");
  });

  it("preserves explicit bounded dates and rejects invalid or unauthorized report scopes", () => {
    const scope = resolveReportReadScope(workspace(), ["allowed"], "2026-09-01", "2026-09-30");
    expect([scope.dateFrom, scope.dateTo]).toEqual(["2026-09-01", "2026-09-30"]);
    for (const ids of [["foreign"], ["inactive"], ["revoked"], ["allowed", "allowed"]]) {
      expect(() => resolveReportReadScope(workspace(), ids, "2026-09-01", "2026-09-30")).toThrow("OPERATIONS_NOT_FOUND");
    }
    for (const [from, to] of [["2026-02-30", "2026-03-01"], ["2026-10-02", "2026-10-01"], ["2026-01-01", "2026-10-01"]]) {
      expect(() => resolveReportReadScope(workspace(), ["allowed"], from, to)).toThrow("OPERATIONS_INVALID_DATES");
    }
  });

  it("keeps the operations dates visible while reports retain the full shared preset set", () => {
    const consoleSource = source("src/components/operations-console.tsx");
    expect(consoleSource).toContain('applyPreset(preset: "day" | "week" | "month")');
    expect(consoleSource).not.toContain('inferOperationsDatePreset');
    expect(consoleSource).toContain('name="dateFrom"');
    expect(consoleSource).toContain('name="dateTo"');

    const reportSource = source("src/components/report-navigation.tsx");
    expect(reportSource).toContain('["TODAY", "YESTERDAY", "WEEK", "MONTH", "CUSTOM"]');
  });
});
