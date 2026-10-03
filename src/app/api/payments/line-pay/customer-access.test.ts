import {beforeEach,describe,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({principal:vi.fn(),owner:vi.fn(),query:vi.fn(),view:vi.fn(),recover:vi.fn()}));
vi.mock("@/lib/auth",()=>({getRequestPrincipal:mocks.principal}));
vi.mock("@/lib/csrf",()=>({validateCsrf:()=>true}));
vi.mock("@/lib/rate-limit",()=>({checkRateLimit:async()=>({allowed:true})}));
vi.mock("@/lib/prisma",()=>({prisma:{$queryRaw:mocks.query}}));
vi.mock("@/server/line-platform/member-service",()=>({requirePlatformOrderOwner:mocks.owner}));
vi.mock("@/server/payment-providers/line-platform-payment-config",()=>({paymentRuntime:()=>({environment:"local"})}));
vi.mock("@/server/payment-providers/line-platform-payment-repository",()=>({platformPaymentRepository:{view:mocks.view}}));
vi.mock("@/server/payment-providers/line-platform-payment-workflow",()=>({platformPaymentWorkflow:()=>({recover:mocks.recover}),publicPaymentView:(value:unknown)=>value}));
import {GET as orderStatus} from "./order/[orderId]/route";
import {GET as attemptStatus,POST as recoverAttempt} from "./[attemptId]/route";
const id="00000000-0000-4000-8000-000000000001",attemptId="00000000-0000-4000-8000-000000000002";
const request=new Request("https://qa.example.test/api/payments/line-pay/fixture");
describe("customer payment endpoints require a current platform identity",()=>{
  beforeEach(()=>{vi.clearAllMocks();mocks.principal.mockResolvedValue({user:{id:"profile-a"}});mocks.owner.mockResolvedValue({});mocks.query.mockResolvedValue([{order_id:id,transaction_id:attemptId}]);mocks.view.mockResolvedValue({state:"UNKNOWN"});mocks.recover.mockResolvedValue({state:"UNKNOWN"});});
  it("denies an invalid current owner before exposing attempts or requesting provider recovery",async()=>{
    mocks.owner.mockRejectedValue(new Error("LINE_PLATFORM_ORDER_NOT_FOUND"));
    expect((await orderStatus(request,{params:Promise.resolve({orderId:id})})).status).toBe(404);
    expect((await attemptStatus(request,{params:Promise.resolve({attemptId})})).status).toBe(404);
    expect((await recoverAttempt(request,{params:Promise.resolve({attemptId})})).status).toBe(404);
    expect(mocks.view).not.toHaveBeenCalled();expect(mocks.recover).not.toHaveBeenCalled();
  });
  it("lets an active owner query and recover an existing attempt",async()=>{
    expect((await orderStatus(request,{params:Promise.resolve({orderId:id})})).status).toBe(200);
    expect((await attemptStatus(request,{params:Promise.resolve({attemptId})})).status).toBe(200);
    expect((await recoverAttempt(request,{params:Promise.resolve({attemptId})})).status).toBe(200);
    expect(mocks.owner).toHaveBeenCalledWith(expect.objectContaining({user:{id:"profile-a"}}),id);
    expect(mocks.recover).toHaveBeenCalledWith(attemptId,true);
  });
});
