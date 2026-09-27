import "server-only";
import { createHash, createHmac } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { PublicOrderCircuitError } from "@/server/public-order/circuit-b-service";
import type { PlatformMember, PlatformOrderContext } from "./member-service";
import type { LinePlatformRuntime } from "./runtime";

/** Public B keeps guest behavior, but a verified pilot member uses the same atomic MINI owner binding. */
export async function resolvePublicPlatformOrderContext(
  input: { orderSessionToken: string; qrToken: string; deviceId: string },
  member: PlatformMember | null,
  runtime: LinePlatformRuntime,
): Promise<PlatformOrderContext | null> {
  const secret = process.env.ABUSE_HASH_SECRET;
  if (!secret) return null; // The original intake owns its required configuration errors.
  const tokenHash = createHash("sha256").update(input.orderSessionToken).digest("hex");
  const deviceHash = createHmac("sha256", secret).update(`device:${input.deviceId}`).digest("hex");
  const [session] = await prisma.$queryRaw<Array<{
    claimed_profile_id: string | null; owner_profile_id: string | null; eligible: boolean;
  }>>`select s.line_platform_cart_claim_profile_id as claimed_profile_id,own.profile_id as owner_profile_id,
      coalesce(p.enabled and s.created_at>=p.cutover_at,false) as eligible
    from public.order_sessions s
    join public.qr_codes q on q.id=s.qr_code_id and q.stall_id=s.stall_id and q.organization_id=s.organization_id
    left join public.line_platform_stalls p on p.stall_id=s.stall_id and p.environment=${runtime.environment}
    left join public.line_platform_order_owners own on own.order_id=s.order_id
    where s.token_hash=${tokenHash} and s.device_hash=${deviceHash} and q.token=${input.qrToken}`;
  if (!session) return null; // The original session/device/QR validation still runs.
  if ((session.claimed_profile_id && session.claimed_profile_id !== member?.profile_id)
    || (session.owner_profile_id && session.owner_profile_id !== member?.profile_id)) {
    throw new PublicOrderCircuitError("LINE_PLATFORM_OWNER_CONFLICT", 403);
  }
  if (!member || (!session.eligible && !session.owner_profile_id)) return null;
  if (member.terms_version !== runtime.termsVersion) {
    throw new PublicOrderCircuitError("LINE_PLATFORM_MEMBERSHIP_REQUIRED", 403);
  }
  return { profileId: member.profile_id, runtime };
}
