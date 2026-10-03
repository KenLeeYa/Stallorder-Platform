import "server-only";
import type { Prisma } from "@prisma/client";
import { digest } from "./crypto";

export async function appendComplianceAudit(tx: Prisma.TransactionClient, input: {
  organizationId: string; actorId?: string; effectiveActorId?: string;
  requestId: string; action: string; entityId: string; outcome?: "SUCCESS" | "DENIED";
  version?: number;
}) {
  const fields = {
    schemaVersion: 1, effectiveActorId: input.effectiveActorId ?? input.actorId ?? null,
    policy: "security-privacy-20260913", version: input.version ?? null,
    environment: process.env.APP_ENV ?? "UNKNOWN",
    releaseSha: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA ?? "LOCAL_UNRELEASED",
  };
  const event = await tx.auditLog.create({ data: {
    organizationId: input.organizationId, actorProfileId: input.actorId,
    action: input.action, entityType: "PRIVACY_GOVERNANCE", entityId: input.entityId,
    outcome: input.outcome ?? "SUCCESS", requestId: input.requestId, afterJson: fields,
  } });
  const eventDigest = digest(JSON.stringify({
    id: event.id, organizationId: input.organizationId, actorId: input.actorId ?? null,
    action: input.action, entityId: input.entityId, outcome: input.outcome ?? "SUCCESS",
    requestId: input.requestId, occurredAt: event.createdAt.toISOString(), ...fields,
  }));
  await tx.$executeRaw`insert into public.audit_archive_outbox (audit_id, organization_id, event_digest)
    values (${event.id}::uuid, ${input.organizationId}::uuid, ${eventDigest})`;
  // No catch: governed business writes/read disclosure cannot outlive their audit failure.
}
