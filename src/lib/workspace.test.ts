import { describe, expect, it } from "vitest";
import { getDefaultWorkspacePath, type WorkspaceOrganization } from "@/lib/workspace";

const organizationId = "11111111-1111-4111-8111-111111111111";

function workspace(
  overrides: Partial<WorkspaceOrganization> = {},
): WorkspaceOrganization {
  return {
    id: organizationId,
    name: "Demo Organization",
    businessName: "示範商家",
    slug: "demo-organization",
    status: "ACTIVE",
    defaultCurrency: "TWD",
    operatingMode: "SINGLE_STALL",
    merchantSetupState: "COMPLETED",
    merchantSetupStallId: "22222222-2222-4222-8222-222222222222",
    roles: ["ORGANIZATION_OWNER"],
    canUseAllStalls: true,
    stalls: [{
      id: "22222222-2222-4222-8222-222222222222",
      organizationId,
      name: "阿明鹽酥雞",
      slug: "aming-chicken",
      code: "AMING",
      businessStatus: "OPEN",
      orderingEnabled: true,
      kdsEnabled: false,
      isActive: true,
      roles: ["ORGANIZATION_OWNER"],
    }],
    ...overrides,
  };
}

describe("default workspace navigation", () => {
  it("keeps onboarding and organization selection ahead of merchant defaults", () => {
    expect(getDefaultWorkspacePath([])).toBe("/onboarding");
    expect(getDefaultWorkspacePath([
      workspace(),
      workspace({ id: "99999999-9999-4999-8999-999999999999" }),
    ])).toBe("/select-organization");
  });

  it("opens the operating overview after the first activation is complete", () => {
    expect(getDefaultWorkspacePath([workspace()]))
      .toBe(`/merchant/dashboard?organizationId=${organizationId}`);
  });

  it("keeps an unfinished merchant in stall setup instead of the daily overview", () => {
    expect(getDefaultWorkspacePath([workspace({ merchantSetupState: "IN_PROGRESS" })]))
      .toBe(`/merchant/stalls?organizationId=${organizationId}`);
  });

  it("treats an established legacy workspace without setup progress as operational", () => {
    expect(getDefaultWorkspacePath([workspace({ merchantSetupState: null })]))
      .toBe(`/merchant/dashboard?organizationId=${organizationId}`);
  });

  it("does not redirect staff and kitchen roles into merchant reports", () => {
    const stall = workspace().stalls[0];
    expect(getDefaultWorkspacePath([workspace({
      roles: [],
      canUseAllStalls: false,
      merchantSetupState: null,
      stalls: [{ ...stall, roles: ["STAFF"] }],
    })])).toBe("/staff/aming-chicken");
    expect(getDefaultWorkspacePath([workspace({
      roles: [],
      canUseAllStalls: false,
      merchantSetupState: null,
      stalls: [{ ...stall, roles: ["KITCHEN"] }],
    })])).toBe("/kitchen?stall=aming-chicken");
  });

  it("opens the operating overview for a finance viewer with report access", () => {
    const stall = workspace().stalls[0];
    expect(getDefaultWorkspacePath([workspace({
      roles: [],
      canUseAllStalls: false,
      stalls: [{ ...stall, roles: ["FINANCE_VIEWER"] }],
    })])).toBe(`/merchant/dashboard?organizationId=${organizationId}`);
  });
});
