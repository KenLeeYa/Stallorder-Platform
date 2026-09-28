import {afterEach,describe,it,expect,vi} from "vitest";
const mocks=vi.hoisted(()=>({process:vi.fn().mockResolvedValue([])}));
vi.mock("@/server/payment-providers/line-platform-payment-worker",()=>({processPlatformPaymentRecovery:mocks.process}));
import {GET} from "./route";
afterEach(()=>{vi.unstubAllEnvs();vi.clearAllMocks();});
describe("payment recovery cron authorization",()=>{
  it("requires the existing configured cron secret before any work",async()=>{
    vi.stubEnv("CRON_SECRET","");expect((await GET(new Request("https://qa.test/api/cron/line-pay-recovery"))).status).toBe(503);
    vi.stubEnv("CRON_SECRET","synthetic-cron-secret");expect((await GET(new Request("https://qa.test/api/cron/line-pay-recovery"))).status).toBe(401);expect(mocks.process).not.toHaveBeenCalled();
  });
  it("runs the bounded worker only with exact authorization",async()=>{
    vi.stubEnv("CRON_SECRET","synthetic-cron-secret");const response=await GET(new Request("https://qa.test/api/cron/line-pay-recovery",{headers:{authorization:"Bearer synthetic-cron-secret"}}));
    expect(response.status).toBe(200);expect(response.headers.get("cache-control")).toBe("no-store");expect(await response.json()).toEqual({processed:0,results:[]});expect(mocks.process).toHaveBeenCalledOnce();
  });
});
