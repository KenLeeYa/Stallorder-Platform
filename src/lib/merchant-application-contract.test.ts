import { describe, expect, it } from "vitest";
import { merchantApplicationCommandSchema } from "./merchant-application-contract";

const completeApplication = {
  phone: "0912345678",
  lineId: null,
  preferredContactMethod: "PHONE",
  merchantName: "測試商家",
  businessType: "NIGHT_MARKET_STALL",
  businessRegistrationNumber: null,
  contactName: "測試負責人",
  businessPhone: "0912345678",
  businessAddress: "台北市測試路 1 號",
  city: "臺北市",
  merchantDescription: null,
  stallName: "測試攤位",
  stallLocation: "測試夜市",
  requestedSlug: "test-stall",
  estimatedDailyOrders: 30,
  expectedStartDate: null,
  needsMultipleStaff: false,
  needsKitchenView: true,
  requestedPlanCode: "TRIAL",
  termsAccepted: true,
  privacyAccepted: true,
  dataProcessingAccepted: true,
  informationConfirmed: true,
} as const;

describe("merchant application contract", () => {
  it("allows a partial draft without creating merchant resources", () => {
    expect(merchantApplicationCommandSchema.safeParse({
      intent: "SAVE_DRAFT",
      currentStep: 1,
      data: { preferredContactMethod: "PHONE" },
    }).success).toBe(true);
  });

  it("requires every legal consent before submission", () => {
    expect(merchantApplicationCommandSchema.safeParse({
      intent: "SUBMIT",
      currentStep: 4,
      data: { ...completeApplication, termsAccepted: false },
    }).success).toBe(false);
  });

  it.each(["Invalid Slug", "-test-stall", "test-stall-"])("enforces the public identifier format: %s", (requestedSlug) => {
    expect(merchantApplicationCommandSchema.safeParse({
      intent: "SUBMIT",
      currentStep: 4,
      data: { ...completeApplication, requestedSlug },
    }).success).toBe(false);
  });
});
