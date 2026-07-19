import { describe, expect, it } from "vitest";
import { classifyMerchantApplicationRisk } from "./application-risk";

describe("merchant application risk rules", () => {
  it("keeps complete unique applications low risk", () => {
    expect(classifyMerchantApplicationRisk([])).toEqual({ level: "LOW", reasons: [] });
  });

  it("flags duplicate contact data for manual review", () => {
    expect(classifyMerchantApplicationRisk(["DUPLICATE_PHONE"]).level).toBe("MEDIUM");
    expect(classifyMerchantApplicationRisk(["DUPLICATE_REGISTRATION_NUMBER"]).level).toBe("HIGH");
  });

  it("blocks high-frequency or matched security events", () => {
    expect(classifyMerchantApplicationRisk(["HIGH_APPLICATION_RATE"]).level).toBe("BLOCKED");
    expect(classifyMerchantApplicationRisk(["SECURITY_EVENT_MATCH"]).level).toBe("BLOCKED");
  });
});
