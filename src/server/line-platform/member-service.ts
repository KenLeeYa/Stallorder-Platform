import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { SessionPrincipal } from "@/lib/auth";
import { decryptPlatformValue, hashPlatformSubject } from "./crypto";
import { getLinePlatformRuntime } from "./runtime";

export type PlatformMember = {
  profile_id: string; auth_identity_id: string; environment: string; provider_id: string;
  subject_hash: string; subject_ciphertext: string; terms_version: string;
  terms_accepted_at: Date; notification_consent: boolean; revoked_at: Date | null;
};

export async function hasPlatformIdentity(principal: SessionPrincipal | null) {
  const runtime = getLinePlatformRuntime();
  if (!principal || !runtime) return false;
  return Boolean(await prisma.authIdentity.findFirst({ where: { profileId: principal.user.id, provider: "LINE", revokedAt: null,
    providerSubject: { startsWith: `miniapp:${runtime.environment}:${runtime.providerId}:` } }, select: { id: true } }));
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
  termsVersion: string; acceptTerms: boolean;
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
        ${subjectHash},${metadata.subjectCiphertext!},${runtime.termsVersion},now(),'MINI_APP',false)
      on conflict(profile_id) do update set terms_version=excluded.terms_version,
        terms_accepted_at=excluded.terms_accepted_at
      where line_platform_members.auth_identity_id=excluded.auth_identity_id
        and line_platform_members.revoked_at is null`;
    if (written !== 1) throw new Error("LINE_PLATFORM_IDENTITY_MISMATCH");
    await db.$executeRaw`insert into public.line_platform_member_audit(profile_id,event_type,terms_version)
      values (${principal.user.id}::uuid,'TERMS_ACCEPTED',${runtime.termsVersion})`;
  });
  return getPlatformMember(principal);
}
