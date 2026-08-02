import { describe, expect, it } from "vitest";
import {
  getStallMembershipConflictFieldErrors,
  getStallMembershipFieldErrors,
  stallMembershipSchema,
} from "@/lib/stall-membership-contract";

describe("stall membership field errors", () => {
  it("returns separate Traditional Chinese errors for email and role", () => {
    const result = stallMembershipSchema.safeParse({ email: "不是信箱", role: "OWNER" });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(getStallMembershipFieldErrors(result.error)).toEqual({
      email: "請輸入有效的 Email 格式。",
      role: "請選擇有效的攤位角色。",
    });
  });

  it("maps a duplicate membership role to the editable role field", () => {
    expect(getStallMembershipConflictFieldErrors()).toEqual({
      role: "此成員已具有相同角色。",
    });
  });
});
