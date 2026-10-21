import { createHash,createHmac,randomBytes,randomUUID } from 'node:crypto';
import { afterAll,beforeAll,describe,expect,it,vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import type {SessionPrincipal} from '@/lib/auth';
import {encryptPlatformValue,hashPlatformSubject} from './crypto';
import {beginGuestCartHandoff,consumeGuestCartHandoff,guestCartCookieName,bindPlatformOrderSession} from './guest-cart';
import {POST as beginRoute} from '@/app/api/public/cart-handoff/route';
import {restoreQrCartDraft} from '@/lib/qr-cart';
import {bindPlatformOrderOwner} from './member-service';
import {getLinePlatformRuntime} from './runtime';
import {exchangeGuestClaimProof,claimGuestPlatformOrder,issueGuestClaimProof} from './guest-claim';
const testUrl=process.env.LINE_PLATFORM_TEST_DATABASE_URL;
if(testUrl){const u=new URL(testUrl);if(!['localhost','127.0.0.1'].includes(u.hostname)||u.port!=='55722'||u.pathname!=='/stallorder_line_miniapp_20260926')throw new Error('CART_HANDOFF_DATABASE_REJECTED');}
const org='11111111-1111-4111-8111-111111111111',device=randomUUID(),secret='synthetic-cart-handoff-only',origin='https://cart.local.test';
const digest=(v:string)=>createHash('sha256').update(v).digest('hex');
const profiles=[randomUUID(),randomUUID()],stalls=[randomUUID(),randomUUID()],productId=randomUUID();
const principal=(id=profiles[0]):SessionPrincipal=>({sessionId:randomUUID(),sessionExpiresAt:new Date(Date.now()+600000),csrfTokenHash:'synthetic',user:{id,authUserId:null,email:null,displayName:'Synthetic cart member',platformRole:null}});
const draft={orderingMode:'PREORDER' as const,scheduledPickupAt:'',customerName:'Synthetic private name',customerPhone:'0900000000',customerNote:'Synthetic note',deliveryAddress:'Synthetic private address',lines:[{id:'line-a',productId,quantity:2,note:'',noteOptionIds:[],bundleChoiceIds:[]}]};
let tokenVersion=0;
describe.skipIf(!testUrl)('guest cart handoff with real original session and member boundaries',()=>{
  beforeAll(async()=>{
    vi.stubEnv('DATABASE_URL',testUrl!);vi.stubEnv('NODE_ENV','test');vi.stubEnv('VERCEL_ENV','');vi.stubEnv('TRUSTED_APP_ORIGINS',origin);
    vi.stubEnv('LINE_PLATFORM_ENABLED','true');vi.stubEnv('LINE_PLATFORM_ENVIRONMENT','local');vi.stubEnv('ABUSE_HASH_SECRET',secret);vi.stubEnv('LINE_PLATFORM_NOTIFICATIONS_ENABLED','false');
    vi.stubEnv('LINE_PLATFORM_DATA_KEY',Buffer.alloc(32,47).toString('base64'));
    vi.stubEnv('LINE_PLATFORM_BINDING_JSON',JSON.stringify({environment:'local',providerId:'1234567',channelId:'1234568',liffId:'1234568-fixture',internalChannel:'developing',endpointUrl:'https://pickup.local.test/mini',oaDestination:`U${'a'.repeat(32)}`,oaChannelId:'1234569',oaAccessTokenReference:randomUUID(),oaSecretReference:randomUUID(),termsVersion:'test-v1'}));
    vi.stubGlobal('fetch',vi.fn(async()=>{throw new Error('REAL_NETWORK_FORBIDDEN');}));
    for(const id of profiles){
      await prisma.profile.create({data:{id,displayName:'Synthetic cart member'}});
      const sub=`U${randomUUID().replaceAll('-','')}`,hash=hashPlatformSubject('local','1234567',sub);
      const identity=await prisma.authIdentity.create({data:{profileId:id,provider:'LINE',providerSubject:`miniapp:local:1234567:${hash}`}});
      await prisma.$executeRaw`insert into public.line_platform_members(profile_id,auth_identity_id,environment,provider_id,subject_hash,subject_ciphertext,terms_version,terms_accepted_at,terms_source,notification_consent)
        values(${id}::uuid,${identity.id}::uuid,'local','1234567',${hash},${encryptPlatformValue(sub)},'test-v1',now(),'MINI_APP',false)`;
    }
    for(const id of stalls){
      await prisma.stall.create({data:{id,organizationId:org,name:'Synthetic cart store',code:`C${id}`,slug:`cart-${id}`,address:'Synthetic',location:'Synthetic'}});
      await prisma.$executeRaw`insert into public.line_platform_stalls(stall_id,environment,enabled,cutover_at) values(${id}::uuid,'local',true,now()-interval '1 hour')`;
    }
  });
  afterAll(async()=>{await prisma.$disconnect();vi.unstubAllEnvs();vi.unstubAllGlobals();});
  async function fixture(stallId=stalls[0]){
    const qrToken=randomUUID(),orderSessionToken=`stos_${randomBytes(32).toString('base64url')}`;
    const qr=await prisma.qrCode.create({data:{organizationId:org,stallId,token:qrToken,tokenVersion:++tokenVersion,label:'Synthetic cart'}});
    const session=await prisma.orderSession.create({data:{organizationId:org,stallId,qrCodeId:qr.id,tokenHash:digest(orderSessionToken),deviceHash:createHmac('sha256',secret).update(`device:${device}`).digest('hex'),ipHash:digest('synthetic'),status:'ACTIVE',orderingMode:'PREORDER',expiresAt:new Date(Date.now()+1200000)}});
    return Object.defineProperty({qrToken,orderSessionToken,deviceId:device,draft},'sessionId',{value:session.id}) as {sessionId:string;qrToken:string;orderSessionToken:string;deviceId:string;draft:typeof draft};
  }
  const consume=(input:Awaited<ReturnType<typeof fixture>>,sealedDraft:string)=>({qrToken:input.qrToken,orderingMode:'PREORDER' as const,sealedDraft});
  it('explicitly imports the same guest session into one member and keeps catalog revalidation in the original restore',async()=>{
    const input=await fixture(),handoff=await beginGuestCartHandoff(input,null);
    expect(handoff.href).toBe(`/mini/store/c${stalls[0]}?view=pickup`);expect(handoff.proof).not.toContain('Synthetic');expect(handoff.sealedDraft).not.toContain('0900000000');expect(handoff.href).not.toContain(input.orderSessionToken);
    const result=await consumeGuestCartHandoff(consume(input,handoff.sealedDraft),device,handoff.proof,principal());
    const restored=restoreQrCartDraft(result.draft,[{id:productId,noteGroups:[]}],{maxItemQuantity:1,maxUniqueProducts:10,maxTotalQuantity:10,maxNoteLength:100});
    expect(restored?.customerName).toBe(draft.customerName);expect(restored?.lines[0].quantity).toBe(1);
    expect(await consumeGuestCartHandoff(consume(input,handoff.sealedDraft),device,handoff.proof,principal())).toEqual(result);
    await expect(consumeGuestCartHandoff(consume(input,handoff.sealedDraft),device,handoff.proof,principal(profiles[1]))).rejects.toThrow('CART_HANDOFF_UNAVAILABLE');
    await expect(prisma.$executeRaw`update public.order_sessions set line_platform_cart_claim_profile_id=${profiles[1]}::uuid where id=${input.sessionId}::uuid`).rejects.toThrow('LINE_CART_CLAIM_IMMUTABLE');
  });
  it('rejects cross-store, wrong device, missing proof, changed ciphertext, and signed-in export',async()=>{
    const a=await fixture(),b=await fixture(stalls[1]),h=await beginGuestCartHandoff(a,null);
    await expect(beginGuestCartHandoff({...a,qrToken:b.qrToken},null)).rejects.toThrow('CART_HANDOFF_UNAVAILABLE');
    await expect(beginGuestCartHandoff({...a,deviceId:randomUUID()},null)).rejects.toThrow('CART_HANDOFF_UNAVAILABLE');
    await expect(beginGuestCartHandoff(a,principal())).rejects.toThrow('CART_HANDOFF_UNAVAILABLE');
    for(const [input,dev,proof] of [[consume(b,h.sealedDraft),device,h.proof],[consume(a,h.sealedDraft),randomUUID(),h.proof],[consume(a,h.sealedDraft),device,''],[consume(a,h.sealedDraft+'x'),device,h.proof]] as const)
      await expect(consumeGuestCartHandoff(input,dev,proof,principal())).rejects.toThrow('CART_HANDOFF_UNAVAILABLE');
  });
  it.each(['CONSUMED','REVOKED','EXPIRED'] as const)('refuses a handoff after the original session becomes %s',async status=>{
    const a=await fixture(),h=await beginGuestCartHandoff(a,null);
    await prisma.orderSession.update({where:{id:a.sessionId},data:{status,...(status==='REVOKED'?{revokedAt:new Date()}:{}),...(status==='EXPIRED'?{expiresAt:new Date(Date.now()-1000)}:{})}});
    await expect(consumeGuestCartHandoff(consume(a,h.sealedDraft),device,h.proof,principal())).rejects.toThrow('CART_HANDOFF_UNAVAILABLE');
  });
  it('rejects expired handoff proof even while its original guest session is active',async()=>{
    const a=await fixture(),h=await beginGuestCartHandoff(a,null),clock=vi.spyOn(Date,'now').mockReturnValue(Date.now()+601000);
    try{await expect(consumeGuestCartHandoff(consume(a,h.sealedDraft),device,h.proof,principal())).rejects.toThrow('CART_HANDOFF_UNAVAILABLE');}finally{clock.mockRestore();}
  });
  it('serializes competing members so only the first claim binds the original session',async()=>{
    const a=await fixture(),h=await beginGuestCartHandoff(a,null);
    const outcomes=await Promise.allSettled(profiles.map(id=>consumeGuestCartHandoff(consume(a,h.sealedDraft),device,h.proof,principal(id))));
    expect(outcomes.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(outcomes.filter(r=>r.status==='rejected')).toHaveLength(1);
  });
  it('binds member sessions before exposure and prevents logout export, cross-member order ownership and guest proof transfer',async()=>{
    const input=await fixture();
    await bindPlatformOrderSession(input,principal());
    await expect(bindPlatformOrderSession(input,principal())).resolves.toBeUndefined();
    await expect(bindPlatformOrderSession(input,principal(profiles[1]))).rejects.toThrow('CART_HANDOFF_UNAVAILABLE');
    await expect(beginGuestCartHandoff(input,null)).rejects.toThrow('CART_HANDOFF_UNAVAILABLE');
    const id=randomUUID(),trackingToken=`sto_${randomBytes(32).toString('base64url')}`;
    await prisma.order.create({data:{id,organizationId:org,stallId:stalls[0],orderNo:`C-${id.slice(0,16)}`,source:'QR_MENU',origin:'TEST',isTest:true,customerName:'Synthetic guest',fulfillmentType:'TAKEOUT',status:'CONFIRMED',subtotal:120,total:120,deviceHash:createHmac('sha256',secret).update(`device:${device}`).digest('hex'),trackingTokenHash:digest(trackingToken),idempotencyKey:randomUUID(),confirmationExpiresAt:new Date(Date.now()+3600000)}});
    await prisma.orderSession.update({where:{id:input.sessionId},data:{status:'CONSUMED',orderId:id,usedAt:new Date()}});
    await expect(prisma.$transaction(db=>bindPlatformOrderOwner(db,id,{profileId:profiles[1],runtime:getLinePlatformRuntime()!}))).rejects.toThrow('LINE_PLATFORM_OWNER_CONFLICT');
    expect(await exchangeGuestClaimProof(input.orderSessionToken,trackingToken,device)).toBeNull();
    const proof=issueGuestClaimProof(input.orderSessionToken,trackingToken,device)!;
    await expect(claimGuestPlatformOrder(principal(profiles[1]),trackingToken,device,proof)).rejects.toThrow('ORDER_NOT_FOUND');
    expect(await prisma.$queryRaw`select order_id from public.line_platform_order_owners where order_id=${id}::uuid`).toEqual([]);
    await expect(prisma.$transaction(db=>bindPlatformOrderOwner(db,id,{profileId:profiles[0],runtime:getLinePlatformRuntime()!}))).resolves.toBeUndefined();
  });
  it.each(['member','identity'] as const)('waits for concurrent %s revocation and refuses importing from a stale active read',async target=>{
    const input=await fixture(),h=await beginGuestCartHandoff(input,null);
    let release!:()=>void,locked!:()=>void;
    const barrier=new Promise<void>(resolve=>{release=resolve;}),ready=new Promise<void>(resolve=>{locked=resolve;});
    const revoke=prisma.$transaction(async db=>{
      if(target==='member')await db.$executeRaw`update public.line_platform_members set revoked_at=now() where profile_id=${profiles[1]}::uuid`;
      else await db.$executeRaw`update public.auth_identities set revoked_at=now() where profile_id=${profiles[1]}::uuid`;
      locked();await barrier;
    },{timeout:10000});
    await ready;
    let finished=false;
    const consumeResult=consumeGuestCartHandoff(consume(input,h.sealedDraft),device,h.proof,principal(profiles[1])).then(value=>({value,error:null}),error=>({value:null,error})).finally(()=>{finished=true;});
    try{await new Promise(resolve=>setTimeout(resolve,120));expect(finished).toBe(false);}finally{release();}
    await revoke;expect((await consumeResult).error?.message).toBe('CART_HANDOFF_UNAVAILABLE');
    const [session]=await prisma.$queryRaw<Array<{owner:string|null}>>`select line_platform_cart_claim_profile_id as owner from public.order_sessions where id=${input.sessionId}::uuid`;
    expect(session.owner).toBeNull();
    if(target==='member')await prisma.$executeRaw`update public.line_platform_members set revoked_at=null where profile_id=${profiles[1]}::uuid`;
    else await prisma.$executeRaw`update public.auth_identities set revoked_at=null where profile_id=${profiles[1]}::uuid`;
  });
  it('uses the actual public API cookie contract and rejects origin/protocol and injected identity',async()=>{
    const input=await fixture();const {sessionId:_,...body}=input;void _;
    const request=(payload:unknown=body,headers:Record<string,string>={})=>new Request(`${origin}/api/public/cart-handoff`,{method:'POST',headers:{origin,'content-type':'application/json','x-stallorder-protocol-version':'1','x-real-ip':'203.0.113.216',...headers},body:JSON.stringify(payload)});
    expect((await beginRoute(request(body,{origin:'https://evil.test'}))).status).toBe(403);
    expect((await beginRoute(request(body,{'x-stallorder-protocol-version':'0'}))).status).toBe(426);
    expect((await beginRoute(request({...body,profileId:profiles[1]}))).status).toBe(400);
    const result=await beginRoute(request());expect(result.status).toBe(200);
    const cookie=result.headers.get('set-cookie')!;expect(cookie).toContain(guestCartCookieName(input.qrToken,'PREORDER'));expect(cookie).toContain('HttpOnly');expect(cookie).toContain('Secure');expect(cookie).toContain('SameSite=strict');expect(cookie).not.toContain('Synthetic');
    const json=await result.json();expect(json.proof).toBeUndefined();expect(json.draft).toBeUndefined();expect(json.sealedDraft).toBeTypeOf('string');
  });
});
