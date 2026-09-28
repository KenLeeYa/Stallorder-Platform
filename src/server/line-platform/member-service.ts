import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { SessionPrincipal } from "@/lib/auth";
import { decryptPlatformValue, hashPlatformSubject } from "./crypto";
import { getLinePlatformRuntime, type LinePlatformRuntime } from "./runtime";

export type PlatformMember = {
  profile_id: string; auth_identity_id: string; environment: string; provider_id: string;
  subject_hash: string; subject_ciphertext: string; terms_version: string;
  terms_accepted_at: Date; notification_consent: boolean; revoked_at: Date | null;
};
export type PlatformOrderContext = { profileId: string; runtime: LinePlatformRuntime };

export async function hasPlatformIdentity(principal: SessionPrincipal | null) {
  const runtime = getLinePlatformRuntime();
  if (!principal || !runtime) return false;
  return Boolean(await prisma.authIdentity.findFirst({ where: { profileId: principal.user.id, provider: "LINE", revokedAt: null,
    providerSubject: { startsWith: `miniapp:${runtime.environment}:${runtime.providerId}:` } }, select: { id: true } }));
}

export async function listPlatformOrders(principal: SessionPrincipal, query: { history: boolean; page: number; stallId: string | null }) {
  const member = await getPlatformMember(principal);
  if (!member) throw new Error("LINE_PLATFORM_LOGIN_REQUIRED");
  const page = Math.max(1, Math.min(1000, Number.isInteger(query.page) ? query.page : 1));
  return prisma.$queryRaw<Array<{ id: string; order_no: string; store_name: string; status: string; total: number; created_at: Date }>>`
    select o.id,o.order_no,s.name as store_name,o.status::text,o.total,o.created_at from public.line_platform_order_owners own
      join public.orders o on o.id=own.order_id join public.stalls s on s.id=o.stall_id
      where own.profile_id=${member.profile_id}::uuid and own.environment=${member.environment}
        and (${query.stallId}::uuid is null or o.stall_id=${query.stallId}::uuid)
        and (o.status::text in ('COMPLETED','CANCELLED','EXPIRED'))=${query.history}
      order by o.created_at desc,o.id desc limit 21 offset ${(page-1)*20}`;
}

export async function getPlatformMember(principal: SessionPrincipal | null, db: Prisma.TransactionClient = prisma) {
  const runtime = getLinePlatformRuntime();
  if (!runtime || !principal) return null;
  const rows = await db.$queryRaw<PlatformMember[]>`
    select m.* from public.line_platform_members m join public.auth_identities a on a.id=m.auth_identity_id
    where m.profile_id=${principal.user.id}::uuid and m.environment=${runtime.environment}
      and m.provider_id=${runtime.providerId} and m.revoked_at is null and a.revoked_at is null`;
  return rows[0] ?? null;
}

export async function acceptPlatformMembership(principal: SessionPrincipal, input: {
  termsVersion: string; acceptTerms: boolean; notificationConsent: boolean;
}) {
  const runtime = getLinePlatformRuntime();
  if (!runtime || !input.acceptTerms || input.termsVersion !== runtime.termsVersion) {
    throw new Error("LINE_PLATFORM_TERMS_REQUIRED");
  }
  await prisma.$transaction(async db => {
    // Serialize enrollment with identity revocation; do not enroll from a stale pre-transaction read.
    await db.$queryRaw`select id from public.auth_identities where profile_id=${principal.user.id}::uuid
      and provider='LINE' and revoked_at is null for share`;
    const identity = await db.authIdentity.findFirst({ where: { profileId: principal.user.id,
      provider: "LINE", revokedAt: null,
      providerSubject: { startsWith: `miniapp:${runtime.environment}:${runtime.providerId}:` } } });
    const metadata = identity?.providerMetadata as { subjectCiphertext?: string } | null;
    if (!identity || !metadata?.subjectCiphertext) throw new Error("LINE_PLATFORM_LOGIN_REQUIRED");
    const subjectHash = hashPlatformSubject(runtime.environment, runtime.providerId, decryptPlatformValue(metadata.subjectCiphertext));
    if (identity.providerSubject !== `miniapp:${runtime.environment}:${runtime.providerId}:${subjectHash}`) {
      throw new Error("LINE_PLATFORM_IDENTITY_MISMATCH");
    }
    // Existing operator memberships are never created or used to authorize customers.
    const written = await db.$executeRaw`insert into public.line_platform_members
      (profile_id,auth_identity_id,environment,provider_id,subject_hash,subject_ciphertext,
       terms_version,terms_accepted_at,terms_source,notification_consent)
      values (${principal.user.id}::uuid,${identity.id}::uuid,${runtime.environment},${runtime.providerId},
        ${subjectHash},${metadata.subjectCiphertext!},${runtime.termsVersion},now(),'MINI_APP',${input.notificationConsent})
      on conflict(profile_id) do update set terms_version=excluded.terms_version,
        terms_accepted_at=excluded.terms_accepted_at,notification_consent=excluded.notification_consent,
        consent_updated_at=now()
      where line_platform_members.auth_identity_id=excluded.auth_identity_id
        and line_platform_members.revoked_at is null`;
    if (written !== 1) throw new Error("LINE_PLATFORM_IDENTITY_MISMATCH");
    await db.$executeRaw`insert into public.line_platform_member_audit(profile_id,event_type,terms_version)
      values (${principal.user.id}::uuid,${input.notificationConsent ? "TERMS_AND_TRANSACTION_NOTIFICATIONS_ACCEPTED" : "TERMS_ACCEPTED_NOTIFICATIONS_DECLINED"},${runtime.termsVersion})`;
  });
  return getPlatformMember(principal);
}

