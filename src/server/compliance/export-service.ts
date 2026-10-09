import "server-only";
import type { SessionPrincipal } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { bindScope, ComplianceError, requireCompliance } from "./access";
import { appendComplianceAudit } from "./audit";
import { digest, unseal } from "./crypto";

export async function receivePrivacyExport(input: { organizationId: string; receipt: string; acknowledgement?: string }, principal: SessionPrincipal | null, requestId: string) {
  requireCompliance();
  return prisma.$transaction(async (tx) => {
    await bindScope(tx, input.organizationId);
    const requests = await tx.$queryRaw<{ id: string; subject_profile_id: string | null; status: string; verified_at: Date | null }[]>`
      select id, subject_profile_id, status, verified_at from public.privacy_requests
      where organization_id = ${input.organizationId}::uuid and receipt_hash = ${digest(input.receipt)} for update`;
    const row = requests[0];
    if (!row?.verified_at || !["EXECUTING", "COMPLETED"].includes(row.status)) throw new ComplianceError("EXPORT_NOT_FOUND", 404);
    if (row.subject_profile_id) {
      if (!principal || principal.user.id !== row.subject_profile_id) throw new ComplianceError("LOGIN_REQUIRED", 401);
      const session = await tx.authSession.findFirst({ where: { id: principal.sessionId, profileId: row.subject_profile_id,
        revokedAt: null, expiresAt: { gt: new Date() }, profile: { isActive: true } }, include: { profile: true } });
      if (!session || session.profileSessionVersion !== session.profile.sessionVersion) throw new ComplianceError("SESSION_REVOKED", 401);
    }
    const exports = await tx.$queryRaw<{ id: string; content_ciphertext: string; content_sha256: string; downloaded_at: Date | null }[]>`
      select id, content_ciphertext, content_sha256, downloaded_at from public.privacy_exports
      where organization_id = ${input.organizationId}::uuid and request_id = ${row.id}::uuid
      and revoked_at is null and expires_at > now() order by created_at desc, id desc limit 1 for update`;
    const item = exports[0];
    if (!item) throw new ComplianceError("EXPORT_NOT_FOUND", 404);
    if (input.acknowledgement) {
      if (!item.downloaded_at || item.content_sha256 !== input.acknowledgement) throw new ComplianceError("EXPORT_ACK_INVALID");
      await tx.$executeRaw`update public.privacy_requests set status = 'COMPLETED', version = version + 1,
        execution_evidence = ${`requester-ack:${item.id}:${item.content_sha256}`} where id = ${row.id}::uuid
        and organization_id = ${input.organizationId}::uuid and status = 'EXECUTING'`;
    } else await tx.$executeRaw`update public.privacy_exports set downloaded_at = now()
      where id = ${item.id}::uuid and organization_id = ${input.organizationId}::uuid`;
    await appendComplianceAudit(tx, { organizationId: input.organizationId, actorId: principal?.user.id,
      action: input.acknowledgement ? "PRIVACY_EXPORT_ACKNOWLEDGED" : "PRIVACY_EXPORT_DISCLOSED", entityId: item.id, requestId });
    if (input.acknowledgement) return { acknowledged: true };
    const content = unseal(item.content_ciphertext, { organizationId: input.organizationId, recordId: item.id, field: "export" });
    if (digest(content) !== item.content_sha256) throw new ComplianceError("EXPORT_INTEGRITY_FAILED", 503);
    return { exportId: item.id, sha256: item.content_sha256, data: JSON.parse(content) };
  });
}
