import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HealthDashboard } from "./health-dashboard";
import { buildDrOperatorReadiness } from "@/server/resilience/dr-operator-readiness";

describe("Chinese health dashboard", () => {
  it("distinguishes unverified probes from passing checks", () => {
    const html = renderToStaticMarkup(<HealthDashboard kind="primary" snapshot={{
      status: "HEALTHY", checkedAt: "2026-09-16T00:00:00Z", dependencies: [
        { key: "primaryDatabase", status: "HEALTHY", checkedAt: "", latencyMs: 23, reasonCode: null },
        { key: "turnstile", status: "UNKNOWN", checkedAt: "", latencyMs: null, reasonCode: "EDGE_MANAGED" },
      ],
    }} />);
    expect(html).toContain("部分尚待驗證");
    expect(html).toContain("目前資料庫");
    expect(html).toContain("點餐安全驗證");
    expect(html).toContain("待驗證");
    expect(html).not.toContain("EDGE_MANAGED");
    expect(html).not.toContain("HEALTHY");
  });
  it("shows all DR fields using Chinese labels and false as disabled", () => {
    const readiness = buildDrOperatorReadiness({
      BACKEND_ACTIVE_TARGET: "DR", AUTH_PROJECT_CODE: "DR", PROMOTION_EPOCH: "1",
      DR_SUPABASE_PROJECT_REF: "abcdefghijklmnopqrst",
      NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
      NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL: "https://abcdefghijklmnopqrst.supabase.co/functions/v1",
    }, { backendCode: "DR", backendRole: "READ_ONLY_STANDBY", promotionEpoch: 1, writesEnabled: false, enforcementEnabled: true });
    const html = renderToStaticMarkup(<HealthDashboard kind="dr" readiness={readiness} />);
    for (const label of ["唯讀待命", "寫入防護", "網站切換版本", "資料庫切換版本", "登入環境", "資料庫寫入", "已關閉", "備援專案識別碼"]) expect(html).toContain(label);
    expect(html).not.toContain("READ_ONLY_STANDBY");
    expect(html).not.toContain("writesEnabled");
  });
  it("does not present failed or absent evidence as readiness", () => {
    const html = renderToStaticMarkup(<HealthDashboard kind="dr" readiness={null} />);
    expect(html).toContain("目前無法完成檢查");
    expect(html).not.toContain("備援環境已就緒");
  });
  it("keeps disabled providers separate from failures", () => {
    const html = renderToStaticMarkup(<HealthDashboard kind="primary" snapshot={{
      status: "HEALTHY", checkedAt: "2026-09-16T00:00:00Z", dependencies: [
        { key: "application", status: "HEALTHY", checkedAt: "", latencyMs: null, reasonCode: null },
        { key: "linePay", status: "MAINTENANCE", checkedAt: "", latencyMs: null, reasonCode: "PROVIDER_MAINTENANCE" },
      ],
    }} />);
    expect(html).toContain("已檢查項目正常");
    expect(html).toContain("另有 1 項停用或維護中");
    expect(html).not.toContain("有項目需要處理");
  });
});
