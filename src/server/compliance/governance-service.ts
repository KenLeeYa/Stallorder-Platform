import "server-only";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { SessionPrincipal } from "@/lib/auth";
import { withActor, ComplianceError } from "./access";
import { appendComplianceAudit } from "./audit";
import { digest, seal, unseal } from "./crypto";
import { requestDueAt, type RequestType } from "./contracts";
import { commandBinding, governedAction, type GovernanceCommand } from "./governance-contracts";
import { consumeStepUp } from "./step-up";
import { deletionPlan, executeDeletion } from "./retention";

type Row = { id: string; organization_id: string; stall_id: string | null; order_id: string | null;
  subject_profile_id: string | null; request_type: RequestType; received_at: Date; due_at: Date; status: string;
  details_ciphertext: string; verified_at: Date | null; version: number; extension_days: number; policy_version: string };
export async function privacySubjectData(tx: Prisma.TransactionClient, row: Row) {
  // Explicit projection: no payment credentials, staff notes, tokens or other customers.
  if (row.order_id) {
    const order = await tx.order.findFirst({ where: { id: row.order_id, organizationId: row.organization_id, stallId: row.stall_id! },
      select: { id: true, orderNo: true, customerName: true, customerPhone: true, deliveryAddress: true,
        note: true, fulfillmentType: true, status: true, paymentStatus: true, total: true, createdAt: true,
        items: { select: { name: true, quantity: true, unitPrice: true } } } });
    if (!order) throw new ComplianceError("REQUEST_NOT_FOUND", 404);
    return { schemaVersion: 1, scope: "SINGLE_VERIFIED_ORDER", order };
  }
  const profile = await tx.profile.findFirst({ where: { id: row.subject_profile_id! },
    select: { id: true, displayName: true, email: true, emailVerified: true, createdAt: true } });
  if (!profile) throw new ComplianceError("REQUEST_NOT_FOUND", 404);
  return { schemaVersion: 1, scope: "VERIFIED_ACCOUNT_PROFILE", profile };
}
export async function runGovernanceCommand(principal: SessionPrincipal, organizationId: string,
  command: GovernanceCommand, requestId: string, stepUp: string | null) {
  return withActor(principal, organizationId, "MANAGE", async (tx) => {
    const proofAction = governedAction(command);
    if (proofAction) await consumeStepUp(tx, principal, proofAction, digest(commandBinding(organizationId, command)), stepUp);
    let entityId = organizationId;
    let result: unknown;
    if (command.action === "SUPPORT_GRANT") {
      if (command.actorId === principal.user.id) throw new ComplianceError("SUPPORT_SELF_APPROVAL_DENIED", 403);
      const actor = await tx.profile.findFirst({ where: { id: command.actorId, isActive: true, platformRole: "PLATFORM_ADMIN" }, select: { id: true } });
      if (!actor) throw new ComplianceError("SUPPORT_ACTOR_INVALID", 404);
      entityId = randomUUID();
      await tx.$executeRaw`insert into public.security_support_grants(id, organization_id, actor_profile_id, approved_by, purpose, expires_at)
        values (${entityId}::uuid, ${organizationId}::uuid, ${actor.id}::uuid, ${principal.user.id}::uuid,
          ${command.purpose}, ${new Date(Date.now() + command.minutes * 60000)})`;
      result = { id: entityId, scope: "PRIVACY_STATUS_READ", minutes: command.minutes };
    } else if (command.action === "SUPPORT_REVOKE") {
      entityId = command.id;
      const changed = await tx.$executeRaw`update public.security_support_grants set revoked_at = now()
        where id = ${command.id}::uuid and organization_id = ${organizationId}::uuid and revoked_at is null`;
      if (changed !== 1) throw new ComplianceError("GRANT_NOT_FOUND", 404);
      result = { id: entityId, revoked: true };
    } else if (command.action === "HOLD") {
      const now = Date.now();
      if (Date.parse(command.reviewAt) <= now || Date.parse(command.reviewAt) > Date.parse(command.expiresAt)
        || (!!command.orderId !== !!command.stallId)) throw new ComplianceError("HOLD_SCOPE_INVALID", 400);
      entityId = randomUUID();
      const message = seal(command.reason, { organizationId, recordId: entityId, field: "hold" });
      await tx.$executeRaw`insert into public.privacy_legal_holds
        (id, organization_id, order_id, stall_id, data_classes, reason_ciphertext, approved_by, review_at, expires_at)
        values (${entityId}::uuid, ${organizationId}::uuid, ${command.orderId}::uuid, ${command.stallId}::uuid,
          ${command.classes}::text[], ${message}, ${principal.user.id}::uuid, ${new Date(command.reviewAt)}, ${new Date(command.expiresAt)})`;
      result = { id: entityId, reviewAt: command.reviewAt, expiresAt: command.expiresAt };
    } else if (command.action === "RELEASE_HOLD") {
      entityId = command.id;
      const message = seal(command.reason, { organizationId, recordId: entityId, field: "holdRelease" });
      const changed = await tx.$executeRaw`update public.privacy_legal_holds set released_at = now(), released_by = ${principal.user.id}::uuid,
        release_reason_ciphertext = ${message} where id = ${entityId}::uuid and organization_id = ${organizationId}::uuid and released_at is null`;
      if (changed !== 1) throw new ComplianceError("HOLD_NOT_FOUND", 404);
      result = { id: entityId, released: true };
    } else if (command.action === "REVOKE_EXPORT") {
      entityId = command.id;
      const changed = await tx.$executeRaw`update public.privacy_exports set revoked_at = now()
        where id = ${entityId}::uuid and organization_id = ${organizationId}::uuid and revoked_at is null`;
      if (changed !== 1) throw new ComplianceError("EXPORT_NOT_FOUND", 404);
      result = { id: entityId, revoked: true };
    } else {
      const rows = await tx.$queryRaw<Row[]>`select * from public.privacy_requests
        where id = ${command.id}::uuid and organization_id = ${organizationId}::uuid for update`;
      const row = rows[0];
      if (!row) throw new ComplianceError("REQUEST_NOT_FOUND", 404);
      entityId = row.id;
      if ("expectedVersion" in command && row.version !== command.expectedVersion) throw new ComplianceError("STALE_REQUEST");
      if (command.action === "DETAIL") {
        result = { id: row.id, details: unseal(row.details_ciphertext, { organizationId, recordId: row.id, field: "details" }),
          type: row.request_type, status: row.status, verifiedAt: row.verified_at, dueAt: row.due_at };
      } else if (command.action === "EXTEND") {
        const notifiedAt = new Date(command.notifiedAt);
        if (["COMPLETED", "REJECTED"].includes(row.status) || row.extension_days > 0 || notifiedAt > new Date()
          || notifiedAt < row.received_at || notifiedAt > row.due_at) throw new ComplianceError("EXTENSION_INVALID");
        const due = requestDueAt(row.received_at, row.request_type, command.days);
        const message = seal(command.reason, { organizationId, recordId: row.id, field: "extension" });
        await tx.$executeRaw`update public.privacy_requests set extension_days = ${command.days}, due_at = ${due}, version = version + 1,
          extension_reason_ciphertext = ${message}, extension_notified_at = ${notifiedAt}, extension_delivery_evidence = ${command.deliveryEvidence}
          where id = ${row.id}::uuid and organization_id = ${organizationId}::uuid`;
        result = { id: row.id, dueAt: due, version: row.version + 1 };
      } else if (command.action === "DELETE_PREVIEW") {
        if (row.request_type !== "DELETE") throw new ComplianceError("REQUEST_TYPE_MISMATCH");
        result = await deletionPlan(tx, row);
      } else {
        if (!["APPROVED", "EXECUTING"].includes(row.status) || !row.verified_at) throw new ComplianceError("APPROVED_VERIFIED_REQUEST_REQUIRED");
        if (command.action === "EXPORT") {
          if (!["ACCESS", "COPY"].includes(row.request_type)) throw new ComplianceError("REQUEST_TYPE_MISMATCH");
          const exportId = randomUUID(); const content = JSON.stringify(await privacySubjectData(tx, row));
          const ciphertext = seal(content, { organizationId, recordId: exportId, field: "export" });
          await tx.$executeRaw`insert into public.privacy_exports(id, organization_id, request_id, content_ciphertext, content_sha256, expires_at)
            values (${exportId}::uuid, ${organizationId}::uuid, ${row.id}::uuid, ${ciphertext}, ${digest(content)}, now() + interval '15 minutes')`;
          await tx.$executeRaw`update public.privacy_requests set status = 'EXECUTING', version = version + 1
            where id = ${row.id}::uuid and organization_id = ${organizationId}::uuid`;
          result = { id: exportId, status: "READY_FOR_REQUESTER", expiresInSeconds: 900, version: row.version + 1 };
        } else if (command.action === "DELETE_EXECUTE") {
          if (row.request_type !== "DELETE") throw new ComplianceError("REQUEST_TYPE_MISMATCH");
          const execution = await executeDeletion(tx, row, command.planDigest);
          await tx.$executeRaw`update public.privacy_requests set status = ${execution.completed ? "COMPLETED" : "EXECUTING"}, version = version + 1
            where id = ${row.id}::uuid and organization_id = ${organizationId}::uuid`;
          result = execution;
        } else if (command.action === "RECORD_RESULT") {
          // A manual attestation cannot masquerade as data delivery or automated erasure.
          if (!["COMPLAINT", "CORRECT", "STOP", "MARKETING_STOP"].includes(row.request_type)) throw new ComplianceError("EXECUTOR_REQUIRED");
          const message = seal(command.reason, { organizationId, recordId: row.id, field: "decision" });
          await tx.$executeRaw`update public.privacy_requests set status = 'COMPLETED', version = version + 1,
            execution_evidence = ${command.executionEvidence}, decision_ciphertext = ${message}, decision_at = now()
            where id = ${row.id}::uuid and organization_id = ${organizationId}::uuid`;
          result = { id: row.id, status: "COMPLETED", evidenceType: "OPERATOR_ATTESTATION", version: row.version + 1 };
        }
      }
    }
    await appendComplianceAudit(tx, { organizationId, actorId: principal.user.id,
      action: `PRIVACY_${command.action}`, entityId, requestId });
    return result;
  });
}
