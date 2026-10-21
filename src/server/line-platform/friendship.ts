import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import type { SessionPrincipal } from "@/lib/auth";
import { readBoundedText } from "@/server/delivery-platforms/bounded-text-reader";
import { hashPlatformSubject } from "./crypto";
import { getPlatformMember } from "./member-service";
import type { LinePlatformRuntime } from "./runtime";

export async function verifyPlatformFriendship(accessToken: string, binding: {
  channelId: string; providerId: string; environment: string; subjectHash: string;
}, fetchImpl: typeof fetch = fetch) {
  async function request(url: string, authenticated = false) {
    let response: Response, body: unknown;
    try {
      response = await fetchImpl(url, { redirect: "error", cache: "no-store", signal: AbortSignal.timeout(5000),
        ...(authenticated ? { headers: { Authorization: `Bearer ${accessToken}` } } : {}) });
      body = JSON.parse(await readBoundedText(response, 16_384));
    } catch { throw new Error("LINE_PLATFORM_FRIENDSHIP_UNAVAILABLE"); }
    if (!response.ok) throw new Error("LINE_PLATFORM_FRIENDSHIP_UNVERIFIED");
    return body;
  }
  // LINE requires the token in this fixed endpoint's query; never log that URL or the provider error.
  const token = z.object({ client_id: z.string(), expires_in: z.number().positive(), scope: z.string() }).safeParse(
    await request(`https://api.line.me/oauth2/v2.1/verify?${new URLSearchParams({ access_token: accessToken })}`));
  if (!token.success || token.data.client_id !== binding.channelId || !token.data.scope.split(" ").includes("profile")) {
    throw new Error("LINE_PLATFORM_FRIENDSHIP_UNVERIFIED");
  }
  const profile = z.object({ userId: z.string().regex(/^U[0-9a-f]{32}$/) }).safeParse(await request("https://api.line.me/v2/profile", true));
  if (!profile.success || hashPlatformSubject(binding.environment, binding.providerId, profile.data.userId) !== binding.subjectHash) {
    throw new Error("LINE_PLATFORM_FRIENDSHIP_UNVERIFIED");
  }
  const friendship = z.object({ friendFlag: z.boolean() }).safeParse(await request("https://api.line.me/friendship/v1/status", true));
  if (!friendship.success) throw new Error("LINE_PLATFORM_FRIENDSHIP_UNVERIFIED");
  return friendship.data.friendFlag;
}

export async function refreshPlatformFriendship(principal: SessionPrincipal, runtime: LinePlatformRuntime,
  accessToken: string, fetchImpl: typeof fetch = fetch) {
  const member = await getPlatformMember(principal);
  if (!member) throw new Error("LINE_PLATFORM_LOGIN_REQUIRED");
  const observedAt = new Date();
  const friend = await verifyPlatformFriendship(accessToken, { ...runtime, subjectHash: member.subject_hash }, fetchImpl);
  const status = friend ? "FRIEND" : "NOT_FRIEND_OR_BLOCKED";
  return prisma.$transaction(async db => {
    // Recheck membership after external I/O and serialize with revocation. No token is persisted.
    await db.$queryRaw`select m.profile_id from public.line_platform_members m join public.auth_identities a on a.id=m.auth_identity_id
      where m.profile_id=${member.profile_id}::uuid for share of m,a`;
    if (!await getPlatformMember(principal, db)) throw new Error("LINE_PLATFORM_LOGIN_REQUIRED");
    const [integration] = await db.$queryRaw<Array<{ id: string }>>`select id::text from public.notification_integrations
      where sender_scope='PLATFORM_OA' and environment=${runtime.environment} and provider_id=${runtime.providerId}
        and oa_destination=${runtime.oaDestination} and public_identifier=${runtime.oaChannelId} and status='ACTIVE'`;
    if (!integration) throw new Error("LINE_PLATFORM_FRIENDSHIP_UNAVAILABLE");
    await db.$executeRaw`insert into public.line_platform_friendships(environment,integration_id,provider_id,subject_hash,status,observed_at,event_id,source)
      values(${runtime.environment},${integration.id}::uuid,${runtime.providerId},${member.subject_hash},${status},${observedAt},${randomUUID()},'VERIFIED_API')
      on conflict(environment,integration_id,subject_hash) do update set status=excluded.status,observed_at=excluded.observed_at,event_id=excluded.event_id,source=excluded.source
      where line_platform_friendships.observed_at<excluded.observed_at`;
    const [current] = await db.$queryRaw<Array<{ status: string }>>`select status from public.line_platform_friendships
      where environment=${runtime.environment} and integration_id=${integration.id}::uuid and subject_hash=${member.subject_hash}`;
    return current.status;
  });
}
