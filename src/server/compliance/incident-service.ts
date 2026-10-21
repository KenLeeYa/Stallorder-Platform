import "server-only";
import { randomUUID } from "node:crypto";
import type { z } from "zod";
import type { SessionPrincipal } from "@/lib/auth";
import { withActor, ComplianceError } from "./access";
import { appendComplianceAudit } from "./audit";
import { seal } from "./crypto";
import { incidentNotificationDue } from "./contracts";
import { canAdvanceIncident, type incidentCommand } from "./governance-contracts";

export async function recordIncident(principal: SessionPrincipal, organizationId: string, command: z.infer<typeof incidentCommand>, requestId: string) {
  return withActor(principal, organizationId, "MANAGE", async (tx) => {
    const id = command.id ?? randomUUID();
    const existing = await tx.$queryRaw<{ state: string; version: number; awareness_at: Date }[]>`select state, version, awareness_at
      from public.security_incidents where id = ${id}::uuid and organization_id = ${organizationId}::uuid for update`;
    const old = existing[0];
    if (command.id && (!old || old.version !== command.expectedVersion || !canAdvanceIncident(old.state, command.state))) throw new ComplianceError("STALE_INCIDENT");
    if (!command.id && (command.state !== "DETECTED" || command.expectedVersion)) throw new ComplianceError("INCIDENT_INITIAL_STATE_INVALID");
    const awareness = new Date(command.awarenessAt);
    if (awareness > new Date() || (old && awareness > old.awareness_at)) throw new ComplianceError("INCIDENT_AWARENESS_CANNOT_MOVE_LATER");
    const dueAt = incidentNotificationDue({ awarenessAt: awareness, digitalIndustryApplicable: command.digitalIndustryApplicable,
      normalOperationsAtRisk: command.normalOperationsAtRisk, largeSubjectImpact: command.largeSubjectImpact });
    const unknown = command.digitalIndustryApplicable === null || (command.digitalIndustryApplicable && command.normalOperationsAtRisk === null && command.largeSubjectImpact !== true)
      || (command.digitalIndustryApplicable && command.largeSubjectImpact === null && command.normalOperationsAtRisk !== true);
    if ((command.notificationStatus === "NOT_REQUIRED" && (dueAt || unknown))
      || (command.notificationStatus === "SUBMITTED" && !command.submissionEvidence)
      || (command.state === "CLOSED" && !["SUBMITTED", "NOT_REQUIRED"].includes(command.notificationStatus))) throw new ComplianceError("INCIDENT_NOTIFICATION_EVIDENCE_REQUIRED");
    const facts = seal(command.facts, { organizationId, recordId: id, field: "incidentFacts" });
    await tx.$executeRaw`insert into public.security_incidents(id, organization_id, state, awareness_at, facts_ciphertext, owner_profile_id,
      digital_industry_applicable, normal_operations_at_risk, large_subject_impact, notification_due_at, notification_status,
      submission_evidence, affected_count, count_confidence, version)
      values (${id}::uuid, ${organizationId}::uuid, ${command.state}, ${awareness}, ${facts}, ${principal.user.id}::uuid,
        ${command.digitalIndustryApplicable}, ${command.normalOperationsAtRisk}, ${command.largeSubjectImpact}, ${dueAt}, ${command.notificationStatus},
        ${command.submissionEvidence}, ${command.affectedCount}, ${command.countConfidence}, 1)
      on conflict(id) do update set state = excluded.state, awareness_at = excluded.awareness_at, facts_ciphertext = excluded.facts_ciphertext,
        digital_industry_applicable = excluded.digital_industry_applicable, normal_operations_at_risk = excluded.normal_operations_at_risk,
        large_subject_impact = excluded.large_subject_impact, notification_due_at = excluded.notification_due_at,
        notification_status = excluded.notification_status, submission_evidence = excluded.submission_evidence,
        affected_count = excluded.affected_count, count_confidence = excluded.count_confidence, version = security_incidents.version + 1`;
    await appendComplianceAudit(tx, { organizationId, actorId: principal.user.id, action: "SECURITY_INCIDENT_RECORDED", entityId: id, requestId, version: (old?.version ?? 0) + 1 });
    return { id, version: (old?.version ?? 0) + 1, state: command.state, notificationDueAt: dueAt,
      notificationStatus: command.notificationStatus, overdue: !!dueAt && dueAt < new Date(), externalDispatch: "NOT_SENT" };
  });
}
