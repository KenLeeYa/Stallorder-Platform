import { beforeEach,describe,expect,it,vi } from "vitest";
const deps=vi.hoisted(()=>({ admin:vi.fn(),merchant:vi.fn(),csrf:vi.fn(),query:vi.fn(),retry:vi.fn(),runtime:vi.fn() }));
vi.mock("@/lib/authorization",()=>({authorizePlatformAdminApiRequest:deps.admin,authorizeStallManagementApiRequest:deps.merchant}));
vi.mock("@/lib/csrf",()=>({validateCsrf:deps.csrf}));
vi.mock("@/lib/prisma",()=>({prisma:{$queryRaw:deps.query}}));
vi.mock("./notification-worker",()=>({retryPlatformNotification:deps.retry}));
vi.mock("./runtime",()=>({getLinePlatformRuntime:deps.runtime}));
import * as admin from "@/app/api/admin/line-platform/notifications/route";
import * as merchant from "@/app/api/merchant/stalls/[stallId]/notifications/route";
const jobId="11111111-1111-4111-8111-111111111111",stallId="22222222-2222-4222-8222-222222222222";
const actor="33333333-3333-4333-8333-333333333333",organizationId="44444444-4444-4444-8444-444444444444";
const context={params:Promise.resolve({stallId})};
const request=(body:unknown)=>new Request("https://local.test/api/notifications",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
beforeEach(()=>{
  vi.clearAllMocks();
  const authorization={ok:true,principal:{user:{id:actor}},workspace:{id:organizationId},requestId:"synthetic-request"};
  deps.admin.mockResolvedValue(authorization);deps.merchant.mockResolvedValue(authorization);deps.csrf.mockReturnValue(true);
  deps.runtime.mockReturnValue({environment:"local",notificationsEnabled:true});deps.retry.mockResolvedValue({queued:true});deps.query.mockResolvedValue([]);
});
describe("platform notification operations HTTP authorization boundary",()=>{
  it("rejects anonymous/non-admin reads before accessing notifications",async()=>{
    deps.admin.mockResolvedValue({ok:false,response:new Response(null,{status:403})});
    expect((await admin.GET(new Request("https://local.test/api/notifications"))).status).toBe(403);expect(deps.query).not.toHaveBeenCalled();
  });
  it("requires merchant membership before returning any notification data",async()=>{
    deps.merchant.mockResolvedValue({ok:false,response:new Response(null,{status:403})});
    expect((await merchant.GET(new Request("https://local.test/api/notifications"),context)).status).toBe(403);expect(deps.query).not.toHaveBeenCalled();
  });
  it("rejects mutation without CSRF",async()=>{
    deps.csrf.mockReturnValue(false);
    expect((await merchant.POST(request({jobId,reason:"已修復"}),context)).status).toBe(403);expect(deps.retry).not.toHaveBeenCalled();
  });
  it.each(["to","sender","templateCode","stallId"])("rejects merchant injected %s",async key=>{
    expect((await merchant.POST(request({jobId,reason:"已修復",[key]:"attacker-input"}),context)).status).toBe(400);expect(deps.retry).not.toHaveBeenCalled();
  });
  it("binds retry to the authorized store path and actor",async()=>{
    expect((await merchant.POST(request({jobId,reason:"已修復"}),context)).status).toBe(200);
    expect(deps.merchant).toHaveBeenCalledWith(expect.any(Request),stallId,"MANAGE_LINE_INTEGRATION");
    expect(deps.retry).toHaveBeenCalledWith(jobId,stallId,"已修復",actor,"synthetic-request");
  });
  it("does not turn an ineligible or cross-store retry into success",async()=>{
    deps.retry.mockRejectedValue(new Error("NOTIFICATION_RETRY_NOT_ALLOWED"));
    expect((await admin.POST(request({operation:"RETRY",jobId,stallId,reason:"已修復"}))).status).toBe(409);
  });
});
