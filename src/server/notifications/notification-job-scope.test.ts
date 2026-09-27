import { beforeEach,describe,expect,it,vi } from "vitest";
const database=vi.hoisted(()=>({$executeRaw:vi.fn(),$queryRaw:vi.fn(),notificationJob:{updateMany:vi.fn(),findUnique:vi.fn(),update:vi.fn()}}));
const secret=vi.hoisted(()=>vi.fn());
vi.mock("@/lib/prisma",()=>({prisma:database}));
vi.mock("./notification-secrets",()=>({readNotificationSecret:secret}));
import {processDueNotificationJobs} from "./notification-job-processor";
beforeEach(()=>{vi.clearAllMocks();database.$executeRaw.mockResolvedValue(0);database.notificationJob.updateMany.mockResolvedValue({count:1});database.notificationJob.update.mockResolvedValue({});});
describe("legacy notification isolation after platform cutover",()=>{
  it("cancels a legacy job if the order acquired a platform owner after candidate selection",async()=>{
    database.$queryRaw.mockResolvedValueOnce([{id:"legacy-job",status:"PENDING"}]).mockResolvedValueOnce([{order_id:"11111111-1111-4111-8111-111111111111"}]);
    database.notificationJob.findUnique.mockResolvedValue({id:"legacy-job",orderId:"11111111-1111-4111-8111-111111111111",status:"PROCESSING"});
    expect(await processDueNotificationJobs()).toEqual([{jobId:"legacy-job",status:"CANCELLED"}]);
    expect(secret).not.toHaveBeenCalled();
    expect(database.notificationJob.update).toHaveBeenCalledWith({where:{id:"legacy-job"},data:{status:"CANCELLED",nextAttemptAt:null,lastErrorCode:"PLATFORM_ORDER_LEGACY_BLOCKED"}});
  });
});
