import 'server-only';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import type { SessionPrincipal } from '@/lib/auth';
import { serializeQrCartDraft } from '@/lib/qr-cart';
import { normalizePublicStorefrontIdentifier } from '@/lib/public-storefront';
import { encryptPlatformValue, decryptPlatformValue } from './crypto';
import { getLinePlatformRuntime } from './runtime';
import { getPlatformMember } from './member-service';

const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const modeSchema=z.enum(['PREORDER','DELIVERY']);
const draftSchema=z.object({orderingMode:modeSchema,scheduledPickupAt:z.string().max(64),customerName:z.string().max(50),customerPhone:z.string().max(30),customerNote:z.string().max(500),deliveryAddress:z.string().max(300),
  lines:z.array(z.object({id:z.string().min(1).max(150),productId:z.string().uuid(),quantity:z.number().int().min(1).max(1000),note:z.string().max(500),noteOptionIds:z.array(z.string().uuid()).max(100),bundleChoiceIds:z.array(z.string().uuid()).max(100)}).strict()).min(1).max(100)}).strict();
export const guestCartBeginSchema=z.object({orderSessionToken:z.string().min(40).max(200),qrToken:z.string().min(24).max(200),deviceId:z.string().uuid(),draft:draftSchema}).strict();
export const guestCartConsumeSchema=z.object({qrToken:z.string().min(24).max(200),orderingMode:modeSchema,sealedDraft:z.string().min(50).max(250000)}).strict();
type Begin=z.infer<typeof guestCartBeginSchema>;
type Consume=z.infer<typeof guestCartConsumeSchema>;
export const GUEST_CART_TTL_SECONDS=600;
export function guestCartCookieName(qrToken:string,mode:string){return `stallorder_line_cart_${hash(`${qrToken}:${mode}`).slice(0,24)}`;}
function deviceHash(value:string){const secret=process.env.ABUSE_HASH_SECRET;if(!secret)throw new Error('CART_HANDOFF_UNAVAILABLE');return createHmac('sha256',secret).update(`device:${value}`).digest('hex');}
const fail=()=>new Error('CART_HANDOFF_UNAVAILABLE');
/** Bind a MINI member's original session before its bearer token reaches the browser. */
export async function bindPlatformOrderSession(input:{orderSessionToken:string;qrToken:string;deviceId:string},principal:SessionPrincipal|null){
  const runtime=getLinePlatformRuntime();if(!runtime||!principal)return;
  await prisma.$transaction(async db=>{
    await db.$queryRaw`select m.profile_id from public.line_platform_members m join public.auth_identities a on a.id=m.auth_identity_id
      where m.profile_id=${principal.user.id}::uuid and m.environment=${runtime.environment} and m.provider_id=${runtime.providerId}
        and m.revoked_at is null and a.revoked_at is null for share of m,a`;
    const member=await getPlatformMember(principal,db);if(!member)return;
    const [session]=await db.$queryRaw<Array<{id:string;line_platform_cart_claim_profile_id:string|null}>>`select s.id,s.line_platform_cart_claim_profile_id from public.order_sessions s
      join public.qr_codes q on q.id=s.qr_code_id and q.stall_id=s.stall_id and q.organization_id=s.organization_id
      where s.token_hash=${hash(input.orderSessionToken)} and s.device_hash=${deviceHash(input.deviceId)} and q.token=${input.qrToken}
        and s.status='ACTIVE' and s.order_id is null and s.revoked_at is null and s.expires_at>now() for update of s`;
    if(!session||(session.line_platform_cart_claim_profile_id&&session.line_platform_cart_claim_profile_id!==member.profile_id))throw fail();
    if(!session.line_platform_cart_claim_profile_id)await db.$executeRaw`update public.order_sessions
      set line_platform_cart_claim_profile_id=${member.profile_id}::uuid,line_platform_cart_claimed_at=now() where id=${session.id}::uuid`;
  });
}
export async function beginGuestCartHandoff(input:Begin,principal:SessionPrincipal|null){
  const runtime=getLinePlatformRuntime();if(!runtime||principal)throw fail();
  const data=guestCartBeginSchema.parse(input),sessionHash=hash(data.orderSessionToken),device=deviceHash(data.deviceId);
  const [session]=await prisma.$queryRaw<Array<{id:string;stall_id:string;code:string;expires_at:Date}>>`select s.id,s.stall_id,st.code,s.expires_at from public.order_sessions s
    join public.qr_codes q on q.id=s.qr_code_id and q.stall_id=s.stall_id and q.organization_id=s.organization_id
    join public.stalls st on st.id=s.stall_id join public.line_platform_stalls p on p.stall_id=s.stall_id and p.environment=${runtime.environment} and p.enabled
    where s.token_hash=${sessionHash} and s.device_hash=${device} and q.token=${data.qrToken} and s.ordering_mode=${data.draft.orderingMode}
      and s.status='ACTIVE' and s.order_id is null and s.revoked_at is null and s.expires_at>now() and s.line_platform_cart_claim_profile_id is null
      and st.is_active and s.created_at>=p.cutover_at`;
  const identifier=session && normalizePublicStorefrontIdentifier(session.code);
  if(!session || !identifier)throw fail();
  const expiresAt=Math.min(session.expires_at.getTime(),Date.now()+GUEST_CART_TTL_SECONDS*1000);
  const sealedDraft=encryptPlatformValue(JSON.stringify({environment:runtime.environment,providerId:runtime.providerId,sessionHash,deviceHash:device,
    qrHash:hash(data.qrToken),stallId:session.stall_id,expiresAt,nonce:randomUUID(),draft:serializeQrCartDraft(data.draft)}),'guest-cart-handoff-v1');
  const proof=encryptPlatformValue(JSON.stringify({sealedHash:hash(sealedDraft),expiresAt}),'guest-cart-cookie-v1');
  return {sealedDraft,proof,expiresAt,href:`/mini/store/${encodeURIComponent(identifier)}?view=${data.draft.orderingMode==='DELIVERY'?'delivery':'pickup'}`};
}
export async function consumeGuestCartHandoff(input:Consume,deviceId:string,proof:string,principal:SessionPrincipal){
  const runtime=getLinePlatformRuntime();if(!runtime)throw fail();
  const data=guestCartConsumeSchema.parse(input);
  let original:{environment:string;providerId:string;sessionHash:string;deviceHash:string;qrHash:string;stallId:string;expiresAt:number;draft:string};
  try{
    const cookie=JSON.parse(decryptPlatformValue(proof,'guest-cart-cookie-v1')) as {sealedHash:string;expiresAt:number};
    original=JSON.parse(decryptPlatformValue(data.sealedDraft,'guest-cart-handoff-v1'));
    if(cookie.sealedHash!==hash(data.sealedDraft)||cookie.expiresAt!==original.expiresAt||original.expiresAt<=Date.now()
      ||original.environment!==runtime.environment||original.providerId!==runtime.providerId||original.deviceHash!==deviceHash(deviceId)||original.qrHash!==hash(data.qrToken))throw fail();
    const draft=JSON.parse(original.draft);if(draft.orderingMode!==data.orderingMode)throw fail();
  }catch{throw fail();}
  return prisma.$transaction(async db=>{
    await db.$queryRaw`select m.profile_id from public.line_platform_members m join public.auth_identities a on a.id=m.auth_identity_id
      where m.profile_id=${principal.user.id}::uuid and m.environment=${runtime.environment} and m.provider_id=${runtime.providerId}
        and m.revoked_at is null and a.revoked_at is null for share of m,a`;
    const member=await getPlatformMember(principal,db);if(!member||member.terms_version!==runtime.termsVersion)throw fail();
    const [session]=await db.$queryRaw<Array<{id:string;line_platform_cart_claim_profile_id:string|null}>>`select s.id,s.line_platform_cart_claim_profile_id from public.order_sessions s
      join public.qr_codes q on q.id=s.qr_code_id and q.stall_id=s.stall_id and q.organization_id=s.organization_id
      join public.line_platform_stalls p on p.stall_id=s.stall_id and p.environment=${runtime.environment} and p.enabled
      where s.token_hash=${original.sessionHash} and s.stall_id=${original.stallId}::uuid and s.device_hash=${original.deviceHash}
        and q.token=${data.qrToken} and s.ordering_mode=${data.orderingMode} and s.status='ACTIVE' and s.order_id is null
        and s.revoked_at is null and s.expires_at>now() and s.created_at>=p.cutover_at for update of s`;
    if(!session||(session.line_platform_cart_claim_profile_id&&session.line_platform_cart_claim_profile_id!==member.profile_id))throw fail();
    if(!session.line_platform_cart_claim_profile_id){
      await db.$executeRaw`update public.order_sessions set line_platform_cart_claim_profile_id=${member.profile_id}::uuid,line_platform_cart_claimed_at=now() where id=${session.id}::uuid`;
      await db.$executeRaw`insert into public.line_platform_member_audit(profile_id,event_type,terms_version) values(${member.profile_id}::uuid,'ORIGINAL_GUEST_CART_IMPORTED',${runtime.termsVersion})`;
    }
    return {draft:original.draft};
  });
}
