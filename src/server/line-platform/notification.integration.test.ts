import { createHmac,createHash,randomUUID } from "node:crypto";
import { beforeAll,afterAll,describe,it,expect,vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { storeNotificationSecret } from "@/server/notifications/notification-secrets";
import { bindPlatformOrderNotifications,ensurePlatformNotificationIntegration } from "./notification-binding";
import { persistPlatformWebhook,processPlatformFriendshipEvents } from "./notification-webhook";
import { processPlatformNotifications,retryPlatformNotification } from "./notification-worker";
import { encryptPlatformValue,hashPlatformSubject,decryptPlatformValue } from "./crypto";
import { platformPayloadHash } from "./messaging";
import { getLinePlatformRuntime,type LinePlatformRuntime } from "./runtime";
import { ensurePickupMediaForOrder,managePlatformPickup,renderPickupMedia } from "./pickup-service";
import { refreshPlatformFriendship } from "./friendship";
import { assertResponsiveQaTarget } from "../../../scripts/responsive-qa-target.mjs";
const url = process.env.LINE_PLATFORM_TEST_DATABASE_URL;
if (url) { const db = new URL(url); if (process.env.RESPONSIVE_QA_RUN === "true") { assertResponsiveQaTarget(process.env); if (url !== process.env.DATABASE_URL) throw new Error("NOTIFICATION_TEST_DATABASE_REJECTED"); } else if (!['localhost','127.0.0.1'].includes(db.hostname) || db.port!=='55722' || db.pathname!=='/stallorder_line_miniapp_20260926') throw new Error("NOTIFICATION_TEST_DATABASE_REJECTED"); }
const org = "11111111-1111-4111-8111-111111111111";
const profile = randomUUID(),stallA = randomUUID(),stallB = randomUUID(),subject = `U${randomUUID().replaceAll('-','')}`;
const secret = "synthetic-notification-webhook-secret";
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
let runtime: LinePlatformRuntime, integrationId: string, subjectHash: string;
const pushed: string[] = [];
const transport = vi.fn<typeof fetch>(async (url,init) => {
  if (String(url).endsWith('/bot/info')) return Response.json({ userId: `U${'a'.repeat(32)}` });
  if (String(url).endsWith('/quota/consumption')) return Response.json({ totalUsage: 0 });
  if (String(url).endsWith('/quota')) return Response.json({ type: 'limited',value: 10000 });
  pushed.push(String(init?.body)); return new Response(null,{ status: 200,headers: { 'x-line-request-id': randomUUID() } });
});
describe.skipIf(!url)("platform OA durable notification lifecycle with real local DB", () => {
  beforeAll(async () => {
    vi.stubGlobal('fetch',vi.fn(async()=>{throw new Error('REAL_NETWORK_FORBIDDEN_IN_SYNTHETIC_TEST');}));
    vi.stubEnv('DATABASE_URL',url!); vi.stubEnv('NODE_ENV','test'); vi.stubEnv('VERCEL_ENV','');
    vi.stubEnv('LINE_PLATFORM_ENABLED','true'); vi.stubEnv('LINE_PLATFORM_ENVIRONMENT','local');
    vi.stubEnv('LINE_PLATFORM_NOTIFICATIONS_ENABLED','true'); vi.stubEnv('LINE_PLATFORM_PICKUP_ENABLED','true');
    vi.stubEnv('LINE_PLATFORM_DATA_KEY',Buffer.alloc(32,47).toString('base64'));
    const tokenRef=await storeNotificationSecret(`stallorder_notification_test_token_${randomUUID()}`,'synthetic-notification-access-token','Local synthetic');
    const secretRef=await storeNotificationSecret(`stallorder_notification_test_secret_${randomUUID()}`,secret,'Local synthetic');
    vi.stubEnv('LINE_PLATFORM_BINDING_JSON',JSON.stringify({ environment:'local',providerId:'1234567',channelId:'1234568',liffId:'1234568-fixture',internalChannel:'developing',endpointUrl:'https://pickup.local.test/mini',oaDestination:`U${'a'.repeat(32)}`,oaChannelId:'1234569',oaAccessTokenReference:tokenRef,oaSecretReference:secretRef,termsVersion:'test-v1' }));
    runtime=getLinePlatformRuntime()!; integrationId=await ensurePlatformNotificationIntegration(runtime); subjectHash=hashPlatformSubject('local',runtime.providerId,subject);
    await prisma.profile.create({data:{id:profile,displayName:'Synthetic notification customer'}});
    const identity=await prisma.authIdentity.create({data:{profileId:profile,provider:'LINE',providerSubject:`notification-test-${randomUUID()}`}});
    await prisma.$executeRaw`insert into public.line_platform_members(profile_id,auth_identity_id,environment,provider_id,subject_hash,subject_ciphertext,terms_version,terms_accepted_at,terms_source,notification_consent)
      values(${profile}::uuid,${identity.id}::uuid,'local',${runtime.providerId},${subjectHash},${encryptPlatformValue(subject)},'test-v1',now(),'MINI_APP',true)`;
    for(const id of [stallA,stallB]) {
      await prisma.stall.create({data:{id,organizationId:org,name:`Synthetic ${id===stallA?'A':'B'}`,slug:`notify-${id}`,code:`N${id.slice(0,7)}`,address:'Synthetic location',location:'Synthetic location'}});
      await prisma.$executeRaw`insert into public.line_platform_stalls(stall_id,environment,enabled,cutover_at) values(${id}::uuid,'local',true,now()-interval '1 day')`;
    }
  });
  afterAll(async () => {
    if(url) {
      await prisma.$executeRaw`update public.notification_jobs set status='CANCELLED',outcome='SUPPRESSED',next_attempt_at=null,last_error_code='SYNTHETIC_TEST_FINISHED'
        where delivery_mode='PLATFORM_OA' and recipient_identity_hash=${subjectHash} and outcome in ('QUEUED','RETRY_SCHEDULED')`;
      await prisma.$disconnect();
    }
    vi.unstubAllEnvs(); vi.unstubAllGlobals();
  });
  async function event(type:'follow'|'unfollow',time:number,eventId=randomUUID()) {
    const body=JSON.stringify({destination:runtime.oaDestination,events:[{type,timestamp:time,webhookEventId:eventId,source:{type:'user',userId:subject}}]});
    await persistPlatformWebhook(body,createHmac('sha256',secret).update(body).digest('base64'),runtime);
    return {body,eventId};
  }
  async function fixture(stallId=stallA) {
    const id=randomUUID();
    await prisma.$transaction(async db => {
      await db.order.create({data:{id,organizationId:org,stallId,orderNo:`N-${id.slice(0,16)}`,trackingTokenHash:digest(randomUUID()),idempotencyKey:randomUUID(),customerName:'Synthetic notification customer',deviceHash:digest(randomUUID()),source:'QR_MENU',fulfillmentType:'TAKEOUT',status:'CONFIRMED',paymentStatus:'UNPAID',subtotal:120,total:120,confirmationExpiresAt:new Date(Date.now()+3600000)}});
      await db.$executeRaw`insert into public.line_platform_order_owners(order_id,profile_id,environment,provider_id,subject_hash,pickup_required) values(${id}::uuid,${profile}::uuid,'local',${runtime.providerId},${subjectHash},true)`;
      await bindPlatformOrderNotifications(id,runtime,db);
    });
    return id;
  }
  async function tick(fetchImpl:typeof fetch=transport) {
    await prisma.$executeRaw`update public.notification_integrations set last_dispatch_at=null where id=${integrationId}::uuid`;
    return processPlatformNotifications(new Date(),async (url,init) => String(url).endsWith('/message/push') && JSON.parse(String(init?.body)).to===subject ? fetchImpl(url,init) : transport(url,init));
  }
  async function jobs(orderId:string) { return prisma.$queryRaw<Array<{id:string;outcome:string;template_code:string;attempt_count:number;snapshot_ciphertext:string|null;payload_hash:string|null;retry_key:string;first_request_at:Date|null}>>`select * from public.notification_jobs where order_id=${orderId}::uuid order by created_at,id`; }
  it('persists signed friendship before processing, rejects wrong destination/signature and ignores older follow',async()=>{
    const time=Date.now()-1000; const first=await event('follow',time);
    await persistPlatformWebhook(first.body,createHmac('sha256',secret).update(first.body).digest('base64'),runtime);
    await event('unfollow',time+100); await event('follow',time-100);
    await processPlatformFriendshipEvents(runtime);
    const [friend]=await prisma.$queryRaw<Array<{status:string}>>`select status from public.line_platform_friendships where integration_id=${integrationId}::uuid and subject_hash=${subjectHash}`;
    expect(friend.status).toBe('NOT_FRIEND_OR_BLOCKED');
    await expect(persistPlatformWebhook(first.body,'invalid',runtime)).rejects.toThrow('INVALID_SIGNATURE');
    const changed=first.body.replace(runtime.oaDestination,`U${'b'.repeat(32)}`);
    await expect(persistPlatformWebhook(changed,createHmac('sha256',secret).update(changed).digest('base64'),runtime)).rejects.toThrow('DESTINATION_MISMATCH');
    await event('follow',time+200); await processPlatformFriendshipEvents(runtime);
  });
  it('sends two stores through one OA with immutable receipts and suppresses legacy duplication',async()=>{
    const a=await fixture(),b=await fixture(stallB); const start=pushed.length;
    await Promise.all([tick(),tick()]);
    expect((await jobs(a))[0].outcome).toBe('PROVIDER_ACCEPTED'); expect((await jobs(b))[0].outcome).toBe('PROVIDER_ACCEPTED');
    const own=pushed.slice(start).filter(body=>JSON.parse(body).to===subject);
    expect(own).toHaveLength(2);
    expect(own.join('')).toContain('Synthetic A'); expect(own.join('')).toContain('Synthetic B');
    expect(own.join('')).toContain('尚未付款');
    await expect(prisma.$executeRaw`update public.notification_jobs set payload_hash=${'f'.repeat(64)} where order_id=${a}::uuid`).rejects.toThrow();
    await expect(prisma.$executeRaw`update public.customer_contact_links set provider_user_id_hash=${'f'.repeat(64)} where customer_reference_id=${a}::uuid`).rejects.toThrow();
    const [legacy]=await prisma.$queryRaw<Array<{count:number}>>`select count(*)::integer as count from public.notification_jobs where order_id in (${a}::uuid,${b}::uuid) and delivery_mode='LEGACY'`;
    expect(legacy.count).toBe(0);
  });
  it('refreshes the receipt QR after staff confirms pickup time and sends READY without a customer visit',async()=>{
    const id=await fixture();await tick();
    const original=await ensurePickupMediaForOrder(id,'local');expect(original).not.toBeNull();
    await prisma.order.update({where:{id},data:{fulfillmentTimeState:'CONFIRMED',fulfillmentTimeVersion:1,
      committedFulfillmentAt:new Date(Date.now()+60*60_000)}});
    await prisma.order.update({where:{id},data:{status:'READY'}});
    await tick();
    expect((await jobs(id)).find(job=>job.template_code==='ORDER_READY')?.outcome).toBe('PROVIDER_ACCEPTED');
    const current=await ensurePickupMediaForOrder(id,'local');
    expect(current?.version).toBe(2);expect(current?.imageUrl).not.toBe(original?.imageUrl);
    await expect(renderPickupMedia(new URL(original!.imageUrl).pathname.split('/').at(-1)!)).rejects.toThrow();
  });
  it('recovers accepted-but-timeout with identical body/key and suppresses stale READY',async()=>{
    const id=await fixture(); let original='';
    const timeout=vi.fn<typeof fetch>(async (_url,init)=>{original=String(init?.body);throw new TypeError('synthetic timeout');});
    await tick(timeout); const first=(await jobs(id))[0]; expect(first.outcome).toBe('RETRY_SCHEDULED');
    await prisma.order.update({where:{id},data:{total:140,subtotal:140}});
    await prisma.$executeRaw`update public.notification_jobs set next_attempt_at=now()-interval '1 second' where id=${first.id}::uuid`;
    const accepted=vi.fn<typeof fetch>(async (_url,init)=>{expect(String(init?.body)).toBe(original);expect(new Headers(init?.headers).get('x-line-retry-key')).toBe(first.retry_key);return Response.json({message:'The retry key is already accepted'},{status:409,headers:{'x-line-accepted-request-id':'original-accepted'}});});
    const result=await tick(accepted);expect((await jobs(id))[0].outcome,JSON.stringify({result,calls:accepted.mock.calls.length})).toBe('PROVIDER_ACCEPTED');
    expect(decryptPlatformValue((await jobs(id))[0].snapshot_ciphertext!,`notification:${first.id}`)).toBe(original);
    await prisma.order.update({where:{id},data:{status:'READY'}}); await prisma.order.update({where:{id},data:{status:'CANCELLED'}});
    await tick(); expect((await jobs(id)).find(j=>j.template_code==='ORDER_READY')?.outcome).toBe('SUPPRESSED');
    await tick();
  });
  it('does not retry permanent errors automatically or let a different store request a retry',async()=>{
    const id=await fixture(); const fail=vi.fn<typeof fetch>(async()=>new Response(null,{status:401}));
    await tick(fail);const row=(await jobs(id))[0];expect(row.outcome).toBe('FAILED');
    await tick(fail);expect((await jobs(id))[0].attempt_count).toBe(1);
    await expect(retryPlatformNotification(row.id,stallB,'Synthetic repair',profile,'test-retry')).rejects.toThrow('NOTIFICATION_RETRY_NOT_ALLOWED');
  });
  it('denies browser reads of payload/recipient and cross-tenant job spoofing',async()=>{
    await expect(prisma.$transaction(async db=>{await db.$executeRaw`set local role authenticated`;await db.$queryRaw`select snapshot_ciphertext from public.notification_jobs limit 1`;})).rejects.toThrow();
    const id=await fixture();
    await expect(prisma.$executeRaw`update public.notification_jobs set stall_id=${stallB}::uuid where order_id=${id}::uuid`).rejects.toThrow();
    await tick();
  });
  it('rolls back READY and its outbox together and deduplicates committed transitions',async()=>{
    const id=await fixture(); await tick();
    await expect(prisma.$transaction(async db=>{await db.order.update({where:{id},data:{status:'READY'}});throw new Error('SYNTHETIC_ROLLBACK');})).rejects.toThrow('SYNTHETIC_ROLLBACK');
    expect((await jobs(id)).some(j=>j.template_code==='ORDER_READY')).toBe(false);
    expect((await prisma.order.findUniqueOrThrow({where:{id}})).status).toBe('CONFIRMED');
    await prisma.order.update({where:{id},data:{status:'READY'}});
    await prisma.$executeRaw`select public.enqueue_line_platform_notification(${id}::uuid,'ORDER_READY',0)`;
    await tick();
    expect((await jobs(id)).filter(j=>j.template_code==='ORDER_READY')).toHaveLength(1);
    expect((await jobs(id)).find(j=>j.template_code==='ORDER_READY')?.outcome).toBe('PROVIDER_ACCEPTED');
  });
  it('recovers an expired worker lease and fences a stale worker write',async()=>{
    const id=await fixture();const job=(await jobs(id))[0];const oldLease=randomUUID();
    await prisma.$executeRaw`update public.notification_jobs set status='PROCESSING',outcome='IN_FLIGHT',lease_token=${oldLease}::uuid,lease_expires_at=now()-interval '1 second',attempt_count=1 where id=${job.id}::uuid`;
    await tick();expect((await jobs(id))[0].outcome).toBe('PROVIDER_ACCEPTED');
    const stale=await prisma.$executeRaw`update public.notification_jobs set outcome='FAILED' where id=${job.id}::uuid and lease_token=${oldLease}::uuid and outcome='IN_FLIGHT'`;
    expect(stale).toBe(0);expect((await jobs(id))[0].attempt_count).toBe(2);
  });
  it.each(['IN_FLIGHT','RETRY_SCHEDULED'])('terminates attempt six without a snapshot from %s instead of leaving an unclaimable retry',async outcome=>{
    const id=await fixture();const job=(await jobs(id))[0];const lease=randomUUID();
    await prisma.$executeRaw`update public.notification_jobs set status='PROCESSING',outcome=${outcome},lease_token=${lease}::uuid,
      lease_expires_at=now()-interval '1 second',next_attempt_at=now()-interval '1 second',attempt_count=6 where id=${job.id}::uuid`;
    const send=vi.fn<typeof fetch>(async()=>new Response(null,{status:200}));await tick(send);
    const exhausted=(await jobs(id))[0];expect(exhausted.outcome).toBe('MANUAL_REVIEW');
    expect(exhausted.snapshot_ciphertext).toBeNull();expect(exhausted.first_request_at).toBeNull();
    expect(exhausted.retry_key).toBe(job.retry_key);expect(exhausted.attempt_count).toBe(6);expect(send).not.toHaveBeenCalled();
    const [state]=await prisma.$queryRaw<Array<{lease_token:string|null;lease_expires_at:Date|null;next_attempt_at:Date|null}>>`select lease_token,lease_expires_at,next_attempt_at from public.notification_jobs where id=${job.id}::uuid`;
    expect(state).toEqual({lease_token:null,lease_expires_at:null,next_attempt_at:null});
  });
  it('moves expired ambiguous snapshots to manual review without generating another retry key',async()=>{
    const id=await fixture();const job=(await jobs(id))[0];const body=JSON.stringify({to:subject,messages:[{type:'text',text:'Synthetic persisted snapshot'}]});
    await prisma.$executeRaw`update public.notification_jobs set snapshot_ciphertext=${encryptPlatformValue(body,`notification:${job.id}`)},payload_hash=${platformPayloadHash(body)},first_request_at=now()-interval '25 hours',outcome='RETRY_SCHEDULED',status='FAILED',attempt_count=1 where id=${job.id}::uuid`;
    const send=vi.fn<typeof fetch>(async()=>new Response(null,{status:200}));await tick(send);
    expect(send).not.toHaveBeenCalled();const expired=(await jobs(id))[0];expect(expired.outcome).toBe('MANUAL_REVIEW');expect(expired.retry_key).toBe(job.retry_key);
    await expect(retryPlatformNotification(job.id,stallA,'Synthetic retry',profile,'expired-retry')).rejects.toThrow('NOTIFICATION_RETRY_NOT_ALLOWED');
  });
  it('prioritizes READY within a store and lets another store progress through a shared quota',async()=>{
    const a=await fixture(),a2=await fixture(),b=await fixture(stallB);
    await prisma.order.update({where:{id:a2},data:{status:'READY'}});
    await tick();expect((await jobs(a2)).find(j=>j.template_code==='ORDER_READY')?.outcome).toBe('PROVIDER_ACCEPTED');
    expect((await jobs(a))[0].outcome).toBe('QUEUED');expect((await jobs(b))[0].outcome).toBe('PROVIDER_ACCEPTED');
    await tick();await tick();
  });
  it('serializes operator retries and preserves the original operation',async()=>{
    const id=await fixture();await tick(async()=>new Response(null,{status:401}));const before=(await jobs(id))[0];
    expect(before.outcome).toBe('FAILED');
    const results=await Promise.allSettled([retryPlatformNotification(before.id,stallA,'合成：已更正憑證',profile,'operator-a'),retryPlatformNotification(before.id,stallA,'合成：已更正憑證',profile,'operator-b')]);
    expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);
    await tick();const after=(await jobs(id))[0];expect(after.outcome).toBe('PROVIDER_ACCEPTED');expect(after.retry_key).toBe(before.retry_key);expect(after.snapshot_ciphertext).toBe(before.snapshot_ciphertext);
    await expect(retryPlatformNotification(before.id,stallA,'合成：再次重試',profile,'operator-c')).rejects.toThrow('NOTIFICATION_RETRY_NOT_ALLOWED');
  });
  it.each(['committed','requested','scheduled','quoted'] as const)('snapshots the authoritative %s fulfillment time before lower-priority estimates',async source=>{
    await event('follow',Date.now());await processPlatformFriendshipEvents(runtime);
    const id=await fixture(),base=Date.now()+3600000;
    const times={committed:new Date(base+60000),requested:new Date(base+120000),scheduled:new Date(base+180000),quoted:new Date(base+240000)};
    await prisma.order.update({where:{id},data:{
      committedFulfillmentAt:source==='committed'?times.committed:null,
      requestedFulfillmentAt:['committed','requested'].includes(source)?times.requested:null,
      scheduledPickupAt:source!=='quoted'?times.scheduled:null,quotedReadyAt:times.quoted,
      fulfillmentTimeState:source==='committed'?'CONFIRMED':source==='requested'?'REQUESTED':'NOT_REQUESTED',
      fulfillmentTimeVersion:['committed','requested'].includes(source)?1:0,
    }});
    await tick();const job=(await jobs(id))[0];expect(job.outcome).toBe('PROVIDER_ACCEPTED');
    const snapshot=decryptPlatformValue(job.snapshot_ciphertext!,`notification:${job.id}`);
    const expected=new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(times[source]);
    expect(snapshot).toContain(`預約／預估時間：${expected}`);
  });
  it('stops retrying an immutable READY snapshot after QR reissue without changing its body or retry key',async()=>{
    const id=await fixture();await prisma.order.update({where:{id},data:{status:'READY'}});
    await tick(async()=>new Response(null,{status:500}));
    const first=(await jobs(id)).find(job=>job.template_code==='ORDER_READY')!;expect(first.outcome).toBe('RETRY_SCHEDULED');
    const snapshot=decryptPlatformValue(first.snapshot_ciphertext!,`notification:${first.id}`);
    const image=JSON.parse(snapshot).messages[0].contents.body.contents.find((item:{type:string})=>item.type==='image').url as string;
    const oldMedia=new URL(image).pathname.split('/').at(-1)!;
    expect((await renderPickupMedia(oldMedia)).length).toBeGreaterThan(0);
    await managePlatformPickup(stallA,profile,{orderId:id,operation:'REISSUE',expectedVersion:1,reason:'合成：取餐碼已重新發行'});
    await expect(renderPickupMedia(oldMedia)).rejects.toMatchObject({code:'PICKUP_MEDIA_NOT_FOUND',status:404});
    expect((await ensurePickupMediaForOrder(id,'local'))?.imageUrl).not.toBe(image);
    await prisma.$executeRaw`update public.notification_jobs set next_attempt_at=now()-interval '1 second' where id=${first.id}::uuid`;
    const send=vi.fn<typeof fetch>(async()=>new Response(null,{status:200}));await tick(send);
    const after=(await jobs(id)).find(job=>job.id===first.id)!;
    expect(send).not.toHaveBeenCalled();expect(after.outcome).toBe('MANUAL_REVIEW');
    expect(after.snapshot_ciphertext).toBe(first.snapshot_ciphertext);expect(after.retry_key).toBe(first.retry_key);expect(after.payload_hash).toBe(first.payload_hash);
    const [state]=await prisma.$queryRaw<Array<{last_error_code:string;next_attempt_at:Date|null}>>`select last_error_code,next_attempt_at from public.notification_jobs where id=${first.id}::uuid`;
    expect(state).toEqual({last_error_code:'PICKUP_SNAPSHOT_STALE',next_attempt_at:null});
    await expect(retryPlatformNotification(first.id,stallA,'合成：嘗試重送',profile,'stale-qr')).rejects.toThrow('NOTIFICATION_RETRY_NOT_ALLOWED');
  });
  it('restores an existing friend through verified API, preserves newer blocks and rejects concurrent revocation',async()=>{
    const principal={user:{id:profile}} as Parameters<typeof refreshPlatformFriendship>[0];
    await prisma.$executeRaw`update public.line_platform_friendships set status='UNKNOWN',observed_at=now()-interval '1 hour'
      where integration_id=${integrationId}::uuid and subject_hash=${subjectHash}`;
    const provider=vi.fn<typeof fetch>(async request=>{
      const path=new URL(String(request)).pathname;
      return Response.json(path.endsWith('/verify')?{client_id:runtime.channelId,expires_in:60,scope:'openid profile'}
        :path==='/v2/profile'?{userId:subject}:{friendFlag:true});
    });
    expect(await refreshPlatformFriendship(principal,runtime,'synthetic-user-access-token',provider)).toBe('FRIEND');
    const [saved]=await prisma.$queryRaw<Array<{status:string;source:string}>>`select status,source from public.line_platform_friendships where integration_id=${integrationId}::uuid and subject_hash=${subjectHash}`;
    expect(saved).toEqual({status:'FRIEND',source:'VERIFIED_API'});
    const concurrentBlock=vi.fn<typeof fetch>(async(request,init)=>{
      if(new URL(String(request)).pathname==='/friendship/v1/status'){
        await event('unfollow',Date.now()+100);await processPlatformFriendshipEvents(runtime);
      }
      return provider(request,init);
    });
    expect(await refreshPlatformFriendship(principal,runtime,'synthetic-user-access-token',concurrentBlock)).toBe('NOT_FRIEND_OR_BLOCKED');
    const concurrentRevoke=vi.fn<typeof fetch>(async(request,init)=>{
      if(new URL(String(request)).pathname==='/friendship/v1/status')await prisma.authIdentity.updateMany({where:{profileId:profile},data:{revokedAt:new Date()}});
      return provider(request,init);
    });
    try {await expect(refreshPlatformFriendship(principal,runtime,'synthetic-user-access-token',concurrentRevoke)).rejects.toThrow('LOGIN_REQUIRED');}
    finally {await prisma.authIdentity.updateMany({where:{profileId:profile},data:{revokedAt:null}});}
    const [member]=await prisma.$queryRaw<Array<{notification_consent:boolean}>>`select notification_consent from public.line_platform_members where profile_id=${profile}::uuid`;
    expect(member.notification_consent).toBe(true);
  });
});
