import {beforeEach,describe,it,expect,vi} from "vitest";
const mocks=vi.hoisted(()=>({authorize:vi.fn(),csrf:vi.fn(),view:vi.fn(),refund:vi.fn(),recover:vi.fn(),list:vi.fn()}));
vi.mock("@/lib/authorization",()=>({authorizeStallManagementApiRequest:mocks.authorize}));
vi.mock("@/lib/csrf",()=>({validateCsrf:mocks.csrf}));
vi.mock("@/lib/rate-limit",()=>({checkRateLimit:vi.fn(async()=>({allowed:true}))}));
vi.mock("@/server/payment-providers/line-platform-payment-repository",()=>({platformPaymentRepository:{view:mocks.view,listMerchant:mocks.list}}));
vi.mock("@/server/payment-providers/line-platform-payment-config",()=>({paymentRuntime:()=>({environment:"local"})}));
vi.mock("@/server/payment-providers/line-platform-payment-workflow",()=>({platformPaymentWorkflow:()=>({refund:mocks.refund,recover:mocks.recover})}));
import {POST,GET} from "./route";
const attemptId="00000000-0000-4000-8000-000000000001";const stallId="00000000-0000-4000-8000-000000000002";
const request=(extra={})=>new Request("https://qa.example.test/api/merchant/payment-integrations/operations",{method:"POST",headers:{"content-type":"application/json","x-idempotency-key":"00000000-0000-4000-8000-000000000003"},body:JSON.stringify({action:"REFUND",attemptId,stallId,reason:"Customer refund",...extra})});
describe("merchant LINE Pay operations authorization",()=>{
  beforeEach(()=>{vi.clearAllMocks();mocks.authorize.mockResolvedValue({ok:true,principal:{user:{id:"operator"}},workspace:{id:"org-a"}});mocks.csrf.mockReturnValue(true);mocks.view.mockResolvedValue({id:attemptId,stallId,organizationId:"org-a"});mocks.refund.mockResolvedValue({state:"SUCCEEDED"});});
  it("honors existing manager permissions and CSRF before attempting a refund",async()=>{
    mocks.authorize.mockResolvedValueOnce({ok:false,response:new Response(null,{status:403})});expect((await POST(request())).status).toBe(403);
    mocks.csrf.mockReturnValueOnce(false);expect((await POST(request())).status).toBe(403);
    expect(mocks.refund).not.toHaveBeenCalled();
    expect(mocks.authorize).toHaveBeenCalledWith(expect.any(Request),stallId,"MANAGE_PAYMENT_INTEGRATIONS");
  });
  it("rejects another store's attempt without invoking provider recovery or refund",async()=>{
    mocks.view.mockResolvedValueOnce({id:attemptId,stallId:"another-stall",organizationId:"org-a"});expect((await POST(request())).status).toBe(404);expect(mocks.refund).not.toHaveBeenCalled();
  });
  it("defaults full refund calculation to the server and rejects client success injection",async()=>{
    expect((await POST(request({refundStatus:"SUCCEEDED"}))).status).toBe(400);
    expect((await POST(request())).status).toBe(200);
    expect(mocks.refund).toHaveBeenCalledWith({attemptId,stallId,actorProfileId:"operator",amount:undefined,reason:"Customer refund",idempotencyKey:"00000000-0000-4000-8000-000000000003"});
  });
  it("lists only the authorized organization, exact stall and runtime environment",async()=>{
    mocks.list.mockResolvedValue([]);const response=await GET(new Request(`https://qa.test/api/merchant/payment-integrations/operations?stallId=${stallId}&organizationId=untrusted`));
    expect(response.status).toBe(200);expect(mocks.list).toHaveBeenCalledWith("org-a",stallId,"local");
    mocks.authorize.mockResolvedValueOnce({ok:false,response:new Response(null,{status:403})});expect((await GET(new Request(`https://qa.test/api/merchant/payment-integrations/operations?stallId=${stallId}`))).status).toBe(403);
    expect(mocks.list).toHaveBeenCalledTimes(1);
  });
});
