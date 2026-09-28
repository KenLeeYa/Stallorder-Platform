import "server-only";
import { createHash, createHmac } from "node:crypto";
import type { SessionPrincipal } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { bindPlatformOrderOwner } from "./member-service";
import { getLinePlatformRuntime, type LinePlatformRuntime } from "./runtime";
import { decryptPlatformValue, encryptPlatformValue } from "./crypto";

export function guestClaimCookieName(trackingToken: string) {
  return `stallorder_line_guest_claim_${createHash("sha256").update(trackingToken).digest("hex").slice(0,24)}`;
}
export function issueGuestClaimProof(sessionToken: string, trackingToken: string, deviceId: string) {
  const runtime = getLinePlatformRuntime();
  if (!runtime) return null;
  return encryptPlatformValue(JSON.stringify({ environment:runtime.environment,providerId:runtime.providerId,
    sessionHash:createHash("sha256").update(sessionToken).digest("hex"),
    trackingHash:createHash("sha256").update(trackingToken).digest("hex"), deviceId,expiresAt:Date.now()+24*60*60*1000 }),"original-guest-session-claim-v1");
}

export function readGuestClaimProof(trackingToken: string, deviceId: string, proof: string, runtime: LinePlatformRuntime | null = getLinePlatformRuntime()) {
  if (!runtime) return null;
  try {
    const original=JSON.parse(decryptPlatformValue(proof,"original-guest-session-claim-v1")) as {environment:string;providerId:string;sessionHash:string;trackingHash:string;deviceId:string;expiresAt:number};
    if (original.environment!==runtime.environment || original.providerId!==runtime.providerId || original.deviceId!==deviceId
      || original.trackingHash!==createHash("sha256").update(trackingToken).digest("hex")
      || !Number.isFinite(original.expiresAt) || original.expiresAt<=Date.now() || !/^[0-9a-f]{64}$/.test(original.sessionHash)) return null;
    return original;
  } catch { return null; }
}

/** Circuit A has already committed. Verify its original capabilities without replaying intake. */
export async function exchangeGuestClaimProof(sessionToken: string, trackingToken: string, deviceId: string) {
  const runtime=getLinePlatformRuntime(),secret=process.env.ABUSE_HASH_SECRET;
  if (!runtime || !secret) return null;
  const sessionHash=createHash("sha256").update(sessionToken).digest("hex");
  const trackingHash=createHash("sha256").update(trackingToken).digest("hex");
  const deviceHash=createHmac("sha256",secret).update(`device:${deviceId}`).digest("hex");
  const rows=await prisma.$queryRaw<Array<{id:string}>>`select o.id from public.orders o
    join public.order_sessions s on s.order_id=o.id and s.organization_id=o.organization_id and s.stall_id=o.stall_id
    join public.line_platform_stalls pilot on pilot.stall_id=o.stall_id and pilot.environment=${runtime.environment} and pilot.enabled and o.created_at>=pilot.cutover_at
    where s.token_hash=${sessionHash} and s.line_platform_cart_claim_profile_id is null and s.status='CONSUMED' and s.revoked_at is null and s.device_hash=${deviceHash}
      and o.tracking_token_hash=${trackingHash} and o.device_hash=${deviceHash} and o.status::text not in ('COMPLETED','CANCELLED','EXPIRED')
      and not exists(select 1 from public.customer_contact_links l join public.notification_integrations i on i.id=l.integration_id
        where l.customer_reference_id=o.id and i.sender_scope<>'PLATFORM_OA')`;
  return rows.length ? issueGuestClaimProof(sessionToken,trackingToken,deviceId) : null;
}

/** Original long tracking capability AND original used order session/device, plus current member. */
export async function claimGuestPlatformOrder(principal: SessionPrincipal, trackingToken: string, deviceId: string, proof: string) {
  const runtime = getLinePlatformRuntime();
  const secret = process.env.ABUSE_HASH_SECRET;
  if (!runtime || !secret || !/^sto_[A-Za-z0-9_-]{43}$/.test(trackingToken)
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(deviceId)) throw new Error("LINE_PLATFORM_ORDER_NOT_FOUND");
  const trackingHash = createHash("sha256").update(trackingToken).digest("hex");
  const original=readGuestClaimProof(trackingToken,deviceId,proof,runtime);
  if (!original) throw new Error("LINE_PLATFORM_ORDER_NOT_FOUND");
  const deviceHash = createHmac("sha256", secret).update(`device:${deviceId}`).digest("hex");
  return prisma.$transaction(async db => {
    const rows = await db.$queryRaw<Array<{ id: string }>>`select o.id from public.orders o
      join public.order_sessions s on s.order_id=o.id and s.stall_id=o.stall_id and s.organization_id=o.organization_id
      where o.tracking_token_hash=${trackingHash} and o.device_hash=${deviceHash} and s.device_hash=${deviceHash}
        and s.status='CONSUMED' and s.revoked_at is null and s.token_hash=${original.sessionHash}
        and (s.line_platform_cart_claim_profile_id is null or s.line_platform_cart_claim_profile_id=${principal.user.id}::uuid)
        and o.status::text not in ('COMPLETED','CANCELLED','EXPIRED') for update of o,s`;
    if (!rows[0]) throw new Error("LINE_PLATFORM_ORDER_NOT_FOUND");
    await bindPlatformOrderOwner(db,rows[0].id,{profileId:principal.user.id,runtime});
    await db.$executeRaw`insert into public.line_platform_member_audit(profile_id,event_type,terms_version)
      values(${principal.user.id}::uuid,'ORIGINAL_GUEST_SESSION_CLAIMED',${runtime.termsVersion})`;
    return rows[0].id;
  });
}
