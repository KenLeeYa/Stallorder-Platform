import { describe, expect, it } from "vitest";
import { inboxReturnPath } from "./notification-inbox-return";
describe("inbox scope return", () => {
  it("returns to the same organization, stall or application instead of another workspace", () => {
    expect(inboxReturnPath({ kind: "ORGANIZATION", organizationId: "organization-b" })).toBe("/merchant/dashboard?organizationId=organization-b");
    expect(inboxReturnPath({ kind: "STALL", stallSlug: "store-b" })).toBe("/staff/store-b");
    expect(inboxReturnPath({ kind: "ADMIN_APPLICATION", applicationId: "case-b" })).toBe("/admin/merchant-applications/case-b");
    expect(inboxReturnPath({ kind: "PERSONAL" })).toBe("/onboarding/status");
  });
});
