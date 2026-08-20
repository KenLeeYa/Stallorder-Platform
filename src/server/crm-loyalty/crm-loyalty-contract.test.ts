import { describe, expect, it } from "vitest";
import {
  crmConsentOptInSchema,
  loyaltyPointsEventSchema,
} from "./crm-loyalty-contract";

describe("CRM and loyalty trusted input contracts", () => {
  it("requires explicit opt-in and a verified opaque contact reference", () => {
    expect(crmConsentOptInSchema.safeParse({
      organizationId: "11111111-1111-4111-8111-111111111111",
      stallId: "22222222-2222-4222-8222-222222222222",
      contactIdentifierHash: "a".repeat(64),
      contactReference: "vault://contact/verified-1",
      contactType: "PHONE",
      contactVerifiedAt: "2026-08-13T00:00:00.000Z",
      purposeCode: "MARKETING_EMAIL",
      noticeVersion: "v1",
      consentSource: "QR_CHECKOUT",
      lawfulBasis: "CONSENT",
      decision: "DECLINED",
    }).success).toBe(false);
  });

  it("accepts immutable event amounts supplied by the originating event", () => {
    expect(loyaltyPointsEventSchema.parse({
      organizationId: "11111111-1111-4111-8111-111111111111",
      stallId: "22222222-2222-4222-8222-222222222222",
      accountId: "33333333-3333-4333-8333-333333333333",
      entryType: "REVERSE",
      pointsDelta: -25,
      orderId: "44444444-4444-4444-8444-444444444444",
      sourceEventType: "ORDER_REFUNDED",
      sourceEventId: "refund:44444444-4444-4444-8444-444444444444:v1",
      reversalOfLedgerId: "55555555-5555-4555-8555-555555555555",
    }).pointsDelta).toBe(-25);
  });
});
