import { describe, expect, it } from "vitest";
import { inboxQuerySchema, inboxPreferenceCommandSchema, inboxPreferencesSchema, inboxScopeSchema, inboxTargetPath } from "./notification-inbox-contract";

describe("personal Inbox public contract", () => {
  it("rejects actor authority and unbounded queries", () => {
    expect(inboxScopeSchema.safeParse({ kind: "PERSONAL", profileId: "other" }).success).toBe(false);
    expect(inboxQuerySchema.safeParse({ scope: { kind: "PERSONAL" }, limit: 51 }).success).toBe(false);
    expect(inboxQuerySchema.safeParse({ scope: { kind: "PERSONAL" }, from: "yesterday" }).success).toBe(false);
    expect(inboxQuerySchema.parse({ scope: { kind: "PERSONAL" } }).limit).toBe(20);
  });
  it("requires CAS and separates visibility from analytics consent", () => {
    expect(inboxPreferenceCommandSchema.safeParse({ version: 1 }).success).toBe(false);
    expect(inboxPreferenceCommandSchema.safeParse({ billingVisible: false }).success).toBe(false);
    expect(inboxPreferenceCommandSchema.safeParse({ version: 1, profileId: "other", billingVisible: false }).success).toBe(false);
    expect(inboxPreferencesSchema.parse({ version: 1, billingVisible: true, applicationVisible: true, staffOrderVisible: true, analyticsConsent: false }).analyticsConsent).toBe(false);
  });
  it("maps only typed destinations without arbitrary URLs", () => {
    expect(inboxTargetPath({ kind: "STAFF_BOARD", stallSlug: "safe-stall" })).toBe("/staff/safe-stall");
    expect(inboxTargetPath({ kind: "APPLICATION_STATUS" })).toBe("/onboarding/status");
  });
});
