import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getPrismaClient, prisma } from "@/lib/prisma";
import { createPerformanceTiming } from "@/lib/performance-timing";
import { createOrderThroughCircuitB, issueOrderSessionThroughCircuitB } from "@/server/public-order/circuit-b-service";
import { createPublicOrderSchema } from "../../../supabase/functions/_shared/schemas";
import { encryptPlatformValue, hashPlatformSubject } from "./crypto";
import type { LinePlatformRuntime } from "./runtime";

// No intake/abuse/stock/schedule/ownership code is mocked. The existing explicit
// offline Turnstile test-key mode is used; every network call fails this test.
const url=process.env.LINE_PLATFORM_TEST_DATABASE_URL;
if(url){const target=new URL(url);if(!["localhost","127.0.0.1"].includes(target.hostname)||target.port!=="55722"||target.pathname!=="/stallorder_line_miniapp_20260926")throw new Error("INTAKE_TEST_DATABASE_REJECTED");}
const org="11111111-1111-4111-8111-111111111111", profile=randomUUID(), category=randomUUID(), product=randomUUID();
const devices=Array.from({length:6},()=>randomUUID());
const runtime:LinePlatformRuntime={environment:"local",providerId:"1234567",channelId:"1234568",liffId:"1234568-fixture",internalChannel:"developing",endpointUrl:"https://pickup.local.test/mini",oaDestination:`U${"a".repeat(32)}`,oaChannelId:"1234569",oaAccessTokenReference:randomUUID(),oaSecretReference:randomUUID(),termsVersion:"test-v1",notificationsEnabled:false,pickupEnabled:true,payEnabled:false};
describe.skipIf(!url)("original MINI Circuit B intake concurrency",()=>{
  beforeAll(async()=>{
    // Circuit B has an existing local-development entrypoint; its shared flag
    // stays default-off. All intake and abuse gates below that entrypoint run.
    vi.stubEnv("DATABASE_URL",url!);vi.stubEnv("NODE_ENV","development");vi.stubEnv("LINE_PLATFORM_DATA_KEY",Buffer.alloc(32,47).toString("base64"));
    vi.stubEnv("ABUSE_HASH_SECRET",`synthetic-intake-${randomUUID()}`);vi.stubEnv("TOKEN_DERIVATION_SECRET",`synthetic-intake-${randomUUID()}`);
    vi.stubEnv("TURNSTILE_SECRET_KEY","1x0000000000000000000000000000000AA");vi.stubEnv("TURNSTILE_ALLOW_TEST_KEYS","true");vi.stubEnv("APP_ENV","test");
    vi.stubGlobal("fetch",vi.fn(async()=>{throw new Error("PROVIDER_IO_FORBIDDEN");}));
    const [db]=await prisma.$queryRaw<Array<{name:string}>>`select current_database() as name`;expect(db.name).toBe("stallorder_line_miniapp_20260926");
    await prisma.profile.create({data:{id:profile,displayName:"Synthetic concurrent intake"}});
    const identity=await prisma.authIdentity.create({data:{profileId:profile,provider:"LINE",providerSubject:`intake-${randomUUID()}`}});
    const subject=`U${randomUUID().replaceAll("-","")}`;
    await prisma.$executeRaw`insert into public.line_platform_members(profile_id,auth_identity_id,environment,provider_id,subject_hash,subject_ciphertext,terms_version,terms_accepted_at,terms_source,notification_consent)
      values(${profile}::uuid,${identity.id}::uuid,'local',${runtime.providerId},${hashPlatformSubject("local",runtime.providerId,subject)},${encryptPlatformValue(subject)},'test-v1',now(),'MINI_APP',false)`;
    await prisma.productCategory.create({data:{id:category,organizationId:org,name:`Synthetic intake ${category}`}});
    await prisma.product.create({data:{id:product,organizationId:org,categoryId:category,name:`Synthetic stock ${product}`,description:"Fixture only",defaultPrice:60}});
  });
  afterAll(async()=>{if(url)await prisma.$disconnect();vi.unstubAllEnvs();vi.unstubAllGlobals();});
  function context(deviceId:string){const requestId=randomUUID();return {clientIp:`2001:db8:${deviceId.slice(0,4)}:${deviceId.slice(4,8)}::1`,requestId,timing:createPerformanceTiming({route:"/api/mini/orders",requestId,logger:()=>{}}),platformContext:{profileId:profile,runtime}};}
  async function fixture(stock:number){
    const stallId=randomUUID(),qrToken=`synthetic-intake-${randomUUID()}`;
    await prisma.stall.create({data:{id:stallId,organizationId:org,name:"Synthetic intake",slug:`intake-${stallId}`,code:`I${stallId.slice(0,7)}`,address:"Fixture only",location:"Fixture only"}});
    await prisma.stallOrderingSettings.create({data:{stallId,organizationId:org,takeoutPreorderEnabled:true}});
    await prisma.stallBusinessHour.createMany({data:Array.from({length:7},(_,dayOfWeek)=>({organizationId:org,stallId,dayOfWeek,opensAt:"00:00",closesAt:"00:00"}))});
    await prisma.stallProduct.create({data:{organizationId:org,stallId,productId:product,stockRemaining:stock}});
    await prisma.qrCode.create({data:{organizationId:org,stallId,token:qrToken,label:"Synthetic intake",fulfillmentTypeContext:"TAKEOUT"}});
    await prisma.$executeRaw`insert into public.line_platform_stalls(stall_id,environment,enabled,cutover_at) values(${stallId}::uuid,'local',true,now()-interval '1 day')`;
    const [slots]=await prisma.$queryRaw<Array<{slots:string[]}>>`select public.get_takeout_preorder_slots(${stallId}::uuid,now()) as slots`;
    expect(slots.slots.length).toBeGreaterThan(1);return {stallId,qrToken,scheduledPickupAt:new Date(slots.slots[1]).toISOString()};
  }
  async function orderInput(target:Awaited<ReturnType<typeof fixture>>,deviceId:string){
    const session=await issueOrderSessionThroughCircuitB({qrToken:target.qrToken,deviceId,sessionRequestId:randomUUID(),orderingMode:"PREORDER",includeMenu:false},context(deviceId));
    expect(session.status).toBe(201);expect(session.body).toHaveProperty("orderSessionToken");
    if (!("orderSessionToken" in session.body)) throw new Error("ORDER_SESSION_NOT_ISSUED");
    return createPublicOrderSchema.parse({qrToken:target.qrToken,deviceId,orderSessionToken:session.body.orderSessionToken,idempotencyKey:randomUUID(),clientOrderId:randomUUID(),orderingMode:"PREORDER",scheduledPickupAt:target.scheduledPickupAt,customerName:"Synthetic intake",customerPhone:"0900000000",waitAcknowledged:true,items:[{productId:product,quantity:1}],turnstileToken:"XXXX.DUMMY.TOKEN.XXXX"});
  }
  it("two valid sessions competing for the last portion commit one order, owner and stock allocation at the selected pickup time",async()=>{
    const target=await fixture(1);const inputs=await Promise.all(devices.slice(0,2).map(device=>orderInput(target,device)));
    const results=await Promise.allSettled(inputs.map(input=>createOrderThroughCircuitB(input,context(input.deviceId))));
    expect(results.filter(result=>result.status==="fulfilled")).toHaveLength(1);
    const winner=results.findIndex(result=>result.status==="fulfilled"),loser=1-winner;
    const rejected=results[loser] as PromiseRejectedResult;
    const reason=rejected.reason as {code?:string;meta?:{code?:string}};
    expect(reason.code).toBe("PRODUCT_STOCK_INSUFFICIENT");
    const orders=await prisma.order.findMany({where:{stallId:target.stallId},include:{items:true}});expect(orders).toHaveLength(1);
    expect(orders[0].id).toBe(inputs[winner].clientOrderId);expect(orders[0].items).toHaveLength(1);
    expect(orders[0].requestedFulfillmentAt?.toISOString()).toBe(target.scheduledPickupAt);expect(orders[0].scheduledPickupAt?.toISOString()).toBe(target.scheduledPickupAt);
    expect(orders[0].stockAllocations).toMatchObject({[product]:{quantity:1}});
    expect((await prisma.stallProduct.findUniqueOrThrow({where:{stallId_productId:{stallId:target.stallId,productId:product}}})).stockRemaining).toBe(0);
    const owners=await prisma.$queryRaw<Array<{order_id:string;profile_id:string;pickup_required:boolean}>>`select owner.order_id,owner.profile_id,owner.pickup_required from public.line_platform_order_owners owner join public.orders o on o.id=owner.order_id where o.stall_id=${target.stallId}::uuid`;
    expect(owners).toEqual([{order_id:orders[0].id,profile_id:profile,pickup_required:true}]);
    expect(await prisma.order.findUnique({where:{id:inputs[loser].clientOrderId!}})).toBeNull();
    const replay=await createOrderThroughCircuitB(inputs[winner],context(inputs[winner].deviceId));expect(replay.status).toBe(200);
    expect(await prisma.order.count({where:{stallId:target.stallId}})).toBe(1);expect((await prisma.stallProduct.findUniqueOrThrow({where:{stallId_productId:{stallId:target.stallId,productId:product}}})).stockRemaining).toBe(0);expect(fetch).not.toHaveBeenCalled();
  },30_000);
  it("valid sessions cannot reserve stock or bind an owner after preorder is disabled",async()=>{
    const target=await fixture(2);const inputs=await Promise.all(devices.slice(2,4).map(device=>orderInput(target,device)));
    await prisma.stallOrderingSettings.update({where:{stallId:target.stallId},data:{takeoutPreorderEnabled:false}});
    const results=await Promise.allSettled(inputs.map(input=>createOrderThroughCircuitB(input,context(input.deviceId))));
    expect(results.every(result=>result.status==="rejected")).toBe(true);
    for(const result of results)expect((result as PromiseRejectedResult).reason).toMatchObject({code:"PREORDER_DISABLED"});
    expect(await prisma.order.count({where:{stallId:target.stallId}})).toBe(0);
    expect(await prisma.$queryRaw`select order_id from public.line_platform_order_owners where order_id in (${inputs[0].clientOrderId}::uuid,${inputs[1].clientOrderId}::uuid)`).toHaveLength(0);
    expect((await prisma.stallProduct.findUniqueOrThrow({where:{stallId_productId:{stallId:target.stallId,productId:product}}})).stockRemaining).toBe(2);expect(fetch).not.toHaveBeenCalled();
  },30_000);
  it("retries a real 40001 rollback with the original order identity and commits each owner and stock allocation once",async()=>{
    const target=await fixture(2);const inputs=await Promise.all(devices.slice(4,6).map(device=>orderInput(target,device)));
    const originalTransaction=getPrismaClient().$transaction.bind(getPrismaClient());
    const conflicts:string[]=[];const spy=vi.spyOn(getPrismaClient(),"$transaction");
    // A scheduling barrier establishes a real old Serializable snapshot, then
    // lets the other full Circuit B command commit. No database result is mocked.
    spy.mockImplementationOnce((async(operation:(db:Prisma.TransactionClient)=>Promise<unknown>,options:object)=>originalTransaction(async db=>{
      await db.$queryRaw`select id from public.stalls where id=${target.stallId}::uuid`;
      const winner=await createOrderThroughCircuitB(inputs[0],context(inputs[0].deviceId));expect(winner.status).toBe(201);
      try{return await operation(db);}catch(error){if(error instanceof Prisma.PrismaClientKnownRequestError)conflicts.push(String(error.meta?.code??error.code));throw error;}
    },options)) as never);
    try{expect((await createOrderThroughCircuitB(inputs[1],context(inputs[1].deviceId))).status).toBe(201);}finally{spy.mockRestore();}
    expect(conflicts).toEqual(["40001"]);
    const orders=await prisma.order.findMany({where:{stallId:target.stallId}});expect(orders.map(order=>order.id).sort()).toEqual(inputs.map(input=>input.clientOrderId).sort());
    expect(orders.every(order=>(order.stockAllocations as Record<string,{quantity:number}>)[product]?.quantity===1)).toBe(true);
    expect(await prisma.$queryRaw`select owner.order_id from public.line_platform_order_owners owner join public.orders o on o.id=owner.order_id where o.stall_id=${target.stallId}::uuid`).toHaveLength(2);
    expect((await prisma.stallProduct.findUniqueOrThrow({where:{stallId_productId:{stallId:target.stallId,productId:product}}})).stockRemaining).toBe(0);expect(fetch).not.toHaveBeenCalled();
  },30_000);
});
