import "server-only";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { z } from "zod";
import type { SessionPrincipal } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canTransition, requestDueAt, type requestCommand, type requestTransition, type RequestType } from "./contracts";
import { digest, seal, unseal, subjectDigest } from "./crypto";
import { appendComplianceAudit } from "./audit";
import { bindScope, ComplianceError, requireCompliance, withActor } from "./access";
import { consumeStepUp } from "./step-up";
import { commandBinding } from "./governance-contracts";

type Subject = { organizationId: string; stallId?: string; orderId?: string; profileId?: string };
type RequestRow = {
  id: string; organization_id: string; request_type: RequestType; status: string; version: number;
  received_at: Date; due_at: Date; verified_at: Date | null; policy_version: string;
  details_ciphertext: string; decision_ciphertext: string | null; subject_profile_id: string | null;
};
export async function createPrivacyRequest(tx: Prisma.TransactionClient, subject: Subject,
  command: z.infer<typeof requestCommand>, requestId: string) {
  requireCompliance();
  await bindScope(tx, subject.organizationId);
  const id = randomUUID();
  const receipt = Buffer.from(subjectDigest(`receipt:${command.operationId}`, subject.organizationId), "hex").toString("base64url");
  const fingerprint = digest(JSON.stringify([subject, command]));
  const existing = await tx.$queryRaw<(RequestRow & { request_digest: string })[]>`select * from public.privacy_requests
    where organization_id = ${subject.organizationId}::uuid and operation_id = ${command.operationId}::uuid`;
  if (existing.length) {
    const row = existing[0];
    if (row.request_digest !== fingerprint) throw new ComplianceError("IDEMPOTENCY_CONFLICT");
    return { id: row.id, organizationId: subject.organizationId, receipt, type: row.request_type, status: row.status,
      receivedAt: row.received_at.toISOString(), dueAt: row.due_at.toISOString() };
  }
  const policies = await tx.$queryRaw<{ version: string }[]>`select version from public.privacy_policy_versions
    where version = ${command.policyVersion} and approved_by is not null and effective_at <= now()`;
  if (!policies.length) throw new ComplianceError("PRIVACY_POLICY_NOT_APPROVED", 503);
  const now = new Date();
  const dueAt = requestDueAt(now, command.type);
  const ciphertext = seal(command.details, { organizationId: subject.organizationId, recordId: id, field: "details" });
  await tx.$executeRaw`insert into public.privacy_requests
    (id, organization_id, stall_id, order_id, subject_profile_id, receipt_hash, operation_id, request_digest,
     request_type, policy_version, details_ciphertext, received_at, due_at, verified_at)
    values (${id}::uuid, ${subject.organizationId}::uuid, ${subject.stallId ?? null}::uuid, ${subject.orderId ?? null}::uuid,
    ${subject.profileId ?? null}::uuid, ${digest(receipt)}, ${command.operationId}::uuid, ${fingerprint}, ${command.type},
    ${command.policyVersion}, ${ciphertext}, ${now}, ${dueAt}, ${now})`;
  await appendComplianceAudit(tx, { organizationId: subject.organizationId, actorId: subject.profileId,
    action: "PRIVACY_REQUEST_RECEIVED", entityId: id, requestId, version: 1 });
  return { id, organizationId: subject.organizationId, receipt, type: command.type, status: "RECEIVED", receivedAt: now.toISOString(), dueAt: dueAt.toISOString() };
}
export async function getPrivacyReceipt(receipt: string, organizationId: string, requestId: string) {
  requireCompliance();
  if (!/^[A-Za-z0-9_-]{43}$/.test(receipt)) throw new ComplianceError("REQUEST_NOT_FOUND", 404);
  return prisma.$transaction(async (tx) => {
    await bindScope(tx, organizationId);
    const rows = await tx.$queryRaw<RequestRow[]>`select * from public.privacy_requests
      where organization_id = ${organizationId}::uuid and receipt_hash = ${digest(receipt)}`;
    const row = rows[0];
    if (!row) throw new ComplianceError("REQUEST_NOT_FOUND", 404);
    await bindScope(tx, row.organization_id);
    await appendComplianceAudit(tx, { organizationId: row.organization_id, action: "PRIVACY_RECEIPT_READ", entityId: row.id, requestId });
    return { id: row.id, type: row.request_type, status: row.status, version: row.version,
      receivedAt: row.received_at.toISOString(), dueAt: row.due_at.toISOString(),
      decision: row.decision_ciphertext ? unseal(row.decision_ciphertext, { organizationId: row.organization_id, recordId: row.id, field: "decision" }) : null };
  });
}
export async function listPrivacyRequests(principal: SessionPrincipal, organizationId: string, page: number, requestId: string) {
  return withActor(principal, organizationId, "SUPPORT_READ", async (tx) => {
    const rows = await tx.$queryRaw<RequestRow[]>`select id, request_type, status, version, received_at, due_at
      from public.privacy_requests where organization_id = ${organizationId}::uuid
      order by received_at desc, id limit 5 offset ${(page - 1) * 5}`;
    await appendComplianceAudit(tx, { organizationId, actorId: principal.user.id,
      action: "PRIVACY_WORKBENCH_READ", entityId: organizationId, requestId });
    return rows;
  });
}
export async function transitionPrivacyRequest(principal: SessionPrincipal, organizationId: string,
  command: z.infer<typeof requestTransition>, requestId: string, stepUp: string | null = null) {
  return withActor(principal, organizationId, "MANAGE", async (tx) => {
    const rows = await tx.$queryRaw<RequestRow[]>`select * from public.privacy_requests
      where id = ${command.id}::uuid and organization_id = ${organizationId}::uuid for update`;
    const row = rows[0];
    if (!row) throw new ComplianceError("REQUEST_NOT_FOUND", 404);
    if (row.version !== command.expectedVersion || !canTransition(row.status, command.status)) throw new ComplianceError("STALE_REQUEST");
    if (command.status === "APPROVED") await consumeStepUp(tx, principal, "PRIVACY_APPROVE", digest(commandBinding(organizationId, command)), stepUp);
    if (["APPROVED", "EXECUTING", "COMPLETED"].includes(command.status) && !row.verified_at) throw new ComplianceError("IDENTITY_NOT_VERIFIED");
    if (command.status === "COMPLETED") {
      // Completion needs a real executor, not an administrative status toggle.
      throw new ComplianceError("EXECUTION_EVIDENCE_REQUIRED");
    }
    const message = seal(command.reason, { organizationId, recordId: row.id, field: "decision" });
    await tx.$executeRaw`update public.privacy_requests set status = ${command.status}, version = version + 1,
      decision_ciphertext = ${message}, decision_at = now() where id = ${row.id}::uuid and organization_id = ${organizationId}::uuid`;
    await tx.$executeRaw`insert into public.privacy_request_events (organization_id, request_id, event_type, actor_profile_id, message_ciphertext)
      values (${organizationId}::uuid, ${row.id}::uuid, ${command.status}, ${principal.user.id}::uuid, ${message})`;
    await appendComplianceAudit(tx, { organizationId, actorId: principal.user.id, action: "PRIVACY_REQUEST_TRANSITION",
      entityId: row.id, requestId, version: row.version + 1 });
    return { id: row.id, status: command.status, version: row.version + 1 };
  });
}
