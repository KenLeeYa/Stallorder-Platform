import {randomUUID,createHash} from "node:crypto";
import {afterAll,beforeAll,describe,it,expect,vi} from "vitest";
import {prisma} from "@/lib/prisma";
import {applyKitchenTaskUpdate,completeKitchenOrder} from "@/lib/kitchen";
import {bindPlatformOrderNotifications} from "./notification-binding";
import {encryptPlatformValue,hashPlatformSubject} from "./crypto";
import type {LinePlatformRuntime} from "./runtime";
import {PATCH as patchOrder} from "@/app/api/stalls/[stallSlug]/orders/[orderId]/route";
import {PATCH as patchItem} from "@/app/api/stalls/[stallSlug]/orders/[orderId]/items/[itemId]/route";
import {PATCH as amendOrder} from "@/app/api/stalls/[stallSlug]/orders/[orderId]/content/route";

// Only the authenticated identity boundary is synthetic. CSRF, routes, core commands,
// transaction fencing, database triggers, and resulting records are real.
const auth=vi.hoisted(()=>({authorize:vi.fn()}));
vi.mock("@/lib/authorization",()=>({authorizeApiRequest:auth.authorize}));

const url=process.env.LINE_PLATFORM_TEST_DATABASE_URL;
if(url){const target=new URL(url);if(!["localhost","127.0.0.1"].includes(target.hostname)||target.port!=="55722"||target.pathname!=="/stallorder_line_miniapp_20260926")throw new Error("FULFILLMENT_TEST_DATABASE_REJECTED");}
const org="11111111-1111-4111-8111-111111111111",stall=randomUUID(),profile=randomUUID();
const subject=`U${randomUUID().replaceAll("-","")}`;const digest=(value:string)=>createHash("sha256").update(value).digest("hex");
const csrf=randomUUID(),base="https://fulfillment.local.test";
const runtime:LinePlatformRuntime={environment:"local",providerId:"1234567",channelId:"1234568",liffId:"1234568-fixture",internalChannel:"developing",endpointUrl:"https://pickup.local.test/mini",oaDestination:`U${"a".repeat(32)}`,oaChannelId:"1234569",oaAccessTokenReference:randomUUID(),oaSecretReference:randomUUID(),termsVersion:"test-v1",notificationsEnabled:false,pickupEnabled:false,payEnabled:false};
describe.skipIf(!url)("actual KDS commands atomically create platform READY events",()=>{
  beforeAll(async()=>{
    vi.stubEnv("DATABASE_URL",url!);vi.stubEnv("NODE_ENV","test");vi.stubEnv("LINE_PLATFORM_DATA_KEY",Buffer.alloc(32,47).toString("base64"));vi.stubEnv("APP_BASE_URL",base);
    vi.stubGlobal("fetch",vi.fn(async()=>{throw new Error("PROVIDER_IO_FORBIDDEN");}));
    const [db]=await prisma.$queryRaw<Array<{name:string}>>`select current_database() as name`;expect(db.name).toBe("stallorder_line_miniapp_20260926");
    const sender=await prisma.$queryRaw`select id from public.notification_integrations where sender_scope='PLATFORM_OA' and environment='local' and provider_id=${runtime.providerId} and oa_destination=${runtime.oaDestination} and status='ACTIVE'`;
    expect(sender).toHaveLength(1); // Reuse the existing synthetic sender; never rotate its tokens.
    await prisma.profile.create({data:{id:profile,displayName:"Synthetic fulfillment operator/customer"}});
    const identity=await prisma.authIdentity.create({data:{profileId:profile,provider:"LINE",providerSubject:`fulfillment-${randomUUID()}`}});
    await prisma.$executeRaw`insert into public.line_platform_members(profile_id,auth_identity_id,environment,provider_id,subject_hash,subject_ciphertext,terms_version,terms_accepted_at,terms_source,notification_consent)
      values(${profile}::uuid,${identity.id}::uuid,'local',${runtime.providerId},${hashPlatformSubject("local",runtime.providerId,subject)},${encryptPlatformValue(subject)},'test-v1',now(),'MINI_APP',false)`;
    await prisma.stall.create({data:{id:stall,organizationId:org,name:"Synthetic fulfillment",slug:`fulfillment-${stall}`,code:`F${stall.slice(0,7)}`,address:"Fixture only",location:"Fixture only"}});
    await prisma.stallOrderingSettings.create({data:{stallId:stall,organizationId:org,kdsModuleEnabled:true}});
    await prisma.stallMembership.create({data:{organizationId:org,stallId:stall,profileId:profile,role:"KITCHEN"}});
    auth.authorize.mockResolvedValue({ok:true,requestId:randomUUID(),principal:{user:{id:profile},csrfTokenHash:digest(csrf)},stall:{id:stall,organizationId:org},role:"STAFF",roles:["STAFF"]});
    await prisma.$executeRaw`insert into public.line_platform_stalls(stall_id,environment,enabled,cutover_at) values(${stall}::uuid,'local',true,now()-interval '1 day')`;
  });
  afterAll(async()=>{if(url)await prisma.$disconnect();vi.unstubAllEnvs();vi.unstubAllGlobals();});
  async function fixture(){
    const id=randomUUID();
    await prisma.$transaction(async db=>{
      await db.order.create({data:{id,organizationId:org,stallId:stall,orderNo:`FE-${id.slice(0,12)}`,trackingTokenHash:digest(randomUUID()),idempotencyKey:randomUUID(),customerName:"Synthetic fulfillment",deviceHash:digest(randomUUID()),source:"QR_MENU",origin:"ONLINE_QR",isTest:false,fulfillmentType:"TAKEOUT",status:"WAITING_CONFIRMATION",paymentStatus:"UNPAID",subtotal:130,total:130,confirmationExpiresAt:new Date(Date.now()+3600_000)}});
      await db.orderItem.createMany({data:[{id:randomUUID(),organizationId:org,stallId:stall,orderId:id,productId:"44444444-4444-4444-8444-444444444441",name:"Synthetic food",baseUnitPrice:95,unitPrice:95,quantity:1},{id:randomUUID(),organizationId:org,stallId:stall,orderId:id,productId:"44444444-4444-4444-8444-444444444444",name:"Synthetic drink",baseUnitPrice:35,unitPrice:35,quantity:1}]});
      await db.$executeRaw`insert into public.line_platform_order_owners(order_id,profile_id,environment,provider_id,subject_hash) values(${id}::uuid,${profile}::uuid,'local',${runtime.providerId},${hashPlatformSubject("local",runtime.providerId,subject)})`;
      await bindPlatformOrderNotifications(id,runtime,db);
      await db.order.update({where:{id},data:{status:"CONFIRMED",confirmedAt:new Date()}});
    });return id;
  }
  async function readyJobs(orderId:string){return prisma.$queryRaw<Array<{id:string;outcome:string}>>`select id,outcome from public.notification_jobs where order_id=${orderId}::uuid and delivery_mode='PLATFORM_OA' and template_code='ORDER_READY'`;}
  function request(status:string){return new Request(`${base}/api/stalls/fixture/orders/fixture`,{method:"PATCH",headers:{"content-type":"application/json",origin:base,"x-csrf-token":csrf,cookie:`stallorder_csrf=${csrf}`},body:JSON.stringify({status})});}
  function context(orderId:string){return {params:Promise.resolve({stallSlug:`fulfillment-${stall}`,orderId})};}
  it("partial item completion stays preparing, then concurrent whole-order commands produce one READY event without billing or duplicate work",async()=>{
    const orderId=await fixture();const task=await prisma.orderProductionTask.findFirstOrThrow({where:{orderId},orderBy:{id:"asc"}});
    const input={organizationId:org,stallId:stall,actorProfileId:profile};
    await applyKitchenTaskUpdate({...input,taskId:task.id,status:"PREPARING"});
    await applyKitchenTaskUpdate({...input,taskId:task.id,status:"COMPLETED"});
    expect((await prisma.order.findUniqueOrThrow({where:{id:orderId}})).status).toBe("PREPARING");expect(await readyJobs(orderId)).toHaveLength(0);
    const results=await Promise.allSettled([completeKitchenOrder({...input,orderId}),completeKitchenOrder({...input,orderId})]);
    expect(results.filter(result=>result.status==="fulfilled")).toHaveLength(1);
    const rejected=results.find(result=>result.status==="rejected") as PromiseRejectedResult;
    if(rejected.reason.code==="P2010")expect(rejected.reason.meta?.code).toBe("40001");
    else expect(["P2034","ORDER_NOT_ACTIVE"]).toContain(rejected.reason.code);
    const order=await prisma.order.findUniqueOrThrow({where:{id:orderId},include:{items:true,productionTasks:true}});
    expect(order.status).toBe("READY");expect(order.items.every(item=>item.status==="READY")).toBe(true);expect(order.productionTasks.every(task=>task.status==="COMPLETED")).toBe(true);
    expect(await readyJobs(orderId)).toEqual([expect.objectContaining({outcome:"SUPPRESSED"})]);
    expect(await prisma.orderEvent.count({where:{orderId,eventType:"PRODUCTION_ORDER_COMPLETED"}})).toBe(1);
    await expect(completeKitchenOrder({...input,orderId})).rejects.toMatchObject({code:"ORDER_NOT_ACTIVE"});
    expect(await readyJobs(orderId)).toHaveLength(1);expect(await prisma.usageEvent.count({where:{referenceId:orderId,eventType:"BILLABLE_ORDER_COMPLETED"}})).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("non-KDS staff READY API atomically enqueues once across concurrent requests and lost-response retry",async()=>{
    await prisma.stallOrderingSettings.update({where:{stallId:stall},data:{kdsModuleEnabled:false}});
    const orderId=await fixture();expect(await prisma.orderProductionTask.count({where:{orderId}})).toBe(0);
    const responses=await Promise.all([patchOrder(request("READY"),context(orderId)),patchOrder(request("READY"),context(orderId))]);
    expect(responses.map(response=>response.status).sort()).toEqual([200,409]);
    const order=await prisma.order.findUniqueOrThrow({where:{id:orderId},include:{items:true}});
    expect(order.status).toBe("READY");expect(order.items.every(item=>item.status==="READY")).toBe(true);
    expect(await readyJobs(orderId)).toHaveLength(1);expect(await prisma.orderEvent.count({where:{orderId,eventType:"STAFF_STATUS_CHANGED",newStatus:"READY"}})).toBe(1);
    expect((await patchOrder(request("READY"),context(orderId))).status).toBe(409);
    expect(await readyJobs(orderId)).toHaveLength(1);expect(await prisma.printJob.count({where:{orderId}})).toBe(0);
    expect(await prisma.usageEvent.count({where:{referenceId:orderId,eventType:"BILLABLE_ORDER_COMPLETED"}})).toBe(0);expect(fetch).not.toHaveBeenCalled();
  });
  it("staff item API preserves PACKING until every active item is ready",async()=>{
    const orderId=await fixture();const items=await prisma.orderItem.findMany({where:{orderId},orderBy:{id:"asc"}});
    expect((await patchOrder(request("PACKING"),context(orderId))).status).toBe(200);
    const itemContext=(itemId:string)=>({params:Promise.resolve({stallSlug:`fulfillment-${stall}`,orderId,itemId})});
    for(const status of ["PREPARING","READY"])expect((await patchItem(request(status),itemContext(items[0].id))).status).toBe(200);
    expect((await prisma.order.findUniqueOrThrow({where:{id:orderId}})).status).toBe("PACKING");expect(await readyJobs(orderId)).toHaveLength(0);
    expect((await patchItem(request("PREPARING"),itemContext(items[1].id))).status).toBe(200);
    expect(await readyJobs(orderId)).toHaveLength(0);
    expect((await patchItem(request("READY"),itemContext(items[1].id))).status).toBe(200);
    expect((await prisma.order.findUniqueOrThrow({where:{id:orderId}})).status).toBe("READY");expect(await readyJobs(orderId)).toHaveLength(1);
    expect((await patchItem(request("READY"),itemContext(items[1].id))).status).toBe(409);expect(await readyJobs(orderId)).toHaveLength(1);expect(fetch).not.toHaveBeenCalled();
  });
  it("original sold-out amendment removes a pending item without prematurely making the remaining item READY",async()=>{
    await prisma.stallOrderingSettings.update({where:{stallId:stall},data:{kdsModuleEnabled:false}});
    const orderId=await fixture();const order=await prisma.order.findUniqueOrThrow({where:{id:orderId},include:{items:true}});
    const retained=order.items[0],removed=order.items[1];
    const body={changeId:randomUUID(),expectedUpdatedAt:order.updatedAt.toISOString(),items:[{kind:"EXISTING",itemId:retained.id,quantity:1}],publicAmendment:{reason:"SOLD_OUT_REMOVE",customerMessage:"此品項已售完，為您取消並保留其餘餐點。"}};
    const amendmentRequest=()=>new Request(`${base}/api/stalls/fixture/orders/${orderId}/content`,{method:"PATCH",headers:{"content-type":"application/json",origin:base,"x-csrf-token":csrf,cookie:`stallorder_csrf=${csrf}`},body:JSON.stringify(body)});
    const response=await amendOrder(amendmentRequest(),context(orderId));
    expect({status:response.status,body:await response.json()}).toMatchObject({status:200});
    const adjusted=await prisma.order.findUniqueOrThrow({where:{id:orderId},include:{items:true}});
    expect(adjusted.status).toBe("CONFIRMED");expect(adjusted.items.map(item=>item.id)).toEqual([retained.id]);expect(adjusted.total).toBe(retained.unitPrice);expect(await prisma.orderItem.findUnique({where:{id:removed.id}})).toBeNull();
    expect(await readyJobs(orderId)).toHaveLength(0);
    expect((await amendOrder(amendmentRequest(),context(orderId))).status).toBe(200);
    expect(await prisma.orderEvent.count({where:{orderId,eventType:"PUBLIC_ORDER_ITEMS_ADJUSTED"}})).toBe(1);expect(await readyJobs(orderId)).toHaveLength(0);
    const itemContext={params:Promise.resolve({stallSlug:`fulfillment-${stall}`,orderId,itemId:retained.id})};
    expect((await patchItem(request("PREPARING"),itemContext)).status).toBe(200);expect(await readyJobs(orderId)).toHaveLength(0);
    expect((await patchItem(request("READY"),itemContext)).status).toBe(200);
    expect((await prisma.order.findUniqueOrThrow({where:{id:orderId}})).status).toBe("READY");expect(await readyJobs(orderId)).toHaveLength(1);
    expect(await prisma.usageEvent.count({where:{referenceId:orderId,eventType:"BILLABLE_ORDER_COMPLETED"}})).toBe(0);expect(fetch).not.toHaveBeenCalled();
  });
});
