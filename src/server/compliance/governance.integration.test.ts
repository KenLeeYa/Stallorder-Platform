import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { randomUUID, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { SessionPrincipal } from "@/lib/auth";
import { createPrivacyRequest, listPrivacyRequests, transitionPrivacyRequest } from "./privacy-service";
import { runGovernanceCommand } from "./governance-service";
import { receivePrivacyExport } from "./export-service";
import { recordIncident } from "./incident-service";
import { commandBinding } from "./governance-contracts";
import { digest } from "./crypto";
import { bindScope, withActor } from "./access";

const enabled = process.env.COMPLIANCE_DB_TESTS === "true";
describe.runIf(enabled)("governance on the explicitly isolated PostgreSQL runtime", () => {
  const org = "11111111-1111-4111-8111-111111111111";
  const other = "11111111-1111-4111-8111-111111111112";
  const owner = "55555555-5555-4555-8555-555555555551";
  const policy = `synthetic-${randomUUID()}`;
  let principal: SessionPrincipal;
  let receipt: Awaited<ReturnType<typeof createPrivacyRequest>>;
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    if (url.hostname !== "127.0.0.1" || url.port !== "55992" || url.pathname !== "/postgres") throw new Error("ISOLATION_REQUIRED");
    const profile = await prisma.profile.findUniqueOrThrow({ where: { id: owner } });
    const session = await prisma.authSession.create({ data: { profileId: owner, tokenHash: digest(randomUUID()), csrfTokenHash: digest(randomUUID()),
      expiresAt: new Date(Date.now() + 3600000), profileSessionVersion: profile.sessionVersion } });
    principal = { sessionId: session.id, sessionExpiresAt: session.expiresAt, csrfTokenHash: session.csrfTokenHash,
      user: { id: owner, authUserId: profile.authUserId, email: profile.email, displayName: profile.displayName, platformRole: profile.platformRole } };
    await prisma.$executeRaw`insert into public.privacy_policy_versions(version, document_sha256, notice_text, lawful_basis, approved_by, effective_at)
      values (${policy}, ${digest(policy)}, 'SYNTHETIC QA ONLY', 'TEST_ONLY', ${owner}::uuid, now())`;
  });
  afterAll(async () => {
    if (principal) await prisma.authSession.update({ where: { id: principal.sessionId }, data: { revokedAt: new Date(), revokeReason: "SYNTHETIC_QA_FINISHED" } });
    await prisma.$disconnect();
  });
  async function proof(action: string, command: unknown) {
    const token = randomBytes(32).toString("base64url");
    // Test fixture only; provider proof verification is tested separately with signed JWTs.
    await prisma.$executeRaw`insert into public.security_step_up_grants(session_id, action, content_digest, token_hash, assurance, expires_at)
      values (${principal.sessionId}::uuid, ${action}, ${digest(commandBinding(org, command))}, ${digest(token)}, 'aal2', now() + interval '5 minutes')`;
    return token;
  }
  it("creates idempotently, rejects payload conflicts, and rolls back business state if audit fails", async () => {
    const command = { operationId: randomUUID(), type: "ACCESS" as const, policyVersion: policy, details: "Only my account" };
    receipt = await prisma.$transaction((tx) => createPrivacyRequest(tx, { organizationId: org, profileId: owner }, command, randomUUID()));
    const replay = await prisma.$transaction((tx) => createPrivacyRequest(tx, { organizationId: org, profileId: owner }, command, randomUUID()));
    expect(replay.receipt).toBe(receipt.receipt); expect(replay.id).toBe(receipt.id);
    await expect(prisma.$transaction((tx) => createPrivacyRequest(tx, { organizationId: org, profileId: owner }, { ...command, details: "different" }, randomUUID()))).rejects.toThrow("IDEMPOTENCY_CONFLICT");
    const failedOperation = randomUUID();
    await expect(prisma.$transaction(async (tx) => {
      await createPrivacyRequest(tx, { organizationId: org, profileId: owner }, { ...command, operationId: failedOperation }, randomUUID());
      // Actual DB constraint failure in the mandatory audit outbox, not a mocked helper.
      await tx.$executeRaw`insert into public.audit_archive_outbox(audit_id, organization_id, event_digest) values (${randomUUID()}::uuid, ${org}::uuid, 'invalid')`;
    })).rejects.toThrow();
    const rows = await prisma.$queryRaw<{ count: bigint }[]>`select count(*) from public.privacy_requests where operation_id = ${failedOperation}::uuid`;
    expect(Number(rows[0].count)).toBe(0);
  });
  it("enforces owner scope, review order, command binding, one-use proof and data minimization", async () => {
    await expect(listPrivacyRequests(principal, other, 1, randomUUID())).rejects.toThrow("SCOPE_DENIED");
    await transitionPrivacyRequest(principal, org, { id: receipt.id, expectedVersion: 1, status: "REVIEWING", reason: "Synthetic review" }, randomUUID());
    const approve = { id: receipt.id, expectedVersion: 2, status: "APPROVED" as const, reason: "Synthetic verification" };
    await expect(transitionPrivacyRequest(principal, org, approve, randomUUID())).rejects.toThrow("STEP_UP_REQUIRED");
    const token = await proof("PRIVACY_APPROVE", approve);
    await expect(transitionPrivacyRequest(principal, org, { ...approve, reason: "changed" }, randomUUID(), token)).rejects.toThrow("STEP_UP_REQUIRED");
    await transitionPrivacyRequest(principal, org, approve, randomUUID(), token);
    const command = { action: "EXPORT" as const, id: receipt.id, expectedVersion: 3 };
    await expect(runGovernanceCommand(principal, org, command, randomUUID(), token)).rejects.toThrow("STEP_UP_REQUIRED");
    const exported = await runGovernanceCommand(principal, org, command, randomUUID(), await proof("PRIVACY_EXPORT", command)) as { id: string };
    await expect(receivePrivacyExport({ organizationId: org, receipt: receipt.receipt }, null, randomUUID())).rejects.toThrow("LOGIN_REQUIRED");
    const data = await receivePrivacyExport({ organizationId: org, receipt: receipt.receipt }, principal, randomUUID());
    expect(data).toHaveProperty("data.profile.id", owner);
    expect(JSON.stringify(data)).not.toMatch(/password|tokenHash|csrf|authUserId|otherOrganization/);
    await prisma.$executeRaw`update public.privacy_exports set created_at = now() - interval '2 minutes',
      expires_at = now() - interval '1 second' where id = ${exported.id}::uuid`;
    await expect(receivePrivacyExport({ organizationId: org, receipt: receipt.receipt }, principal, randomUUID())).rejects.toThrow("EXPORT_NOT_FOUND");
    // Restore only this synthetic fixture's TTL so revocation is tested independently of expiry.
    await prisma.$executeRaw`update public.privacy_exports set expires_at = now() + interval '5 minutes' where id = ${exported.id}::uuid`;
    await expect(receivePrivacyExport({ organizationId: org, receipt: receipt.receipt }, principal, randomUUID())).resolves.toHaveProperty("data.profile.id", owner);
    await runGovernanceCommand(principal, org, { action: "REVOKE_EXPORT", id: exported.id, reason: "Synthetic revoke" }, randomUUID(), null);
    await expect(receivePrivacyExport({ organizationId: org, receipt: receipt.receipt }, principal, randomUUID())).rejects.toThrow("EXPORT_NOT_FOUND");
  });
  it("rejects complaint extensions and moving incident awareness later", async () => {
    const result = await recordIncident(principal, org, { state: "DETECTED", awarenessAt: new Date(Date.now() - 1000).toISOString(), facts: "Synthetic incident test",
      digitalIndustryApplicable: null, normalOperationsAtRisk: null, largeSubjectImpact: null, notificationStatus: "ASSESSING", submissionEvidence: null, affectedCount: null, countConfidence: "UNKNOWN" }, randomUUID());
    expect(result.notificationDueAt).toBeNull(); expect(result.externalDispatch).toBe("NOT_SENT");
    await expect(recordIncident(principal, org, { id: result.id, expectedVersion: 1, state: "TRIAGED", awarenessAt: new Date().toISOString(), facts: "Synthetic incident test",
      digitalIndustryApplicable: true, normalOperationsAtRisk: true, largeSubjectImpact: null, notificationStatus: "DRAFT", submissionEvidence: null, affectedCount: 1, countConfidence: "ESTIMATE" }, randomUUID())).rejects.toThrow("INCIDENT_AWARENESS_CANNOT_MOVE_LATER");
    const complaint = await prisma.$transaction((tx) => createPrivacyRequest(tx, { organizationId: org, profileId: owner },
      { operationId: randomUUID(), type: "COMPLAINT", policyVersion: policy, details: "Synthetic complaint" }, randomUUID()));
    await expect(runGovernanceCommand(principal, org, { action: "EXTEND", id: complaint.id, expectedVersion: 1, days: 1, reason: "Synthetic reason",
      notifiedAt: new Date().toISOString(), deliveryEvidence: "synthetic-receipt-only" }, randomUUID(), null)).rejects.toThrow("PRIVACY_DEADLINE_INVALID");
  });
  it("previews without erasure, respects a contact hold, preserves financial fields and retries unresolved targets", async () => {
    const stall = await prisma.stall.findFirstOrThrow({ where: { organizationId: org, isActive: true }, select: { id: true } });
    const order = await prisma.order.create({ data: { organizationId: org, stallId: stall.id, orderNo: `QA-${randomUUID().slice(0, 8)}`,
      trackingTokenHash: digest(randomUUID()), idempotencyKey: randomUUID(), customerName: "Synthetic customer", customerPhone: "0900000000",
      fulfillmentType: "DELIVERY", deliveryAddress: "SYNTHETIC ADDRESS", subtotal: 100, total: 100, status: "COMPLETED", paymentStatus: "PAID", isTest: true,
      deviceHash: digest(randomUUID()), confirmationExpiresAt: new Date(), completedAt: new Date(Date.now() - 3 * 86400000) } });
    await prisma.$executeRaw`insert into public.retention_policy_versions(data_class,version,start_event,retain_days,legal_basis,approved_by,approved_at,effective_at)
      values ('CUSTOMER_CONTACT', ${policy}, 'PURPOSE_ENDED', 1, 'SYNTHETIC_TEST_NOT_LEGAL_POLICY', ${owner}::uuid, now(), now())`;
    const request = await prisma.$transaction((tx) => createPrivacyRequest(tx, { organizationId: org, stallId: stall.id, orderId: order.id },
      { operationId: randomUUID(), type: "DELETE", policyVersion: policy, details: "Delete only this synthetic order contact" }, randomUUID()));
    await prisma.$executeRaw`update public.privacy_requests set status='APPROVED' where id=${request.id}::uuid`;
    const preview = { action: "DELETE_PREVIEW" as const, id: request.id, expectedVersion: 1 };
    let plan = await runGovernanceCommand(principal, org, preview, randomUUID(), null) as { planDigest: string; targets: { target: string; blocked: string | null }[] };
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).customerPhone).toBe("0900000000");
    expect(plan.targets.find((target) => target.target === "DATABASE_CONTACT")?.blocked).toBeNull();
    const holdCommand = { action: "HOLD" as const, orderId: order.id, stallId: stall.id, classes: ["CUSTOMER_CONTACT" as const], reason: "Synthetic litigation preservation",
      reviewAt: new Date(Date.now() + 86400000).toISOString(), expiresAt: new Date(Date.now() + 2 * 86400000).toISOString() };
    const hold = await runGovernanceCommand(principal, org, holdCommand, randomUUID(), await proof("PRIVACY_DELETE", holdCommand)) as { id: string };
    plan = await runGovernanceCommand(principal, org, preview, randomUUID(), null) as typeof plan;
    expect(plan.targets.find((target) => target.target === "DATABASE_CONTACT")?.blocked).toBe("LEGAL_HOLD");
    const release = { action: "RELEASE_HOLD" as const, id: hold.id, reason: "Synthetic preservation completed" };
    await runGovernanceCommand(principal, org, release, randomUUID(), await proof("PRIVACY_DELETE", release));
    plan = await runGovernanceCommand(principal, org, preview, randomUUID(), null) as typeof plan;
    const execute = { action: "DELETE_EXECUTE" as const, id: request.id, expectedVersion: 1, planDigest: plan.planDigest, reason: "Approved synthetic deletion" };
    const token = await proof("PRIVACY_DELETE", execute);
    await expect(runGovernanceCommand(principal, org, execute, randomUUID(), token)).rejects.toThrow("DELETION_DRY_RUN_ONLY");
    process.env.COMPLIANCE_DELETION_DRY_RUN = "false";
    try {
      const result = await runGovernanceCommand(principal, org, execute, randomUUID(), token) as { completed: boolean };
      expect(result.completed).toBe(false);
      const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(after.customerName).toBe("[removed]"); expect(after.customerPhone).toBeNull();
      expect(after.total).toBe(order.total); expect(after.paymentStatus).toBe(order.paymentStatus); expect(after.status).toBe(order.status);
      const pending = await prisma.$queryRaw<{ target: string }[]>`select target from public.privacy_deletion_tasks
        where request_id=${request.id}::uuid and status='BLOCKED'`;
      expect(pending.map((target) => target.target)).toContain("VENDOR");
      const tombstones = await prisma.$queryRaw<{ target: string; subject_hash: string }[]>`select target,subject_hash from public.privacy_deletion_tombstones where request_id=${request.id}::uuid`;
      expect(tombstones).toHaveLength(4); expect(tombstones[0].subject_hash).not.toBe(order.id);
    } finally { process.env.COMPLIANCE_DELETION_DRY_RUN = "true"; }
  });
  it("clears tenant context after interleaving pooled transactions and rollback", async () => {
    await Promise.all([org, other].map((organizationId) => prisma.$transaction(async (tx) => {
      await bindScope(tx, organizationId);
      await tx.$queryRaw`select 1 as waited from pg_sleep(0.03)`;
      const rows = await tx.$queryRaw<{ value: string }[]>`select current_setting('app.compliance_organization_id',true) as value`;
      expect(rows[0].value).toBe(organizationId);
    })));
    await expect(prisma.$transaction(async (tx) => { await bindScope(tx, org); throw new Error("ROLLBACK_TEST"); })).rejects.toThrow("ROLLBACK_TEST");
    for (let index = 0; index < 4; index++) {
      const rows = await prisma.$queryRaw<{ value: string | null }[]>`select current_setting('app.compliance_organization_id',true) as value`;
      expect([null, ""]).toContain(rows[0].value);
    }
  });
  it("expires and revokes support access without impersonating the owner or allowing management", async () => {
    const profile = await prisma.profile.create({ data: { email: `qa-support-${randomUUID()}@example.invalid`,
      displayName: "Synthetic support", platformRole: "PLATFORM_ADMIN" } });
    const session = await prisma.authSession.create({ data: { profileId: profile.id, tokenHash: digest(randomUUID()), csrfTokenHash: digest(randomUUID()),
      expiresAt: new Date(Date.now() + 3600000), profileSessionVersion: profile.sessionVersion } });
    const support: SessionPrincipal = { sessionId: session.id, sessionExpiresAt: session.expiresAt, csrfTokenHash: session.csrfTokenHash,
      user: { id: profile.id, authUserId: profile.authUserId, email: profile.email, displayName: profile.displayName, platformRole: profile.platformRole } };
    try {
      await expect(listPrivacyRequests(support, org, 1, randomUUID())).rejects.toThrow("SCOPE_DENIED");
      const command = { action: "SUPPORT_GRANT" as const, actorId: profile.id, purpose: "Synthetic status assistance", minutes: 1 };
      const granted = await runGovernanceCommand(principal, org, command, randomUUID(), await proof("SUPPORT_GRANT", command)) as { id: string };
      const requestId = randomUUID();
      expect((await listPrivacyRequests(support, org, 1, requestId)).length).toBeGreaterThan(0);
      const event = await prisma.auditLog.findFirstOrThrow({ where: { requestId } });
      expect(event.actorProfileId).toBe(profile.id);
      expect(event.afterJson).toHaveProperty("effectiveActorId", profile.id);
      await expect(withActor(support, org, "MANAGE", async () => true)).rejects.toThrow("SCOPE_DENIED");
      await runGovernanceCommand(principal, org, { action: "SUPPORT_REVOKE", id: granted.id, reason: "Synthetic assistance finished" }, randomUUID(), null);
      await expect(listPrivacyRequests(support, org, 1, randomUUID())).rejects.toThrow("SCOPE_DENIED");
      const again = await runGovernanceCommand(principal, org, command, randomUUID(), await proof("SUPPORT_GRANT", command)) as { id: string };
      await prisma.$executeRaw`update public.security_support_grants set created_at = now() - interval '2 minutes',
        expires_at = now() - interval '1 second' where id = ${again.id}::uuid`;
      await expect(listPrivacyRequests(support, org, 1, randomUUID())).rejects.toThrow("SCOPE_DENIED");
      const self = { ...command, actorId: owner };
      await expect(runGovernanceCommand(principal, org, self, randomUUID(), await proof("SUPPORT_GRANT", self))).rejects.toThrow("SUPPORT_SELF_APPROVAL_DENIED");
    } finally {
      await prisma.authSession.update({ where: { id: session.id }, data: { revokedAt: new Date(), revokeReason: "SYNTHETIC_QA_FINISHED" } });
      await prisma.profile.update({ where: { id: profile.id }, data: { isActive: false } });
    }
  });
});
