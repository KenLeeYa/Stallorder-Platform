import { describe, expect, it } from "vitest";
import {
  canStartMerchantReapplication,
  canTransitionMerchantApplication,
} from "./application-state";

describe("merchant application state machine", () => {
  it("allows applicant submission and resubmission", () => {
    expect(canTransitionMerchantApplication("DRAFT", "SUBMITTED", "APPLICANT")).toBe(true);
    expect(canTransitionMerchantApplication("NEEDS_INFO", "SUBMITTED", "APPLICANT")).toBe(true);
  });

  it("keeps approval exclusive to platform review", () => {
    expect(canTransitionMerchantApplication("PENDING_REVIEW", "APPROVED", "APPLICANT")).toBe(false);
    expect(canTransitionMerchantApplication("PENDING_REVIEW", "APPROVED", "PLATFORM_ADMIN")).toBe(true);
  });

  it("keeps terminal states terminal", () => {
    for (const status of ["APPROVED", "REJECTED", "WITHDRAWN", "EXPIRED"] as const) {
      expect(canTransitionMerchantApplication(status, "PENDING_REVIEW", "PLATFORM_ADMIN")).toBe(false);
    }
  });

  it("starts a new application instead of reopening a terminal application", () => {
    expect(canStartMerchantReapplication("WITHDRAWN", false)).toBe(true);
    expect(canStartMerchantReapplication("REJECTED", true)).toBe(true);
    expect(canStartMerchantReapplication("REJECTED", false)).toBe(false);
    expect(canStartMerchantReapplication("APPROVED", true)).toBe(false);
    expect(canStartMerchantReapplication("EXPIRED", true)).toBe(false);
  });
});
