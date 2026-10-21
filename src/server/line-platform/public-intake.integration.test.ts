import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { createSession, SESSION_COOKIE } from "@/lib/auth";
import { SESSION_DEVICE_COOKIE } from "@/lib/security";
import { POST as sessionRoute } from "@/app/api/public/order-session/route";
import { POST as orderRoute } from "@/app/api/public/orders/route";
import { encryptPlatformValue, hashPlatformSubject } from "./crypto";
import { ensurePlatformNotificationIntegration } from "./notification-binding";
import { getLinePlatformRuntime } from "./runtime";
const url=process.env.LINE_PLATFORM_TEST_DATABASE_URL;
if(url){const target=new URL(url);if(!["localhost","127.0.0.1"].includes(target.hostname)||target.port!=="55722"||target.pathname!=="/stallorder_line_miniapp_20260926")throw new Error("PUBLIC_MEMBER_INTAKE_DATABASE_REJECTED");}
const org="11111111-1111-4111-8111-111111111111",profiles=[randomUUID(),randomUUID()],category=randomUUID(),product=randomUUID(),origin="https://public-member.local.test";
const binding={environment:"local",providerId:"1234567",channelId:"1234568",liffId:"1234568-fixture",internalChannel:"developing",endpointUrl:"https://pickup.local.test/mini",oaDestination:`U${"a".repeat(32)}`,oaChannelId:"1234569",oaAccessTokenReference:randomUUID(),oaSecretReference:randomUUID(),termsVersion:"test-v1"};
const bindingJson=JSON.stringify(binding);
function restoreRuntime(){vi.stubEnv("LINE_PLATFORM_ENABLED","true");vi.stubEnv("LINE_PLATFORM_BINDING_JSON",bindingJson);}
function request(path:string,body:unknown,cookie:string,device:string){return new Request(`${origin}${path}`,{method:"POST",headers:{origin,"content-type":"application/json","x-real-ip":`2001:db8:${device.slice(0,4)}:${device.slice(4,8)}::1`,"x-stallorder-protocol-version":"1",cookie},body:JSON.stringify(body)});}
async function cookie(profile=profiles[0]){const auth=await createSession(profile,{deviceId:randomUUID()});return `${SESSION_COOKIE}=${auth.token}; ${SESSION_DEVICE_COOKIE}=${auth.deviceId}`;}
describe.skipIf(!url)("authenticated original public Circuit B intake",()=>{
  beforeAll(async()=>{
    vi.stubEnv("DATABASE_URL",url!);vi.stubEnv("NODE_ENV","development");vi.stubEnv("VERCEL_ENV","");vi.stubEnv("TRUSTED_APP_ORIGINS",origin);
    vi.stubEnv("LINE_PLATFORM_ENVIRONMENT","local");vi.stubEnv("LINE_PLATFORM_DATA_KEY",Buffer.alloc(32,47).toString("base64"));vi.stubEnv("LINE_PLATFORM_NOTIFICATIONS_ENABLED","true");vi.stubEnv("LINE_PLATFORM_PICKUP_ENABLED","false");restoreRuntime();
    vi.stubEnv("ABUSE_HASH_SECRET",`synthetic-public-${randomUUID()}`);vi.stubEnv("TOKEN_DERIVATION_SECRET",`synthetic-public-${randomUUID()}`);
    vi.stubEnv("TURNSTILE_SECRET_KEY","1x0000000000000000000000000000000AA");vi.stubEnv("TURNSTILE_ALLOW_TEST_KEYS","true");vi.stubEnv("APP_ENV","test");
    vi.stubGlobal("fetch",vi.fn(async()=>{throw new Error("REAL_PROVIDER_FORBIDDEN");}));
    vi.spyOn(console,"info").mockImplementation(()=>undefined);vi.spyOn(console,"warn").mockImplementation(()=>undefined);vi.spyOn(console,"error").mockImplementation(()=>undefined);
    const [integration]=await prisma.$queryRaw<Array<{id:string}>>`select id from public.notification_integrations where sender_scope='PLATFORM_OA' and environment='local' and provider_id=${binding.providerId} and oa_destination=${binding.oaDestination} and status='ACTIVE'`;
    if(!integration)await ensurePlatformNotificationIntegration(getLinePlatformRuntime()!);
    for(const profile of profiles){
      await prisma.profile.create({data:{id:profile,displayName:"Synthetic public member"}});
      const subject=`U${randomUUID().replaceAll("-","")}`,hash=hashPlatformSubject("local",binding.providerId,subject);
      const identity=await prisma.authIdentity.create({data:{profileId:profile,provider:"LINE",providerSubject:`miniapp:local:${binding.providerId}:${hash}`}});
      await prisma.$executeRaw`insert into public.line_platform_members(profile_id,auth_identity_id,environment,provider_id,subject_hash,subject_ciphertext,terms_version,terms_accepted_at,terms_source,notification_consent)
        values(${profile}::uuid,${identity.id}::uuid,'local',${binding.providerId},${hash},${encryptPlatformValue(subject)},'test-v1',now(),'MINI_APP',false)`;
    }
    await prisma.productCategory.create({data:{id:category,organizationId:org,name:`Synthetic public ${category}`}});
    await prisma.product.create({data:{id:product,organizationId:org,categoryId:category,name:"Synthetic original public meal",description:"Synthetic only",defaultPrice:60}});
  });
  afterAll(async()=>{await prisma.$disconnect();vi.restoreAllMocks();vi.unstubAllEnvs();vi.unstubAllGlobals();});
  async function fixture(mode='member'){
    restoreRuntime();const stallId=randomUUID(),qrToken=`synthetic-public-${randomUUID()}`,device=randomUUID();
    await prisma.stall.create({data:{id:stallId,organizationId:org,name:"Synthetic public store",slug:`public-${stallId}`,code:`P${stallId.slice(0,7)}`,address:"Synthetic",location:"Synthetic"}});
    await prisma.stallOrderingSettings.create({data:{stallId,organizationId:org,takeoutPreorderEnabled:true}});
    await prisma.stallBusinessHour.createMany({data:Array.from({length:7},(_,dayOfWeek)=>({organizationId:org,stallId,dayOfWeek,opensAt:"00:00",closesAt:"00:00"}))});
    await prisma.stallProduct.create({data:{organizationId:org,stallId,productId:product,stockRemaining:3}});
    await prisma.qrCode.create({data:{organizationId:org,stallId,token:qrToken,label:"Synthetic public",fulfillmentTypeContext:"TAKEOUT"}});
    if(mode!=='nonpilot')await prisma.$executeRaw`insert into public.line_platform_stalls(stall_id,environment,enabled,cutover_at) values(${stallId}::uuid,'local',true,now()-interval '1 day')`;
    const [slots]=await prisma.$queryRaw<Array<{slots:string[]}>>`select public.get_takeout_preorder_slots(${stallId}::uuid,now()) as slots`;
    if(mode==='off')vi.stubEnv("LINE_PLATFORM_ENABLED","false");if(mode==='invalid')vi.stubEnv("LINE_PLATFORM_BINDING_JSON","invalid");
    const authCookie=mode==='anonymous'?'':await cookie();
    const session=await sessionRoute(request('/api/public/order-session',{qrToken,deviceId:device,sessionRequestId:randomUUID(),orderingMode:'PREORDER',includeMenu:false},authCookie,device));
    const sessionBody=await session.json();expect(session.status,sessionBody.code).toBe(201);expect(sessionBody.orderSessionToken).toBeTypeOf('string');
    if(mode==='pilot-off')await prisma.$executeRaw`update public.line_platform_stalls set enabled=false where stall_id=${stallId}::uuid`;
    if(mode==='beforecutover')await prisma.$executeRaw`update public.line_platform_stalls set cutover_at=now()+interval '1 hour' where stall_id=${stallId}::uuid`;
    const body={qrToken,deviceId:device,orderSessionToken:sessionBody.orderSessionToken,idempotencyKey:randomUUID(),clientOrderId:randomUUID(),orderingMode:'PREORDER',scheduledPickupAt:new Date(slots.slots[1]).toISOString(),customerName:'Synthetic public member',customerPhone:'0900000000',waitAcknowledged:true,items:[{productId:product,quantity:1}],turnstileToken:'XXXX.DUMMY.TOKEN.XXXX'};
    return {stallId,device,authCookie,body};
  }
  it('creates one original order, fixed owner and platform contact/outbox, and replays without duplication',async()=>{
    const f=await fixture();const response=await orderRoute(request('/api/public/orders',f.body,f.authCookie,f.device));const body=await response.json();expect(response.status,body.code).toBe(201);
    const owners=await prisma.$queryRaw`select profile_id from public.line_platform_order_owners where order_id=${f.body.clientOrderId}::uuid`;expect(owners).toEqual([{profile_id:profiles[0]}]);
    const links=await prisma.$queryRaw`select l.id from public.customer_contact_links l join public.notification_integrations i on i.id=l.integration_id where l.customer_reference_id=${f.body.clientOrderId}::uuid and i.sender_scope='PLATFORM_OA'`;expect(links).toHaveLength(1);
    const order=await prisma.order.findUniqueOrThrow({where:{id:f.body.clientOrderId}});
    // The original workflow may wait for staff confirmation; its committed transition enqueues the receipt.
    if(order.status==='WAITING_CONFIRMATION')await prisma.order.update({where:{id:order.id},data:{status:'CONFIRMED'}});
    const jobs=await prisma.$queryRaw`select template_code,outcome from public.notification_jobs where order_id=${order.id}::uuid and delivery_mode='PLATFORM_OA'`;expect(jobs).toEqual([{template_code:'ORDER_RECEIPT_AVAILABLE',outcome:'SUPPRESSED'}]);
    expect((await orderRoute(request('/api/public/orders',f.body,f.authCookie,f.device))).status).toBe(200);
    expect(await prisma.order.count({where:{stallId:f.stallId}})).toBe(1);expect(await prisma.notificationJob.count({where:{orderId:order.id}})).toBe(1);expect(fetch).not.toHaveBeenCalled();
  });
  it.each(['anonymous','nonpilot','pilot-off','beforecutover','off','invalid'])('preserves original Web intake for %s',async mode=>{
    const f=await fixture(mode);const response=await orderRoute(request('/api/public/orders',f.body,f.authCookie,f.device));const body=await response.json();expect(response.status,body.code).toBe(201);
    expect(await prisma.order.count({where:{id:f.body.clientOrderId}})).toBe(1);
    expect(await prisma.$queryRaw`select order_id from public.line_platform_order_owners where order_id=${f.body.clientOrderId}::uuid`).toHaveLength(0);
    expect(await prisma.notificationJob.count({where:{orderId:f.body.clientOrderId}})).toBe(0);expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects another member or logout using a previously bound session before an order or stock allocation exists',async()=>{
    const f=await fixture();for(const authCookie of [await cookie(profiles[1]),'']){
      const response=await orderRoute(request('/api/public/orders',f.body,authCookie,f.device));expect(response.status).toBe(403);expect((await response.json()).code).toBe('LINE_PLATFORM_OWNER_CONFLICT');
    }
    expect(await prisma.order.count({where:{id:f.body.clientOrderId}})).toBe(0);expect((await prisma.stallProduct.findUniqueOrThrow({where:{stallId_productId:{stallId:f.stallId,productId:product}}})).stockRemaining).toBe(3);
  });
});
