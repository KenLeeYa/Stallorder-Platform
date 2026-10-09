import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({ runtime:vi.fn(), query:vi.fn(), principal:vi.fn(), member:vi.fn(), redirect:vi.fn() }));
vi.mock("@/server/line-platform/runtime",()=>({getLinePlatformRuntime:mocks.runtime}));
vi.mock("@/lib/prisma",()=>({prisma:{$queryRaw:mocks.query}}));
vi.mock("@/lib/auth",()=>({getPagePrincipal:mocks.principal}));
vi.mock("@/server/line-platform/member-service",()=>({getPlatformMember:mocks.member}));
vi.mock("next/headers",()=>({cookies:async()=>({get:()=>undefined})}));
vi.mock("next/navigation",()=>({redirect:mocks.redirect}));
vi.mock("@/components/public-order-tracker",()=>({PublicOrderTracker:()=>null}));
import Page from "./page";
describe("optional LINE membership cannot break original guest tracking",()=>{
  beforeEach(()=>{vi.resetAllMocks();mocks.redirect.mockImplementation(()=>{throw new Error("NEXT_REDIRECT");});});
  it("routes the signed-in platform owner to their private order after the original checkout",async()=>{
    mocks.runtime.mockReturnValue({environment:"preview"});
    mocks.principal.mockResolvedValue({user:{id:"member-a"}});
    mocks.member.mockResolvedValue({profile_id:"member-a",environment:"preview",provider_id:"123",subject_hash:"owner-hash"});
    mocks.query.mockResolvedValue([{id:"order-a"}]);
    await expect(Page({params:Promise.resolve({trackingToken:`sto_${"a".repeat(43)}`})})).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.redirect).toHaveBeenCalledWith("/mini/orders/order-a");
    expect(mocks.query.mock.calls[0].slice(1)).toEqual([expect.stringMatching(/^[0-9a-f]{64}$/),"member-a","preview","123","owner-hash"]);
  });
  it("does not redirect another member's tracking token into a private order",async()=>{
    mocks.runtime.mockReturnValue({environment:"preview"});
    mocks.member.mockResolvedValue({profile_id:"member-b",environment:"preview",provider_id:"123",subject_hash:"other-hash"});
    mocks.query.mockResolvedValue([]);
    const page=await Page({params:Promise.resolve({trackingToken:`sto_${"a".repeat(43)}`})});
    expect(mocks.redirect).not.toHaveBeenCalled();expect(page.props.platformClaim).toBeUndefined();
  });
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
