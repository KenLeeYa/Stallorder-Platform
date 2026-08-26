import { describe, expect, it } from "vitest";
import {
  integrationSetupCatalog,
  normalizeIntegrationStatus,
  resolveBestConnectionStatus,
} from "@/server/integrations/setup-center";

describe("integration setup center", () => {
  it("lists all manually configured integration families from the Master Prompt", () => {
    expect(integrationSetupCatalog.map((entry) => entry.code)).toEqual(expect.arrayContaining([
      "AUTHENTICATION",
      "LINE_LOGIN",
      "LINE_OFFICIAL_ACCOUNT",
      "LINE_MESSAGING",
      "LINE_PAY",
      "JKO_PAY",
      "PX_PAY_PLUS",
      "TAIWAN_PAY",
      "CREDIT_CARD_PROVIDER",
      "E_INVOICE",
      "FOODPANDA",
      "UBER_EATS",
      "LOGISTICS",
      "ERP_ACCOUNTING",
      "OUTBOUND_WEBHOOK",
      "PUBLIC_API_KEYS",
      "PRINTING",
    ]));
  });

  it("normalizes existing provider states without overstating readiness", () => {
    expect(normalizeIntegrationStatus("ACTIVE")).toBe("CONFIGURED");
    expect(normalizeIntegrationStatus("READY")).toBe("SANDBOX_READY");
    expect(normalizeIntegrationStatus("PRODUCTION_VERIFIED")).toBe("PRODUCTION_READY");
    expect(normalizeIntegrationStatus("ERROR")).toBe("ERROR");
    expect(normalizeIntegrationStatus("unknown-provider-state")).toBe("NOT_CONFIGURED");
  });

  it("selects the most useful safe status across multiple connections", () => {
    expect(resolveBestConnectionStatus(["DISABLED", "ACTIVE"])).toBe("CONFIGURED");
    expect(resolveBestConnectionStatus(["ERROR", "DEGRADED"])).toBe("DEGRADED");
    expect(resolveBestConnectionStatus([])).toBe("NOT_CONFIGURED");
  });
});