export async function requirePlatformOrderOwner(principal: SessionPrincipal | null, orderId: string) {
  const member = await getPlatformMember(principal);
  if (!member || !/^[0-9a-f-]{36}$/i.test(orderId)) throw new Error("LINE_PLATFORM_ORDER_NOT_FOUND");
  const owners = await prisma.$queryRaw<Array<{ order_id: string }>>`
    select order_id from public.line_platform_order_owners where order_id=${orderId}::uuid
      and profile_id=${member.profile_id}::uuid and environment=${member.environment}`;
  if (!owners.length) throw new Error("LINE_PLATFORM_ORDER_NOT_FOUND");
  return member;
}

/** Called only after the original session/device validation inside order intake. */
export async function bindPlatformOrderOwner(db: Prisma.TransactionClient, orderId: string, context: PlatformOrderContext) {
  const member = await db.$queryRaw<PlatformMember[]>`
    select m.* from public.line_platform_members m join public.auth_identities a on a.id=m.auth_identity_id
      where m.profile_id=${context.profileId}::uuid and m.environment=${context.runtime.environment}
        and m.provider_id=${context.runtime.providerId} and m.revoked_at is null and a.revoked_at is null for share of m,a`;
  if (!member[0] || member[0].terms_version !== context.runtime.termsVersion) throw new Error("LINE_PLATFORM_MEMBERSHIP_REQUIRED");
  const sessions = await db.$queryRaw<Array<{ line_platform_cart_claim_profile_id: string | null }>>`
    select line_platform_cart_claim_profile_id from public.order_sessions where order_id=${orderId}::uuid for update`;
  if (sessions.some(session => session.line_platform_cart_claim_profile_id && session.line_platform_cart_claim_profile_id !== context.profileId)) {
    throw new Error("LINE_PLATFORM_OWNER_CONFLICT");
  }
  const existing = await db.$queryRaw<Array<{ profile_id: string; environment: string; provider_id: string; subject_hash: string }>>`
    select profile_id,environment,provider_id,subject_hash from public.line_platform_order_owners where order_id=${orderId}::uuid`;
  if (existing[0]) {
    if (existing[0].profile_id !== context.profileId || existing[0].environment !== context.runtime.environment
      || existing[0].provider_id !== context.runtime.providerId || existing[0].subject_hash !== member[0].subject_hash) throw new Error("LINE_PLATFORM_OWNER_CONFLICT");
    return; // Replay still succeeds after pilot shutdown; immutable sender and events stay unchanged.
  }
  const legacy = await db.$queryRaw<Array<{ id: string }>>`select l.id from public.customer_contact_links l
    join public.notification_integrations i on i.id=l.integration_id
    where l.customer_reference_id=${orderId}::uuid and l.provider='LINE' and i.sender_scope<>'PLATFORM_OA'`;
  if (legacy.length) throw new Error("LINE_PLATFORM_LEGACY_ORDER_CANNOT_RELINK");
  await db.$executeRaw`insert into public.line_platform_order_owners(order_id,profile_id,environment,provider_id,subject_hash,pickup_required)
    select id,${context.profileId}::uuid,${context.runtime.environment},${context.runtime.providerId},${member[0].subject_hash},
      (${context.runtime.pickupEnabled} and fulfillment_type='TAKEOUT') from public.orders where id=${orderId}::uuid
    on conflict(order_id) do nothing`;
  const owners = await db.$queryRaw<Array<{ profile_id: string }>>`select profile_id from public.line_platform_order_owners where order_id=${orderId}::uuid`;
  if (owners[0]?.profile_id !== context.profileId) throw new Error("LINE_PLATFORM_OWNER_CONFLICT");
  const { bindPlatformOrderNotifications } = await import("./notification-binding");
  await bindPlatformOrderNotifications(orderId, context.runtime, db);
}
