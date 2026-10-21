import {beforeEach,describe,expect,it,vi} from "vitest";
const h=vi.hoisted(()=>({find:vi.fn(),revoke:vi.fn(),invalidate:vi.fn()}));
vi.mock("@/lib/prisma",()=>({prisma:{authSession:{findUnique:h.find}}}));
vi.mock("@/lib/auth",async()=>({...await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth"),revokeSessionToken:h.revoke}));
vi.mock("@/server/analytics/product-analytics",()=>({productAnalytics:{invalidate:h.invalidate}}));
import {POST} from "@/app/api/mobile/v1/auth/logout/route";
const device="11111111-1111-4111-8111-111111111111",actor="22222222-2222-4222-8222-222222222222",token="a".repeat(43);
beforeEach(()=>{vi.clearAllMocks();h.find.mockResolvedValue({profileId:actor,deviceId:device,clientKind:"NATIVE"});h.revoke.mockResolvedValue(true);});
const request=()=>new Request("http://localhost/api/mobile/v1/auth/logout",{method:"POST",headers:{authorization:`Bearer ${token}`,"x-stallorder-device-id":device}});
describe("Native logout optional analytics cleanup",()=>{
 it("resolves the existing token/device/NATIVE actor and invalidates only after original revoke succeeds",async()=>{expect((await POST(request())).status).toBe(200);expect(h.revoke).toHaveBeenCalledWith(token,"MOBILE_LOGOUT","NATIVE",device);expect(h.invalidate).toHaveBeenCalledWith(actor);expect(h.revoke.mock.invocationCallOrder[0]).toBeLessThan(h.invalidate.mock.invocationCallOrder[0]);});
 it("never invalidates when original revoke fails",async()=>{h.revoke.mockResolvedValue(false);expect((await POST(request())).status).toBe(401);expect(h.invalidate).not.toHaveBeenCalled();});
 it.each([{profileId:actor,deviceId:"33333333-3333-4333-8333-333333333333",clientKind:"NATIVE"},{profileId:actor,deviceId:device,clientKind:"WEB"}])("cannot use a foreign device or Web family as analytics identity",async row=>{h.find.mockResolvedValue(row);h.revoke.mockResolvedValue(false);expect((await POST(request())).status).toBe(401);expect(h.invalidate).not.toHaveBeenCalled();});
 it("optional lookup failure cannot prevent original logout",async()=>{h.find.mockRejectedValue(Error("lookup unavailable"));expect((await POST(request())).status).toBe(200);expect(h.revoke).toHaveBeenCalledTimes(1);expect(h.invalidate).not.toHaveBeenCalled();});
});
