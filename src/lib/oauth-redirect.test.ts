import { describe, expect, it } from "vitest";
import { resolveOAuthDestination } from "./oauth-redirect";

const staffWorkspace = [{
  roles: [],
  stalls: [{ slug: "night-market", roles: ["STAFF" as const] }],
}];

const ownerWorkspace = [{
  roles: ["ORGANIZATION_OWNER" as const],
  stalls: [{ slug: "night-market", roles: ["ORGANIZATION_OWNER" as const] }],
}];

describe("OAuth 登入後導向", () => {
  it("拒絕角色無權限的內部 next 路徑", () => {
    expect(resolveOAuthDestination("/admin/billing", "/staff/night-market", null, staffWorkspace))
      .toBe("/staff/night-market");
    expect(resolveOAuthDestination("/merchant/reports/overview", "/staff/night-market", null, staffWorkspace))
      .toBe("/staff/night-market");
  });

  it("預設根路徑不會覆蓋後端解析出的角色首頁", () => {
    expect(resolveOAuthDestination("/", "/merchant/dashboard?organizationId=org-1", null, ownerWorkspace))
      .toBe("/merchant/dashboard?organizationId=org-1");
  });

  it("只允許店員前往已指派的攤位", () => {
    expect(resolveOAuthDestination("/staff/night-market", "/", null, staffWorkspace))
      .toBe("/staff/night-market");
    expect(resolveOAuthDestination("/staff/other-stall", "/staff/night-market", null, staffWorkspace))
      .toBe("/staff/night-market");
  });

  it("允許商戶角色前往商戶工作區", () => {
    expect(resolveOAuthDestination("/merchant/reports/overview", "/", null, ownerWorkspace))
      .toBe("/merchant/reports/overview");
  });

  it("允許保留工作區選擇頁的查詢參數", () => {
    expect(resolveOAuthDestination("/select-stall?organization=org-1", "/", null, ownerWorkspace))
      .toBe("/select-stall?organization=org-1");
  });

  it("保留一次性邀請的登入回跳", () => {
    const token = "a".repeat(43);
    expect(resolveOAuthDestination(`/invite/${token}`, "/onboarding", null, []))
      .toBe(`/invite/${token}`);
  });

  it("無成員使用者不能藉 next 進入受保護路徑", () => {
    expect(resolveOAuthDestination("/merchant/dashboard", "/onboarding?oauth=1", null, []))
      .toBe("/onboarding?oauth=1");
  });

  it("平台管理員可進入管理後台，但不能導向任意路徑", () => {
    expect(resolveOAuthDestination("/admin/billing", "/", "PLATFORM_ADMIN", ownerWorkspace))
      .toBe("/admin/billing");
    expect(resolveOAuthDestination("/admin", "/admin", "PLATFORM_ADMIN", []))
      .toBe("/admin");
    expect(resolveOAuthDestination("/api/private", "/admin", "PLATFORM_ADMIN", ownerWorkspace))
      .toBe("/admin");
  });
});
