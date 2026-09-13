import "server-only";
import { Prisma } from "@prisma/client";
import type { SessionPrincipal } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { complianceEnabled } from "./contracts";

export class ComplianceError extends Error {
  constructor(readonly code: string, readonly status = 409) { super(code); }
}
export function requireCompliance() {
  if (!complianceEnabled()) throw new ComplianceError("COMPLIANCE_UNAVAILABLE", 404);
}
export async function bindScope(tx: Prisma.TransactionClient, organizationId: string) {
  await tx.$queryRaw`select set_config('app.compliance_organization_id', ${organizationId}, true)`;
}
export async function withActor<T>(principal: SessionPrincipal, organizationId: string,
  mode: "SUBJECT" | "MANAGE" | "SUPPORT_READ", task: (tx: Prisma.TransactionClient) => Promise<T>) {
  requireCompliance();
  return prisma.$transaction(async (tx) => {
    const session = await tx.authSession.findFirst({ where: {
      id: principal.sessionId, profileId: principal.user.id, revokedAt: null, expiresAt: { gt: new Date() },
      profile: { isActive: true },
    }, include: { profile: true } });
    if (!session || session.profileSessionVersion !== session.profile.sessionVersion) throw new ComplianceError("SESSION_REVOKED", 401);
    const membership = await tx.organizationMembership.findFirst({ where: {
      organizationId, profileId: principal.user.id, isActive: true,
      ...(mode === "SUBJECT" ? {} : { role: "ORGANIZATION_OWNER" }),
    } });
    const ownStall = !membership && mode === "SUBJECT" ? await tx.stallMembership.findFirst({
      where: { organizationId, profileId: principal.user.id, isActive: true }, select: { id: true },
    }) : null;
    await bindScope(tx, organizationId);
    if (!membership && !ownStall) {
      if (mode !== "SUPPORT_READ" || session.profile.platformRole !== "PLATFORM_ADMIN") throw new ComplianceError("SCOPE_DENIED", 404);
      const grant = await tx.$queryRaw<{ id: string }[]>`select id from public.security_support_grants
        where organization_id = ${organizationId}::uuid and actor_profile_id = ${principal.user.id}::uuid
        and revoked_at is null and expires_at > now() and scope = 'PRIVACY_STATUS_READ'`;
      if (!grant.length) throw new ComplianceError("SCOPE_DENIED", 404);
    }
    return task(tx);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
