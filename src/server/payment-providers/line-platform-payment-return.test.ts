import {beforeEach,describe,it,expect,vi} from "vitest";
const mocks=vi.hoisted(()=>({resolve:vi.fn(),recover:vi.fn()}));
vi.mock("@/lib/rate-limit",()=>({checkRateLimit:async()=>({allowed:true})}));
vi.mock("@/lib/security",()=>({hashClientIp:()=>"fixture-ip-hash"}));
vi.mock("./line-platform-payment-workflow",()=>({platformPaymentWorkflow:()=>({resolveReturn:mocks.resolve,recover:mocks.recover})}));
import {handlePaymentReturn} from "./line-platform-payment-return";
import {PaymentProviderError} from "./types";
describe("LINE Pay browser return",()=>{
  beforeEach(()=>{vi.clearAllMocks();mocks.resolve.mockResolvedValue({id:"attempt",orderId:"owned-order"});mocks.recover.mockResolvedValue({state:"SUCCEEDED"});});
  it("redirects to a clean protected order URL, without treating callback as an order-data session",async()=>{
    const response=await handlePaymentReturn(new Request("https://qa.example.test/api/payments/line-pay/return?state=secret&transactionId=2026092201234567891&orderId=merchant-order"),false);
    expect(response.status).toBe(303);expect(response.headers.get("location")).toBe("/mini/orders/owned-order");expect(await response.text()).toBe("");expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(mocks.recover).toHaveBeenCalledWith("attempt",true);
  });
  it("a cancel redirect cannot confirm or mark a payment cancelled",async()=>{
    await handlePaymentReturn(new Request("https://qa.example.test/api/payments/line-pay/cancel?state=secret"),true);
    expect(mocks.recover).toHaveBeenCalledWith("attempt",false);
  });
  it("rejects mismatched callbacks before any provider call and redacts errors",async()=>{
    mocks.resolve.mockRejectedValueOnce(new PaymentProviderError("LINE_PAY_RETURN_INVALID",400));
    const response=await handlePaymentReturn(new Request("https://qa.example.test/api/payments/line-pay/return?state=secret"),false);
    expect(response.status).toBe(400);expect(mocks.recover).not.toHaveBeenCalled();expect(await response.text()).not.toContain("secret");
  });
});
