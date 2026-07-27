import { describe, expect, it } from "vitest";
import { buildWorkModeDestinations, currentWorkModeValue, type WorkModeWorkspace } from "./work-mode";

function workspace(
  organizationRoles: WorkModeWorkspace["roles"],
  stallRoles: WorkModeWorkspace["stalls"][number]["roles"],
): WorkModeWorkspace {
  return {
    id: "organization-1",
    businessName: "測試商家",
    roles: organizationRoles,
    stalls: [{
      id: "stall-1",
      name: "測試攤位",
      slug: "test-stall",
      isActive: true,
      roles: stallRoles,
    }],
  };
}

describe("同帳號多工作模式", () => {
  it("組織擁有者可進入商家、店員與廚房模式", () => {
    const destinations = buildWorkModeDestinations([
      workspace(["ORGANIZATION_OWNER"], ["ORGANIZATION_OWNER"]),
    ]);

    expect(destinations.map((destination) => destination.value)).toEqual([
      "merchant:organization-1",
      "staff:stall-1",
      "kitchen:stall-1",
    ]);
  });

  it("純店員帳號不會取得商家或廚房入口", () => {
    const destinations = buildWorkModeDestinations([
      workspace([], ["STAFF"]),
    ]);

    expect(destinations.map((destination) => destination.value)).toEqual(["staff:stall-1"]);
  });

  it("純廚房帳號不會取得商家或店員入口", () => {
    const destinations = buildWorkModeDestinations([
      workspace([], ["KITCHEN"]),
    ]);

    expect(destinations.map((destination) => destination.value)).toEqual(["kitchen:stall-1"]);
  });

  it("停用攤位不提供任何現場工作入口", () => {
    const source = workspace(["ORGANIZATION_OWNER"], ["ORGANIZATION_OWNER"]);
    const destinations = buildWorkModeDestinations([{
      ...source,
      stalls: source.stalls.map((stall) => ({ ...stall, isActive: false })),
    }]);

    expect(destinations.map((destination) => destination.value)).toEqual([
      "merchant:organization-1",
    ]);
  });

  it("正確解析目前工作模式選項", () => {
    expect(currentWorkModeValue("MERCHANT", "organization-1")).toBe("merchant:organization-1");
    expect(currentWorkModeValue("STAFF", "organization-1", "stall-1")).toBe("staff:stall-1");
    expect(currentWorkModeValue("KITCHEN", "organization-1", "stall-1")).toBe("kitchen:stall-1");
  });
});
