import {createHash,createHmac,randomBytes,randomUUID} from "node:crypto";
import {afterAll,beforeAll,describe,expect,it,vi} from "vitest";
import {prisma} from "@/lib/prisma";
import type {SessionPrincipal} from "@/lib/auth";
import {encryptPlatformValue,hashPlatformSubject} from "./crypto";
import {claimGuestPlatformOrder,exchangeGuestClaimProof,guestClaimCookieName,readGuestClaimProof} from "./guest-claim";
import {POST as exchange} from "@/app/api/public/orders/claim-proof/route";
const testUrl=process.env.LINE_PLATFORM_TEST_DATABASE_URL;
if(testUrl){const u=new URL(testUrl);if(!['localhost','127.0.0.1'].includes(u.hostname)||u.port!=='55722'||u.pathname!=='/stallorder_line_miniapp_20260926')throw new Error('GUEST_PROOF_DATABASE_REJECTED');}
const org='11111111-1111-4111-8111-111111111111',profile=randomUUID(),device=randomUUID();
const subject=`U${randomUUID().replaceAll('-','')}`,secret='synthetic-guest-proof-only';
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
const deviceHash=createHmac('sha256',secret).update(`device:${device}`).digest('hex');
const principal:SessionPrincipal={sessionId:randomUUID(),sessionExpiresAt:new Date(Date.now()+600000),csrfTokenHash:'synthetic',user:{id:profile,authUserId:null,email:null,displayName:'Synthetic guest owner',platformRole:null}};
type Fixture={id:string;stallId:string;sessionToken:string;trackingToken:string};
const fixtures:Fixture[]=[];
const origin='https://guest.local.test';
function request(fixture:Fixture,override:Record<string,string>={}){
  return new Request(`${origin}/api/public/orders/claim-proof`,{method:'POST',headers:{'content-type':'application/json',origin,'x-stallorder-protocol-version':'1','x-real-ip':'203.0.113.212'},body:JSON.stringify({orderSessionToken:fixture.sessionToken,trackingToken:fixture.trackingToken,deviceId:device,...override})});
}
describe.skipIf(!testUrl)('original guest proof exchange and multi-order ownership with real local DB',()=>{
  beforeAll(async()=>{
    vi.stubEnv('DATABASE_URL',testUrl!);vi.stubEnv('NODE_ENV','test');vi.stubEnv('VERCEL_ENV','');vi.stubEnv('TRUSTED_APP_ORIGINS',origin);
    vi.stubEnv('LINE_PLATFORM_ENABLED','true');vi.stubEnv('LINE_PLATFORM_ENVIRONMENT','local');vi.stubEnv('ABUSE_HASH_SECRET',secret);
    vi.stubEnv('LINE_PLATFORM_PICKUP_ENABLED','false');vi.stubEnv('LINE_PLATFORM_NOTIFICATIONS_ENABLED','false');
    vi.stubEnv('LINE_PLATFORM_DATA_KEY',Buffer.alloc(32,47).toString('base64'));
    vi.stubEnv('LINE_PLATFORM_BINDING_JSON',JSON.stringify({environment:'local',providerId:'1234567',channelId:'1234568',liffId:'1234568-fixture',internalChannel:'developing',endpointUrl:'https://pickup.local.test/mini',oaDestination:`U${'a'.repeat(32)}`,oaChannelId:'1234569',oaAccessTokenReference:randomUUID(),oaSecretReference:randomUUID(),termsVersion:'test-v1'}));
    vi.stubGlobal('fetch',vi.fn(async()=>{throw new Error('REAL_NETWORK_FORBIDDEN');}));
    await prisma.profile.create({data:{id:profile,displayName:'Synthetic guest owner'}});
    const subjectHash=hashPlatformSubject('local','1234567',subject);
    const identity=await prisma.authIdentity.create({data:{profileId:profile,provider:'LINE',providerSubject:`miniapp:local:1234567:${subjectHash}`}});
    await prisma.$executeRaw`insert into public.line_platform_members(profile_id,auth_identity_id,environment,provider_id,subject_hash,subject_ciphertext,terms_version,terms_accepted_at,terms_source,notification_consent)
      values(${profile}::uuid,${identity.id}::uuid,'local','1234567',${subjectHash},${encryptPlatformValue(subject)},'test-v1',now(),'MINI_APP',false)`;
    for(let i=0;i<2;i++){
      const stallId=randomUUID(),id=randomUUID(),sessionToken=`stos_${randomBytes(32).toString('base64url')}`,trackingToken=`sto_${randomBytes(32).toString('base64url')}`;
      await prisma.stall.create({data:{id:stallId,organizationId:org,name:`Synthetic guest ${i}`,code:`g-${stallId}`,slug:`guest-${stallId}`,address:'Synthetic address',location:'Synthetic location'}});
      await prisma.$executeRaw`insert into public.line_platform_stalls(stall_id,environment,enabled,cutover_at) values(${stallId}::uuid,'local',true,now()-interval '1 hour')`;
      const qr=await prisma.qrCode.create({data:{organizationId:org,stallId,token:randomUUID(),label:'Synthetic guest claim'}});
      await prisma.order.create({data:{id,organizationId:org,stallId,orderNo:`G-${id.slice(0,16)}`,source:'QR_MENU',origin:'TEST',isTest:true,customerName:'Synthetic guest',fulfillmentType:'TAKEOUT',status:'CONFIRMED',subtotal:120,total:120,deviceHash,trackingTokenHash:digest(trackingToken),idempotencyKey:randomUUID(),confirmationExpiresAt:new Date(Date.now()+3600000)}});
      await prisma.orderSession.create({data:{organizationId:org,stallId,qrCodeId:qr.id,tokenHash:digest(sessionToken),deviceHash,ipHash:digest('synthetic'),status:'CONSUMED',orderId:id,expiresAt:new Date(Date.now()+60000),usedAt:new Date()}});
      fixtures.push({id,stallId,sessionToken,trackingToken});
    }
  });
  afterAll(async()=>{await prisma.$disconnect();vi.unstubAllEnvs();vi.unstubAllGlobals();});
  it('rejects the wrong original session, device, or tracking capability without issuing proof',async()=>{
    const a=fixtures[0],b=fixtures[1];
    expect(await exchangeGuestClaimProof(b.sessionToken,a.trackingToken,device)).toBeNull();
    expect(await exchangeGuestClaimProof(a.sessionToken,a.trackingToken,randomUUID())).toBeNull();
    expect(await exchangeGuestClaimProof(a.sessionToken,b.trackingToken,device)).toBeNull();
    expect((await exchange(request(a,{deviceId:randomUUID()}))).status).toBe(404);
    await expect(claimGuestPlatformOrder(principal,a.trackingToken,device,'')).rejects.toThrow('ORDER_NOT_FOUND');
  });
  it('issues independent secure cookies for two stores and permits both original orders to be claimed',async()=>{
    const jar=new Map<string,string>();
    for(const fixture of fixtures){
      const response=await exchange(request(fixture));expect(response.status).toBe(200);expect(await response.json()).toEqual({ok:true});
      const name=guestClaimCookieName(fixture.trackingToken),header=response.headers.get('set-cookie')!;
      expect(header).toContain(`${name}=`);expect(header).toContain('HttpOnly');expect(header).toContain('Secure');expect(header).toContain('SameSite=strict');expect(header).toContain('Path=/');expect(header).toContain('Max-Age=86400');
      const proof=decodeURIComponent(header.split(';')[0].slice(name.length+1));jar.set(name,proof);
      expect(readGuestClaimProof(fixture.trackingToken,device,proof)).not.toBeNull();
    }
    expect(jar.size).toBe(2);
    expect(readGuestClaimProof(fixtures[0].trackingToken,device,jar.get(guestClaimCookieName(fixtures[1].trackingToken))!)).toBeNull();
    for(const fixture of fixtures)expect(await claimGuestPlatformOrder(principal,fixture.trackingToken,device,jar.get(guestClaimCookieName(fixture.trackingToken))!)).toBe(fixture.id);
    const [owners]=await prisma.$queryRaw<Array<{count:number}>>`select count(*)::integer as count from public.line_platform_order_owners where profile_id=${profile}::uuid`;
    expect(owners.count).toBe(2);
  });
  it('does not issue another proof when the original session is revoked or the pilot is disabled',async()=>{
    const a=fixtures[0],b=fixtures[1];
    await prisma.orderSession.updateMany({where:{orderId:a.id},data:{revokedAt:new Date()}});
    expect(await exchangeGuestClaimProof(a.sessionToken,a.trackingToken,device)).toBeNull();
    await prisma.$executeRaw`update public.line_platform_stalls set enabled=false where stall_id=${b.stallId}::uuid`;
    expect(await exchangeGuestClaimProof(b.sessionToken,b.trackingToken,device)).toBeNull();
  });
});
