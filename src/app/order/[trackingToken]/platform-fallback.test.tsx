import { describe, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({ runtime:vi.fn(), query:vi.fn() }));
vi.mock("@/server/line-platform/runtime",()=>({getLinePlatformRuntime:mocks.runtime}));
vi.mock("@/lib/prisma",()=>({prisma:{$queryRaw:mocks.query}}));
vi.mock("@/lib/auth",()=>({getPagePrincipal:vi.fn()}));
vi.mock("@/server/line-platform/member-service",()=>({getPlatformMember:vi.fn()}));
vi.mock("@/components/public-order-tracker",()=>({PublicOrderTracker:()=>null}));
import Page from "./page";
describe("optional LINE membership cannot break original guest tracking",()=>{
  it("keeps the tracker when platform deployment config is invalid",async()=>{
    mocks.runtime.mockImplementation(()=>{throw new Error("BAD_CONFIG");});
    const page=await Page({params:Promise.resolve({trackingToken:"synthetic-tracker"})});
    expect(page.props).toMatchObject({trackingToken:"synthetic-tracker",platformClaim:undefined});
  });
  it("keeps the tracker when the optional pilot eligibility query fails",async()=>{
    mocks.runtime.mockReturnValue({environment:"local"});mocks.query.mockRejectedValue(new Error("OPTIONAL_QUERY_UNAVAILABLE"));
    const page=await Page({params:Promise.resolve({trackingToken:"synthetic-tracker"})});
    expect(page.props.platformClaim).toBeUndefined();
    expect(page.props.trackingToken).toBe("synthetic-tracker");
  });
});
