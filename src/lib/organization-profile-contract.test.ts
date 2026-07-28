import { describe, expect, it } from "vitest";
import { updateOrganizationProfileSchema } from "./organization-profile-contract";

describe("organization profile contract", () => {
  it("接受商家資料並正規化電子郵件", () => {
    expect(updateOrganizationProfileSchema.parse({
      businessName: "阿宏河粉",
      email: "OWNER@EXAMPLE.COM",
      phone: "0916-166-504",
    })).toEqual({
      businessName: "阿宏河粉",
      email: "owner@example.com",
      phone: "0916-166-504",
    });
  });

  it("拒絕額外欄位避免 mass assignment", () => {
    expect(updateOrganizationProfileSchema.safeParse({
      businessName: "阿宏河粉",
      email: "owner@example.com",
      phone: "0916166504",
      status: "ACTIVE",
    }).success).toBe(false);
  });

  it("拒絕不符合型態的聯絡資料", () => {
    expect(updateOrganizationProfileSchema.safeParse({
      businessName: "阿宏河粉",
      email: "not-an-email",
      phone: "<script>",
    }).success).toBe(false);
  });
});
