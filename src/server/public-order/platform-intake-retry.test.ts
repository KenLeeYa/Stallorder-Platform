import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LinePlatformRuntime } from "@/server/line-platform/runtime";
const mocks=vi.hoisted(()=>({transaction:vi.fn(),query:vi.fn(),bind:vi.fn()}));
vi.mock("@/lib/prisma",()=>({prisma:{$transaction:mocks.transaction,$queryRaw:mocks.query}}));
vi.mock("@/server/line-platform/member-service",()=>({bindPlatformOrderOwner:mocks.bind}));
import { createPublicOrderWithSchedule } from "./trusted-rpc-repository";
const input:Parameters<typeof createPublicOrderWithSchedule>[0]={orderingMode:"PREORDER",orderId:"11111111-1111-4111-8111-111111111111",qrToken:"synthetic-qr",sessionTokenHash:"synthetic-session",deviceHash:"synthetic-device",ipHash:"synthetic-ip",qrTokenHash:"synthetic-qr-hash",behaviorHash:"synthetic-behavior",idempotencyKey:"22222222-2222-4222-8222-222222222222",idempotencyHash:"synthetic-key",customerName:"Synthetic",customerPhone:"0900000000",deliveryAddress:"",customerNote:"",items:[],trackingTokenHash:"synthetic-tracking",pickupCodeHash:"synthetic-pickup",requestId:"synthetic-request",waitAcknowledged:true,scheduledPickupAt:null,lotteryDrawId:null,platformContext:{profileId:"33333333-3333-4333-8333-333333333333",runtime:{environment:"local"} as LinePlatformRuntime}};
const conflict=()=>new Prisma.PrismaClientKnownRequestError("safe fixture serialization conflict",{code:"P2010",clientVersion:"fixture",meta:{code:"40001"}});
describe("platform intake transaction retries",()=>{
  beforeEach(()=>{vi.resetAllMocks();mocks.transaction.mockImplementation(async(callback:(db:unknown)=>unknown)=>callback({$queryRaw:mocks.query}));mocks.query.mockResolvedValue([{result:{ok:true,order:{order_id:input.orderId}}}]);});
  it("retries two rolled-back serialization conflicts using the identical SQL identity and binds only after success",async()=>{
    mocks.query.mockRejectedValueOnce(conflict()).mockRejectedValueOnce(conflict());
    expect(await createPublicOrderWithSchedule(input)).toMatchObject({ok:true});
    expect(mocks.transaction).toHaveBeenCalledTimes(3);expect(mocks.bind).toHaveBeenCalledTimes(1);
    expect(mocks.query.mock.calls[1][0]).toBe(mocks.query.mock.calls[0][0]);expect(mocks.query.mock.calls[2][0]).toBe(mocks.query.mock.calls[0][0]);
    expect(mocks.query.mock.calls[0][0].values).toEqual(expect.arrayContaining([input.orderId,input.sessionTokenHash,input.idempotencyKey]));
  });
  it("returns a recoverable conflict after three failed transactions without owner binding",async()=>{
    mocks.query.mockRejectedValue(conflict());
    expect(await createPublicOrderWithSchedule(input)).toEqual({ok:false,code:"ORDER_CONFLICT"});
    expect(mocks.transaction).toHaveBeenCalledTimes(3);expect(mocks.bind).not.toHaveBeenCalled();
  });
  it("never retries failed owner authorization",async()=>{
    const error=new Error("LINE_PLATFORM_MEMBERSHIP_REQUIRED");mocks.bind.mockRejectedValue(error);
    await expect(createPublicOrderWithSchedule(input)).rejects.toBe(error);expect(mocks.transaction).toHaveBeenCalledTimes(1);
  });
});
