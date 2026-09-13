import "server-only";
import type { Prisma } from "@prisma/client";
import { digest, subjectDigest } from "./crypto";
import { ComplianceError } from "./access";

export const deletionTargets = ["DATABASE_CONTACT", "PRINT_PAYLOAD", "STORAGE", "CACHE", "SEARCH", "NOTIFICATIONS", "EXPORTS", "ANALYTICS", "VENDOR"] as const;
type RequestScope = { id: string; organization_id: string; stall_id: string | null; order_id: string | null; subject_profile_id: string | null; policy_version: string };
export async function deletionPlan(tx: Prisma.TransactionClient, row: RequestScope) {
  const order = row.order_id ? await tx.order.findFirst({ where: { id: row.order_id, organizationId: row.organization_id, stallId: row.stall_id! },
    select: { id: true, status: true, updatedAt: true, completedAt: true, cancelledAt: true, expiredAt: true } }) : null;
  const holds = await tx.$queryRaw<{ id: string; data_classes: string[] }[]>`select id, data_classes from public.privacy_legal_holds
    where organization_id = ${row.organization_id}::uuid and released_at is null
    and (order_id is null or order_id = ${row.order_id}::uuid) order by id`;
  // An overdue hold requires review, not automatic disappearance of preservation.
  const policy = await tx.$queryRaw<{ version: string; retain_days: number; start_event: string }[]>`select version, retain_days, start_event
    from public.retention_policy_versions where data_class = 'CUSTOMER_CONTACT'
    and approved_by is not null and effective_at <= now() order by effective_at desc, id desc limit 1`;
  const endedAt = order?.completedAt ?? order?.cancelledAt ?? order?.expiredAt;
  const due = endedAt && policy[0]?.start_event === "PURPOSE_ENDED"
    ? endedAt.getTime() + policy[0].retain_days * 86400000 <= Date.now() : false;
  const contactHeld = holds.some((hold) => hold.data_classes.includes("CUSTOMER_CONTACT"));
  const printHeld = holds.some((hold) => hold.data_classes.includes("PRINT_PAYLOAD"));
  const terminal = !!order && ["COMPLETED", "CANCELLED", "EXPIRED"].includes(order.status);
  const scope = { organizationId: row.organization_id, orderId: row.order_id ?? "00000000-0000-0000-0000-000000000000", ...(row.stall_id ? { stallId: row.stall_id } : {}) };
  const [printing, notifying, prints, notifications] = await Promise.all([
    tx.printJob.count({ where: { ...scope, status: { in: ["PENDING", "PRINTING"] } } }),
    tx.notificationJob.count({ where: { ...scope, status: "PROCESSING" } }),
    tx.printJob.count({ where: scope }), tx.notificationJob.count({ where: scope }),
  ]);
  const exportRows = await tx.$queryRaw<{ count: bigint }[]>`select count(*) from public.privacy_exports export
    join public.privacy_requests request on request.id = export.request_id and request.organization_id = export.organization_id
    where request.organization_id = ${row.organization_id}::uuid and request.order_id = ${row.order_id}::uuid`;
  const common = !row.order_id ? "ACCOUNT_REVIEW_REQUIRED" : !terminal ? "FULFILLMENT_ACTIVE" : !due ? "APPROVED_RETENTION_NOT_DUE" : null;
  const targets = deletionTargets.map((target) => {
    let blocked: string | null = common;
    let count: number | null = null;
    if (target === "DATABASE_CONTACT") { count = order ? 1 : 0; blocked ||= contactHeld ? "LEGAL_HOLD" : null; }
    else if (target === "PRINT_PAYLOAD") { count = prints; blocked ||= printHeld ? "LEGAL_HOLD" : printing ? "PRINT_LEASE_ACTIVE" : null; }
    else if (target === "NOTIFICATIONS") { count = notifications; blocked ||= contactHeld ? "LEGAL_HOLD" : notifying ? "NOTIFICATION_LEASE_ACTIVE" : null; }
    else if (target === "EXPORTS") { count = Number(exportRows[0].count); }
    else { blocked = "VERIFIED_TARGET_INVENTORY_REQUIRED"; }
    return { target, count, blocked };
  });
  const material = { requestId: row.id, organizationId: row.organization_id, orderId: row.order_id,
    orderVersion: order?.updatedAt.toISOString() ?? null, policyVersion: policy[0]?.version ?? null,
    holds: holds.map((hold) => ({ id: hold.id, classes: [...hold.data_classes].sort() })), targets };
  return { ...material, planDigest: digest(JSON.stringify(material)), mode: "DRY_RUN" as const,
    preserved: ["ORDER_FINANCIAL_TOTALS", "PAYMENTS", "REFUNDS", "STOCK_LEDGER", "PAYG", "INVOICES", "AUDIT"] };
}
export async function executeDeletion(tx: Prisma.TransactionClient, row: RequestScope, expectedDigest: string) {
  if (process.env.COMPLIANCE_DELETION_DRY_RUN !== "false") throw new ComplianceError("DELETION_DRY_RUN_ONLY");
  if (row.order_id) await tx.$queryRaw`select id from public.orders where id = ${row.order_id}::uuid
    and organization_id = ${row.organization_id}::uuid for update`;
  const plan = await deletionPlan(tx, row);
  if (plan.planDigest !== expectedDigest) throw new ComplianceError("STALE_DELETION_PLAN");
  const scope = { organizationId: row.organization_id, orderId: row.order_id!, stallId: row.stall_id! };
  for (const task of plan.targets) {
    const previous = await tx.$queryRaw<{ status: string }[]>`select status from public.privacy_deletion_tasks
      where request_id = ${row.id}::uuid and organization_id = ${row.organization_id}::uuid and target = ${task.target}`;
    if (previous[0]?.status === "COMPLETED") continue;
    if (!task.blocked && task.target === "DATABASE_CONTACT") await tx.order.updateMany({
      where: { id: row.order_id!, organizationId: row.organization_id, stallId: row.stall_id! },
      data: { customerName: "[removed]", customerPhone: null, deliveryAddress: null, note: null,
        cancellationDetail: null, pickupCodeDisplay: null, privacyErasureRequestId: row.id, privacyContactErasedAt: new Date() },
    });
    if (!task.blocked && task.target === "PRINT_PAYLOAD") await tx.printJob.updateMany({ where: scope, data: { payload: { privacyRemoved: true }, lastError: null } });
    if (!task.blocked && task.target === "NOTIFICATIONS") {
      await tx.customerContactLink.updateMany({ where: { organizationId: row.organization_id, stallId: row.stall_id!, customerReferenceId: row.order_id! }, data: { consentStatus: "REVOKED", revokedAt: new Date() } });
      await tx.notificationJob.updateMany({ where: { ...scope, status: { in: ["PENDING", "FAILED"] } }, data: { status: "CANCELLED", lastErrorCode: "PRIVACY_RESTRICTED" } });
    }
    if (!task.blocked && task.target === "EXPORTS") await tx.$executeRaw`update public.privacy_exports export set revoked_at = now(), content_ciphertext = ''
      from public.privacy_requests request where export.request_id = request.id and export.organization_id = request.organization_id
      and request.organization_id = ${row.organization_id}::uuid and request.order_id = ${row.order_id}::uuid`;
    const status = task.blocked ? "BLOCKED" : "COMPLETED";
    const evidence = task.blocked ? null : `transaction:${row.id}:${task.target}:${plan.planDigest}`;
    await tx.$executeRaw`insert into public.privacy_deletion_tasks
      (organization_id, request_id, target, status, attempt, error_code, completed_at, plan_digest, result_evidence)
      values (${row.organization_id}::uuid, ${row.id}::uuid, ${task.target}, ${status}, 1, ${task.blocked},
        ${task.blocked ? null : new Date()}, ${plan.planDigest}, ${evidence})
      on conflict(request_id, target) do update set status = excluded.status, attempt = privacy_deletion_tasks.attempt + 1,
        error_code = excluded.error_code, completed_at = excluded.completed_at, plan_digest = excluded.plan_digest, result_evidence = excluded.result_evidence`;
    if (!task.blocked) await tx.$executeRaw`insert into public.privacy_deletion_tombstones
      (organization_id, request_id, subject_hash, target, policy_version) values
      (${row.organization_id}::uuid, ${row.id}::uuid, ${subjectDigest(row.order_id ?? row.subject_profile_id!, row.organization_id)},
       ${task.target}, ${plan.policyVersion!}) on conflict(request_id, target) do nothing`;
  }
  return { ...plan, mode: "EXECUTED", completed: plan.targets.every((target) => !target.blocked) };
}
